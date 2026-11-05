package aggregator

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func writeLogFile(t *testing.T, dir, key string, lines []string) string {
	t.Helper()
	path := filepath.Join(dir, key+"_report.log")
	if err := os.MkdirAll(filepath.Dir(path), 0755); err != nil {
		t.Fatalf("mkdir: %v", err)
	}
	content := strings.Join(lines, "\n")
	if content != "" {
		content += "\n"
	}
	if err := os.WriteFile(path, []byte(content), 0644); err != nil {
		t.Fatalf("write log: %v", err)
	}
	return path
}

func latencyJSON(latency any) string {
	if value, ok := latency.(int64); ok {
		return fmt.Sprintf("%d", value)
	}
	return "null"
}

func legacyLine(timeStr, status string, latency any) string {
	return fmt.Sprintf("{\"time\":%q,\"status\":%q,\"latency\":%s}", timeStr, status, latencyJSON(latency))
}

func newLine(timeStr, status string, latency any, ok, tries int) string {
	return fmt.Sprintf("{\"time\":%q,\"status\":%q,\"latency\":%s,\"ok\":%d,\"tries\":%d}",
		timeStr, status, latencyJSON(latency), ok, tries)
}

func TestReadRecordsLegacyFiveLineGroup(t *testing.T) {
	tests := []struct {
		name           string
		lines          []string
		expectedStatus string
		expectedOK     int
		expectedTries  int
		expectedLat    *int64
	}{
		{
			name: "both local probes success, third-party latency ignored",
			lines: []string{
				legacyLine("2026-11-05 10:00:00", "success", int64(50)),
				legacyLine("2026-11-05 10:00:00", "success", int64(100)),
				legacyLine("2026-11-05 10:00:00", "success", int64(2000)),
				legacyLine("2026-11-05 10:00:00", "success", int64(1800)),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
			},
			expectedStatus: "success",
			expectedOK:     2,
			expectedTries:  2,
			expectedLat:    int64Ptr(75),
		},
		{
			name: "one local success is partial",
			lines: []string{
				legacyLine("2026-11-05 10:00:00", "success", int64(60)),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
				legacyLine("2026-11-05 10:00:00", "success", int64(1500)),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
			},
			expectedStatus: "partial",
			expectedOK:     1,
			expectedTries:  2,
			expectedLat:    int64Ptr(60),
		},
		{
			name: "both local probes failure",
			lines: []string{
				legacyLine("2026-11-05 10:00:00", "failure", nil),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
				legacyLine("2026-11-05 10:00:00", "success", int64(3000)),
				legacyLine("2026-11-05 10:00:00", "success", int64(2500)),
				legacyLine("2026-11-05 10:00:00", "failure", nil),
			},
			expectedStatus: "failure",
			expectedOK:     0,
			expectedTries:  2,
			expectedLat:    nil,
		},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			dir := t.TempDir()
			path := writeLogFile(t, dir, "Google", test.lines)
			records, err := ReadRecords(path)
			if err != nil {
				t.Fatalf("ReadRecords: %v", err)
			}
			if len(records) != 1 {
				t.Fatalf("records = %d, want 1 collapsed record", len(records))
			}
			record := records[0]
			if record.Status != test.expectedStatus {
				t.Errorf("status = %q, want %q", record.Status, test.expectedStatus)
			}
			if record.OK != test.expectedOK || record.Tries != test.expectedTries {
				t.Errorf("ok/tries = %d/%d, want %d/%d", record.OK, record.Tries, test.expectedOK, test.expectedTries)
			}
			if !equalInt64Ptr(record.Latency, test.expectedLat) {
				t.Errorf("latency = %v, want %v", int64PtrText(record.Latency), int64PtrText(test.expectedLat))
			}
		})
	}
}

func TestReadRecordsLegacySingleLine(t *testing.T) {
	dir := t.TempDir()
	path := writeLogFile(t, dir, "Mojoo", []string{
		legacyLine("2026-11-05 09:00:00", "success", int64(30)),
		legacyLine("2026-11-05 09:30:00", "failure", nil),
	})
	records, err := ReadRecords(path)
	if err != nil {
		t.Fatalf("ReadRecords: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	if records[0].Status != "success" || records[1].Status != "failure" {
		t.Fatalf("statuses = %q/%q, want success/failure", records[0].Status, records[1].Status)
	}
}

func TestReadRecordsNewFormat(t *testing.T) {
	dir := t.TempDir()
	path := writeLogFile(t, dir, "ShadowQ", []string{
		newLine("2026-11-05 10:00:00", "success", int64(72), 3, 3),
		newLine("2026-11-05 10:04:00", "partial", nil, 0, 3),
	})
	records, err := ReadRecords(path)
	if err != nil {
		t.Fatalf("ReadRecords: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	if records[0].OK != 3 || records[0].Tries != 3 {
		t.Fatalf("ok/tries = %d/%d, want 3/3", records[0].OK, records[0].Tries)
	}
	if records[1].Status != "partial" || records[1].Latency != nil {
		t.Fatalf("partial record = %+v, want status partial latency nil", records[1])
	}
}

func TestReadRecordsMixedFormats(t *testing.T) {
	dir := t.TempDir()
	path := writeLogFile(t, dir, "Google", []string{
		legacyLine("2026-11-05 09:00:00", "success", int64(50)),
		legacyLine("2026-11-05 09:00:00", "success", int64(70)),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
		newLine("2026-11-05 10:00:00", "success", int64(72), 3, 3),
	})
	records, err := ReadRecords(path)
	if err != nil {
		t.Fatalf("ReadRecords: %v", err)
	}
	if len(records) != 2 {
		t.Fatalf("records = %d, want 2", len(records))
	}
	if records[0].Status != "success" || records[1].Status != "success" {
		t.Fatalf("statuses = %q/%q, want success/success", records[0].Status, records[1].Status)
	}
}

func TestReadRecordsMissingFile(t *testing.T) {
	records, err := ReadRecords(filepath.Join(t.TempDir(), "Missing_report.log"))
	if err != nil {
		t.Fatalf("ReadRecords: %v", err)
	}
	if len(records) != 0 {
		t.Fatalf("records = %d, want 0", len(records))
	}
}

func TestBuildInvariants(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	dir := t.TempDir()
	writeLogFile(t, dir, "Google", []string{
		newLine("2026-11-05 10:30:00", "failure", nil, 0, 3),
		newLine("2026-11-05 10:00:00", "success", int64(100), 3, 3),
		newLine("2026-11-04 09:00:00", "success", int64(200), 3, 3),
		newLine("2026-11-03 09:00:00", "success", int64(300), 3, 3),
		newLine("2026-11-02 09:00:00", "success", int64(400), 3, 3),
	})

	document, err := Build(Input{
		Now:           now,
		RetentionDays: 3,
		LogDir:        dir,
		Services:      []ServiceInput{{Key: "Google", URL: "https://www.google.com"}},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}

	if document.Schema != Schema || document.RetentionDays != 3 {
		t.Fatalf("schema/retentionDays = %d/%d, want 2/3", document.Schema, document.RetentionDays)
	}
	if document.GeneratedAt != "2026-11-05T12:00:00+08:00" {
		t.Fatalf("generatedAt = %q, want 2026-11-05T12:00:00+08:00", document.GeneratedAt)
	}
	if document.GeneratedAtUnix != now.Unix() {
		t.Fatalf("generatedAtUnix = %d, want %d", document.GeneratedAtUnix, now.Unix())
	}
	if len(document.Services) != 1 {
		t.Fatalf("services = %d, want 1", len(document.Services))
	}

	service := document.Services[0]
	if service.Key != "Google" || service.URL != "https://www.google.com" {
		t.Fatalf("service identity = %q/%q", service.Key, service.URL)
	}
	if service.Status != "failure" {
		t.Fatalf("status = %q, want failure (latest record)", service.Status)
	}
	if service.Latency != nil {
		t.Fatalf("latency = %v, want nil for latest failure", *service.Latency)
	}
	if service.LastCheckAt != "2026-11-05T10:30:00+08:00" {
		t.Fatalf("lastCheckAt = %q, want 2026-11-05T10:30:00+08:00", service.LastCheckAt)
	}
	if service.Uptime != 75 {
		t.Fatalf("uptime = %v, want 75 (3/4 checks)", service.Uptime)
	}
	wantChecks := Checks{Success: 3, Partial: 0, Failure: 1, Total: 4, TodayTotal: 2, TodayFailures: 1}
	if service.Checks.Success != wantChecks.Success || service.Checks.Partial != wantChecks.Partial ||
		service.Checks.Failure != wantChecks.Failure || service.Checks.Total != wantChecks.Total ||
		service.Checks.TodayTotal != wantChecks.TodayTotal || service.Checks.TodayFailures != wantChecks.TodayFailures {
		t.Fatalf("checks = %+v", service.Checks)
	}
	if service.Checks.LastFailureAt == nil || *service.Checks.LastFailureAt != "2026-11-05T10:30:00+08:00" {
		t.Fatalf("lastFailureAt = %v, want 2026-11-05T10:30:00+08:00", service.Checks.LastFailureAt)
	}

	if len(service.Daily) != 3 {
		t.Fatalf("daily rows = %d, want 3", len(service.Daily))
	}
	wantDates := []string{"2026-11-03", "2026-11-04", "2026-11-05"}
	for i, row := range service.Daily {
		if row.Date != wantDates[i] {
			t.Errorf("daily[%d].date = %q, want %q", i, row.Date, wantDates[i])
		}
	}
	today := service.Daily[2]
	if today.Status != "partial" || today.UptimePct != 50 || today.Checks != 2 || today.Failures != 1 {
		t.Fatalf("today row = %+v, want partial/50/2/1", today)
	}
	if today.P50 == nil || *today.P50 != 100 || today.P95 == nil || *today.P95 != 100 {
		t.Fatalf("today p50/p95 = %v/%v, want 100/100", int64PtrText(today.P50), int64PtrText(today.P95))
	}
	yesterday := service.Daily[1]
	if yesterday.Status != "success" || yesterday.UptimePct != 100 || yesterday.Checks != 1 {
		t.Fatalf("yesterday row = %+v, want success/100/1", yesterday)
	}

	if len(service.Hourly) != 3 {
		t.Fatalf("hourly rows = %d, want 3 (one per hour with data)", len(service.Hourly))
	}
	for i := 1; i < len(service.Hourly); i++ {
		if service.Hourly[i-1].UnixHour >= service.Hourly[i].UnixHour {
			t.Fatalf("hourly rows are not ascending: %v", service.Hourly)
		}
	}
	wantHour := time.Date(2026, 11, 5, 10, 0, 0, 0, cst).Unix()
	if service.Hourly[2].UnixHour != wantHour {
		t.Fatalf("last hourly = %d, want %d", service.Hourly[2].UnixHour, wantHour)
	}
	if service.Hourly[2].Median == nil || *service.Hourly[2].Median != 100 {
		t.Fatalf("hourly median = %v, want 100", int64PtrText(service.Hourly[2].Median))
	}
}

func TestBuildJSONShape(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	dir := t.TempDir()
	writeLogFile(t, dir, "Google", []string{
		newLine("2026-11-05 10:00:00", "success", int64(72), 3, 3),
	})
	document, err := Build(Input{Now: now, RetentionDays: 2, LogDir: dir, Services: []ServiceInput{{Key: "Google"}}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	data, err := json.Marshal(document)
	if err != nil {
		t.Fatalf("marshal: %v", err)
	}

	var decoded struct {
		Schema          int
		GeneratedAt     string
		GeneratedAtUnix int64
		RetentionDays   int
		Services        []struct {
			Key    string
			Status string
			Uptime float64
			Checks struct{ Total int }
			Daily  [][]any
			Hourly [][]any
		}
	}
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal: %v", err)
	}
	if decoded.Schema != 2 || decoded.RetentionDays != 2 {
		t.Fatalf("schema/retentionDays = %d/%d", decoded.Schema, decoded.RetentionDays)
	}
	if len(decoded.Services) != 1 || len(decoded.Services[0].Daily) != 2 {
		t.Fatalf("daily rows = %d, want 2", len(decoded.Services[0].Daily))
	}
	if len(decoded.Services[0].Daily[0]) != 7 {
		t.Fatalf("daily row width = %d, want 7", len(decoded.Services[0].Daily[0]))
	}
	if len(decoded.Services[0].Hourly) != 1 || len(decoded.Services[0].Hourly[0]) != 3 {
		t.Fatalf("hourly rows/width = %d/%d, want 1/3", len(decoded.Services[0].Hourly),
			len(decoded.Services[0].Hourly[0]))
	}
}

func TestBuildNodata(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	document, err := Build(Input{
		Now:           now,
		RetentionDays: 3,
		LogDir:        t.TempDir(),
		Services:      []ServiceInput{{Key: "Missing"}},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	service := document.Services[0]
	if service.Status != "nodata" {
		t.Fatalf("status = %q, want nodata", service.Status)
	}
	if service.Uptime != 0 || service.Checks.Total != 0 {
		t.Fatalf("uptime/checks = %v/%d, want 0/0", service.Uptime, service.Checks.Total)
	}
	if len(service.Daily) != 3 {
		t.Fatalf("daily rows = %d, want 3", len(service.Daily))
	}
	for _, row := range service.Daily {
		if row.Status != "nodata" || row.UptimePct != 0 || row.Checks != 0 || row.Failures != 0 {
			t.Fatalf("nodata row = %+v", row)
		}
		if row.P50 != nil || row.P95 != nil {
			t.Fatalf("nodata row p50/p95 must be nil")
		}
	}
	if len(service.Hourly) != 0 {
		t.Fatalf("hourly rows = %d, want 0", len(service.Hourly))
	}
}

func TestBuildFailureOnlyDay(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	dir := t.TempDir()
	writeLogFile(t, dir, "Google", []string{
		newLine("2026-11-05 09:00:00", "failure", nil, 0, 3),
	})
	document, err := Build(Input{Now: now, RetentionDays: 1, LogDir: dir, Services: []ServiceInput{{Key: "Google"}}})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	service := document.Services[0]
	if service.Status != "failure" || service.Uptime != 0 {
		t.Fatalf("service = %+v, want failure/0", service)
	}
	row := service.Daily[0]
	if row.Status != "failure" || row.UptimePct != 0 || row.Checks != 1 || row.Failures != 1 {
		t.Fatalf("daily row = %+v, want failure/0/1/1", row)
	}
	if row.P50 != nil || row.P95 != nil {
		t.Fatalf("p50/p95 = %v/%v, want nil", int64PtrText(row.P50), int64PtrText(row.P95))
	}
}

func TestBuildUsesProbeInput(t *testing.T) {
	now := time.Date(2026, 11, 5, 12, 0, 0, 0, cst)
	dir := t.TempDir()
	writeLogFile(t, dir, "Google", []string{
		newLine("2026-11-05 10:00:00", "failure", nil, 0, 3),
	})
	latency := int64(42)
	document, err := Build(Input{
		Now:           now,
		RetentionDays: 1,
		LogDir:        dir,
		Services: []ServiceInput{{
			Key:         "Google",
			URL:         "https://www.google.com",
			Status:      "success",
			Latency:     &latency,
			LastCheckAt: now,
		}},
	})
	if err != nil {
		t.Fatalf("Build: %v", err)
	}
	service := document.Services[0]
	if service.Status != "success" || service.Latency == nil || *service.Latency != 42 {
		t.Fatalf("service = %+v, want probe status success/42", service)
	}
	if service.LastCheckAt != "2026-11-05T12:00:00+08:00" {
		t.Fatalf("lastCheckAt = %q", service.LastCheckAt)
	}
}

func TestLastStatus(t *testing.T) {
	dir := t.TempDir()
	legacy := writeLogFile(t, dir, "Legacy", []string{
		legacyLine("2026-11-05 09:00:00", "success", int64(50)),
		legacyLine("2026-11-05 09:00:00", "success", int64(70)),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
		legacyLine("2026-11-05 09:00:00", "failure", nil),
	})
	status, ok := LastStatus(legacy)
	if !ok || status != "success" {
		t.Fatalf("legacy last status = %q/%v, want success/true", status, ok)
	}

	current := writeLogFile(t, dir, "Current", []string{
		newLine("2026-11-05 10:00:00", "success", int64(50), 3, 3),
		newLine("2026-11-05 10:04:00", "failure", nil, 0, 3),
	})
	status, ok = LastStatus(current)
	if !ok || status != "failure" {
		t.Fatalf("current last status = %q/%v, want failure/true", status, ok)
	}

	if _, ok := LastStatus(filepath.Join(dir, "Missing_report.log")); ok {
		t.Fatal("LastStatus(missing) = true, want false")
	}
}

func TestWriteFileAtomic(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "data", "status.json")
	document := File{
		Schema:          2,
		GeneratedAt:     "2026-11-05T12:00:00+08:00",
		GeneratedAtUnix: 1793832000,
		RetentionDays:   1,
		Services:        []Service{},
	}
	if err := WriteFile(path, document); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read output: %v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(data, &decoded); err != nil {
		t.Fatalf("unmarshal output: %v", err)
	}
	if decoded["schema"] != float64(2) {
		t.Fatalf("schema = %v, want 2", decoded["schema"])
	}
	matches, err := filepath.Glob(filepath.Join(dir, "data", ".status-*"))
	if err != nil {
		t.Fatal(err)
	}
	if len(matches) != 0 {
		t.Fatalf("temp files left behind: %v", matches)
	}
}

func int64Ptr(value int64) *int64 { return &value }

func equalInt64Ptr(a, b *int64) bool {
	if a == nil || b == nil {
		return a == nil && b == nil
	}
	return *a == *b
}

func int64PtrText(value *int64) string {
	if value == nil {
		return "nil"
	}
	return fmt.Sprintf("%d", *value)
}
