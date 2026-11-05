package main

import (
	"context"
	"errors"
	"testing"

	"servicecheck/checker"
	"servicecheck/globalping"
)

func successResult() checker.Result {
	latency := int64(42)
	return checker.Result{Status: checker.StatusSuccess, Latency: &latency, OK: 3, Tries: 3}
}

func failureResult() checker.Result {
	return checker.Result{Status: checker.StatusFailure, OK: 0, Tries: 3}
}

func TestCheckEngineLocalMode(t *testing.T) {
	globalpingCalled := false
	engine := &checkEngine{
		mode: probeModeLocal,
		local: func(context.Context, string) checker.Result {
			return successResult()
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			globalpingCalled = true
			return globalping.Result{}, nil
		},
	}
	result, note := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusSuccess || note != "" {
		t.Fatalf("result/note = %+v/%q", result, note)
	}
	if globalpingCalled {
		t.Fatal("globalping was called in local mode")
	}
}

func TestCheckEngineGlobalpingSuccess(t *testing.T) {
	latency := int64(120)
	engine := &checkEngine{
		mode: probeModeGlobalping,
		local: func(context.Context, string) checker.Result {
			t.Fatal("local probe should not run when globalping succeeds")
			return checker.Result{}
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{MeasurementID: "m1", OK: 3, Total: 3, Latency: &latency}, nil
		},
	}
	result, note := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusSuccess || result.OK != 3 || result.Tries != 3 {
		t.Fatalf("result = %+v, want success 3/3", result)
	}
	if result.Latency == nil || *result.Latency != 120 {
		t.Fatalf("latency = %v, want 120", result.Latency)
	}
	if note == "" {
		t.Fatal("note is empty, want measurement summary")
	}
}

func TestCheckEngineGlobalpingPartial(t *testing.T) {
	engine := &checkEngine{
		mode: probeModeGlobalping,
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{MeasurementID: "m1", OK: 2, Total: 4}, nil
		},
	}
	result, _ := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusPartial || result.OK != 2 || result.Tries != 4 {
		t.Fatalf("result = %+v, want partial 2/4", result)
	}
}

func TestCheckEngineGlobalpingFailure(t *testing.T) {
	engine := &checkEngine{
		mode: probeModeGlobalping,
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{MeasurementID: "m1", OK: 0, Total: 4}, nil
		},
	}
	result, _ := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusFailure {
		t.Fatalf("status = %q, want failure", result.Status)
	}
}

func TestCheckEngineGlobalpingFallback(t *testing.T) {
	engine := &checkEngine{
		mode:          probeModeGlobalping,
		fallbackLocal: true,
		local: func(context.Context, string) checker.Result {
			return successResult()
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{}, errors.New("rate limit")
		},
	}
	result, note := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusSuccess {
		t.Fatalf("status = %q, want fallback local success", result.Status)
	}
	if note == "" {
		t.Fatal("note is empty, want fallback explanation")
	}
}

func TestCheckEngineGlobalpingNoFallback(t *testing.T) {
	engine := &checkEngine{
		mode:          probeModeGlobalping,
		fallbackLocal: false,
		local: func(context.Context, string) checker.Result {
			t.Fatal("local probe should not run when fallback is disabled")
			return checker.Result{}
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{}, errors.New("rate limit")
		},
	}
	result, note := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusPartial {
		t.Fatalf("status = %q, want partial on unavailable API", result.Status)
	}
	if note == "" {
		t.Fatal("note is empty, want unavailable explanation")
	}
}

func TestCheckEngineHybridSkipsGlobalpingWhenLocalSucceeds(t *testing.T) {
	engine := &checkEngine{
		mode: probeModeHybrid,
		local: func(context.Context, string) checker.Result {
			return successResult()
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			t.Fatal("globalping should not run when local succeeds")
			return globalping.Result{}, nil
		},
	}
	result, _ := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusSuccess {
		t.Fatalf("status = %q, want success", result.Status)
	}
}

func TestCheckEngineHybridPromotesPartialWhenRegionalReachable(t *testing.T) {
	engine := &checkEngine{
		mode: probeModeHybrid,
		local: func(context.Context, string) checker.Result {
			return failureResult()
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{MeasurementID: "m1", OK: 3, Total: 4}, nil
		},
	}
	result, _ := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusPartial || result.OK != 3 || result.Tries != 4 {
		t.Fatalf("result = %+v, want partial 3/4", result)
	}
}

func TestCheckEngineHybridKeepsLocalWhenGlobalpingErrors(t *testing.T) {
	engine := &checkEngine{
		mode: probeModeHybrid,
		local: func(context.Context, string) checker.Result {
			return failureResult()
		},
		globalping: func(context.Context, string) (globalping.Result, error) {
			return globalping.Result{}, errors.New("timeout")
		},
	}
	result, note := engine.check(context.Background(), "https://example.com")
	if result.Status != checker.StatusFailure {
		t.Fatalf("status = %q, want local failure kept", result.Status)
	}
	if note == "" {
		t.Fatal("note is empty, want error explanation")
	}
}

func TestNormalizeProbeConfigDefaults(t *testing.T) {
	config := Config{}
	if err := normalizeProbeConfig(&config); err != nil {
		t.Fatalf("normalizeProbeConfig: %v", err)
	}
	if config.Probe.Mode != probeModeLocal {
		t.Fatalf("mode = %q, want local", config.Probe.Mode)
	}
	settings := config.Probe.Globalping
	if settings.Type != "http" || settings.Method != "HEAD" {
		t.Fatalf("type/method = %q/%q", settings.Type, settings.Method)
	}
	if len(settings.Locations) != 4 {
		t.Fatalf("locations = %d, want 4 defaults", len(settings.Locations))
	}
	for _, location := range settings.Locations {
		if location.Limit != 1 {
			t.Fatalf("location limit = %d, want 1", location.Limit)
		}
	}
	if settings.FallbackToLocal == nil || !*settings.FallbackToLocal {
		t.Fatal("fallbackToLocal should default to true")
	}
	if settings.TokenEnv != "GLOBALPING_TOKEN" {
		t.Fatalf("tokenEnv = %q", settings.TokenEnv)
	}
	if settings.TimeoutMs != 20000 || settings.PollIntervalMs != 1000 {
		t.Fatalf("timeout/poll = %d/%d", settings.TimeoutMs, settings.PollIntervalMs)
	}
}

func TestNormalizeProbeConfigValidation(t *testing.T) {
	cases := []Config{
		{Probe: ProbeConfig{Mode: "nope"}},
		{Probe: ProbeConfig{Mode: "globalping", Globalping: GlobalpingConfig{Type: "tcp"}}},
		{Probe: ProbeConfig{Mode: "globalping", Globalping: GlobalpingConfig{Method: "POST"}}},
		{Probe: ProbeConfig{Mode: "globalping", Globalping: GlobalpingConfig{Locations: []globalping.Location{{}}}}},
	}
	for index, config := range cases {
		if err := normalizeProbeConfig(&config); err == nil {
			t.Fatalf("case %d: expected validation error", index)
		}
	}

	config := Config{Probe: ProbeConfig{Mode: " GLOBALPING ", Globalping: GlobalpingConfig{
		Type:      "PING",
		Locations: []globalping.Location{{Country: "CN"}},
	}}}
	if err := normalizeProbeConfig(&config); err != nil {
		t.Fatalf("normalizeProbeConfig: %v", err)
	}
	if config.Probe.Mode != probeModeGlobalping || config.Probe.Globalping.Type != "ping" {
		t.Fatalf("normalized = %+v", config.Probe)
	}
	if config.Probe.Globalping.Locations[0].Limit != 1 {
		t.Fatal("location limit was not defaulted")
	}
}
