package handler

import (
	"context"
	"encoding/json"
	"errors"
	"log"
	"net/http"
	"os"
	"sort"
	"strings"
	"sync"
	"time"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/relayclient"

	"github.com/gin-gonic/gin"
)

// relayTokenName 是应用在中转站上创建的令牌名，用户可在中转站单独识别与吊销。
const relayTokenName = "SiFlux Desktop"

// relayCodeInterval 是本地对同一邮箱发送验证码的最小间隔。
const relayCodeInterval = 60 * time.Second

var relayCodeGuard = struct {
	sync.Mutex
	sentAt map[string]time.Time
}{sentAt: map[string]time.Time{}}

// RegisterRelayRoutes 注册内置中转站的注册与接入接口。
func RegisterRelayRoutes(r gin.IRouter, svc *app.Service) {
	r.GET("/relay/signup-options", func(c *gin.Context) {
		client, err := relayClient()
		if err != nil {
			fail(c, http.StatusServiceUnavailable, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
		defer cancel()
		options, err := client.Status(ctx)
		if err != nil {
			failRelay(c, err)
			return
		}
		ok(c, gin.H{
			"systemName":              options.SystemName,
			"registerEnabled":         options.RegisterEnabled,
			"passwordRegisterEnabled": options.PasswordRegister,
			"passwordLoginEnabled":    options.PasswordLogin,
			"emailVerification":       options.EmailVerification,
			"turnstile":               options.Turnstile,
			"quotaPerUnit":            options.QuotaPerUnit,
		})
	})

	r.POST("/relay/verification-code", func(c *gin.Context) {
		var request struct {
			Email string `json:"email"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请求格式错误"))
			return
		}
		email := strings.TrimSpace(request.Email)
		if email == "" || !strings.Contains(email, "@") {
			fail(c, http.StatusBadRequest, errors.New("请填写有效的邮箱地址"))
			return
		}
		if wait := relayCodeWait(email); wait > 0 {
			c.JSON(http.StatusTooManyRequests, gin.H{
				"code":   http.StatusTooManyRequests,
				"reason": "relay_code_throttled",
				"msg":    "验证码发送太频繁，请稍后再试",
				"data":   gin.H{"retryAfterSeconds": int(wait.Seconds()) + 1},
			})
			return
		}
		client, err := relayClient()
		if err != nil {
			fail(c, http.StatusServiceUnavailable, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()
		if err := client.SendVerificationCode(ctx, email); err != nil {
			failRelay(c, err)
			return
		}
		relayCodeMark(email)
		ok(c, gin.H{"sent": true})
	})

	r.POST("/relay/signup", func(c *gin.Context) {
		var request struct {
			Username string `json:"username"`
			Password string `json:"password"`
			Email    string `json:"email"`
			Code     string `json:"code"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请求格式错误"))
			return
		}
		username := strings.TrimSpace(request.Username)
		email := strings.TrimSpace(request.Email)
		code := strings.TrimSpace(request.Code)
		switch {
		case username == "":
			fail(c, http.StatusBadRequest, errors.New("请填写用户名"))
			return
		case len(request.Password) < 8:
			fail(c, http.StatusBadRequest, errors.New("密码至少 8 位"))
			return
		case email == "" || !strings.Contains(email, "@"):
			fail(c, http.StatusBadRequest, errors.New("请填写有效的邮箱地址"))
			return
		case code == "":
			fail(c, http.StatusBadRequest, errors.New("请填写邮箱验证码"))
			return
		}

		client, err := relayClient()
		if err != nil {
			fail(c, http.StatusServiceUnavailable, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()

		options, err := client.Status(ctx)
		if err != nil {
			failRelay(c, err)
			return
		}
		if !options.RegisterEnabled || !options.PasswordRegister {
			fail(c, http.StatusBadRequest, errors.New("SiFlux 服务暂未开放密码注册"))
			return
		}
		if options.Turnstile {
			fail(c, http.StatusBadRequest, errors.New("SiFlux 服务要求人机验证，请前往网页完成注册"))
			return
		}

		if err := client.Register(ctx, relayclient.RegisterRequest{
			Username: username,
			Password: request.Password,
			Email:    email,
			Code:     code,
		}); err != nil {
			// 服务端可能已经建号、却在它自己的默认令牌阶段失败；此时直接登录继续，
			// 免得用户白填一次验证码。
			if session, loginErr := client.Login(ctx, username, request.Password); loginErr == nil {
				log.Printf("relay 注册返回失败但账号可用，改为直接登录: %v", err)
				completeRelaySignIn(c, svc, client, session, options)
				return
			}
			failRelay(c, err)
			return
		}

		session, err := client.Login(ctx, username, request.Password)
		if err != nil {
			failRelay(c, err)
			return
		}
		completeRelaySignIn(c, svc, client, session, options)
	})

	// relayQuota 读取账户总余额：优先用登录态查询，凭据过期时自动刷新一次。
	r.GET("/relay/quota", func(c *gin.Context) {
		state, err := storedRelayState(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if state.APIKey == "" {
			fail(c, http.StatusBadRequest, errors.New("尚未连接 SiFlux 服务"))
			return
		}
		client, err := relayClient()
		if err != nil {
			fail(c, http.StatusServiceUnavailable, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 20*time.Second)
		defer cancel()

		quota, perUnit, fresh := readRelayAccountQuota(ctx, client, &state)
		if !fresh {
			// 登录态失效时退回上次记录的账户余额，避免把令牌额度当成账户余额。
			if state.QuotaPerUnit <= 0 {
				state.QuotaPerUnit = 1
			}
			ok(c, gin.H{
				"remaining":  float64(state.Quota) / state.QuotaPerUnit,
				"granted":    float64(state.Quota+state.UsedQuota) / state.QuotaPerUnit,
				"stale":      true,
				"usageKnown": false,
				"username":   state.Username,
			})
			return
		}
		state.Quota = quota
		state.QuotaPerUnit = perUnit
		if _, err := saveRelayAPIKey(c, svc, state); err == nil {
			// 保存失败不影响这次展示。
			_ = err
		}
		ok(c, gin.H{
			"remaining":  float64(quota) / perUnit,
			"granted":    float64(quota+state.UsedQuota) / perUnit,
			"stale":      false,
			"usageKnown": true,
			"username":   state.Username,
		})
	})
	// relayLogout 退出账号：清掉本地保存的凭据与额度，渠道回到未连接状态。
	// relayModels 返回服务端当前的模型清单，供设置页同步渠道模型。
	r.GET("/relay/models", func(c *gin.Context) {
		state, err := storedRelayState(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if strings.TrimSpace(state.APIKey) == "" {
			failRelay(c, &relayclient.Error{Status: http.StatusBadRequest, Path: "/v1/models", Message: "尚未连接 SiFlux 服务"})
			return
		}
		client, err := relayClient()
		if err != nil {
			failService(c, err)
			return
		}
		// 先取价格表（含全部分组），拿不到再退回当前分组的模型清单。
		session := relayclient.Session{AccessToken: state.AccessToken, TokenType: state.TokenType, Cookie: state.Cookie}
		priced, priceErr := client.Pricing(c.Request.Context(), session)
		if priceErr == nil && len(priced) > 0 {
			names := make([]string, 0, len(priced))
			groups := make(map[string][]string, len(priced))
			for _, item := range priced {
				names = append(names, item.Model)
				groups[item.Model] = item.EnableGroups
			}
			ok(c, gin.H{"models": names, "groups": groups, "source": "pricing"})
			return
		}
		models, err := client.Models(c.Request.Context(), state.APIKey)
		if err != nil {
			failRelay(c, err)
			return
		}
		ok(c, gin.H{"models": models, "source": "models"})
	})
	// relayKeys 列出每个分组保存的密钥，供详情面板查看与修改。
	r.GET("/relay/keys", func(c *gin.Context) {
		state, err := storedRelayState(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		groups := make([]string, 0, len(state.ModelGroups))
		seen := map[string]struct{}{}
		for _, group := range state.ModelGroups {
			if _, ok := seen[group]; ok {
				continue
			}
			seen[group] = struct{}{}
			groups = append(groups, group)
		}
		for group := range state.GroupKeys {
			if _, ok := seen[group]; ok {
				continue
			}
			seen[group] = struct{}{}
			groups = append(groups, group)
		}
		sort.Strings(groups)
		items := make([]gin.H, 0, len(groups))
		for _, group := range groups {
			count := 0
			for _, name := range state.ModelGroups {
				if name == group {
					count++
				}
			}
			items = append(items, gin.H{"group": group, "key": state.GroupKeys[group], "modelCount": count})
		}
		ok(c, gin.H{"keys": items, "mainKey": state.APIKey})
	})

	// relayKeyUpdate 修改某个分组的密钥。
	r.PUT("/relay/keys", func(c *gin.Context) {
		var body struct {
			Group string `json:"group"`
			Key   string `json:"key"`
		}
		if err := c.ShouldBindJSON(&body); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请求格式错误"))
			return
		}
		group := strings.TrimSpace(body.Group)
		key := strings.TrimSpace(body.Key)
		if group == "" || key == "" {
			fail(c, http.StatusBadRequest, errors.New("分组和密钥都不能为空"))
			return
		}
		state, err := storedRelayState(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if state.GroupKeys == nil {
			state.GroupKeys = map[string]string{}
		}
		state.GroupKeys[group] = key
		if _, err := saveRelayAPIKey(c, svc, state); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"group": group, "key": key})
	})
	r.POST("/relay/logout", func(c *gin.Context) {
		revision, err := clearRelayConnection(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"channelId": builtinRelayChannelID, "revision": revision})
	})
	r.POST("/relay/connect", func(c *gin.Context) {
		var request struct {
			Username string `json:"username"`
			Password string `json:"password"`
		}
		if err := c.ShouldBindJSON(&request); err != nil {
			fail(c, http.StatusBadRequest, errors.New("请求格式错误"))
			return
		}
		username := strings.TrimSpace(request.Username)
		if username == "" || request.Password == "" {
			fail(c, http.StatusBadRequest, errors.New("请填写用户名和密码"))
			return
		}

		client, err := relayClient()
		if err != nil {
			fail(c, http.StatusServiceUnavailable, err)
			return
		}
		ctx, cancel := context.WithTimeout(c.Request.Context(), 60*time.Second)
		defer cancel()

		options, err := client.Status(ctx)
		if err != nil {
			failRelay(c, err)
			return
		}
		session, err := client.Login(ctx, username, request.Password)
		if err != nil {
			failRelay(c, err)
			return
		}
		completeRelaySignIn(c, svc, client, session, options)
	})
}

// completeRelaySignIn 在登录成功后创建应用令牌并把凭据写入内置渠道。
func completeRelaySignIn(c *gin.Context, svc *app.Service, client *relayclient.Client, session relayclient.Session, options relayclient.Options) {
	ctx := c.Request.Context()

	token, err := client.CreateToken(ctx, session, relayTokenName, "")
	if err != nil {
		failRelay(c, err)
		return
	}

	// 按分组各建一把密钥，让不同分组的模型都能用。
	groupKeys := make(map[string]string)
	modelGroups := make(map[string]string)
	priced, priceErr := client.Pricing(ctx, session)
	if priceErr != nil {
		log.Printf("relay 价格表读取失败，跳过分组密钥: %v", priceErr)
	}
	if priceErr == nil {
		for _, item := range priced {
			group := ""
			if len(item.EnableGroups) > 0 {
				group = item.EnableGroups[0]
			}
			if group != "" {
				modelGroups[item.Model] = group
			}
		}
		groups := make([]string, 0, len(modelGroups))
		seen := map[string]struct{}{}
		for _, name := range modelGroups {
			if _, ok := seen[name]; ok {
				continue
			}
			seen[name] = struct{}{}
			groups = append(groups, name)
		}
		for _, group := range groups {
			groupToken, createErr := client.CreateToken(ctx, session, relayTokenName+" "+group, group)
			if createErr != nil || strings.TrimSpace(groupToken.Key) == "" {
				continue
			}
			groupKeys[group] = groupToken.Key
		}
	}

	self, err := client.Self(ctx, session)
	if err != nil {
		failRelay(c, err)
		return
	}

	models, modelsErr := client.Models(ctx, token.Key)

	revision, err := saveRelayAPIKey(c, svc, relayChannelState{
		APIKey:       token.Key,
		Models:       models,
		AccessToken:  session.AccessToken,
		TokenType:    session.TokenType,
		Cookie:       session.Cookie,
		Quota:        self.Quota,
		UsedQuota:    self.UsedQuota,
		QuotaPerUnit: options.QuotaPerUnit,
	})
	if err != nil {
		failService(c, err)
		return
	}

	data := gin.H{
		"channelId":    builtinRelayChannelID,
		"username":     self.Username,
		"displayName":  self.DisplayName,
		"group":        self.Group,
		"quota":        self.Quota,
		"usedQuota":    self.UsedQuota,
		"quotaPerUnit": options.QuotaPerUnit,
		"models":       models,
		"tokenName":    relayTokenName,
		"revision":     revision,
	}
	if modelsErr != nil {
		// 模型列表拉取失败不影响凭据写入，前端可稍后手动刷新。
		data["modelsError"] = modelsErr.Error()
	}
	ok(c, data)
}

// readRelayAccountQuota 用登录态读取账户剩余额度；凭据过期时刷新一次。
func readRelayAccountQuota(ctx context.Context, client *relayclient.Client, state *relayChannelState) (int64, float64, bool) {
	perUnit := state.QuotaPerUnit
	if perUnit <= 0 {
		if options, err := client.Status(ctx); err == nil && options.QuotaPerUnit > 0 {
			perUnit = options.QuotaPerUnit
		}
	}
	if perUnit <= 0 {
		perUnit = 1
	}
	session := relayclient.Session{AccessToken: state.AccessToken, TokenType: state.TokenType, Cookie: state.Cookie}
	if session.AccessToken != "" || session.Cookie != "" {
		if self, err := client.Self(ctx, session); err == nil {
			state.UsedQuota = self.UsedQuota
			state.Username = firstNonEmpty(self.DisplayName, self.Username)
			return self.Quota, perUnit, true
		}
		if next, err := client.Refresh(ctx, session); err == nil {
			if self, err := client.Self(ctx, next); err == nil {
				state.AccessToken = next.AccessToken
				state.TokenType = next.TokenType
				state.Cookie = next.Cookie
				state.UsedQuota = self.UsedQuota
				state.Username = firstNonEmpty(self.DisplayName, self.Username)
				return self.Quota, perUnit, true
			}
		}
	}
	return 0, perUnit, false
}

// storedRelayState 读取内置渠道里已保存的连接状态。
func storedRelayState(c *gin.Context, svc *app.Service) (relayChannelState, error) {
	providerConfig := requestProviderConfig(c, svc)
	versioned, supportsVersioning := providerConfig.(VersionedProviderConfig)
	if !supportsVersioning {
		return relayChannelState{}, nil
	}
	effective, _, err := versioned.LoadEffectiveModelConfig()
	if err != nil {
		return relayChannelState{}, err
	}
	channels, _ := effective.Config["channels"].([]any)
	for _, item := range channels {
		channel, isMap := item.(map[string]any)
		if !isMap {
			continue
		}
		if id, _ := channel["id"].(string); id != builtinRelayChannelID {
			continue
		}
		return relayChannelStateFromMap(channel), nil
	}
	return relayChannelState{}, nil
}

// relayChannelStateFromMap 从渠道对象还原连接状态。
func relayChannelStateFromMap(channel map[string]any) relayChannelState {
	state := relayChannelState{}
	state.APIKey, _ = channel["apiKey"].(string)
	state.AccessToken, _ = channel["relayAccessToken"].(string)
	state.TokenType, _ = channel["relayTokenType"].(string)
	state.Cookie, _ = channel["relayCookie"].(string)
	state.Quota = anyToInt64(channel["relayQuota"])
	state.UsedQuota = anyToInt64(channel["relayUsedQuota"])
	state.QuotaPerUnit = anyToFloat64(channel["relayQuotaPerUnit"])
	return state
}

func anyToInt64(value any) int64 {
	switch typed := value.(type) {
	case float64:
		return int64(typed)
	case int64:
		return typed
	case int:
		return int64(typed)
	}
	return 0
}

func anyToFloat64(value any) float64 {
	switch typed := value.(type) {
	case float64:
		return typed
	case int64:
		return float64(typed)
	case int:
		return float64(typed)
	}
	return 0
}

// relayChannelState 是写入内置渠道的连接状态。
// firstNonEmpty 返回第一个非空字符串。
func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

type relayChannelState struct {
	APIKey       string
	Models       []string
	AccessToken  string
	TokenType    string
	Cookie       string
	Quota        int64
	UsedQuota    int64
	QuotaPerUnit float64
	Username     string
	GroupKeys    map[string]string
	ModelGroups  map[string]string
}

// clearRelayConnection 清除内置渠道里保存的连接凭据。
func clearRelayConnection(c *gin.Context, svc *app.Service) (int64, error) {
	providerConfig := requestProviderConfig(c, svc)
	versioned, supportsVersioning := providerConfig.(VersionedProviderConfig)
	if !supportsVersioning {
		return 0, errors.New("当前工作区不支持保存模型配置")
	}
	effective, _, err := versioned.LoadEffectiveModelConfig()
	if err != nil {
		return 0, err
	}
	config := effective.Config
	if config == nil {
		config = map[string]any{}
	}
	channels, _ := config["channels"].([]any)
	for _, item := range channels {
		channel, isMap := item.(map[string]any)
		if !isMap {
			continue
		}
		if id, _ := channel["id"].(string); id != builtinRelayChannelID {
			continue
		}
		channel["apiKey"] = ""
		channel["enabled"] = false
		for _, key := range []string{"relayAccessToken", "relayTokenType", "relayCookie", "relayQuota", "relayUsedQuota", "relayQuotaPerUnit", "relayQuotaAt"} {
			delete(channel, key)
		}
	}
	body, err := json.Marshal(config)
	if err != nil {
		return 0, err
	}
	return versioned.SaveLocalModelConfigRevision(body, effective.Revision)
}

// applyRelayChannelState 把连接状态写入渠道对象。
// marshalRelayMap 把分组映射存成 JSON 字符串，便于随渠道配置一起持久化。
func marshalRelayMap(value map[string]string) string {
	raw, err := json.Marshal(value)
	if err != nil {
		return ""
	}
	return string(raw)
}

func unmarshalRelayMap(raw string) map[string]string {
	out := map[string]string{}
	if strings.TrimSpace(raw) == "" {
		return out
	}
	_ = json.Unmarshal([]byte(raw), &out)
	return out
}

func applyRelayChannelState(channel map[string]any, state relayChannelState) {
	channel["apiKey"] = state.APIKey
	channel["enabled"] = true
	if len(state.Models) > 0 {
		channel["models"] = stringListToAny(state.Models)
	}
	if state.AccessToken != "" {
		channel["relayAccessToken"] = state.AccessToken
		channel["relayTokenType"] = state.TokenType
		channel["relayCookie"] = state.Cookie
	}
	channel["relayUsername"] = state.Username
	channel["relayQuota"] = state.Quota
	channel["relayUsedQuota"] = state.UsedQuota
	channel["relayQuotaPerUnit"] = state.QuotaPerUnit
	channel["relayQuotaAt"] = time.Now().Unix()
	if len(state.GroupKeys) > 0 {
		channel["relayGroupKeys"] = marshalRelayMap(state.GroupKeys)
	}
	if len(state.ModelGroups) > 0 {
		channel["relayModelGroups"] = marshalRelayMap(state.ModelGroups)
	}
}
func saveRelayAPIKey(c *gin.Context, svc *app.Service, state relayChannelState) (int64, error) {
	providerConfig := requestProviderConfig(c, svc)
	versioned, supportsVersioning := providerConfig.(VersionedProviderConfig)
	if !supportsVersioning {
		return 0, errors.New("当前工作区不支持保存模型配置")
	}
	effective, _, err := versioned.LoadEffectiveModelConfig()
	if err != nil {
		return 0, err
	}
	config := effective.Config
	if config == nil {
		config = map[string]any{}
	}
	channels, _ := config["channels"].([]any)
	updated := false
	for _, item := range channels {
		channel, isMap := item.(map[string]any)
		if !isMap {
			continue
		}
		if id, _ := channel["id"].(string); id != builtinRelayChannelID {
			continue
		}
		applyRelayChannelState(channel, state)
		updated = true
		break
	}
	if !updated {
		channel := map[string]any{
			"id":        builtinRelayChannelID,
			"name":      "SiFlux 服务",
			"baseUrl":   "https://api.siflux.cn/v1",
			"apiFormat": "openai",
			"enabled":   true,
		}
		applyRelayChannelState(channel, state)
		channels = append(channels, channel)
		config["channels"] = channels
	}
	body, err := json.Marshal(config)
	if err != nil {
		return 0, err
	}
	return versioned.SaveLocalModelConfigRevision(body, effective.Revision)
}

func stringListToAny(values []string) []any {
	items := make([]any, 0, len(values))
	for _, value := range values {
		items = append(items, value)
	}
	return items
}

// relayClient 构造中转站客户端，测试可用环境变量指向本地实例。
func relayClient() (*relayclient.Client, error) {
	baseURL := strings.TrimSpace(os.Getenv("SIFLUX_RELAY_BASE_URL"))
	if baseURL == "" {
		baseURL = relayclient.DefaultBaseURL
	}
	return relayclient.New(baseURL)
}

// failRelay 把中转站错误映射成对用户可读的失败响应，并把原始报错留在本机日志里。
func failRelay(c *gin.Context, err error) {
	relayErr, isRelay := relayclient.IsError(err)
	if !isRelay {
		log.Printf("relay 调用失败: %v", err)
		fail(c, http.StatusBadGateway, errors.New("无法连接 SiFlux 服务，请检查网络后重试"))
		return
	}
	// 只记录路径、状态与原始文案，不含任何凭据。
	log.Printf("relay 返回失败: path=%s status=%d msg=%s", relayErr.Path, relayErr.Status, relayErr.Message)
	status := http.StatusBadRequest
	if relayErr.Status >= 500 {
		status = http.StatusBadGateway
	}
	reason := relayFailureReason(relayErr.Message)
	c.JSON(status, gin.H{
		"code":   status,
		"reason": reason,
		"msg":    relayErr.Message,
		"data":   gin.H{},
	})
}

// relayFailureReason 给常见失败一个稳定原因码，便于前端定位输入项。
func relayFailureReason(message string) string {
	switch {
	case strings.Contains(message, "邮箱") && (strings.Contains(message, "使用") || strings.Contains(message, "占用")):
		return "relay_email_taken"
	case strings.Contains(message, "Username already exists") || strings.Contains(message, "用户名"):
		return "relay_username_taken"
	case strings.Contains(message, "verification code") || strings.Contains(message, "验证码"):
		return "relay_code_invalid"
	case strings.Contains(message, "password") || strings.Contains(message, "密码"):
		return "relay_password_rejected"
	case strings.Contains(message, "rate") || strings.Contains(message, "频繁"):
		return "relay_rate_limited"
	case strings.Contains(message, "disabled") || strings.Contains(message, "未开放"):
		return "relay_register_disabled"
	default:
		return "relay_failed"
	}
}

// relayCodeWait 返回同一邮箱还需等待的时长。
func relayCodeWait(email string) time.Duration {
	relayCodeGuard.Lock()
	defer relayCodeGuard.Unlock()
	sentAt, exists := relayCodeGuard.sentAt[email]
	if !exists {
		return 0
	}
	remaining := relayCodeInterval - time.Since(sentAt)
	if remaining <= 0 {
		delete(relayCodeGuard.sentAt, email)
		return 0
	}
	return remaining
}

func relayCodeMark(email string) {
	relayCodeGuard.Lock()
	defer relayCodeGuard.Unlock()
	relayCodeGuard.sentAt[email] = time.Now()
}
