package logger

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func readLines(t *testing.T, path string) []string {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	text := strings.TrimSuffix(string(data), "\n")
	if text == "" {
		return nil
	}
	return strings.Split(text, "\n")
}

func TestWriteRetentionWindow(t *testing.T) {
	dir := t.TempDir()
	options := Options{Dir: dir, RetentionDays: 3, MaxLogLines: 100}
	reference := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	latency := func(value int64) *int64 { return &value }

	entries := []struct {
		when   time.Time
		status string
	}{
		{reference.AddDate(0, 0, -5), "success"},
		{reference.AddDate(0, 0, -2), "success"},
		{reference, "partial"},
	}
	for _, entry := range entries {
		if err := Write("Google", entry.when, entry.status, latency(10), 1, 3, options); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}

	lines := readLines(t, filepath.Join(dir, "Google_report.log"))
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2 (5 days ago trimmed)", len(lines))
	}
	if !strings.Contains(lines[len(lines)-1], "\"status\":\"partial\"") {
		t.Fatalf("last line = %s, want partial entry", lines[len(lines)-1])
	}
}

func TestWriteMaxLogLines(t *testing.T) {
	dir := t.TempDir()
	options := Options{Dir: dir, MaxLogLines: 2}
	reference := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	for i := 0; i < 4; i++ {
		if err := Write("Google", reference.Add(time.Duration(i)*time.Minute), "success", nil, 3, 3, options); err != nil {
			t.Fatalf("Write: %v", err)
		}
	}
	lines := readLines(t, filepath.Join(dir, "Google_report.log"))
	if len(lines) != 2 {
		t.Fatalf("lines = %d, want 2", len(lines))
	}
	want := reference.Add(3 * time.Minute).Format(timeLayout)
	var decoded Entry
	if err := json.Unmarshal([]byte(lines[1]), &decoded); err != nil {
		t.Fatalf("unmarshal last line: %v", err)
	}
	if decoded.Time != want {
		t.Fatalf("last entry time = %q, want %q", decoded.Time, want)
	}
}

func TestWriteNewFormatFields(t *testing.T) {
	dir := t.TempDir()
	reference := time.Date(2026, 11, 5, 2, 43, 28, 0, cst)
	latency := int64(72)
	if err := Write("Google", reference, "success", &latency, 3, 3, Options{Dir: dir, RetentionDays: 60, MaxLogLines: 100}); err != nil {
		t.Fatalf("Write: %v", err)
	}

	lines := readLines(t, filepath.Join(dir, "Google_report.log"))
	if len(lines) != 1 {
		t.Fatalf("lines = %d, want 1", len(lines))
	}

	var raw map[string]any
	if err := json.Unmarshal([]byte(lines[0]), &raw); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if raw["time"] != "2026-11-05 02:43:28" {
		t.Errorf("time = %v, want 2026-11-05 02:43:28 (Beijing)", raw["time"])
	}
	if raw["status"] != "success" {
		t.Errorf("status = %v, want success", raw["status"])
	}
	if raw["latency"] != float64(72) {
		t.Errorf("latency = %v, want 72", raw["latency"])
	}
	if raw["ok"] != float64(3) || raw["tries"] != float64(3) {
		t.Errorf("ok/tries = %v/%v, want 3/3", raw["ok"], raw["tries"])
	}

	matches, err := filepath.Glob(filepath.Join(dir, ".report-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temp files left behind: %v", matches)
	}
}

func TestTrimLinesDropsOldKeepsMalformed(t *testing.T) {
	reference := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	lines := []string{
		"{\"time\":\"2026-10-01 00:00:00\",\"status\":\"success\",\"latency\":10}",
		"not-json",
		"{\"time\":\"2026-11-04 00:00:00\",\"status\":\"success\",\"latency\":20}",
	}
	trimmed := trimLines(lines, reference, 3, 10)
	if len(trimmed) != 2 {
		t.Fatalf("trimmed lines = %d, want 2 (old line dropped, malformed kept)", len(trimmed))
	}
	if trimmed[0] != "not-json" {
		t.Fatalf("first kept line = %q, want not-json", trimmed[0])
	}
}

func TestWriteRejectsInvalidStatus(t *testing.T) {
	dir := t.TempDir()
	if err := Write("Google", time.Now(), "unknown", nil, 0, 3, Options{Dir: dir}); err == nil {
		t.Fatal("Write() error = nil, want error for invalid status")
	}
}
