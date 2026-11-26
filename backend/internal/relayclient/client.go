// Package relayclient 封装内置中转站（NewAPI）的账户与令牌接口，
// 供本地后端在用户注册/登录后自动取得 API Key。
package relayclient

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"
)

// DefaultBaseURL 是内置中转站地址，与前端渠道预设保持一致。
const DefaultBaseURL = "https://api.siflux.cn"

const maxResponseBytes = 1 << 20

// Error 表示中转站返回的业务失败，Message 可直接展示给用户。
type Error struct {
	Status  int
	Message string
}

func (e *Error) Error() string { return e.Message }

// IsError 判断 err 是否为目标中转站业务错误。
func IsError(err error) (*Error, bool) {
	var relayErr *Error
	if errors.As(err, &relayErr) {
		return relayErr, true
	}
	return nil, false
}

// Options 是 /api/status 暴露的注册与登录能力。
type Options struct {
	SystemName             string  `json:"systemName"`
	RegisterEnabled        bool    `json:"registerEnabled"`
	PasswordRegister       bool    `json:"passwordRegisterEnabled"`
	PasswordLogin          bool    `json:"passwordLoginEnabled"`
	PasswordLoginEncrypted bool    `json:"passwordLoginEncryptionEnabled"`
	EmailVerification      bool    `json:"emailVerification"`
	Turnstile              bool    `json:"turnstile"`
	QuotaPerUnit           float64 `json:"quotaPerUnit"`
}

// RegisterRequest 是新账号的注册参数。
type RegisterRequest struct {
	Username string
	Password string
	Email    string
	Code     string
}

// Token 是新建的访问令牌。
type Token struct {
	ID  int    `json:"id"`
	Key string `json:"key"`
}

// Self 是当前账号的额度信息。
type Self struct {
	ID          int    `json:"id"`
	Username    string `json:"username"`
	DisplayName string `json:"display_name"`
	Group       string `json:"group"`
	Quota       int64  `json:"quota"`
	UsedQuota   int64  `json:"used_quota"`
}

// Balance 是账户余额，金额单位为中转站的计价单位（通常为美元）。
type Balance struct {
	Granted    float64 `json:"granted"`
	Spent      float64 `json:"spent"`
	Remaining  float64 `json:"remaining"`
	UsageKnown bool    `json:"usageKnown"`
}

// Client 访问一个 NewAPI 站点。
type Client struct {
	baseURL string
	http    *http.Client
}

// New 构造客户端；baseURL 必须是 https 地址，测试可传本地地址。
func New(baseURL string) (*Client, error) {
	trimmed := strings.TrimRight(strings.TrimSpace(baseURL), "/")
	if trimmed == "" {
		trimmed = DefaultBaseURL
	}
	parsed, err := url.Parse(trimmed)
	if err != nil || parsed.Host == "" {
		return nil, errors.New("中转站地址无效")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("中转站地址必须是 http(s)")
	}
	return &Client{
		baseURL: trimmed,
		http: &http.Client{
			Timeout: 20 * time.Second,
			// 中转站的重定向一律不跟随，避免凭据被带到其他主机。
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
	}, nil
}

// BaseURL 返回客户端目标站点。
func (c *Client) BaseURL() string { return c.baseURL }

// Status 读取站点能力。
func (c *Client) Status(ctx context.Context) (Options, error) {
	var payload struct {
		SystemName             string  `json:"system_name"`
		RegisterEnabled        bool    `json:"register_enabled"`
		PasswordRegister       bool    `json:"password_register_enabled"`
		PasswordLogin          bool    `json:"password_login_enabled"`
		PasswordLoginEncrypted bool    `json:"password_login_encryption_enabled"`
		EmailVerification      bool    `json:"email_verification"`
		Turnstile              bool    `json:"turnstile_check"`
		QuotaPerUnit           float64 `json:"quota_per_unit"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/status", nil, "", &payload); err != nil {
		return Options{}, err
	}
	return Options{
		SystemName:             payload.SystemName,
		RegisterEnabled:        payload.RegisterEnabled,
		PasswordRegister:       payload.PasswordRegister,
		PasswordLogin:          payload.PasswordLogin,
		PasswordLoginEncrypted: payload.PasswordLoginEncrypted,
		EmailVerification:      payload.EmailVerification,
		Turnstile:              payload.Turnstile,
		QuotaPerUnit:           payload.QuotaPerUnit,
	}, nil
}

// SendVerificationCode 请求中转站向 email 发送注册验证码。
func (c *Client) SendVerificationCode(ctx context.Context, email string) error {
	target := "/api/verification?email=" + url.QueryEscape(strings.TrimSpace(email))
	return c.call(ctx, http.MethodGet, target, nil, "", nil)
}

// Register 创建账号。
func (c *Client) Register(ctx context.Context, request RegisterRequest) error {
	body := map[string]any{
		"username":          strings.TrimSpace(request.Username),
		"password":          request.Password,
		"email":             strings.TrimSpace(request.Email),
		"verification_code": strings.TrimSpace(request.Code),
	}
	return c.call(ctx, http.MethodPost, "/api/user/register", body, "", nil)
}

// Login 登录并返回可直接复用的 Cookie 头。
func (c *Client) Login(ctx context.Context, username, password string) (string, error) {
	body := map[string]any{
		"username": strings.TrimSpace(username),
		"password": password,
	}
	payload := []byte(mustJSON(body))
	request, err := c.newRequest(ctx, http.MethodPost, "/api/user/login", bytes.NewReader(payload), "")
	if err != nil {
		return "", err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return "", fmt.Errorf("连接中转站失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("读取中转站响应失败: %w", err)
	}
	if err := decodeEnvelope(response.StatusCode, raw); err != nil {
		return "", err
	}
	cookies := response.Cookies()
	if len(cookies) == 0 {
		return "", &Error{Status: response.StatusCode, Message: "登录失败，中转站没有返回会话"}
	}
	parts := make([]string, 0, len(cookies))
	for _, cookie := range cookies {
		parts = append(parts, cookie.Name+"="+cookie.Value)
	}
	return strings.Join(parts, "; "), nil
}

// CreateToken 以登录会话创建一枚访问令牌。
func (c *Client) CreateToken(ctx context.Context, session, name string) (Token, error) {
	body := map[string]any{
		"name":                 name,
		"expired_time":         -1,
		"remain_quota":         0,
		"unlimited_quota":      true,
		"model_limits_enabled": false,
		"model_limits":         "",
		"allow_ips":            "",
	}
	var token Token
	if err := c.call(ctx, http.MethodPost, "/api/token/", body, session, &token); err != nil {
		return Token{}, err
	}
	if token.Key != "" {
		return token, nil
	}
	if token.ID <= 0 {
		return Token{}, &Error{Status: http.StatusBadGateway, Message: "中转站没有返回令牌"}
	}
	key, err := c.tokenKey(ctx, session, token.ID)
	if err != nil {
		return Token{}, err
	}
	token.Key = key
	return token, nil
}

// tokenKey 取回令牌明文。
func (c *Client) tokenKey(ctx context.Context, session string, id int) (string, error) {
	var payload struct {
		Key string `json:"key"`
	}
	path := fmt.Sprintf("/api/token/%d/key", id)
	if err := c.call(ctx, http.MethodPost, path, nil, session, &payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Key) == "" {
		return "", &Error{Status: http.StatusBadGateway, Message: "中转站没有返回令牌内容"}
	}
	return payload.Key, nil
}

// Balance 用访问令牌读取账户余额，返回剩余额度与已用额度（单位：quota_per_unit 分之一）。
func (c *Client) Balance(ctx context.Context, apiKey string) (Balance, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return Balance{}, &Error{Status: http.StatusUnauthorized, Message: "尚未接入中转站"}
	}
	subscription, err := c.getWithKey(ctx, "/v1/dashboard/billing/subscription", key)
	if err != nil {
		return Balance{}, err
	}
	var grant struct {
		HardLimitUSD float64 `json:"hard_limit_usd"`
		SoftLimitUSD float64 `json:"soft_limit_usd"`
	}
	if err := json.Unmarshal(subscription, &grant); err != nil {
		return Balance{}, &Error{Status: http.StatusBadGateway, Message: "中转站返回的额度信息无法解析"}
	}
	total := grant.HardLimitUSD
	if total <= 0 {
		total = grant.SoftLimitUSD
	}
	usage, err := c.getWithKey(ctx, "/v1/dashboard/billing/usage", key)
	if err != nil {
		// 用量读取失败时仍然给出总额度，界面按"未知用量"展示。
		return Balance{Granted: total, Remaining: total, UsageKnown: false}, nil
	}
	var used struct {
		TotalUsage float64 `json:"total_usage"`
	}
	if err := json.Unmarshal(usage, &used); err != nil {
		return Balance{Granted: total, Remaining: total, UsageKnown: false}, nil
	}
	// 用量以美分计，额度以美元计。
	spent := used.TotalUsage / 100
	remaining := total - spent
	if remaining < 0 {
		remaining = 0
	}
	return Balance{Granted: total, Spent: spent, Remaining: remaining, UsageKnown: true}, nil
}

// getWithKey 用访问令牌请求一个 JSON 接口。
func (c *Client) getWithKey(ctx context.Context, path, apiKey string) ([]byte, error) {
	request, err := c.newRequest(ctx, http.MethodGet, path, nil, "")
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接中转站失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取中转站响应失败: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Status: response.StatusCode, Message: failureMessage(raw, response.StatusCode)}
	}
	return raw, nil
}

// Self 读取当前账号额度。
func (c *Client) Self(ctx context.Context, session string) (Self, error) {
	var self Self
	if err := c.call(ctx, http.MethodGet, "/api/user/self", nil, session, &self); err != nil {
		return Self{}, err
	}
	return self, nil
}

// Models 用访问令牌读取可用模型。
func (c *Client) Models(ctx context.Context, apiKey string) ([]string, error) {
	request, err := c.newRequest(ctx, http.MethodGet, "/v1/models", nil, "")
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接中转站失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取中转站响应失败: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Status: response.StatusCode, Message: failureMessage(raw, response.StatusCode)}
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &Error{Status: response.StatusCode, Message: "中转站返回的模型列表无法解析"}
	}
	models := make([]string, 0, len(payload.Data))
	for _, item := range payload.Data {
		if id := strings.TrimSpace(item.ID); id != "" {
			models = append(models, id)
		}
	}
	return models, nil
}

// call 发出请求并把 data 解码到 out。
func (c *Client) call(ctx context.Context, method, path string, body any, session string, out any) error {
	var reader io.Reader
	if body != nil {
		reader = bytes.NewReader([]byte(mustJSON(body)))
	}
	request, err := c.newRequest(ctx, method, path, reader, session)
	if err != nil {
		return err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("连接中转站失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("读取中转站响应失败: %w", err)
	}
	if err := decodeEnvelope(response.StatusCode, raw); err != nil {
		return err
	}
	if out == nil {
		return nil
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.Data) == 0 {
		return &Error{Status: response.StatusCode, Message: "中转站返回内容无法解析"}
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return &Error{Status: response.StatusCode, Message: "中转站返回内容无法解析"}
	}
	return nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader, session string) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if session != "" {
		request.Header.Set("Cookie", session)
	}
	return request, nil
}

// decodeEnvelope 校验 NewAPI 的 {success, message} 信封。
func decodeEnvelope(status int, raw []byte) error {
	var envelope struct {
		Success *bool  `json:"success"`
		Message string `json:"message"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil {
		if status >= http.StatusBadRequest {
			return &Error{Status: status, Message: failureMessage(raw, status)}
		}
		return &Error{Status: status, Message: "中转站返回内容无法解析"}
	}
	if envelope.Success != nil && !*envelope.Success {
		message := strings.TrimSpace(envelope.Message)
		if message == "" {
			message = "中转站拒绝了这次请求"
		}
		return &Error{Status: status, Message: message}
	}
	if status >= http.StatusBadRequest {
		return &Error{Status: status, Message: failureMessage(raw, status)}
	}
	return nil
}

// failureMessage 从失败响应里取可展示文案。
func failureMessage(raw []byte, status int) string {
	var envelope struct {
		Message string `json:"message"`
		Error   struct {
			Message string `json:"message"`
		} `json:"error"`
	}
	if err := json.Unmarshal(raw, &envelope); err == nil {
		if message := strings.TrimSpace(envelope.Message); message != "" {
			return message
		}
		if message := strings.TrimSpace(envelope.Error.Message); message != "" {
			return message
		}
	}
	return fmt.Sprintf("中转站返回 %d", status)
}

func mustJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return encoded
}
