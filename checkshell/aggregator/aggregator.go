// Package aggregator reads per-service check logs (both the v2 one-line format
// and the legacy five-line-per-round format) and builds data/status.json.
package aggregator

import (
	"bufio"
	"encoding/json"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
)

const (
	// Schema is the status.json schema version.
	Schema = 2

	timeLayout = "2006-01-02 15:04:05"
	dateLayout = "2006-01-02"

	statusSuccess = "success"
	statusPartial = "partial"
	statusFailure = "failure"
	statusNoData  = "nodata"
)

var cst = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*60*60)
	}
	return loc
}()

// Record is one normalized check. Legacy five-line groups are collapsed into a
// single local-probe record before aggregation.
type Record struct {
	Time    time.Time
	Status  string
	Latency *int64
	OK      int
	Tries   int
}

// ServiceInput describes a service for Build. Status/Latency/LastCheckAt are
// normally filled from the live probe; when they are empty (aggregate-only
// mode) they are derived from the latest log record.
type ServiceInput struct {
	Key         string
	URL         string
	Status      string
	Latency     *int64
	LastCheckAt time.Time
}

// Input is the input of Build.
type Input struct {
	Now           time.Time
	RetentionDays int
	Services      []ServiceInput
	LogDir        string
}

// File is the top-level data/status.json document.
type File struct {
	Schema          int       `json:"schema"`
	GeneratedAt     string    `json:"generatedAt"`
	GeneratedAtUnix int64     `json:"generatedAtUnix"`
	RetentionDays   int       `json:"retentionDays"`
	Services        []Service `json:"services"`
}

// Service is one aggregated service entry.
type Service struct {
	Key         string      `json:"key"`
	URL         string      `json:"url"`
	Status      string      `json:"status"`
	Latency     *int64      `json:"latency"`
	LastCheckAt string      `json:"lastCheckAt"`
	Uptime      float64     `json:"uptime"`
	Checks      Checks      `json:"checks"`
	Daily       []DailyRow  `json:"daily"`
	Hourly      []HourlyRow `json:"hourly"`
}

// Checks holds counter fields for a service.
type Checks struct {
	Success       int     `json:"success"`
	Partial       int     `json:"partial"`
	Failure       int     `json:"failure"`
	Total         int     `json:"total"`
	TodayTotal    int     `json:"todayTotal"`
	TodayFailures int     `json:"todayFailures"`
	LastFailureAt *string `json:"lastFailureAt"`
}

// DailyRow is one row of the daily array:
// [date, status, uptimePct, p50, p95, checks, failures].
type DailyRow struct {
	Date      string
	Status    string
	UptimePct float64
	P50       *int64
	P95       *int64
	Checks    int
	Failures  int
}

// MarshalJSON encodes the documented compact array form.
func (r DailyRow) MarshalJSON() ([]byte, error) {
	var p50, p95 any
	if r.P50 != nil {
		p50 = *r.P50
	}
	if r.P95 != nil {
		p95 = *r.P95
	}
	return json.Marshal([]any{r.Date, r.Status, r.UptimePct, p50, p95, r.Checks, r.Failures})
}

// HourlyRow is one row of the hourly array: [unixHourStart, median, p95].
type HourlyRow struct {
	UnixHour int64
	Median   *int64
	P95      *int64
}

// MarshalJSON encodes the documented compact array form.
func (r HourlyRow) MarshalJSON() ([]byte, error) {
	var median, p95 any
	if r.Median != nil {
		median = *r.Median
	}
	if r.P95 != nil {
		p95 = *r.P95
	}
	return json.Marshal([]any{r.UnixHour, median, p95})
}

type rawLine struct {
	Time    string `json:"time"`
	Status  string `json:"status"`
	Latency *int64 `json:"latency"`
	OK      *int   `json:"ok"`
	Tries   *int   `json:"tries"`
}

func (r rawLine) isNewFormat() bool {
	return r.OK != nil || r.Tries != nil
}

// Build reads the logs of every service and produces the status.json document.
func Build(in Input) (File, error) {
	if in.RetentionDays <= 0 {
		in.RetentionDays = 60
	}
	if in.LogDir == "" {
		in.LogDir = filepath.Join("..", "logs")
	}
	now := in.Now
	if now.IsZero() {
		now = time.Now()
	}
	now = now.In(cst)
	generatedUnix := in.Now.Unix()
	if in.Now.IsZero() {
		generatedUnix = now.Unix()
	}

	windowStart := startOfDay(now).AddDate(0, 0, -(in.RetentionDays - 1))
	windowEnd := startOfDay(now).AddDate(0, 0, 1)

	services := make([]Service, 0, len(in.Services))
	for _, service := range in.Services {
		records, err := ReadRecords(filepath.Join(in.LogDir, service.Key+"_report.log"))
		if err != nil {
			return File{}, fmt.Errorf("read %s log: %w", service.Key, err)
		}
		filtered := make([]Record, 0, len(records))
		for _, record := range records {
			if !record.Time.Before(windowStart) && record.Time.Before(windowEnd) {
				filtered = append(filtered, record)
			}
		}
		services = append(services, aggregateService(service, filtered, now, in.RetentionDays))
	}

	return File{
		Schema:          Schema,
		GeneratedAt:     now.Format(time.RFC3339),
		GeneratedAtUnix: generatedUnix,
		RetentionDays:   in.RetentionDays,
		Services:        services,
	}, nil
}

func aggregateService(service ServiceInput, records []Record, now time.Time, retentionDays int) Service {
	byDate := make(map[string][]Record, retentionDays)
	byHour := make(map[int64][]Record)
	for _, record := range records {
		dateKey := record.Time.Format(dateLayout)
		byDate[dateKey] = append(byDate[dateKey], record)
		hourStart := time.Date(record.Time.Year(), record.Time.Month(), record.Time.Day(), record.Time.Hour(), 0, 0, 0, cst)
		byHour[hourStart.Unix()] = append(byHour[hourStart.Unix()], record)
	}

	daily := buildDaily(byDate, now, retentionDays)
	hourly := buildHourly(byHour)

	checks := Checks{Total: len(records)}
	var lastFailure *time.Time
	for _, record := range records {
		switch record.Status {
		case statusSuccess:
			checks.Success++
		case statusPartial:
			checks.Partial++
		case statusFailure:
			checks.Failure++
			if lastFailure == nil || record.Time.After(*lastFailure) {
				t := record.Time
				lastFailure = &t
			}
		}
	}
	todayKey := now.Format(dateLayout)
	today := byDate[todayKey]
	checks.TodayTotal = len(today)
	for _, record := range today {
		if record.Status == statusFailure {
			checks.TodayFailures++
		}
	}
	if lastFailure != nil {
		formatted := lastFailure.In(cst).Format(time.RFC3339)
		checks.LastFailureAt = &formatted
	}

	status := service.Status
	latency := service.Latency
	lastCheckAt := service.LastCheckAt
	if len(records) > 0 {
		latest := records[len(records)-1]
		if status == "" {
			status = latest.Status
		}
		if latency == nil && service.Status == "" {
			latency = latest.Latency
		}
		if lastCheckAt.IsZero() {
			lastCheckAt = latest.Time
		}
	}
	if status == "" {
		status = statusNoData
	}

	lastCheck := ""
	if !lastCheckAt.IsZero() {
		lastCheck = lastCheckAt.In(cst).Format(time.RFC3339)
	}

	uptime := 0.0
	if checks.Total > 0 {
		uptime = round2(float64(checks.Success) / float64(checks.Total) * 100)
	}

	return Service{
		Key:         service.Key,
		URL:         service.URL,
		Status:      status,
		Latency:     latency,
		LastCheckAt: lastCheck,
		Uptime:      uptime,
		Checks:      checks,
		Daily:       daily,
		Hourly:      hourly,
	}
}

func buildDaily(byDate map[string][]Record, now time.Time, retentionDays int) []DailyRow {
	rows := make([]DailyRow, 0, retentionDays)
	start := startOfDay(now).AddDate(0, 0, -(retentionDays - 1))
	for i := 0; i < retentionDays; i++ {
		date := start.AddDate(0, 0, i).Format(dateLayout)
		records := byDate[date]
		row := DailyRow{Date: date}
		if len(records) == 0 {
			row.Status = statusNoData
			rows = append(rows, row)
			continue
		}
		var success, failure int
		latencies := make([]int64, 0, len(records))
		for _, record := range records {
			switch record.Status {
			case statusSuccess:
				success++
			case statusFailure:
				failure++
			}
			if hasLatency(record) {
				latencies = append(latencies, *record.Latency)
			}
		}
		row.Status = dailyStatus(success, failure)
		row.Checks = len(records)
		row.Failures = failure
		row.UptimePct = round2(float64(success) / float64(len(records)) * 100)
		row.P50 = medianPtr(latencies)
		row.P95 = percentilePtr(latencies, 95)
		rows = append(rows, row)
	}
	return rows
}

func dailyStatus(success, failure int) string {
	switch {
	case failure == 0:
		return statusSuccess
	case success == 0:
		return statusFailure
	default:
		return statusPartial
	}
}

func buildHourly(byHour map[int64][]Record) []HourlyRow {
	keys := make([]int64, 0, len(byHour))
	for key := range byHour {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool { return keys[i] < keys[j] })

	rows := make([]HourlyRow, 0, len(keys))
	for _, key := range keys {
		latencies := make([]int64, 0, len(byHour[key]))
		for _, record := range byHour[key] {
			if hasLatency(record) {
				latencies = append(latencies, *record.Latency)
			}
		}
		rows = append(rows, HourlyRow{
			UnixHour: key,
			Median:   medianPtr(latencies),
			P95:      percentilePtr(latencies, 95),
		})
	}
	return rows
}

func hasLatency(record Record) bool {
	return (record.Status == statusSuccess || record.Status == statusPartial) && record.Latency != nil
}

// ReadRecords parses a report log file. Missing files yield no records. The
// parser understands:
//   - v2 single lines (they carry ok/tries);
//   - legacy single lines (one check per line);
//   - legacy five-line groups (same time, 2 local + 3 third-party probes), for
//     which only the first two local lines are used and third-party latency is
//     discarded.
func ReadRecords(path string) ([]Record, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	lines := make([]rawLine, 0, 1024)
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" {
			continue
		}
		var parsed rawLine
		if err := json.Unmarshal([]byte(line), &parsed); err != nil {
			continue
		}
		lines = append(lines, parsed)
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}

	records := parseRecords(lines)
	sort.SliceStable(records, func(i, j int) bool { return records[i].Time.Before(records[j].Time) })
	return records, nil
}

func parseRecords(lines []rawLine) []Record {
	records := make([]Record, 0, len(lines))
	for i := 0; i < len(lines); {
		if lines[i].isNewFormat() {
			if record, ok := lines[i].record(); ok {
				records = append(records, record)
			}
			i++
			continue
		}

		// Group consecutive legacy lines that share a timestamp. The legacy
		// writer emitted five lines per round with an identical timestamp.
		j := i + 1
		for j < len(lines) && !lines[j].isNewFormat() && lines[j].Time == lines[i].Time {
			j++
		}
		group := lines[i:j]
		i = j

		if len(group) >= 3 {
			if record, ok := legacyGroupRecord(group[:2]); ok {
				records = append(records, record)
			}
			continue
		}
		for _, line := range group {
			if record, ok := line.record(); ok {
				records = append(records, record)
			}
		}
	}
	return records
}

func legacyGroupRecord(local []rawLine) (Record, bool) {
	if len(local) == 0 {
		return Record{}, false
	}
	when, err := time.ParseInLocation(timeLayout, local[0].Time, cst)
	if err != nil {
		return Record{}, false
	}
	record := Record{Time: when, Tries: len(local)}
	latencies := make([]int64, 0, len(local))
	for _, line := range local {
		if line.Status == statusSuccess {
			record.OK++
			if line.Latency != nil {
				latencies = append(latencies, *line.Latency)
			}
		}
	}
	switch {
	case record.OK == len(local):
		record.Status = statusSuccess
	case record.OK == 0:
		record.Status = statusFailure
	default:
		record.Status = statusPartial
	}
	if len(latencies) > 0 {
		record.Latency = medianPtr(latencies)
	}
	return record, true
}

func (r rawLine) record() (Record, bool) {
	when, err := time.ParseInLocation(timeLayout, r.Time, cst)
	if err != nil {
		return Record{}, false
	}
	if r.Status != statusSuccess && r.Status != statusPartial && r.Status != statusFailure {
		return Record{}, false
	}
	record := Record{Time: when, Status: r.Status, Latency: r.Latency}
	if r.OK != nil {
		record.OK = *r.OK
	}
	if r.Tries != nil {
		record.Tries = *r.Tries
	}
	return record, true
}

// LastStatus returns the status of the latest record in a report log file. The
// bool is false when the file is missing or has no usable records.
func LastStatus(path string) (string, bool) {
	records, err := ReadRecords(path)
	if err != nil || len(records) == 0 {
		return "", false
	}
	return records[len(records)-1].Status, true
}

// WriteFile writes status.json atomically (temp file + rename) and creates the
// target directory when needed.
func WriteFile(path string, document File) error {
	data, err := json.Marshal(document)
	if err != nil {
		return fmt.Errorf("marshal status.json: %w", err)
	}
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return fmt.Errorf("create status directory: %w", err)
	}
	tmp, err := os.CreateTemp(dir, ".status-*.json")
	if err != nil {
		return fmt.Errorf("create temp status file: %w", err)
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	if _, err := tmp.Write(data); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write([]byte("\n")); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	if err := os.Rename(tmpName, path); err != nil {
		return err
	}
	return nil
}

func startOfDay(t time.Time) time.Time {
	return time.Date(t.Year(), t.Month(), t.Day(), 0, 0, 0, 0, t.Location())
}

func round2(value float64) float64 {
	return math.Round(value*100) / 100
}

func medianPtr(values []int64) *int64 {
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

func percentilePtr(values []int64, percentile float64) *int64 {
	if len(values) == 0 {
		return nil
	}
	sorted := append([]int64(nil), values...)
	sort.Slice(sorted, func(i, j int) bool { return sorted[i] < sorted[j] })
	index := int(math.Ceil(percentile/100*float64(len(sorted)))) - 1
	if index < 0 {
		index = 0
	}
	if index >= len(sorted) {
		index = len(sorted) - 1
	}
	value := sorted[index]
	return &value
}
