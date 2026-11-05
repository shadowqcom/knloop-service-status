package checker

import (
	"context"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

type fakePeer struct {
	name  string
	err   error
	calls int32
}

func (p *fakePeer) Name() string { return p.name }

func (p *fakePeer) Reachable(ctx context.Context, targetURL string) error {
	atomic.AddInt32(&p.calls, 1)
	return p.err
}

func testOptions() Options {
	return Options{
		Attempts:         3,
		MinSuccess:       2,
		Timeout:          2 * time.Second,
		RetryDelay:       time.Millisecond,
		PeerCheckEnabled: true,
		PeerTimeout:      time.Second,
		UserAgent:        "test-agent",
	}
}

func TestProbeAllSuccess(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		atomic.AddInt32(&requests, 1)
		if ua := r.Header.Get("User-Agent"); ua != "test-agent" {
			t.Errorf("User-Agent = %q, want test-agent", ua)
		}
		if accept := r.Header.Get("Accept"); !strings.Contains(accept, "text/html") {
			t.Errorf("Accept = %q, want text/html", accept)
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	prober := NewProber(server.Client(), nil)
	result := prober.Probe(context.Background(), server.URL, testOptions())

	if result.Status != StatusSuccess {
		t.Fatalf("status = %q, want success", result.Status)
	}
	if result.OK != 3 || result.Tries != 3 {
		t.Fatalf("ok/tries = %d/%d, want 3/3", result.OK, result.Tries)
	}
	if result.Latency == nil {
		t.Fatal("latency = nil, want non-nil")
	}
	if got := atomic.LoadInt32(&requests); got != 3 {
		t.Fatalf("requests = %d, want 3", got)
	}
}

func TestProbePartial(t *testing.T) {
	var requests int32
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if atomic.AddInt32(&requests, 1) <= 2 {
			w.WriteHeader(http.StatusInternalServerError)
			return
		}
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	result := NewProber(server.Client(), nil).Probe(context.Background(), server.URL, testOptions())
	if result.Status != StatusPartial {
		t.Fatalf("status = %q, want partial", result.Status)
	}
	if result.OK != 1 || result.Tries != 3 {
		t.Fatalf("ok/tries = %d/%d, want 1/3", result.OK, result.Tries)
	}
	if result.Latency == nil {
		t.Fatal("partial with one success must keep its latency")
	}
}

func TestProbeFailureCorroboratedByPeer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusInternalServerError)
	}))
	defer server.Close()

	peer := &fakePeer{name: "fake"}
	result := NewProber(server.Client(), []Peer{peer}).Probe(context.Background(), server.URL, testOptions())
	if result.Status != StatusPartial {
		t.Fatalf("status = %q, want partial (peer reachable)", result.Status)
	}
	if !result.PeerReachable {
		t.Fatal("PeerReachable = false, want true")
	}
	if result.Latency != nil {
		t.Fatalf("latency = %v, want nil (peer latency must not count)", *result.Latency)
	}
	if got := atomic.LoadInt32(&peer.calls); got != 1 {
		t.Fatalf("peer calls = %d, want 1", got)
	}
}

func TestProbePeerNotCalledWhenLocalSucceeds(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusOK)
	}))
	defer server.Close()

	peer := &fakePeer{name: "fake"}
	result := NewProber(server.Client(), []Peer{peer}).Probe(context.Background(), server.URL, testOptions())
	if result.Status != StatusSuccess {
		t.Fatalf("status = %q, want success", result.Status)
	}
	if got := atomic.LoadInt32(&peer.calls); got != 0 {
		t.Fatalf("peer calls = %d, want 0", got)
	}
}

func TestProbeFailureWhenPeerUnreachable(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	peer := &fakePeer{name: "fake", err: fmt.Errorf("peer down")}
	result := NewProber(server.Client(), []Peer{peer}).Probe(context.Background(), server.URL, testOptions())
	if result.Status != StatusFailure {
		t.Fatalf("status = %q, want failure", result.Status)
	}
	if result.Latency != nil {
		t.Fatal("latency must be nil for failure")
	}
	if result.OK != 0 || result.Tries != 3 {
		t.Fatalf("ok/tries = %d/%d, want 0/3", result.OK, result.Tries)
	}
}

func TestProbeRedirectLimit(t *testing.T) {
	handler := func(totalRedirects int) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			var n int
			fmt.Sscanf(r.URL.Path, "/%d", &n)
			if n < totalRedirects {
				http.Redirect(w, r, fmt.Sprintf("/%d", n+1), http.StatusFound)
				return
			}
			w.WriteHeader(http.StatusOK)
		})
	}

	ten := httptest.NewServer(handler(10))
	defer ten.Close()
	options := Options{Attempts: 1, MinSuccess: 1, Timeout: 2 * time.Second, RetryDelay: time.Millisecond}
	result := NewProber(ten.Client(), nil).Probe(context.Background(), ten.URL+"/0", options)
	if result.Status != StatusSuccess {
		t.Fatalf("10 redirect hops: status = %q, want success", result.Status)
	}

	eleven := httptest.NewServer(handler(11))
	defer eleven.Close()
	result = NewProber(eleven.Client(), nil).Probe(context.Background(), eleven.URL+"/0", options)
	if result.Status != StatusFailure {
		t.Fatalf("11 redirect hops: status = %q, want failure (limit is 10)", result.Status)
	}
}

func TestProbeStatusCodeRules(t *testing.T) {
	tests := []struct {
		name     string
		handler  http.HandlerFunc
		expected string
	}{
		{
			name:     "final 3xx without location is success",
			handler:  func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusMovedPermanently) },
			expected: StatusSuccess,
		},
		{
			name:     "404 is failure",
			handler:  func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNotFound) },
			expected: StatusFailure,
		},
		{
			name:     "500 is failure",
			handler:  func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusInternalServerError) },
			expected: StatusFailure,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			server := httptest.NewServer(test.handler)
			defer server.Close()
			options := Options{
				Attempts:         1,
				MinSuccess:       1,
				Timeout:          2 * time.Second,
				RetryDelay:       time.Millisecond,
				PeerCheckEnabled: false,
			}
			result := NewProber(server.Client(), nil).Probe(context.Background(), server.URL, options)
			if result.Status != test.expected {
				t.Fatalf("status = %q, want %q", result.Status, test.expected)
			}
		})
	}
}

func TestXXAPIPeer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/ping" {
			t.Errorf("path = %q, want /api/ping", r.URL.Path)
		}
		if got := r.URL.Query().Get("url"); got != "example.com" {
			t.Errorf("url param = %q, want example.com", got)
		}
		_, _ = w.Write([]byte("{\"code\":200,\"data\":{\"ip\":\"1.2.3.4\"}}"))
	}))
	defer server.Close()

	peer := newXXAPIPeer(server.Client(), server.URL)
	if err := peer.Reachable(context.Background(), "https://example.com/path"); err != nil {
		t.Fatalf("Reachable() error = %v", err)
	}
}

func TestUAPIPeer(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/v1/network/ping" {
			t.Errorf("path = %q, want /api/v1/network/ping", r.URL.Path)
		}
		if got := r.URL.Query().Get("host"); got != "example.com" {
			t.Errorf("host param = %q, want example.com (www trimmed)", got)
		}
		_, _ = w.Write([]byte("{\"host\":\"example.com\",\"ip\":\"1.2.3.4\"}"))
	}))
	defer server.Close()

	peer := newUAPIPeer(server.Client(), server.URL)
	if err := peer.Reachable(context.Background(), "https://www.example.com/"); err != nil {
		t.Fatalf("Reachable() error = %v", err)
	}
}

func TestPeerProviderFailure(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadGateway)
	}))
	defer server.Close()

	peers := []Peer{
		newXXAPIPeer(server.Client(), server.URL),
		newUAPIPeer(server.Client(), server.URL),
	}
	for _, peer := range peers {
		if err := peer.Reachable(context.Background(), "https://example.com"); err == nil {
			t.Fatalf("%s: Reachable() error = nil, want error", peer.Name())
		}
	}
}
