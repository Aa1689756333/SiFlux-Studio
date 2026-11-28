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
	"log"
	"net/http"
	"net/url"
	"sort"
	"strings"
	"time"
)

// DefaultBaseURL 是内置中转站地址，与前端渠道预设保持一致。
const DefaultBaseURL = "https://api.siflux.cn"

const maxResponseBytes = 1 << 20

// Error 表示中转站返回的业务失败，Message 可直接展示给用户。
type Error struct {
	Status  int
	Path    string
	Message string
}

func (e *Error) Error() string { return e.Message }

// withPath 给错误补上调用路径，便于服务端日志定位。
func withPath(err error, path string) error {
	var relayErr *Error
	if errors.As(err, &relayErr) {
		if relayErr.Path == "" {
			relayErr.Path = path
		}
		return relayErr
	}
	return err
}

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

// Session 是一次登录得到的凭据：新版走 access token，旧版走 Cookie。
type Session struct {
	AccessToken string
	TokenType   string
	Cookie      string
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
		return nil, errors.New("服务地址无效")
	}
	if parsed.Scheme != "https" && parsed.Scheme != "http" {
		return nil, errors.New("服务地址必须是 http(s)")
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
	if err := c.call(ctx, http.MethodGet, "/api/status", nil, Session{}, &payload); err != nil {
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
	return c.call(ctx, http.MethodGet, target, nil, Session{}, nil)
}

// Register 创建账号。
func (c *Client) Register(ctx context.Context, request RegisterRequest) error {
	body := map[string]any{
		"username":          strings.TrimSpace(request.Username),
		"password":          request.Password,
		"email":             strings.TrimSpace(request.Email),
		"verification_code": strings.TrimSpace(request.Code),
	}
	return c.call(ctx, http.MethodPost, "/api/user/register", body, Session{}, nil)
}

// Login 登录并返回后续调用所需的凭据。
// NewAPI 新版返回 access token；旧版走 Cookie，因此两者都保留。
func (c *Client) Login(ctx context.Context, username, password string) (Session, error) {
	body := map[string]any{
		"username": strings.TrimSpace(username),
		"password": password,
	}
	payload := []byte(mustJSON(body))
	request, err := c.newRequest(ctx, http.MethodPost, "/api/user/login", bytes.NewReader(payload), Session{})
	if err != nil {
		return Session{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return Session{}, fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return Session{}, fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if err := decodeEnvelope(response.StatusCode, raw); err != nil {
		return Session{}, withPath(err, "/api/user/login")
	}
	var envelope struct {
		Data struct {
			AccessToken string `json:"access_token"`
			TokenType   string `json:"token_type"`
		} `json:"data"`
	}
	_ = json.Unmarshal(raw, &envelope)
	session := Session{
		AccessToken: strings.TrimSpace(envelope.Data.AccessToken),
		TokenType:   strings.TrimSpace(envelope.Data.TokenType),
	}
	if cookies := response.Cookies(); len(cookies) > 0 {
		parts := make([]string, 0, len(cookies))
		for _, cookie := range cookies {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
		session.Cookie = strings.Join(parts, "; ")
	}
	if session.AccessToken == "" && session.Cookie == "" {
		return Session{}, &Error{Status: response.StatusCode, Path: "/api/user/login", Message: "登录失败，服务没有返回凭据"}
	}
	if session.TokenType == "" {
		session.TokenType = "Bearer"
	}
	return session, nil
}

// CreateToken 以登录会话创建一枚访问令牌。
// 服务端建令牌只返回 {success,message}，因此建完再查列表取回 Id 与明文。
func (c *Client) CreateToken(ctx context.Context, session Session, name string, group string) (Token, error) {
	body := map[string]any{
		"name":                 name,
		"group":                strings.TrimSpace(group),
		"expired_time":         -1,
		"remain_quota":         0,
		"unlimited_quota":      true,
		"model_limits_enabled": false,
		"model_limits":         "",
		"allow_ips":            "",
	}
	if err := c.call(ctx, http.MethodPost, "/api/token/", body, session, nil); err != nil {
		return Token{}, err
	}
	created, err := c.newestToken(ctx, session, name)
	if err != nil {
		return Token{}, err
	}
	key, err := c.tokenKey(ctx, session, created.ID)
	if err != nil {
		return Token{}, err
	}
	created.Key = key
	return created, nil
}

// tokenSummary 是令牌列表里的一项。
type tokenSummary struct {
	ID    int    `json:"id"`
	Name  string `json:"name"`
	Group string `json:"group"`
}

// newestToken 在令牌列表里找到刚创建的那一枚。
// tokenByName 找到同名令牌，返回它的 ID。
func (c *Client) tokenByName(ctx context.Context, session Session, name string) (int, bool) {
	var page struct {
		Items []tokenSummary `json:"items"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/token/?p=0&size=100", nil, session, &page); err != nil {
		return 0, false
	}
	for _, item := range page.Items {
		if strings.TrimSpace(item.Name) == name {
			return item.ID, true
		}
	}
	return 0, false
}

// ModelMeta 是模型元数据（标签与描述），部分站点只对管理员开放。
type ModelMeta struct {
	Tags        []string `json:"tags"`
	Description string   `json:"description"`
}

// ModelMetas 读取模型元数据；接口不可用时返回空表而不是错误。
func (c *Client) ModelMetas(ctx context.Context, session Session) map[string]ModelMeta {
	out := map[string]ModelMeta{}
	var payload struct {
		Data map[string]ModelMeta `json:"data"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/models/meta", nil, session, &payload); err != nil {
		return out
	}
	for model, meta := range payload.Data {
		if strings.TrimSpace(model) == "" {
			continue
		}
		out[model] = meta
	}
	return out
}
// SyncGroupKeys 从站点已有的令牌里恢复分组密钥，前缀由 prefix 指定。
func (c *Client) SyncGroupKeys(ctx context.Context, session Session, prefix string) (map[string]string, map[string]string) {
	keys := map[string]string{}
	groups := map[string]string{}
	var page struct {
		Items []tokenSummary `json:"items"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/token/?p=0&size=100", nil, session, &page); err != nil {
		return keys, groups
	}
	for _, item := range page.Items {
		name := strings.TrimSpace(item.Name)
		if !strings.HasPrefix(name, prefix) {
			continue
		}
		group := strings.TrimSpace(item.Group)
		if group == "" {
			group = strings.TrimSpace(strings.TrimPrefix(name, prefix))
		}
		key, err := c.tokenKey(ctx, session, item.ID)
		if err != nil || strings.TrimSpace(key) == "" {
			continue
		}
		if group == "" {
			continue
		}
		keys[group] = key
	}
	return keys, groups
}
// EnsureToken 复用同名令牌；不存在时才新建，避免每次登录都多出一把密钥。
func (c *Client) EnsureToken(ctx context.Context, session Session, name string, group string) (Token, error) {
	if id, found := c.tokenByName(ctx, session, name); found {
		if key, err := c.tokenKey(ctx, session, id); err == nil && strings.TrimSpace(key) != "" {
			return Token{ID: id, Key: key}, nil
		}
	}
	return c.CreateToken(ctx, session, name, group)
}
func (c *Client) newestToken(ctx context.Context, session Session, name string) (Token, error) {
	var page struct {
		Items []tokenSummary `json:"items"`
	}
	if err := c.call(ctx, http.MethodGet, "/api/token/?p=0&size=100", nil, session, &page); err != nil {
		return Token{}, err
	}
	best := Token{}
	for _, item := range page.Items {
		if item.ID <= best.ID {
			continue
		}
		if item.Name == name || best.ID == 0 {
			best = Token{ID: item.ID}
		}
	}
	if best.ID == 0 {
		return Token{}, &Error{Status: http.StatusBadGateway, Path: "/api/token/", Message: "服务没有返回新建的密钥"}
	}
	return best, nil
}

// tokenKey 取回令牌明文。
func (c *Client) tokenKey(ctx context.Context, session Session, id int) (string, error) {
	var payload struct {
		Key string `json:"key"`
	}
	path := fmt.Sprintf("/api/token/%d/key", id)
	if err := c.call(ctx, http.MethodPost, path, nil, session, &payload); err != nil {
		return "", err
	}
	if strings.TrimSpace(payload.Key) == "" {
		return "", &Error{Status: http.StatusBadGateway, Path: path, Message: "服务没有返回密钥内容"}
	}
	return payload.Key, nil
}

// Balance 用访问令牌读取账户余额，返回剩余额度与已用额度。
func (c *Client) Balance(ctx context.Context, apiKey string) (Balance, error) {
	key := strings.TrimSpace(apiKey)
	if key == "" {
		return Balance{}, &Error{Status: http.StatusUnauthorized, Message: "尚未连接 SiFlux 服务"}
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
		return Balance{}, &Error{Status: http.StatusBadGateway, Path: "/v1/dashboard/billing/subscription", Message: "服务返回的余额信息无法解析"}
	}
	total := grant.HardLimitUSD
	if total <= 0 {
		total = grant.SoftLimitUSD
	}
	usage, err := c.getWithKey(ctx, "/v1/dashboard/billing/usage", key)
	if err != nil {
		return Balance{Granted: total, Remaining: total, UsageKnown: false}, nil
	}
	var used struct {
		TotalUsage float64 `json:"total_usage"`
	}
	if err := json.Unmarshal(usage, &used); err != nil {
		return Balance{Granted: total, Remaining: total, UsageKnown: false}, nil
	}
	spent := used.TotalUsage / 100
	remaining := total - spent
	if remaining < 0 {
		remaining = 0
	}
	// 服务端在"令牌无限额度"时会返回固定哨兵值，这里同时记录原始数值便于核对。
	log.Printf("relay 账单: hard_limit_usd=%.4f soft_limit_usd=%.4f total_usage=%.2f => granted=%.4f spent=%.4f remaining=%.4f",
		grant.HardLimitUSD, grant.SoftLimitUSD, used.TotalUsage, total, spent, remaining)
	return Balance{Granted: total, Spent: spent, Remaining: remaining, UsageKnown: true}, nil
}

// getWithKey 用访问令牌请求一个 JSON 接口。
func (c *Client) getWithKey(ctx context.Context, path, apiKey string) ([]byte, error) {
	request, err := c.newRequest(ctx, http.MethodGet, path, nil, Session{})
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+apiKey)
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Status: response.StatusCode, Path: path, Message: failureMessage(raw, response.StatusCode)}
	}
	return raw, nil
}

// Refresh 用刷新 Cookie 换一枚新的访问令牌。
func (c *Client) Refresh(ctx context.Context, session Session) (Session, error) {
	request, err := c.newRequest(ctx, http.MethodPost, "/api/user/auth/refresh", nil, session)
	if err != nil {
		return Session{}, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return Session{}, fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return Session{}, fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if err := decodeEnvelope(response.StatusCode, raw); err != nil {
		return Session{}, withPath(err, "/api/user/auth/refresh")
	}
	var envelope struct {
		Data struct {
			AccessToken string `json:"access_token"`
			TokenType   string `json:"token_type"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || strings.TrimSpace(envelope.Data.AccessToken) == "" {
		return Session{}, &Error{Status: response.StatusCode, Path: "/api/user/auth/refresh", Message: "服务没有返回新的访问凭据"}
	}
	next := session
	next.AccessToken = strings.TrimSpace(envelope.Data.AccessToken)
	if tt := strings.TrimSpace(envelope.Data.TokenType); tt != "" {
		next.TokenType = tt
	}
	if cookies := response.Cookies(); len(cookies) > 0 {
		parts := make([]string, 0, len(cookies))
		for _, cookie := range cookies {
			parts = append(parts, cookie.Name+"="+cookie.Value)
		}
		next.Cookie = strings.Join(parts, "; ")
	}
	return next, nil
}

// Self 读取当前账号额度。
func (c *Client) Self(ctx context.Context, session Session) (Self, error) {
	var self Self
	if err := c.call(ctx, http.MethodGet, "/api/user/self", nil, session, &self); err != nil {
		return Self{}, err
	}
	return self, nil
}

// Models 用访问令牌读取可用模型。
// PricingModel 是中转站价格表里的一条模型，带上可用的分组。
type PricingModel struct {
	Model           string   `json:"model"`
	EnableGroups    []string `json:"enableGroups"`
	QuotaType       int      `json:"quotaType"`
	ModelRatio      float64  `json:"modelRatio"`
	CompletionRatio float64  `json:"completionRatio"`
	ModelPrice      float64  `json:"modelPrice"`
	VendorID        int      `json:"vendorId"`
	Vendor          string   `json:"vendor"`
}

// Pricing 读取全部模型（含所有分组）。/v1/models 只返回当前分组的模型，
// 因此按分组控价的站点必须用价格表才能拿到完整清单。
func (c *Client) Pricing(ctx context.Context, session Session) ([]PricingModel, error) {
	request, err := c.newRequest(ctx, http.MethodGet, "/api/pricing", nil, session)
	if err != nil {
		return nil, err
	}
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Status: response.StatusCode, Path: "/api/pricing", Message: failureMessage(raw, response.StatusCode)}
	}
	var payload struct {
		Data []struct {
			ModelName       string   `json:"model_name"`
			Model           string   `json:"model"`
			EnableGroups    []string `json:"enable_groups"`
			QuotaType       int      `json:"quota_type"`
			ModelRatio      float64  `json:"model_ratio"`
			CompletionRatio float64  `json:"completion_ratio"`
			ModelPrice      float64  `json:"model_price"`
			VendorID        int      `json:"vendor_id"`
		} `json:"data"`
		Vendors []struct {
			ID   int    `json:"id"`
			Name string `json:"name"`
		} `json:"vendors"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("服务返回内容无法解析")
	}
	vendorNames := make(map[int]string, len(payload.Vendors))
	for _, vendor := range payload.Vendors {
		vendorNames[vendor.ID] = strings.TrimSpace(vendor.Name)
	}
	seen := map[string]struct{}{}
	models := make([]PricingModel, 0, len(payload.Data))
	for _, item := range payload.Data {
		name := strings.TrimSpace(item.ModelName)
		if name == "" {
			name = strings.TrimSpace(item.Model)
		}
		if name == "" {
			continue
		}
		if _, exists := seen[name]; exists {
			continue
		}
		seen[name] = struct{}{}
		models = append(models, PricingModel{
			Model: name, EnableGroups: item.EnableGroups,
			QuotaType: item.QuotaType, ModelRatio: item.ModelRatio,
			CompletionRatio: item.CompletionRatio, ModelPrice: item.ModelPrice,
			VendorID: item.VendorID, Vendor: vendorNames[item.VendorID],
		})
	}
	sort.Slice(models, func(i, j int) bool { return models[i].Model < models[j].Model })
	return models, nil
}
func (c *Client) Models(ctx context.Context, apiKey string) ([]string, error) {
	request, err := c.newRequest(ctx, http.MethodGet, "/v1/models", nil, Session{})
	if err != nil {
		return nil, err
	}
	request.Header.Set("Authorization", "Bearer "+strings.TrimSpace(apiKey))
	response, err := c.http.Do(request)
	if err != nil {
		return nil, fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return nil, fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if response.StatusCode != http.StatusOK {
		return nil, &Error{Status: response.StatusCode, Path: "/v1/models", Message: failureMessage(raw, response.StatusCode)}
	}
	var payload struct {
		Data []struct {
			ID string `json:"id"`
		} `json:"data"`
	}
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, &Error{Status: response.StatusCode, Message: "服务返回的模型列表无法解析"}
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
func (c *Client) call(ctx context.Context, method, path string, body any, session Session, out any) error {
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
		return fmt.Errorf("连接 SiFlux 服务失败: %w", err)
	}
	defer response.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("读取 SiFlux 服务响应失败: %w", err)
	}
	if err := decodeEnvelope(response.StatusCode, raw); err != nil {
		return withPath(err, path)
	}
	if out == nil {
		return nil
	}
	var envelope struct {
		Data json.RawMessage `json:"data"`
	}
	if err := json.Unmarshal(raw, &envelope); err != nil || len(envelope.Data) == 0 {
		return &Error{Status: response.StatusCode, Message: "服务返回内容无法解析"}
	}
	if err := json.Unmarshal(envelope.Data, out); err != nil {
		return &Error{Status: response.StatusCode, Message: "服务返回内容无法解析"}
	}
	return nil
}

func (c *Client) newRequest(ctx context.Context, method, path string, body io.Reader, session Session) (*http.Request, error) {
	request, err := http.NewRequestWithContext(ctx, method, c.baseURL+path, body)
	if err != nil {
		return nil, err
	}
	request.Header.Set("Accept", "application/json")
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if session.Cookie != "" {
		request.Header.Set("Cookie", session.Cookie)
	}
	if session.AccessToken != "" {
		tokenType := session.TokenType
		if tokenType == "" {
			tokenType = "Bearer"
		}
		request.Header.Set("Authorization", tokenType+" "+session.AccessToken)
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
		return &Error{Status: status, Message: "服务返回内容无法解析"}
	}
	if envelope.Success != nil && !*envelope.Success {
		message := strings.TrimSpace(envelope.Message)
		if message == "" {
			message = "服务拒绝了这次请求"
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
	return fmt.Sprintf("服务返回 %d", status)
}

func mustJSON(value any) []byte {
	encoded, err := json.Marshal(value)
	if err != nil {
		return []byte("{}")
	}
	return encoded
}
