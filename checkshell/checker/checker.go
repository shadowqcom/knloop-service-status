package checker

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/go-resty/resty/v2"
)

var successCodes = map[int]bool{
	200: true,
	201: true,
	202: true,
	301: true,
	302: true,
	307: true,
}

type CheckResult struct {
	Source   string
	Success  bool
	Latency  int64
	IP       string
	Location string
	Error    error
}

type XXAPIResponse struct {
	Code int `json:"code"`
	Data struct {
		IP     string `json:"ip"`
		Server string `json:"server"`
		Time   string `json:"time"`
		URL    string `json:"url"`
	} `json:"data"`
	Msg string `json:"msg"`
}

type UAPIResponse struct {
	Host     string  `json:"host"`
	IP       string  `json:"ip"`
	Location string  `json:"location"`
	Max      float64 `json:"max"`
	Avg      float64 `json:"avg"`
	Min      float64 `json:"min"`
}

type MMPAPIResponse struct {
	Status string `json:"status"`
	Data   struct {
		IP       string `json:"IP"`
		Latency  string `json:"延迟"`
		Location string `json:"IP地址"`
		LocalIP  string `json:"本机地址"`
	} `json:"data"`
}

func CheckURL(rawURL string, maxRetries int, retryDelay, timeout time.Duration) (string, int64, error) {
	results := CheckURLAll(rawURL, timeout)

	successCount := 0
	var totalLatency int64 = 0
	var lastError error

	for _, r := range results {
		if r.Success {
			successCount++
			totalLatency += r.Latency
		} else if r.Error != nil {
			lastError = r.Error
		}
	}

	if successCount >= 3 {
		avgLatency := totalLatency / int64(successCount)
		return "success", avgLatency, nil
	}

	return "failure", 7000, lastError
}

func CheckURLAll(rawURL string, timeout time.Duration) []CheckResult {
	results := make([]CheckResult, 0, 5)

	for i := 0; i < 2; i++ {
		result := checkLocal(rawURL, timeout)
		results = append(results, result)
	}

	results = append(results, checkXXAPI(rawURL, timeout))
	results = append(results, checkUAPI(rawURL, timeout))
	results = append(results, checkMMPAPI(rawURL, timeout))

	return results
}

func checkLocal(rawURL string, timeout time.Duration) CheckResult {
	result := CheckResult{
		Source: "local",
	}

	start := time.Now()
	client := resty.New().
		SetTimeout(timeout).
		SetRedirectPolicy(resty.FlexibleRedirectPolicy(10))

	resp, err := client.R().
		SetDoNotParseResponse(true).
		Get(rawURL)

	if err != nil {
		result.Error = err
		result.Latency = time.Since(start).Milliseconds()
		return result
	}

	result.Latency = time.Since(start).Milliseconds()
	result.Success = successCodes[resp.StatusCode()]

	return result
}

func checkXXAPI(rawURL string, timeout time.Duration) CheckResult {
	result := CheckResult{
		Source: "xxapi.cn",
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		result.Error = err
		return result
	}
	host := parsedURL.Host
	if host == "" {
		host = rawURL
	}

	apiURL := fmt.Sprintf("https://v2.xxapi.cn/api/ping?url=%s", host)

	start := time.Now()
	client := resty.New().SetTimeout(timeout)

	resp, err := client.R().
		SetHeader("Accept", "application/json").
		Get(apiURL)

	if err != nil {
		result.Error = err
		result.Latency = time.Since(start).Milliseconds()
		return result
	}

	result.Latency = time.Since(start).Milliseconds()

	var xxResp XXAPIResponse
	if err := json.Unmarshal(resp.Body(), &xxResp); err != nil {
		result.Error = err
		return result
	}

	if xxResp.Code == 200 {
		result.Success = true
		result.IP = xxResp.Data.IP
		result.Location = xxResp.Data.Server
	} else {
		result.Error = fmt.Errorf("xxapi returned code %d: %s", xxResp.Code, xxResp.Msg)
	}

	return result
}

func checkUAPI(rawURL string, timeout time.Duration) CheckResult {
	result := CheckResult{
		Source: "uapis.cn",
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		result.Error = err
		return result
	}
	host := parsedURL.Host
	if host == "" {
		host = rawURL
	}
	host = strings.TrimPrefix(host, "www.")

	apiURL := fmt.Sprintf("https://uapis.cn/api/v1/network/ping?host=%s", host)

	start := time.Now()
	client := resty.New().SetTimeout(timeout)

	resp, err := client.R().
		SetHeader("Accept", "application/json").
		Get(apiURL)

	if err != nil {
		result.Error = err
		result.Latency = time.Since(start).Milliseconds()
		return result
	}

	result.Latency = time.Since(start).Milliseconds()

	var uResp UAPIResponse
	if err := json.Unmarshal(resp.Body(), &uResp); err != nil {
		result.Error = err
		return result
	}

	if uResp.Host != "" {
		result.Success = true
		result.IP = uResp.IP
		result.Location = uResp.Location
		if uResp.Avg > 0 {
			result.Latency = int64(uResp.Avg * 1000)
		}
	} else {
		result.Error = fmt.Errorf("uapis returned empty response")
	}

	return result
}

func checkMMPAPI(rawURL string, timeout time.Duration) CheckResult {
	result := CheckResult{
		Source: "mmp.cc",
	}

	parsedURL, err := url.Parse(rawURL)
	if err != nil {
		result.Error = err
		return result
	}
	host := parsedURL.Host
	if host == "" {
		host = rawURL
	}

	apiURL := fmt.Sprintf("https://api.mmp.cc/api/ping?text=%s", host)

	start := time.Now()
	client := resty.New().SetTimeout(timeout)

	resp, err := client.R().
		SetHeader("Accept", "application/json").
		Get(apiURL)

	if err != nil {
		result.Error = err
		result.Latency = time.Since(start).Milliseconds()
		return result
	}

	result.Latency = time.Since(start).Milliseconds()

	var mmpResp MMPAPIResponse
	if err := json.Unmarshal(resp.Body(), &mmpResp); err != nil {
		result.Error = err
		return result
	}

	if mmpResp.Status == "success" {
		result.Success = true
		result.IP = mmpResp.Data.IP
		result.Location = mmpResp.Data.Location
	} else {
		result.Error = fmt.Errorf("mmp.cc returned status: %s", mmpResp.Status)
	}

	return result
}

func CheckURLSimple(url string, timeout time.Duration) (int, error) {
	client := &http.Client{
		Timeout: timeout,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			return nil
		},
	}

	resp, err := client.Get(url)
	if err != nil {
		return 0, err
	}
	defer resp.Body.Close()

	return resp.StatusCode, nil
}

func IsSuccessCode(code int) bool {
	return successCodes[code]
}

func ParseURL(url string) string {
	return strings.TrimSpace(url)
}
