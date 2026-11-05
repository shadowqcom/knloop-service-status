// Command statuscheck implements the v2 status checker: parallel local probes,
// one aggregated log line per service per round, and data/status.json.
package main

import (
	"context"
	"encoding/json"
	"flag"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"servicecheck/aggregator"
	"servicecheck/checker"
	"servicecheck/globalping"
	"servicecheck/logger"
	"servicecheck/notifier"
)

// WebhookConfig keeps the legacy webhook configuration shape.
type WebhookConfig struct {
	Enabled bool `json:"enabled"`
}

// PeerCheckConfig configures third-party corroboration.
type PeerCheckConfig struct {
	Enabled   bool `json:"enabled"`
	TimeoutMs int  `json:"timeoutMs"`
}

const (
	probeModeLocal      = "local"
	probeModeGlobalping = "globalping"
	probeModeHybrid     = "hybrid"
)

// ProbeConfig selects the detection source. The zero value keeps the original
// local HTTP probing behaviour.
type ProbeConfig struct {
	Mode       string           `json:"mode"`
	Globalping GlobalpingConfig `json:"globalping"`
}

// GlobalpingConfig configures the Globalping measurement source.
type GlobalpingConfig struct {
	Type            string                `json:"type"`
	Method          string                `json:"method"`
	Locations       []globalping.Location `json:"locations"`
	TimeoutMs       int                   `json:"timeoutMs"`
	PollIntervalMs  int                   `json:"pollIntervalMs"`
	FallbackToLocal *bool                 `json:"fallbackToLocal"`
	TokenEnv        string                `json:"tokenEnv"`
	BaseURL         string                `json:"baseUrl"`
}

// Config is the shared src/config.json document. v2 keys default when absent
// and legacy keys (maxRetries, requestTimeoutMs, retryDelayMs, maxDays,
// maxLogLines, webhook) stay supported.
type Config struct {
	MaxDays           int              `json:"maxDays"`
	MaxHour           int              `json:"maxHour"`
	MaxLogLines       int              `json:"maxLogLines"`
	LogsPath          string           `json:"logspath"`
	ReloadReportsData bool             `json:"reloadReportsdata"`
	ReloadReportsTime float64          `json:"reloadReportstime"`
	Webhook           WebhookConfig    `json:"webhook"`
	Services          []Service        `json:"services"`
	MaxRetries        int              `json:"maxRetries"`
	RetryDelayMs      int              `json:"retryDelayMs"`
	RequestTimeoutMs  int              `json:"requestTimeoutMs"`
	Attempts          int              `json:"attempts"`
	MinSuccess        int              `json:"minSuccess"`
	PeerCheck         *PeerCheckConfig `json:"peerCheck"`
	Probe             ProbeConfig      `json:"probe"`
	RetentionDays     int              `json:"retentionDays"`
	UserAgent         string           `json:"userAgent"`
	PollIntervalSec   int              `json:"pollIntervalSec"`
	StaleAfterMin     int              `json:"staleAfterMin"`
}

// Service is one monitored target.
type Service struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

type runState struct {
	service    Service
	status     string
	latency    *int64
	ok         int
	tries      int
	timestamp  time.Time
	prevStatus string
	hasPrev    bool
	writeErr   error
}

var (
	configPath    = flag.String("config", "", "Path to config file (default: ../src/config.json)")
	logsDirFlag   = flag.String("logs-dir", "", "Directory containing <Key>_report.log files (default: ../logs)")
	dataFileFlag  = flag.String("data-file", "", "status.json output path (default: ../data/status.json)")
	aggregateOnly = flag.Bool("aggregate-only", false, "Only aggregate existing logs into status.json; never probe")
)

var defaultConfig = Config{
	MaxLogLines:      10500,
	Attempts:         3,
	MinSuccess:       2,
	RequestTimeoutMs: 5000,
	RetryDelayMs:     250,
	RetentionDays:    60,
	UserAgent:        checker.DefaultUserAgent,
	PollIntervalSec:  60,
	StaleAfterMin:    45,
	Probe:            ProbeConfig{Mode: probeModeLocal},
}

func main() {
	flag.Parse()
	if err := run(); err != nil {
		log.Fatalf("statuscheck: %v", err)
	}
}

func run() error {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		log.Printf("warning: failed to load timezone, using UTC: %v", err)
		loc = time.UTC
	}
	time.Local = loc

	config, err := loadConfig()
	if err != nil {
		return err
	}

	logDir := *logsDirFlag
	if logDir == "" {
		logDir = filepath.Join("..", "logs")
	}
	dataPath := *dataFileFlag
	if dataPath == "" {
		dataPath = filepath.Join("..", "data", "status.json")
	}
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("create log directory: %w", err)
	}
	if err := os.MkdirAll(filepath.Dir(dataPath), 0755); err != nil {
		return fmt.Errorf("create data directory: %w", err)
	}

	logOptions := logger.Options{
		Dir:           logDir,
		RetentionDays: config.RetentionDays,
		MaxLogLines:   config.MaxLogLines,
	}

	if *aggregateOnly {
		log.Printf("aggregate-only mode: reading logs from %s", logDir)
		document, err := aggregate(config, logDir, time.Now(), nil)
		if err != nil {
			return err
		}
		if err := aggregator.WriteFile(dataPath, document); err != nil {
			return fmt.Errorf("write %s: %w", dataPath, err)
		}
		logDocument(document, dataPath)
		return nil
	}

	runs := runChecks(config, logOptions)

	down, recovered := transitions(runs)
	if config.Webhook.Enabled && (len(down) > 0 || len(recovered) > 0) {
		sendNotification(down, recovered)
	}

	document, err := aggregate(config, logDir, time.Now(), runs)
	if err != nil {
		return err
	}
	if err := aggregator.WriteFile(dataPath, document); err != nil {
		return fmt.Errorf("write %s: %w", dataPath, err)
	}
	logDocument(document, dataPath)
	return nil
}

func loadConfig() (*Config, error) {
	path := *configPath
	if path == "" {
		path = filepath.Join("..", "src", "config.json")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return nil, fmt.Errorf("read config %s: %w", path, err)
	}

	config := defaultConfig
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("parse config %s: %w", path, err)
	}
	applyDefaults(&config)
	if err := normalizeProbeConfig(&config); err != nil {
		return nil, fmt.Errorf("invalid probe config in %s: %w", path, err)
	}
	return &config, nil
}

func applyDefaults(config *Config) {
	if config.Attempts <= 0 && config.MaxRetries > 0 {
		config.Attempts = config.MaxRetries
	}
	if config.Attempts <= 0 {
		config.Attempts = 3
	}
	if config.MinSuccess <= 0 {
		config.MinSuccess = 2
	}
	if config.MinSuccess > config.Attempts {
		config.MinSuccess = config.Attempts
	}
	if config.RequestTimeoutMs <= 0 {
		config.RequestTimeoutMs = 5000
	}
	if config.RetryDelayMs <= 0 {
		config.RetryDelayMs = 250
	}
	if config.RetentionDays <= 0 {
		if config.MaxDays > 0 {
			config.RetentionDays = config.MaxDays
		} else {
			config.RetentionDays = 60
		}
	}
	if config.RetentionDays > 3650 {
		config.RetentionDays = 3650
	}
	if config.MaxLogLines <= 0 {
		config.MaxLogLines = 10500
	}
	if config.UserAgent == "" {
		config.UserAgent = checker.DefaultUserAgent
	}
	if config.PeerCheck == nil {
		config.PeerCheck = &PeerCheckConfig{Enabled: true}
	}
	if config.PeerCheck.TimeoutMs <= 0 {
		config.PeerCheck.TimeoutMs = 5000
	}
}

// normalizeProbeConfig validates the probe mode and fills in Globalping
// defaults. mode=local keeps the historical behaviour exactly as before.
func normalizeProbeConfig(config *Config) error {
	mode := strings.ToLower(strings.TrimSpace(config.Probe.Mode))
	if mode == "" {
		mode = probeModeLocal
	}
	switch mode {
	case probeModeLocal, probeModeGlobalping, probeModeHybrid:
	default:
		return fmt.Errorf("probe.mode %q is not supported (want local, globalping or hybrid)", config.Probe.Mode)
	}
	config.Probe.Mode = mode

	settings := &config.Probe.Globalping
	if settings.Type == "" {
		settings.Type = globalping.DefaultType
	}
	settings.Type = strings.ToLower(settings.Type)
	if settings.Type != "http" && settings.Type != "ping" {
		return fmt.Errorf("probe.globalping.type %q is not supported (want http or ping)", settings.Type)
	}
	if settings.Method == "" {
		settings.Method = globalping.DefaultMethod
	}
	settings.Method = strings.ToUpper(settings.Method)
	if settings.Method != "HEAD" && settings.Method != "GET" {
		return fmt.Errorf("probe.globalping.method %q is not supported (want HEAD or GET)", settings.Method)
	}
	if len(settings.Locations) == 0 {
		settings.Locations = []globalping.Location{
			{Country: "CN", Limit: 1},
			{Country: "HK", Limit: 1},
			{Country: "JP", Limit: 1},
			{Country: "US", Limit: 1},
		}
	}
	for index := range settings.Locations {
		location := &settings.Locations[index]
		if location.Limit <= 0 {
			location.Limit = 1
		}
		if location.Country == "" && location.City == "" && location.ASN == 0 && location.Magic == "" {
			return fmt.Errorf("probe.globalping.locations[%d] needs country, city, asn or magic", index)
		}
	}
	if settings.TimeoutMs <= 0 {
		settings.TimeoutMs = 20000
	}
	if settings.TimeoutMs < 2000 {
		settings.TimeoutMs = 2000
	}
	if settings.TimeoutMs > 120000 {
		settings.TimeoutMs = 120000
	}
	if settings.PollIntervalMs <= 0 {
		settings.PollIntervalMs = 1000
	}
	if settings.PollIntervalMs < 200 {
		settings.PollIntervalMs = 200
	}
	if settings.PollIntervalMs > 5000 {
		settings.PollIntervalMs = 5000
	}
	if settings.TokenEnv == "" {
		settings.TokenEnv = "GLOBALPING_TOKEN"
	}
	if settings.FallbackToLocal == nil {
		enabled := true
		settings.FallbackToLocal = &enabled
	}
	return nil
}

type localProbeFunc func(ctx context.Context, targetURL string) checker.Result

type globalpingCheckFunc func(ctx context.Context, targetURL string) (globalping.Result, error)

// checkEngine applies the configured probe mode. local is always available;
// globalping is only used in globalping/hybrid modes.
type checkEngine struct {
	mode          string
	local         localProbeFunc
	globalping    globalpingCheckFunc
	fallbackLocal bool
}

// check returns the check result and an optional note for the run log.
func (e *checkEngine) check(ctx context.Context, targetURL string) (checker.Result, string) {
	if e.mode == probeModeGlobalping {
		result, err := e.globalping(ctx, targetURL)
		if err != nil {
			if e.fallbackLocal && e.local != nil {
				return e.local(ctx, targetURL), "globalping unavailable, fell back to local probe: " + err.Error()
			}
			return checker.Result{Status: checker.StatusPartial}, "globalping unavailable: " + err.Error()
		}
		return globalpingToResult(result), globalpingNote(result)
	}

	localResult := e.local(ctx, targetURL)
	if e.mode != probeModeHybrid || localResult.Status == checker.StatusSuccess {
		return localResult, ""
	}

	result, err := e.globalping(ctx, targetURL)
	if err != nil {
		return localResult, "globalping unavailable, keeping local result: " + err.Error()
	}
	if result.OK > 0 {
		return checker.Result{
			Status:  checker.StatusPartial,
			Latency: result.Latency,
			OK:      result.OK,
			Tries:   result.Total,
		}, globalpingNote(result)
	}
	if localResult.Status == checker.StatusFailure {
		return checker.Result{
			Status: checker.StatusFailure,
			Tries:  result.Total,
		}, globalpingNote(result)
	}
	return localResult, globalpingNote(result)
}

func globalpingToResult(result globalping.Result) checker.Result {
	status := checker.StatusFailure
	switch {
	case result.Total > 0 && result.OK >= result.Total:
		status = checker.StatusSuccess
	case result.OK > 0:
		status = checker.StatusPartial
	}
	return checker.Result{
		Status:  status,
		Latency: result.Latency,
		OK:      result.OK,
		Tries:   result.Total,
	}
}

func globalpingNote(result globalping.Result) string {
	if result.MeasurementID == "" {
		return ""
	}
	return fmt.Sprintf("globalping %s: %d/%d probes ok", result.MeasurementID, result.OK, result.Total)
}

// newCheckEngine builds the probe engine from the shared configuration.
func newCheckEngine(config *Config) *checkEngine {
	client := checker.NewClient()
	var peers []checker.Peer
	if config.PeerCheck.Enabled {
		peers = checker.NewDefaultPeers(client)
	}
	localProber := checker.NewProber(client, peers)
	localOptions := checker.Options{
		Attempts:         config.Attempts,
		MinSuccess:       config.MinSuccess,
		Timeout:          time.Duration(config.RequestTimeoutMs) * time.Millisecond,
		RetryDelay:       time.Duration(config.RetryDelayMs) * time.Millisecond,
		PeerCheckEnabled: config.PeerCheck.Enabled,
		PeerTimeout:      time.Duration(config.PeerCheck.TimeoutMs) * time.Millisecond,
		UserAgent:        config.UserAgent,
	}

	engine := &checkEngine{mode: config.Probe.Mode}
	engine.local = func(ctx context.Context, targetURL string) checker.Result {
		return localProber.Probe(ctx, targetURL, localOptions)
	}
	if engine.mode == probeModeLocal {
		return engine
	}

	settings := config.Probe.Globalping
	token := ""
	if settings.TokenEnv != "" {
		token = os.Getenv(settings.TokenEnv)
	}
	globalpingClient := globalping.NewClient(globalping.Options{
		Type:         settings.Type,
		Method:       settings.Method,
		Locations:    settings.Locations,
		Timeout:      time.Duration(settings.TimeoutMs) * time.Millisecond,
		PollInterval: time.Duration(settings.PollIntervalMs) * time.Millisecond,
		UserAgent:    config.UserAgent,
		Token:        token,
		BaseURL:      settings.BaseURL,
	})
	engine.globalping = func(ctx context.Context, targetURL string) (globalping.Result, error) {
		return globalpingClient.Check(ctx, targetURL)
	}
	engine.fallbackLocal = settings.FallbackToLocal == nil || *settings.FallbackToLocal
	return engine
}

func runChecks(config *Config, logOptions logger.Options) []runState {
	engine := newCheckEngine(config)

	runs := make([]runState, len(config.Services))
	var wg sync.WaitGroup
	for i, service := range config.Services {
		wg.Add(1)
		go func(index int, service Service) {
			defer wg.Done()
			timestamp := time.Now()
			logPath := logger.Path(service.Key, logOptions)
			previous, hasPrevious := aggregator.LastStatus(logPath)

			result, note := engine.check(context.Background(), service.URL)
			if note != "" {
				log.Printf("[%s] %s", service.Key, note)
			}
			writeErr := logger.Write(service.Key, timestamp, result.Status, result.Latency, result.OK, result.Tries, logOptions)
			if writeErr != nil {
				log.Printf("[%s] failed to write log: %v", service.Key, writeErr)
			}

			runs[index] = runState{
				service:    service,
				status:     result.Status,
				latency:    result.Latency,
				ok:         result.OK,
				tries:      result.Tries,
				timestamp:  timestamp,
				prevStatus: previous,
				hasPrev:    hasPrevious,
				writeErr:   writeErr,
			}
		}(i, service)
	}
	wg.Wait()

	for _, run := range runs {
		log.Printf("[%s] status=%s latency=%s ok=%d/%d",
			run.service.Key, run.status, latencyText(run.latency), run.ok, run.tries)
	}
	return runs
}

func transitions(runs []runState) (down, recovered []notifier.CheckResult) {
	for _, run := range runs {
		if !run.hasPrev {
			continue
		}
		wasFailure := run.prevStatus == checker.StatusFailure
		isFailure := run.status == checker.StatusFailure
		switch {
		case !wasFailure && isFailure:
			down = append(down, toNotifierResult(run))
		case wasFailure && !isFailure:
			recovered = append(recovered, toNotifierResult(run))
		}
	}
	return down, recovered
}

func toNotifierResult(run runState) notifier.CheckResult {
	return notifier.CheckResult{
		Key:       run.service.Key,
		URL:       run.service.URL,
		Status:    run.status,
		Latency:   run.latency,
		Timestamp: run.timestamp,
	}
}

func sendNotification(down, recovered []notifier.CheckResult) {
	webhookKey := os.Getenv("WEBHOOK_KEY")
	if webhookKey == "" {
		log.Println("warning: WEBHOOK_KEY is not set; skipping notification")
		return
	}
	url := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%s", webhookKey)
	if err := notifier.SendWebhookNotification(url, down, recovered); err != nil {
		log.Printf("failed to send notification: %v", err)
		return
	}
	log.Printf("notification sent (down=%d, recovered=%d)", len(down), len(recovered))
}

func aggregate(config *Config, logDir string, now time.Time, runs []runState) (aggregator.File, error) {
	byKey := make(map[string]runState, len(runs))
	for _, run := range runs {
		byKey[run.service.Key] = run
	}
	inputs := make([]aggregator.ServiceInput, 0, len(config.Services))
	for _, service := range config.Services {
		input := aggregator.ServiceInput{
			Key: service.Key,
			URL: service.URL,
		}
		if run, ok := byKey[service.Key]; ok {
			input.Status = run.status
			input.Latency = run.latency
			input.LastCheckAt = run.timestamp
		}
		inputs = append(inputs, input)
	}
	return aggregator.Build(aggregator.Input{
		Now:           now,
		RetentionDays: config.RetentionDays,
		Services:      inputs,
		LogDir:        logDir,
	})
}

func logDocument(document aggregator.File, path string) {
	log.Printf("wrote %s (schema=%d, retentionDays=%d)", path, document.Schema, document.RetentionDays)
	for _, service := range document.Services {
		log.Printf("[%s] status=%s uptime=%.2f%% checks=%d (success=%d partial=%d failure=%d) daily=%d hourly=%d",
			service.Key, service.Status, service.Uptime, service.Checks.Total,
			service.Checks.Success, service.Checks.Partial, service.Checks.Failure,
			len(service.Daily), len(service.Hourly))
	}
}

func latencyText(latency *int64) string {
	if latency == nil {
		return "null"
	}
	return fmt.Sprintf("%dms", *latency)
}
