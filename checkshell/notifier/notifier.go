package notifier

import (
	"fmt"
	"time"

	"github.com/go-resty/resty/v2"
)

type WebhookMessage struct {
	MsgType  string           `json:"msgtype"`
	Markdown *MarkdownContent `json:"markdown,omitempty"`
}

type MarkdownContent struct {
	Content string `json:"content"`
}

type CheckResult struct {
	Key       string
	URL       string
	Status    string
	Latency   int64
	Timestamp time.Time
}

func SendWebhookNotification(webhookURL string, failedServices []CheckResult) error {
	if len(failedServices) == 0 {
		return nil
	}

	messageTime := time.Now().Format("2006-01-02 15:04")
	content := fmt.Sprintf("### Service Down\n > %s\n > 以下 url/api 请求失败:\n\n", messageTime)

	for _, result := range failedServices {
		content += fmt.Sprintf("- **%s** (%s)\n", result.Key, result.URL)
	}

	msg := WebhookMessage{
		MsgType: "markdown",
		Markdown: &MarkdownContent{
			Content: content,
		},
	}

	client := resty.New()
	resp, err := client.R().
		SetHeader("Content-Type", "application/json").
		SetBody(msg).
		Post(webhookURL)

	if err != nil {
		return fmt.Errorf("failed to send webhook: %w", err)
	}

	if !resp.IsSuccess() {
		return fmt.Errorf("webhook returned status %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	return nil
}

func SendTestNotification(webhookURL string) error {
	msg := WebhookMessage{
		MsgType: "markdown",
		Markdown: &MarkdownContent{
			Content: fmt.Sprintf("### Test Notification\n > %s\n > 这是一条测试消息", time.Now().Format("2006-01-02 15:04")),
		},
	}

	client := resty.New()
	resp, err := client.R().
		SetHeader("Content-Type", "application/json").
		SetBody(msg).
		Post(webhookURL)

	if err != nil {
		return fmt.Errorf("failed to send test webhook: %w", err)
	}

	if !resp.IsSuccess() {
		return fmt.Errorf("webhook returned status %d: %s", resp.StatusCode(), string(resp.Body()))
	}

	return nil
}
