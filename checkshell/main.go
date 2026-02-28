package main

import (
	"encoding/json"
	"fmt"
	"log"
	"os"
	"path/filepath"
	"sync"
	"time"

	"servicecheck/checker"
	"servicecheck/logger"
	"servicecheck/notifier"
)

type WebhookConfig struct {
	Enabled bool `json:"enabled"`
}

type Config struct {
	MaxDays           int           `json:"maxDays"`
	MaxHour           int           `json:"maxHour"`
	MaxLogLines       int           `json:"maxLogLines"`
	LogsPath          string        `json:"logspath"`
	ReloadReportsData bool          `json:"reloadReportsdata"`
	ReloadReportsTime float64       `json:"reloadReportstime"`
	Webhook           WebhookConfig `json:"webhook"`
	Services          []Service     `json:"services"`
}

type Service struct {
	Key string `json:"key"`
	URL string `json:"url"`
}

type CheckResult struct {
	Key      string
	URL      string
	Source   string
	Success  bool
	Latency  int64
	Timestamp time.Time
	Error    error
}

type ServiceCheckResult struct {
	Key       string
	URL       string
	Status    string
	Latency   int64
	Timestamp time.Time
	Results   []CheckResult
}

func toNotifierResult(r ServiceCheckResult) notifier.CheckResult {
	return notifier.CheckResult{
		Key:       r.Key,
		URL:       r.URL,
		Status:    r.Status,
		Latency:   r.Latency,
		Timestamp: r.Timestamp,
	}
}

const (
	MaxRetries     = 3
	RetryDelay     = 5 * time.Second
	RequestTimeout = 7 * time.Second
)

func main() {
	loc, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		log.Printf("Warning: Failed to load timezone: %v, using UTC", err)
		loc = time.UTC
	}
	time.Local = loc

	config, err := loadConfig()
	if err != nil {
		log.Fatalf("Failed to load config: %v", err)
	}

	if err := ensureDirectories(); err != nil {
		log.Fatalf("Failed to create directories: %v", err)
	}

	results := make(chan ServiceCheckResult, len(config.Services))
	var wg sync.WaitGroup

	for _, service := range config.Services {
		wg.Add(1)
		go func(s Service) {
			defer wg.Done()
			result := checkService(s)
			results <- result
		}(service)
	}

	go func() {
		wg.Wait()
		close(results)
	}()

	failedServices := make([]ServiceCheckResult, 0)
	for result := range results {
		log.Printf("[%s] Status: %s, Latency: %dms", result.Key, result.Status, result.Latency)

		for _, r := range result.Results {
			statusStr := "failure"
			if r.Success {
				statusStr = "success"
			}
			if err := logger.WriteLog(result.Key, r.Timestamp, statusStr, r.Latency, config.MaxLogLines); err != nil {
				log.Printf("Failed to write log for %s (%s): %v", result.Key, r.Source, err)
			}
		}

		if result.Status != "success" {
			failedServices = append(failedServices, result)
		}
	}

	if config.Webhook.Enabled && len(failedServices) > 0 {
		webhookKey := os.Getenv("WEBHOOK_KEY")
		if webhookKey != "" {
			webhookURL := fmt.Sprintf("https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=%s", webhookKey)
			notifierResults := make([]notifier.CheckResult, len(failedServices))
			for i, r := range failedServices {
				notifierResults[i] = toNotifierResult(r)
			}
			if err := notifier.SendWebhookNotification(webhookURL, notifierResults); err != nil {
				log.Printf("Failed to send notification: %v", err)
			} else {
				log.Println("Notification sent successfully")
			}
		} else {
			log.Println("Warning: WEBHOOK_KEY environment variable not set")
		}
	}

	log.Println("Service check completed")
}

func loadConfig() (*Config, error) {
	configPath := filepath.Join("..", "src", "config.json")
	data, err := os.ReadFile(configPath)
	if err != nil {
		return nil, fmt.Errorf("failed to read config file: %w", err)
	}

	var config Config
	if err := json.Unmarshal(data, &config); err != nil {
		return nil, fmt.Errorf("failed to parse config: %w", err)
	}

	if config.MaxLogLines <= 0 {
		config.MaxLogLines = 10500
	}

	return &config, nil
}

func ensureDirectories() error {
	dirs := []string{filepath.Join("..", "logs"), filepath.Join("..", "tmp")}
	for _, dir := range dirs {
		if err := os.MkdirAll(dir, 0755); err != nil {
			return fmt.Errorf("failed to create directory %s: %w", dir, err)
		}
	}
	return nil
}

func checkService(service Service) ServiceCheckResult {
	timestamp := time.Now()
	checkResults := checker.CheckURLAll(service.URL, RequestTimeout)

	successCount := 0
	var totalLatency int64 = 0

	detailedResults := make([]CheckResult, len(checkResults))
	for i, r := range checkResults {
		detailedResults[i] = CheckResult{
			Key:       service.Key,
			URL:       service.URL,
			Source:    r.Source,
			Success:   r.Success,
			Latency:   r.Latency,
			Timestamp: timestamp,
			Error:     r.Error,
		}
		if r.Success {
			successCount++
			totalLatency += r.Latency
		}
	}

	status := "failure"
	var avgLatency int64 = 7000
	if successCount >= 3 {
		status = "success"
		avgLatency = totalLatency / int64(successCount)
	}

	return ServiceCheckResult{
		Key:       service.Key,
		URL:       service.URL,
		Status:    status,
		Latency:   avgLatency,
		Timestamp: timestamp,
		Results:   detailedResults,
	}
}
