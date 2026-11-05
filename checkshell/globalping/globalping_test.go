package globalping

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

type fakeServer struct {
	t             *testing.T
	probesCount   int
	results       string
	pollsToFinish int
	createStatus  int
	getCount      int
	createBody    map[string]interface{}
	createAuth    string
	getAuth       string
}

func (f *fakeServer) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	f.t.Helper()
	if r.Method == http.MethodPost && r.URL.Path == "/measurements" {
		f.createAuth = r.Header.Get("Authorization")
		if err := json.NewDecoder(r.Body).Decode(&f.createBody); err != nil {
			f.t.Fatalf("decode create body: %v", err)
		}
		if f.createStatus != 0 {
			w.WriteHeader(f.createStatus)
			_, _ = w.Write([]byte(`{"error":"rate limited"}`))
			return
		}
		w.WriteHeader(http.StatusAccepted)
		fmt.Fprintf(w, `{"id":"m1","probesCount":%d}`, f.probesCount)
		return
	}
	if r.Method == http.MethodGet && strings.HasPrefix(r.URL.Path, "/measurements/") {
		f.getAuth = r.Header.Get("Authorization")
		f.getCount++
		if f.pollsToFinish > 0 && f.getCount < f.pollsToFinish {
			_, _ = w.Write([]byte(`{"id":"m1","status":"in-progress","results":[]}`))
			return
		}
		fmt.Fprintf(w, `{"id":"m1","status":"finished","results":%s}`, f.results)
		return
	}
	http.NotFound(w, r)
}

func newTestClient(t *testing.T, fake *fakeServer, opts Options) *Client {
	t.Helper()
	server := httptest.NewServer(fake)
	t.Cleanup(server.Close)
	opts.BaseURL = server.URL
	opts.PollInterval = 10 * time.Millisecond
	if opts.Timeout == 0 {
		opts.Timeout = 2 * time.Second
	}
	return NewClient(opts)
}

func twoProbes() string {
	return `[{"probe":{"country":"CN","city":"Beijing","network":"Tencent"},"result":{"status":"finished","statusCode":200,"timings":{"total":100},"stats":{"avg":0,"rcv":0}}},{"probe":{"country":"JP","city":"Tokyo","network":"xTom"},"result":{"status":"finished","statusCode":200,"timings":{"total":300},"stats":{"avg":0,"rcv":0}}}]`
}

func TestCheckSuccess(t *testing.T) {
	fake := &fakeServer{t: t, probesCount: 2, results: twoProbes()}
	client := newTestClient(t, fake, Options{
		Type:      "http",
		Method:    "HEAD",
		Locations: []Location{{Country: "CN", Limit: 1}, {Country: "JP", Limit: 1}},
	})

	result, err := client.Check(context.Background(), "https://www.shadowq.com/some/path?q=1")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.OK != 2 || result.Total != 2 {
		t.Fatalf("OK/Total = %d/%d, want 2/2", result.OK, result.Total)
	}
	if result.Latency == nil || *result.Latency != 200 {
		t.Fatalf("latency = %v, want 200", result.Latency)
	}
	if len(result.Probes) != 2 {
		t.Fatalf("probes = %d, want 2", len(result.Probes))
	}
	if fake.createBody["type"] != "http" || fake.createBody["target"] != "www.shadowq.com" {
		t.Fatalf("create body type/target = %v/%v", fake.createBody["type"], fake.createBody["target"])
	}
	locations, _ := fake.createBody["locations"].([]interface{})
	if len(locations) != 2 {
		t.Fatalf("locations = %v, want 2", fake.createBody["locations"])
	}
	options, _ := fake.createBody["measurementOptions"].(map[string]interface{})
	request, _ := options["request"].(map[string]interface{})
	if options["protocol"] != "HTTPS" || request["method"] != "HEAD" || request["path"] != "/some/path?q=1" {
		t.Fatalf("measurementOptions = %#v", options)
	}
}

func TestCheckPartialAndFailure(t *testing.T) {
	partialResults := `[{"probe":{"country":"CN"},"result":{"status":"finished","statusCode":200,"timings":{"total":120}}},{"probe":{"country":"JP"},"result":{"status":"failed","rawOutput":"timeout"}}]`
	fake := &fakeServer{t: t, probesCount: 2, results: partialResults}
	client := newTestClient(t, fake, Options{Locations: []Location{{Country: "CN", Limit: 1}, {Country: "JP", Limit: 1}}})
	result, err := client.Check(context.Background(), "https://www.shadowq.com")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.OK != 1 || result.Total != 2 {
		t.Fatalf("OK/Total = %d/%d, want 1/2", result.OK, result.Total)
	}
	if result.Probes[1].OK || result.Probes[1].Error == "" {
		t.Fatalf("failed probe = %+v, want error", result.Probes[1])
	}

	allFailed := `[{"probe":{"country":"CN"},"result":{"status":"failed","rawOutput":"timeout"}},{"probe":{"country":"JP"},"result":{"status":"failed","rawOutput":"refused"}}]`
	fake = &fakeServer{t: t, probesCount: 2, results: allFailed}
	client = newTestClient(t, fake, Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	result, err = client.Check(context.Background(), "https://www.shadowq.com")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.OK != 0 || result.Latency != nil {
		t.Fatalf("result = %+v, want 0 ok and nil latency", result)
	}
}

func TestCheckPing(t *testing.T) {
	results := `[{"probe":{"country":"CN"},"result":{"status":"finished","stats":{"avg":57.4,"rcv":3,"loss":0}}},{"probe":{"country":"US"},"result":{"status":"finished","stats":{"avg":153,"rcv":0,"loss":100}}}]`
	fake := &fakeServer{t: t, probesCount: 2, results: results}
	client := newTestClient(t, fake, Options{Type: "ping", Locations: []Location{{Country: "CN", Limit: 1}}})
	result, err := client.Check(context.Background(), "https://www.shadowq.com/path")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.OK != 1 || result.Total != 2 {
		t.Fatalf("OK/Total = %d/%d, want 1/2", result.OK, result.Total)
	}
	if result.Latency == nil || *result.Latency != 57 {
		t.Fatalf("latency = %v, want 57", result.Latency)
	}
	if fake.createBody["type"] != "ping" || fake.createBody["target"] != "www.shadowq.com" {
		t.Fatalf("ping body = %#v", fake.createBody)
	}
}

func TestCheckHTTPErrorStatus(t *testing.T) {
	results := `[{"probe":{"country":"CN"},"result":{"status":"finished","statusCode":503,"timings":{"total":20}}}]`
	fake := &fakeServer{t: t, probesCount: 1, results: results}
	client := newTestClient(t, fake, Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	result, err := client.Check(context.Background(), "https://www.shadowq.com")
	if err != nil {
		t.Fatalf("check: %v", err)
	}
	if result.OK != 0 {
		t.Fatalf("OK = %d, want 0 for status 503", result.OK)
	}
	if result.Probes[0].StatusCode != 503 {
		t.Fatalf("status code = %d, want 503", result.Probes[0].StatusCode)
	}
}

func TestCheckRateLimit(t *testing.T) {
	fake := &fakeServer{t: t, createStatus: http.StatusTooManyRequests}
	client := newTestClient(t, fake, Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	if _, err := client.Check(context.Background(), "https://www.shadowq.com"); err == nil {
		t.Fatal("check succeeded, want rate limit error")
	} else if !strings.Contains(err.Error(), "rate limit") {
		t.Fatalf("error = %v, want rate limit mention", err)
	}
}

func TestCheckAPIError(t *testing.T) {
	fake := &fakeServer{t: t, createStatus: http.StatusInternalServerError}
	client := newTestClient(t, fake, Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	if _, err := client.Check(context.Background(), "https://www.shadowq.com"); err == nil {
		t.Fatal("check succeeded, want API error")
	}
}

func TestCheckPollTimeout(t *testing.T) {
	fake := &fakeServer{t: t, probesCount: 1, pollsToFinish: 1 << 30}
	client := newTestClient(t, fake, Options{
		Locations: []Location{{Country: "CN", Limit: 1}},
		Timeout:   150 * time.Millisecond,
	})
	if _, err := client.Check(context.Background(), "https://www.shadowq.com"); err == nil {
		t.Fatal("check succeeded, want poll timeout")
	}
}

func TestCheckAuthHeader(t *testing.T) {
	fake := &fakeServer{t: t, probesCount: 1, results: `[{"probe":{"country":"CN"},"result":{"status":"finished","statusCode":200,"timings":{"total":10}}}]`}
	client := newTestClient(t, fake, Options{Token: "secret-token", Locations: []Location{{Country: "CN", Limit: 1}}})
	if _, err := client.Check(context.Background(), "https://www.shadowq.com"); err != nil {
		t.Fatalf("check: %v", err)
	}
	if fake.createAuth != "Bearer secret-token" || fake.getAuth != "Bearer secret-token" {
		t.Fatalf("auth headers = %q/%q, want Bearer secret-token", fake.createAuth, fake.getAuth)
	}
}

func TestCheckInvalidTarget(t *testing.T) {
	client := NewClient(Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	for _, target := range []string{"ftp://example.com", "https://example.com:8080", "not-a-url"} {
		if _, err := client.Check(context.Background(), target); err == nil {
			t.Fatalf("target %q: check succeeded, want error", target)
		}
	}
	if _, err := NewClient(Options{}).Check(context.Background(), "https://example.com"); err == nil {
		t.Fatal("missing locations: check succeeded, want error")
	}
}

func TestBuildMeasurementDefaults(t *testing.T) {
	request, err := buildMeasurement("http://example.com", Options{Locations: []Location{{Country: "CN", Limit: 1}}})
	if err != nil {
		t.Fatalf("buildMeasurement: %v", err)
	}
	if request.Type != "http" || request.Target != "example.com" {
		t.Fatalf("request = %+v", request)
	}
	options, _ := request.MeasurementOptions.(map[string]interface{})
	requestOptions, _ := options["request"].(map[string]interface{})
	if options["protocol"] != "HTTP" || requestOptions["method"] != DefaultMethod || requestOptions["path"] != "/" {
		t.Fatalf("options = %#v", options)
	}
}
