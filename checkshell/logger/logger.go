package logger

import (
	"bufio"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"time"
)

type LogEntry struct {
	Time    string `json:"time"`
	Status  string `json:"status"`
	Latency *int64 `json:"latency"`
}

func WriteLog(key string, timestamp time.Time, status string, latency *int64, maxLines int) error {
	logDir := filepath.Join("..", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	logPath := filepath.Join(logDir, fmt.Sprintf("%s_report.log", key))

	loc, _ := time.LoadLocation("Asia/Shanghai")
	beijingTime := timestamp.In(loc)
	timeStr := beijingTime.Format("2006-01-02 15:04:05")

	entry := LogEntry{
		Time:    timeStr,
		Status:  status,
		Latency: latency,
	}

	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal log entry: %w", err)
	}

	existingLines, err := readExistingLines(logPath, maxLines-1)
	if err != nil {
		return fmt.Errorf("failed to read existing log: %w", err)
	}

	file, err := os.Create(logPath)
	if err != nil {
		return fmt.Errorf("failed to create log file: %w", err)
	}
	defer file.Close()

	writer := bufio.NewWriter(file)
	for _, existingLine := range existingLines {
		if _, err := writer.WriteString(existingLine + "\n"); err != nil {
			return fmt.Errorf("failed to write existing line: %w", err)
		}
	}

	if _, err := writer.WriteString(string(line) + "\n"); err != nil {
		return fmt.Errorf("failed to write new line: %w", err)
	}

	if err := writer.Flush(); err != nil {
		return fmt.Errorf("failed to flush writer: %w", err)
	}

	return nil
}

func readExistingLines(logPath string, maxLines int) ([]string, error) {
	file, err := os.Open(logPath)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	defer file.Close()

	var lines []string
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		lines = append(lines, scanner.Text())
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	if len(lines) > maxLines {
		lines = lines[len(lines)-maxLines:]
	}

	return lines, nil
}

func ReadLogs(key string) ([]LogEntry, error) {
	logPath := filepath.Join("..", "logs", fmt.Sprintf("%s_report.log", key))
	
	file, err := os.Open(logPath)
	if err != nil {
		return nil, err
	}
	defer file.Close()

	var entries []LogEntry
	scanner := bufio.NewScanner(file)
	for scanner.Scan() {
		var entry LogEntry
		if err := json.Unmarshal(scanner.Bytes(), &entry); err != nil {
			continue
		}
		entries = append(entries, entry)
	}

	if err := scanner.Err(); err != nil {
		return nil, err
	}

	return entries, nil
}

func AppendLog(key string, entry LogEntry) error {
	logDir := filepath.Join("..", "logs")
	if err := os.MkdirAll(logDir, 0755); err != nil {
		return fmt.Errorf("failed to create log directory: %w", err)
	}

	logPath := filepath.Join(logDir, fmt.Sprintf("%s_report.log", key))

	file, err := os.OpenFile(logPath, os.O_APPEND|os.O_CREATE|os.O_WRONLY, 0644)
	if err != nil {
		return fmt.Errorf("failed to open log file: %w", err)
	}
	defer file.Close()

	line, err := json.Marshal(entry)
	if err != nil {
		return fmt.Errorf("failed to marshal log entry: %w", err)
	}

	if _, err := file.WriteString(string(line) + "\n"); err != nil {
		return fmt.Errorf("failed to write log entry: %w", err)
	}

	return nil
}
