// Package notifier sends WeCom (WeChat Work) webhook notifications for status
// transitions.
package notifier

import (
	"bytes"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"time"
)

// CheckResult describes one service that changed state.
type CheckResult struct {
	Key       string
	URL       string
	Status    string
	Latency   *int64
	Timestamp time.Time
}

type webhookMessage struct {
	MsgType  string           `json:"msgtype"`
	Markdown *markdownContent `json:"markdown,omitempty"`
}

type markdownContent struct {
	Content string `json:"content"`
}

// SendWebhookNotification pushes one message describing services that just went
// down and/or recovered. It is a no-op when both lists are empty.
func SendWebhookNotification(webhookURL string, down, recovered []CheckResult) error {
	if len(down) == 0 && len(recovered) == 0 {
		return nil
	}

	content := fmt.Sprintf("### Service Status Alert\n > %s\n", time.Now().Format("2006-01-02 15:04"))
	if len(down) > 0 {
		content += "\n > 以下 url/api 请求失败:\n\n"
		for _, result := range down {
			content += fmt.Sprintf("- **%s** (%s) - %s\n", result.Key, result.URL, statusText(result.Status))
		}
	}
	if len(recovered) > 0 {
		content += "\n > 以下服务已恢复:\n\n"
		for _, result := range recovered {
			content += fmt.Sprintf("- **%s** (%s) - %s\n", result.Key, result.URL, statusText(result.Status))
		}
	}

	payload := webhookMessage{
		MsgType:  "markdown",
		Markdown: &markdownContent{Content: content},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return fmt.Errorf("marshal webhook payload: %w", err)
	}

	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post webhook: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d: %s", resp.StatusCode, string(responseBody))
	}
	return nil
}

// SendTestNotification sends a simple test message.
func SendTestNotification(webhookURL string) error {
	payload := webhookMessage{
		MsgType: "markdown",
		Markdown: &markdownContent{Content: fmt.Sprintf(
			"### Test Notification\n > %s\n > 这是一条测试消息", time.Now().Format("2006-01-02 15:04"),
		)},
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return err
	}
	client := &http.Client{Timeout: 10 * time.Second}
	resp, err := client.Post(webhookURL, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("post test webhook: %w", err)
	}
	defer resp.Body.Close()
	responseBody, _ := io.ReadAll(io.LimitReader(resp.Body, 4096))
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		return fmt.Errorf("webhook returned status %d: %s", resp.StatusCode, string(responseBody))
	}
	return nil
}

func statusText(status string) string {
	switch status {
	case "success":
		return "success"
	case "partial":
		return "partial"
	default:
		return "failure"
	}
}
