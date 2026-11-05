// Package globalping implements a minimal client for the Globalping
// (jsDelivr) public measurements API, used as an alternative detection source.
//
// The API is asynchronous: a measurement is created with POST /measurements,
// then polled with GET /measurements/{id} until the status is "finished".
// See https://globalping.io/docs/api.globalping.io for the full specification.
package globalping

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"math"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

const (
	// DefaultBaseURL is the public Globalping API endpoint.
	DefaultBaseURL = "https://api.globalping.io/v1"
	// DefaultType is the default measurement type.
	DefaultType = "http"
	// DefaultMethod is the default HTTP method. HEAD keeps API responses small
	// because Globalping echoes the response body for GET measurements.
	DefaultMethod = "HEAD"
	// DefaultTimeout bounds one whole Check call (create + polling).
	DefaultTimeout = 20 * time.Second
	// DefaultPollInterval is the delay between measurement polls.
	DefaultPollInterval = 1 * time.Second

	maxResponseBytes = 2 << 20
	maxErrorText     = 160
)

// Location selects probes for a measurement. Country is an ISO 3166-1 alpha-2
// code (e.g. CN, HK, JP, US); City, ASN and Magic are optional refinements.
type Location struct {
	Country string `json:"country,omitempty"`
	City    string `json:"city,omitempty"`
	ASN     int    `json:"asn,omitempty"`
	Magic   string `json:"magic,omitempty"`
	Limit   int    `json:"limit,omitempty"`
}

// Options configures a Client.
type Options struct {
	Type         string        // http (default) or ping
	Method       string        // HTTP method for type=http (default HEAD)
	Locations    []Location    // probes to request; required
	Timeout      time.Duration // whole Check deadline (default 20s)
	PollInterval time.Duration // poll delay (default 1s)
	UserAgent    string
	Token        string       // optional API token (higher rate limits)
	BaseURL      string       // override for tests/self-hosting
	HTTPClient   *http.Client // optional injectable client
}

// ProbeResult is the normalized outcome of a single probe.
type ProbeResult struct {
	Country    string
	City       string
	Network    string
	OK         bool
	StatusCode int
	LatencyMs  *int64
	Error      string
}

// Result is the outcome of one measurement across all probes.
type Result struct {
	MeasurementID string
	OK            int
	Total         int
	Latency       *int64 // median of successful probe latencies, ms
	Probes        []ProbeResult
}

// Client is a Globalping API client. It is safe for concurrent use.
type Client struct {
	opts       Options
	httpClient *http.Client
}

// NewClient creates a client, applying defaults to zero-valued options.
func NewClient(opts Options) *Client {
	if opts.BaseURL == "" {
		opts.BaseURL = DefaultBaseURL
	}
	opts.BaseURL = strings.TrimRight(opts.BaseURL, "/")
	if opts.Type == "" {
		opts.Type = DefaultType
	}
	opts.Type = strings.ToLower(opts.Type)
	if opts.Method == "" {
		opts.Method = DefaultMethod
	}
	opts.Method = strings.ToUpper(opts.Method)
	if opts.Timeout <= 0 {
		opts.Timeout = DefaultTimeout
	}
	if opts.PollInterval <= 0 {
		opts.PollInterval = DefaultPollInterval
	}
	if opts.UserAgent == "" {
		opts.UserAgent = "knloop-status/2.0 (+https://status.knloop.com)"
	}
	client := opts.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 15 * time.Second}
	}
	return &Client{opts: opts, httpClient: client}
}

// Check runs one measurement for rawURL and returns the aggregated result.
// It returns an error when the Globalping API itself failed (network error,
// rate limit, invalid request); callers should degrade to a local probe rather
// than treating the service as down.
func (c *Client) Check(ctx context.Context, rawURL string) (Result, error) {
	request, err := buildMeasurement(rawURL, c.opts)
	if err != nil {
		return Result{}, err
	}

	ctx, cancel := context.WithTimeout(ctx, c.opts.Timeout)
	defer cancel()

	created, err := c.create(ctx, request)
	if err != nil {
		return Result{}, err
	}
	probes, err := c.wait(ctx, created.ID)
	if err != nil {
		return Result{}, err
	}
	result := summarize(created.ProbesCount, probes, c.opts.Type)
	result.MeasurementID = created.ID
	return result, nil
}

type measurementRequest struct {
	Type               string      `json:"type"`
	Target             string      `json:"target"`
	Locations          []Location  `json:"locations"`
	MeasurementOptions interface{} `json:"measurementOptions,omitempty"`
}

type createResponse struct {
	ID          string `json:"id"`
	ProbesCount int    `json:"probesCount"`
}

type apiProbe struct {
	Probe struct {
		Country string `json:"country"`
		City    string `json:"city"`
		Network string `json:"network"`
	} `json:"probe"`
	Result struct {
		Status     string `json:"status"`
		StatusCode *int   `json:"statusCode"`
		Timings    struct {
			Total     float64 `json:"total"`
			FirstByte float64 `json:"firstByte"`
		} `json:"timings"`
		Stats struct {
			Avg  float64 `json:"avg"`
			Rcv  int     `json:"rcv"`
			Loss float64 `json:"loss"`
		} `json:"stats"`
		RawOutput string `json:"rawOutput"`
	} `json:"result"`
}

type measurementResponse struct {
	ID      string     `json:"id"`
	Status  string     `json:"status"`
	Results []apiProbe `json:"results"`
}

func buildMeasurement(rawURL string, opts Options) (measurementRequest, error) {
	parsed, err := url.Parse(strings.TrimSpace(rawURL))
	if err != nil {
		return measurementRequest{}, fmt.Errorf("parse target URL %q: %w", rawURL, err)
	}
	if parsed.Scheme != "http" && parsed.Scheme != "https" {
		return measurementRequest{}, fmt.Errorf("globalping requires an http(s) target, got %q", rawURL)
	}
	host := parsed.Hostname()
	if host == "" {
		return measurementRequest{}, fmt.Errorf("target URL %q has no host", rawURL)
	}
	if port := parsed.Port(); port != "" && port != "80" && port != "443" {
		return measurementRequest{}, fmt.Errorf("globalping only supports standard ports, got %q", port)
	}
	if len(opts.Locations) == 0 {
		return measurementRequest{}, fmt.Errorf("globalping requires at least one location")
	}

	path := parsed.EscapedPath()
	if path == "" {
		path = "/"
	}
	if parsed.RawQuery != "" {
		path += "?" + parsed.RawQuery
	}

	measurementType := strings.ToLower(strings.TrimSpace(opts.Type))
	if measurementType == "" {
		measurementType = DefaultType
	}

	switch measurementType {
	case "http":
		method := strings.ToUpper(opts.Method)
		if method == "" {
			method = DefaultMethod
		}
		return measurementRequest{
			Type:      "http",
			Target:    host,
			Locations: opts.Locations,
			MeasurementOptions: map[string]interface{}{
				"protocol": strings.ToUpper(parsed.Scheme),
				"request": map[string]interface{}{
					"method": method,
					"path":   path,
				},
			},
		}, nil
	case "ping":
		return measurementRequest{
			Type:      "ping",
			Target:    host,
			Locations: opts.Locations,
			MeasurementOptions: map[string]interface{}{
				"packets": 3,
			},
		}, nil
	default:
		return measurementRequest{}, fmt.Errorf("unsupported globalping measurement type %q", measurementType)
	}
}

func (c *Client) create(ctx context.Context, request measurementRequest) (createResponse, error) {
	body, err := json.Marshal(request)
	if err != nil {
		return createResponse{}, fmt.Errorf("encode measurement: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, c.opts.BaseURL+"/measurements", bytes.NewReader(body))
	if err != nil {
		return createResponse{}, err
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.opts.UserAgent)
	if c.opts.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.opts.Token)
	}

	resp, err := c.httpClient.Do(req)
	if err != nil {
		return createResponse{}, fmt.Errorf("create globalping measurement: %w", err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))

	if resp.StatusCode == http.StatusTooManyRequests {
		return createResponse{}, fmt.Errorf("globalping rate limit reached (retry-after=%q): %s", resp.Header.Get("Retry-After"), summarizeError(payload))
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return createResponse{}, fmt.Errorf("globalping API returned %d: %s", resp.StatusCode, summarizeError(payload))
	}

	var created createResponse
	if err := json.Unmarshal(payload, &created); err != nil {
		return createResponse{}, fmt.Errorf("decode globalping response: %w", err)
	}
	if created.ID == "" {
		return createResponse{}, fmt.Errorf("globalping response has no measurement id")
	}
	if created.ProbesCount <= 0 {
		return createResponse{}, fmt.Errorf("globalping matched no probes for the requested locations")
	}
	return created, nil
}

func (c *Client) wait(ctx context.Context, id string) ([]apiProbe, error) {
	ticker := time.NewTicker(c.opts.PollInterval)
	defer ticker.Stop()
	for {
		probes, status, err := c.fetch(ctx, id)
		if err != nil {
			return nil, err
		}
		switch status {
		case "finished":
			return probes, nil
		case "in-progress", "":
			// keep polling
		default:
			return nil, fmt.Errorf("globalping measurement %s finished with status %q", id, status)
		}
		select {
		case <-ctx.Done():
			return nil, fmt.Errorf("waiting for globalping measurement %s: %w", id, ctx.Err())
		case <-ticker.C:
		}
	}
}

func (c *Client) fetch(ctx context.Context, id string) ([]apiProbe, string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, c.opts.BaseURL+"/measurements/"+id, nil)
	if err != nil {
		return nil, "", err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", c.opts.UserAgent)
	if c.opts.Token != "" {
		req.Header.Set("Authorization", "Bearer "+c.opts.Token)
	}
	resp, err := c.httpClient.Do(req)
	if err != nil {
		return nil, "", fmt.Errorf("poll globalping measurement: %w", err)
	}
	defer resp.Body.Close()
	payload, _ := io.ReadAll(io.LimitReader(resp.Body, maxResponseBytes))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return nil, "", fmt.Errorf("poll globalping measurement returned %d: %s", resp.StatusCode, summarizeError(payload))
	}
	var measurement measurementResponse
	if err := json.Unmarshal(payload, &measurement); err != nil {
		return nil, "", fmt.Errorf("decode globalping measurement: %w", err)
	}
	return measurement.Results, measurement.Status, nil
}

func summarize(requested int, probes []apiProbe, measurementType string) Result {
	result := Result{
		Total:  requested,
		Probes: make([]ProbeResult, 0, len(probes)),
	}
	if result.Total < len(probes) {
		result.Total = len(probes)
	}

	latencies := make([]int64, 0, len(probes))
	for _, probe := range probes {
		outcome := ProbeResult{
			Country: probe.Probe.Country,
			City:    probe.Probe.City,
			Network: probe.Probe.Network,
		}
		if probe.Result.Status != "finished" {
			outcome.Error = firstNonEmpty(probe.Result.RawOutput, "probe status "+probe.Result.Status)
		} else if measurementType == "ping" {
			if probe.Result.Stats.Rcv <= 0 {
				outcome.Error = fmt.Sprintf("no ping replies (loss %.0f%%)", probe.Result.Stats.Loss)
			} else {
				outcome.OK = true
				latency := int64(math.Round(probe.Result.Stats.Avg))
				outcome.LatencyMs = &latency
			}
		} else {
			code := 0
			if probe.Result.StatusCode != nil {
				code = *probe.Result.StatusCode
			}
			outcome.StatusCode = code
			switch {
			case code == 0:
				outcome.Error = "missing HTTP status code"
			case code < 200 || code >= 400:
				outcome.Error = fmt.Sprintf("status code %d", code)
			default:
				timing := probe.Result.Timings.Total
				if timing <= 0 {
					timing = probe.Result.Timings.FirstByte
				}
				if timing <= 0 {
					outcome.Error = "missing timing"
				} else {
					outcome.OK = true
					latency := int64(math.Round(timing))
					outcome.LatencyMs = &latency
				}
			}
		}
		if outcome.OK {
			result.OK++
			if outcome.LatencyMs != nil {
				latencies = append(latencies, *outcome.LatencyMs)
			}
		}
		outcome.Error = truncate(outcome.Error)
		result.Probes = append(result.Probes, outcome)
	}
	result.Latency = median(latencies)
	return result
}

func median(values []int64) *int64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	var value int64
	if len(sorted)%2 == 0 {
		value = (sorted[len(sorted)/2-1] + sorted[len(sorted)/2]) / 2
	} else {
		value = sorted[len(sorted)/2]
	}
	return &value
}

func summarizeError(payload []byte) string {
	text := strings.TrimSpace(string(payload))
	if text == "" {
		return "(empty response)"
	}
	return truncate(text)
}

func truncate(value string) string {
	value = strings.Join(strings.Fields(value), " ")
	if len(value) <= maxErrorText {
		return value
	}
	return value[:maxErrorText] + "…"
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
