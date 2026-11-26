package handler

import (
	"encoding/json"
	"io"
	"net"
	"net/http"
	"net/url"
	"os"
	"strings"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/agentops"
	"infinite-canvas/backend/internal/app"
	httptransport "infinite-canvas/backend/internal/transport/http"
)

// agentOpsMaxBody 与画布 PUT 上限对齐：文档提交会带上整份画布，1MB 不够。
const agentOpsMaxBody = 5 << 20

// RegisterAgentOpsRoutes 暴露统一操作层：内置 pi 宿主与桌面本机入口都调用同一组端点，
// 不各自打开数据库或另起 worker。
func RegisterAgentOpsRoutes(r gin.IRouter, svc *app.Service, store *agentops.Store) *agentops.Registry {
	registry := agentops.NewRegistry(svc, store)
	agentops.RegisterDefaultOps(registry)

	r.GET("/ops", func(c *gin.Context) {
		if !isLoopbackRequest(c.Request) {
			fail(c, http.StatusForbidden, app.BadAuthRequest("操作层只接受本机请求"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		caller, clientLabel, authErr := resolveCaller(c, svc)
		if authErr != nil {
			fail(c, http.StatusForbidden, app.BadAuthRequest(authErr.Error()))
			return
		}
		// 能力发现只按调用者身份过滤可见集合；内置宿主在回合之外没有画布范围。
		scope, _, scopeErr := assistantScopeForRequest(c, svc, user.ID, isAssistantHostRequest(c, svc))
		if scopeErr != nil {
			fail(c, http.StatusForbidden, app.BadAuthRequest(scopeErr.Error()))
			return
		}
		caller = withRequestScope(caller, scope)
		ok(c, gin.H{"ops": registry.List(caller), "readOnly": caller.ReadOnly, "client": clientLabel, "caller": caller.Kind})
	})

	r.POST("/ops/:op", func(c *gin.Context) {
		// 本机入口：只接受 loopback 来源，避免被浏览器跨站或外部主机调用。
		if !isLoopbackRequest(c.Request) {
			fail(c, http.StatusForbidden, app.BadAuthRequest("操作层只接受本机请求"))
			return
		}
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		body, err := io.ReadAll(io.LimitReader(c.Request.Body, agentOpsMaxBody+1))
		if err != nil {
			fail(c, http.StatusBadRequest, app.BadAuthRequest("请求体读取失败"))
			return
		}
		if int64(len(body)) > agentOpsMaxBody {
			fail(c, http.StatusRequestEntityTooLarge, app.BadAuthRequest("请求体超过 5MB 限制"))
			return
		}
		// 请求体不接受 readOnly：能力模式只由调用者身份决定。
		var req struct {
			OpID   string          `json:"opId"`
			Params json.RawMessage `json:"params"`
		}
		if len(strings.TrimSpace(string(body))) > 0 {
			if err := json.Unmarshal(body, &req); err != nil {
				fail(c, http.StatusBadRequest, app.BadAuthRequest("请求体不是合法 JSON"))
				return
			}
		}
		caller, clientLabel, authErr := resolveCaller(c, svc)
		if authErr != nil {
			fail(c, http.StatusForbidden, app.BadAuthRequest(authErr.Error()))
			return
		}
		_ = clientLabel
		// 回合归属只认内置宿主：其他身份出示 turn 头会被明确拒绝，而不是静默忽略后
		// 让一次手工写入被误当成助手的改动（撤销会因此抹掉手工修改）。
		scope, turnID, scopeErr := assistantScopeForRequest(c, svc, user.ID, isAssistantHostRequest(c, svc))
		if scopeErr != nil {
			fail(c, http.StatusForbidden, app.BadAuthRequest(scopeErr.Error()))
			return
		}
		caller = withRequestScope(caller, scope)
		result, execErr := registry.Execute(agentops.Request{
			Context: c.Request.Context(),
			OpID:    req.OpID, Op: c.Param("op"), UserID: user.ID, Caller: caller, Params: req.Params,
			TurnID: turnID,
		})
		if execErr != nil {
			opErr := agentops.AsError(execErr)
			c.JSON(agentops.HTTPStatus(opErr.Code), gin.H{
				"code": agentops.HTTPStatus(opErr.Code), "reason": opErr.Reason, "msg": opErr.Message,
				"details": opErr.Details,
			})
			return
		}
		ok(c, result)
	})
	return registry
}

// resolveCaller 决定本次调用的身份与能力模式。
// 内置助手宿主：凭自己那份后端注入的宿主凭据拿到读写；页面的 UI 会话凭据不在这里。
// owner 通道是手工 UI 与本机直连的身份。
func resolveCaller(c *gin.Context, svc *app.Service) (agentops.Caller, string, error) {
	if isAssistantHostRequest(c, svc) {
		return agentops.Caller{Kind: agentops.CallerAssistant}, "assistant-host", nil
	}
	if agentops.OwnerTokenMatches(svc.DataDir(), strings.TrimSpace(c.GetHeader("x-siflux-Owner"))) {
		return agentops.Caller{Kind: agentops.CallerManual}, "owner", nil
	}
	if trustedDesktopUI(c) {
		return agentops.Caller{Kind: agentops.CallerManual}, "desktop-ui", nil
	}
	return agentops.Caller{}, "", errUnidentified
}

func trustedDesktopUI(c *gin.Context) bool {
	if c == nil || c.Request == nil || !isLoopbackRequest(c.Request) {
		return false
	}
	dependencies, ok := runtimeDependencies(c)
	if !ok || dependencies.DesktopTrust == nil {
		return false
	}
	return dependencies.DesktopTrust(c.Request)
}

// requireTrustedDesktopWritePrincipal is the creation.write principal check.
// Hosted runtimes leave DesktopTrust unset and still allow the workspace owner.
func requireTrustedDesktopWritePrincipal(c *gin.Context, message string) bool {
	dependencies, ok := runtimeDependencies(c)
	if !ok || dependencies.DesktopTrust == nil {
		return true
	}
	if !trustedDesktopUI(c) {
		fail(c, http.StatusForbidden, app.Forbidden(message))
		return false
	}
	return true
}

func withRequestScope(caller agentops.Caller, scope *agentops.AssistantScope) agentops.Caller {
	if scope != nil {
		caller.Scope = scope
		if scope.PermissionMode == "read-only" {
			caller.ReadOnly = true
		}
	}
	return caller
}

type clientAuthError struct{ message string }

func (e clientAuthError) Error() string { return e.message }

var (
	errUnidentified = clientAuthError{"缺少可信身份：需要 owner 凭据或受信任的桌面界面"}
)

// loopbackHosts 是允许访问本机操作层的主机名；后续 Wails 正式 origin 也在这里登记。
var loopbackHosts = map[string]bool{"127.0.0.1": true, "localhost": true, "::1": true}

func isLoopbackHost(host string) bool {
	name, _, err := net.SplitHostPort(host)
	if err != nil {
		name = host // 无端口时按主机名处理
	}
	name = strings.Trim(name, "[]")
	return loopbackHosts[strings.ToLower(name)]
}

// isLoopbackRequest 精确校验来源：Host、Origin 与 RemoteAddr 都必须是本机。
// 不用子串匹配，避免 localhost.attacker.example 或任意 loopback 端口被误当成同源。
func isLoopbackRequest(r *http.Request) bool {
	if !isLoopbackHost(r.Host) {
		return false
	}
	remoteHost, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		remoteHost = r.RemoteAddr
	}
	if !isLoopbackHost(remoteHost) {
		return false
	}
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if httptransport.DesktopAuthenticated(r) && (origin == "wails://wails" || origin == "http://wails.localhost" || origin == "https://wails.localhost") {
		return true
	}
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") {
		return false
	}
	// 同源必须 host 与端口都一致：仅“是 loopback”不够，任意 loopback 端口都不算同源。
	if strings.EqualFold(parsed.Host, r.Host) {
		return true
	}
	for _, allowed := range allowedOrigins() {
		if strings.EqualFold(strings.TrimRight(allowed, "/"), strings.TrimRight(origin, "/")) {
			return true
		}
	}
	return false
}

// allowedOrigins 允许显式配置的正式前端 Origin（例如 Wails 宿主页面）。
func allowedOrigins() []string {
	raw := strings.TrimSpace(os.Getenv("SIFLUX_ALLOWED_ORIGINS"))
	if raw == "" {
		return nil
	}
	parts := strings.Split(raw, ",")
	out := make([]string, 0, len(parts))
	for _, item := range parts {
		if trimmed := strings.TrimSpace(item); trimmed != "" {
			out = append(out, trimmed)
		}
	}
	return out
}
