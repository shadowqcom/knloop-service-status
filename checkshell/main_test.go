package main

import (
	"testing"

	"servicecheck/checker"
)

func TestApplyDefaultsLegacyKeys(t *testing.T) {
	config := Config{MaxRetries: 5, MaxDays: 60, MaxLogLines: 10500, RequestTimeoutMs: 7000}
	applyDefaults(&config)

	if config.Attempts != 5 {
		t.Fatalf("attempts = %d, want 5 (legacy maxRetries alias)", config.Attempts)
	}
	if config.MinSuccess != 2 {
		t.Fatalf("minSuccess = %d, want 2", config.MinSuccess)
	}
	if config.RetryDelayMs != 250 {
		t.Fatalf("retryDelayMs = %d, want 250", config.RetryDelayMs)
	}
	if config.RequestTimeoutMs != 7000 {
		t.Fatalf("requestTimeoutMs = %d, want 7000 (legacy key preserved)", config.RequestTimeoutMs)
	}
	if config.RetentionDays != 60 {
		t.Fatalf("retentionDays = %d, want 60 (legacy maxDays)", config.RetentionDays)
	}
	if config.MaxLogLines != 10500 {
		t.Fatalf("maxLogLines = %d, want 10500", config.MaxLogLines)
	}
	if config.PeerCheck == nil || !config.PeerCheck.Enabled || config.PeerCheck.TimeoutMs != 5000 {
		t.Fatalf("peerCheck = %+v, want enabled with 5000ms timeout", config.PeerCheck)
	}
	if config.UserAgent != checker.DefaultUserAgent {
		t.Fatalf("userAgent = %q, want default", config.UserAgent)
	}
}

func TestApplyDefaultsNewKeys(t *testing.T) {
	config := Config{
		Attempts:         4,
		MinSuccess:       3,
		RetentionDays:    30,
		RequestTimeoutMs: 6000,
		RetryDelayMs:     100,
		PeerCheck:        &PeerCheckConfig{Enabled: false, TimeoutMs: 2000},
		UserAgent:        "custom-agent",
	}
	applyDefaults(&config)

	if config.Attempts != 4 || config.MinSuccess != 3 {
		t.Fatalf("attempts/minSuccess = %d/%d, want 4/3", config.Attempts, config.MinSuccess)
	}
	if config.RetentionDays != 30 || config.MaxLogLines != 10500 {
		t.Fatalf("retentionDays/maxLogLines = %d/%d", config.RetentionDays, config.MaxLogLines)
	}
	if config.PeerCheck == nil || config.PeerCheck.Enabled || config.PeerCheck.TimeoutMs != 2000 {
		t.Fatalf("peerCheck = %+v, want disabled with 2000ms timeout", config.PeerCheck)
	}
	if config.UserAgent != "custom-agent" {
		t.Fatalf("userAgent = %q, want custom-agent", config.UserAgent)
	}
}

func TestApplyDefaultsClampsMinSuccess(t *testing.T) {
	config := Config{Attempts: 2, MinSuccess: 5}
	applyDefaults(&config)
	if config.MinSuccess != 2 {
		t.Fatalf("minSuccess = %d, want clamped to attempts (2)", config.MinSuccess)
	}
}

func TestTransitions(t *testing.T) {
	runs := []runState{
		{service: Service{Key: "A"}, status: "failure", prevStatus: "success", hasPrev: true},
		{service: Service{Key: "B"}, status: "success", prevStatus: "failure", hasPrev: true},
		{service: Service{Key: "C"}, status: "failure", prevStatus: "failure", hasPrev: true},
		{service: Service{Key: "D"}, status: "success", prevStatus: "success", hasPrev: true},
		{service: Service{Key: "E"}, status: "failure", hasPrev: false},
	}
	down, recovered := transitions(runs)
	if len(down) != 1 || down[0].Key != "A" {
		t.Fatalf("down = %+v, want only A", down)
	}
	if len(recovered) != 1 || recovered[0].Key != "B" {
		t.Fatalf("recovered = %+v, want only B", recovered)
	}
}
