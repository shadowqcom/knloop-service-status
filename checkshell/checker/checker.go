// Package checker implements the v2 local HTTP probe and third-party peer
// corroboration used by the status checker.
package checker

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptrace"
	"net/url"
	"sort"
	"strings"
	"sync"
	"time"
)

const (
	// StatusSuccess marks a check where at least MinSuccess local probes succeeded.
	StatusSuccess = "success"
	// StatusPartial marks a check with some (but too few) local successes, or an
	// unreachable local probe corroborated by a third-party peer.
	StatusPartial = "partial"
	// StatusFailure marks a check with no local success and no peer corroboration.
	StatusFailure = "failure"

	// DefaultUserAgent is used when the configuration does not define one.
	DefaultUserAgent = "Mozilla/5.0 (compatible; knloop-status/2.0; +https://status.knloop.com)"

	defaultAttempts    = 3
	defaultMinSuccess  = 2
	defaultTimeout     = 5 * time.Second
	defaultRetryDelay  = 250 * time.Millisecond
	defaultPeerTimeout = 5 * time.Second

	// maxRedirects is the maximum number of redirect hops that are followed.
	maxRedirects = 10

	xxapiBase = "https://v2.xxapi.cn"
	uapiBase  = "https://uapis.cn"
)

// Options configures a single Probe call.
type Options struct {
	Attempts         int
	MinSuccess       int
	Timeout          time.Duration
	RetryDelay       time.Duration
	PeerCheckEnabled bool
	PeerTimeout      time.Duration
	UserAgent        string
}

func (o Options) normalize() Options {
	if o.Attempts <= 0 {
		o.Attempts = defaultAttempts
	}
	if o.MinSuccess <= 0 {
		o.MinSuccess = defaultMinSuccess
	}
	if o.MinSuccess > o.Attempts {
		o.MinSuccess = o.Attempts
	}
	if o.Timeout <= 0 {
		o.Timeout = defaultTimeout
	}
	if o.RetryDelay <= 0 {
		o.RetryDelay = defaultRetryDelay
	}
	if o.PeerTimeout <= 0 {
		o.PeerTimeout = defaultPeerTimeout
	}
	if o.UserAgent == "" {
		o.UserAgent = DefaultUserAgent
	}
	return o
}

// Result is the outcome of one service check.
// Latency is the median TTFB (ms) of the successful local probes; it is nil
// when no local probe succeeded, including peer-corroborated partial results.
type Result struct {
	Status        string
	Latency       *int64
	OK            int
	Tries         int
	PeerReachable bool
}

// Peer corroborates a target URL from an independent network vantage point.
// Implementations must return nil when the target is reported reachable.
type Peer interface {
	Name() string
	Reachable(ctx context.Context, targetURL string) error
}

// Prober performs local probes and, when all local probes fail, asks the
// configured peers for corroboration. A Prober is safe for concurrent use.
type Prober struct {
	client *http.Client
	peers  []Peer
}

// NewProber creates a Prober. A nil client falls back to NewClient. When the
// client has no redirect policy the default <=10 hop policy is installed.
func NewProber(client *http.Client, peers []Peer) *Prober {
	if client == nil {
		client = NewClient()
	}
	if client.CheckRedirect == nil {
		client.CheckRedirect = limitRedirects
	}
	return &Prober{client: client, peers: peers}
}

// NewClient returns the shared HTTP client used for probing: keep-alive
// connection pool, no whole-client timeout (per-attempt deadlines are applied
// through the request context), and a redirect limit of 10 hops.
func NewClient() *http.Client {
	transport, ok := http.DefaultTransport.(*http.Transport)
	var cloned *http.Transport
	if ok {
		cloned = transport.Clone()
	} else {
		cloned = &http.Transport{}
	}
	cloned.MaxIdleConns = 100
	cloned.MaxIdleConnsPerHost = 4
	cloned.IdleConnTimeout = 90 * time.Second
	return &http.Client{Transport: cloned, CheckRedirect: limitRedirects}
}

func limitRedirects(req *http.Request, via []*http.Request) error {
	// via holds the requests already issued. Allowing len(via) == maxRedirects
	// permits 10 redirect hops (11 requests); the 11th hop is rejected.
	if len(via) > maxRedirects {
		return fmt.Errorf("stopped after %d redirects", maxRedirects)
	}
	return nil
}

// Probe checks rawURL: Attempts serial local probes, then (only when every
// local probe failed) concurrent peer corroboration. Peer latency never
// contributes to the reported latency.
func (p *Prober) Probe(ctx context.Context, rawURL string, opts Options) Result {
	opts = opts.normalize()

	okCount := 0
	tries := 0
	latencies := make([]int64, 0, opts.Attempts)

	for i := 0; i < opts.Attempts; i++ {
		if ctx.Err() != nil {
			break
		}
		tries++
		latency, err := p.probeOnce(ctx, rawURL, opts)
		if err == nil {
			okCount++
			latencies = append(latencies, latency)
		}
		if i < opts.Attempts-1 {
			if !sleepContext(ctx, opts.RetryDelay<<uint(i)) {
				break
			}
		}
	}

	result := Result{OK: okCount, Tries: tries}
	switch {
	case okCount >= opts.MinSuccess:
		result.Status = StatusSuccess
		result.Latency = medianLatency(latencies)
	case okCount > 0:
		result.Status = StatusPartial
		result.Latency = medianLatency(latencies)
	default:
		if opts.PeerCheckEnabled && p.peerReachable(ctx, rawURL, opts) {
			result.Status = StatusPartial
			result.PeerReachable = true
		} else {
			result.Status = StatusFailure
		}
	}
	return result
}

// probeOnce performs one local HTTP GET and returns the time to first byte of
// the final response in milliseconds.
func (p *Prober) probeOnce(ctx context.Context, rawURL string, opts Options) (int64, error) {
	reqCtx, cancel := context.WithTimeout(ctx, opts.Timeout)
	defer cancel()

	start := time.Now()
	var ttfb time.Duration

	req, err := http.NewRequestWithContext(reqCtx, http.MethodGet, rawURL, nil)
	if err != nil {
		return 0, err
	}
	req.Header.Set("User-Agent", opts.UserAgent)
	req.Header.Set("Accept", "text/html,application/xhtml+xml,*/*")

	trace := &httptrace.ClientTrace{
		GotFirstResponseByte: func() {
			// For redirected requests this callback fires once per response;
			// keeping the last value measures the final response.
			ttfb = time.Since(start)
		},
	}
	req = req.WithContext(httptrace.WithClientTrace(reqCtx, trace))

	resp, err := p.client.Do(req)
	if err != nil {
		return 0, err
	}
	// The body is not needed: drain a small prefix so keep-alive can reuse the
	// connection, then always close it.
	_, _ = io.Copy(io.Discard, io.LimitReader(resp.Body, 4096))
	_ = resp.Body.Close()

	if ttfb <= 0 {
		ttfb = time.Since(start)
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 400 {
		return 0, fmt.Errorf("unexpected status code %d", resp.StatusCode)
	}
	return ttfb.Milliseconds(), nil
}

func (p *Prober) peerReachable(ctx context.Context, rawURL string, opts Options) bool {
	if len(p.peers) == 0 {
		return false
	}
	peerCtx, cancel := context.WithTimeout(ctx, opts.PeerTimeout)
	defer cancel()

	var (
		wg        sync.WaitGroup
		mu        sync.Mutex
		reachable bool
	)
	for _, peer := range p.peers {
		wg.Add(1)
		go func(peer Peer) {
			defer wg.Done()
			if err := peer.Reachable(peerCtx, rawURL); err == nil {
				mu.Lock()
				reachable = true
				mu.Unlock()
			}
		}(peer)
	}
	wg.Wait()
	return reachable
}

func sleepContext(ctx context.Context, delay time.Duration) bool {
	if delay <= 0 {
		return ctx.Err() == nil
	}
	timer := time.NewTimer(delay)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return false
	case <-timer.C:
		return true
	}
}

func medianLatency(values []int64) *int64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	var median int64
	if len(sorted)%2 == 0 {
		median = (sorted[len(sorted)/2-1] + sorted[len(sorted)/2]) / 2
	} else {
		median = sorted[len(sorted)/2]
	}
	return &median
}

// httpPeer implements Peer using a JSON API. build receives the probed URL and
// returns the API URL; check receives the response body and returns nil when
// the API reports the target as reachable.
type httpPeer struct {
	name   string
	base   string
	client *http.Client
	build  func(targetURL, base string) (string, error)
	check  func(body []byte) error
}

// Name returns the provider name.
func (p *httpPeer) Name() string { return p.name }

// Reachable asks the provider whether the target host is reachable.
func (p *httpPeer) Reachable(ctx context.Context, rawURL string) error {
	apiURL, err := p.build(rawURL, p.base)
	if err != nil {
		return err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, apiURL, nil)
	if err != nil {
		return err
	}
	req.Header.Set("Accept", "application/json")
	req.Header.Set("User-Agent", DefaultUserAgent)

	resp, err := p.client.Do(req)
	if err != nil {
		return err
	}
	defer resp.Body.Close()

	body, err := io.ReadAll(io.LimitReader(resp.Body, 64<<10))
	if err != nil {
		return err
	}
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("%s: http status %d", p.name, resp.StatusCode)
	}
	return p.check(body)
}

// NewDefaultPeers returns the built-in providers (mmp.cc was removed because it
// failed for 100% of checks).
func NewDefaultPeers(client *http.Client) []Peer {
	return []Peer{XXAPIPeer(client), UAPIPeer(client)}
}

// XXAPIPeer returns the xxapi.cn peer. base is normally empty.
func XXAPIPeer(client *http.Client) Peer { return newXXAPIPeer(client, xxapiBase) }

// UAPIPeer returns the uapis.cn peer. base is normally empty.
func UAPIPeer(client *http.Client) Peer { return newUAPIPeer(client, uapiBase) }

func newXXAPIPeer(client *http.Client, base string) Peer {
	return &httpPeer{
		name:   "xxapi.cn",
		base:   base,
		client: clientOrDefault(client),
		build: func(rawURL, apiBase string) (string, error) {
			host, err := hostOf(rawURL)
			if err != nil {
				return "", err
			}
			return strings.TrimRight(apiBase, "/") + "/api/ping?url=" + url.QueryEscape(host), nil
		},
		check: func(body []byte) error {
			var payload struct {
				Code int    `json:"code"`
				Msg  string `json:"msg"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				return fmt.Errorf("xxapi.cn: invalid json: %w", err)
			}
			if payload.Code != 200 {
				return fmt.Errorf("xxapi.cn: code %d (%s)", payload.Code, payload.Msg)
			}
			return nil
		},
	}
}

func newUAPIPeer(client *http.Client, base string) Peer {
	return &httpPeer{
		name:   "uapis.cn",
		base:   base,
		client: clientOrDefault(client),
		build: func(rawURL, apiBase string) (string, error) {
			host, err := hostOf(rawURL)
			if err != nil {
				return "", err
			}
			host = strings.TrimPrefix(host, "www.")
			return strings.TrimRight(apiBase, "/") + "/api/v1/network/ping?host=" + url.QueryEscape(host), nil
		},
		check: func(body []byte) error {
			var payload struct {
				Host string `json:"host"`
			}
			if err := json.Unmarshal(body, &payload); err != nil {
				return fmt.Errorf("uapis.cn: invalid json: %w", err)
			}
			if payload.Host == "" {
				return fmt.Errorf("uapis.cn: empty host in response")
			}
			return nil
		},
	}
}

func clientOrDefault(client *http.Client) *http.Client {
	if client != nil {
		return client
	}
	return NewClient()
}

func hostOf(rawURL string) (string, error) {
	parsed, err := url.Parse(rawURL)
	if err != nil {
		return "", err
	}
	if parsed.Host == "" {
		return "", fmt.Errorf("missing host in URL %q", rawURL)
	}
	return parsed.Host, nil
}
