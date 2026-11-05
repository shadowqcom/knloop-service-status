// Package logger appends one-line check records to per-service log files and
// enforces the retention window (retentionDays / maxLogLines).
package logger

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

const timeLayout = "2006-01-02 15:04:05"

var cst = func() *time.Location {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("CST", 8*60*60)
	}
	return loc
}()

// Entry is one line of a service report log. OK/Tries are only present in the
// v2 format; legacy entries decode into zero values.
type Entry struct {
	Time    string `json:"time"`
	Status  string `json:"status"`
	Latency *int64 `json:"latency"`
	OK      int    `json:"ok"`
	Tries   int    `json:"tries"`
}

// Options controls where and how the log file is trimmed.
type Options struct {
	Dir           string
	RetentionDays int
	MaxLogLines   int
}

// Path returns the report log path for a service key.
func Path(key string, opts Options) string {
	dir := opts.Dir
	if dir == "" {
		dir = filepath.Join("..", "logs")
	}
	return filepath.Join(dir, fmt.Sprintf("%s_report.log", key))
}

// Write appends one v2 check record to <key>_report.log and trims the file.
func Write(key string, timestamp time.Time, status string, latency *int64, ok, tries int, opts Options) error {
	entry := Entry{
		Time:    timestamp.In(cst).Format(timeLayout),
		Status:  status,
		Latency: latency,
		OK:      ok,
		Tries:   tries,
	}
	return WriteEntry(key, entry, opts)
}

// WriteEntry appends an already built entry. The file is rewritten atomically
// (temp file + rename) so readers never observe a half-written file.
func WriteEntry(key string, entry Entry, opts Options) error {
	if entry.Status != "success" && entry.Status != "partial" && entry.Status != "failure" {
		return fmt.Errorf("invalid status %q", entry.Status)
	}
	logPath := Path(key, opts)
	if err := os.MkdirAll(filepath.Dir(logPath), 0755); err != nil {
		return fmt.Errorf("create log directory: %w", err)
	}

	lines, err := readAllLines(logPath)
	if err != nil {
		return fmt.Errorf("read existing log: %w", err)
	}

	encoded, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("marshal log entry: %w", err)
	}
	lines = append(lines, string(encoded))

	ref, err := time.ParseInLocation(timeLayout, entry.Time, cst)
	if err != nil {
		ref = time.Now().In(cst)
	}
	lines = trimLines(lines, ref, opts.RetentionDays, opts.MaxLogLines)
	return writeLinesAtomic(logPath, lines)
}

// ReadLogs reads all parseable entries from <key>_report.log in the default
// logs directory. It is kept for callers that only need the raw records.
func ReadLogs(key string) ([]Entry, error) {
	lines, err := readAllLines(Path(key, Options{}))
	if err != nil {
		return nil, err
	}
	entries := make([]Entry, 0, len(lines))
	for _, line := range lines {
		var entry Entry
		if err := json.Unmarshal([]byte(line), &entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}
	return entries, nil
}

func trimLines(lines []string, ref time.Time, retentionDays, maxLines int) []string {
	if retentionDays > 0 {
		dayStart := time.Date(ref.Year(), ref.Month(), ref.Day(), 0, 0, 0, 0, ref.Location())
		cutoff := dayStart.AddDate(0, 0, -(retentionDays - 1))
		kept := make([]string, 0, len(lines))
		for _, line := range lines {
			t, ok := parseLineTime(line)
			if !ok || !t.Before(cutoff) {
				kept = append(kept, line)
			}
		}
		lines = kept
	}
	if maxLines > 0 && len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}
	return lines
}

func parseLineTime(line string) (time.Time, bool) {
	var entry Entry
	if err := json.Unmarshal([]byte(line), &entry); err != nil {
		return time.Time{}, false
	}
	t, err := time.ParseInLocation(timeLayout, entry.Time, cst)
	if err != nil {
		return time.Time{}, false
	}
	return t, true
}

func readAllLines(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	scanner.Buffer(make([]byte, 64*1024), 1024*1024)
	for scanner.Scan() {
		if line := scanner.Text(); line != "" {
			lines = append(lines, line)
		}
	}
	if err := scanner.Err(); err != nil {
		return nil, err
	}
	return lines, nil
}

func writeLinesAtomic(path string, lines []string) error {
	dir := filepath.Dir(path)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dir, ".report-*.tmp")
	if err != nil {
		return err
	}
	tmpName := tmp.Name()
	defer os.Remove(tmpName)

	writer := bufio.NewWriter(tmp)
	for _, line := range lines {
		if _, err := writer.WriteString(line); err != nil {
			tmp.Close()
			return err
		}
		if err := writer.WriteByte('\n'); err != nil {
			tmp.Close()
			return err
		}
	}
	if err := writer.Flush(); err != nil {
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
