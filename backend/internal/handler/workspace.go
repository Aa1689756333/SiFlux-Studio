package handler

import (
	"encoding/json"
	"errors"
	"io"
	"net/http"

	"infinite-canvas/backend/internal/app"
	"infinite-canvas/backend/internal/workspace"

	"github.com/gin-gonic/gin"
)

// RegisterWorkspaceRoutes exposes the desktop-first bootstrap contract. The
// workspace scope is injected by the runtime before the router is mounted, so
// this endpoint never reads a cookie or creates an AuthSession.
func RegisterWorkspaceRoutes(r *gin.RouterGroup, svc *app.Service) {
	r.GET("/workspace/bootstrap", func(c *gin.Context) {
		scope, err := CurrentWorkspace(c)
		if err != nil {
			fail(c, http.StatusInternalServerError, err)
			return
		}
		user, err := svc.WorkspaceOwner(scope.ID)
		if err != nil {
			failService(c, err)
			return
		}
		publicUser := app.AuthUser{User: *user}
		// Desktop model configuration is persisted separately under the workspace
		// data directory. The bootstrap contract contains no account metadata.
		logicalModels := []app.PublicLogicalModel{}
		limits, err := svc.PublicRuntimeLimits()
		if err != nil {
			failService(c, err)
			return
		}
		features, err := svc.FeatureAvailability()
		if err != nil {
			failService(c, err)
			return
		}
		contract := LocalDesktopContract()
		ok(c, gin.H{
			"contractVersion": contract.Version,
			"profile":         contract.Profile,
			"capabilities":    contract.Capabilities,
			"workspace": gin.H{
				"id":      scope.ID,
				"name":    "本地工作区",
				"owner":   "local",
				"storage": "sqlite",
			},
			"user":          publicUser,
			"storageMode":   "local",
			"logicalModels": logicalModels,
			"runtimeLimits": limits,
			"features":      features,
		})
	})
	r.GET("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		providerConfig := requestProviderConfig(c, svc)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning {
			effective, health, err := versioned.LoadEffectiveModelConfig()
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"config": redactModelConfig(c, svc, effective.Config), "revision": effective.Revision, "health": health, "source": "builtin+local"})
			return
		}
		body, err := providerConfig.ReadLocalModelConfig()
		if err != nil {
			failService(c, err)
			return
		}
		if len(body) == 0 {
			ok(c, gin.H{"config": nil})
			return
		}
		var config map[string]any
		if err := json.Unmarshal(body, &config); err != nil {
			fail(c, http.StatusInternalServerError, errors.New("本地模型配置损坏"))
			return
		}
		ok(c, gin.H{"config": redactModelConfig(c, svc, config)})
	})
	r.PUT("/workspace/model-config", func(c *gin.Context) {
		if _, err := workspaceForLocalRequest(c, svc); err != nil {
			fail(c, http.StatusUnauthorized, err)
			return
		}
		body, err := io.ReadAll(http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20))
		if err != nil {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置读取失败"))
			return
		}
		var envelope struct {
			Config           json.RawMessage `json:"config"`
			ExpectedRevision *int64          `json:"expectedRevision"`
		}
		if err := json.Unmarshal(body, &envelope); err != nil || len(envelope.Config) == 0 || string(envelope.Config) == "null" {
			fail(c, http.StatusBadRequest, errors.New("本地模型配置格式错误"))
			return
		}
		if _, external := externalBusiness(c); external && envelope.ExpectedRevision == nil {
			fail(c, http.StatusBadRequest, errors.New("修改模型配置需要 expectedRevision"))
			return
		}
		envelope.Config = preserveManagedModelConfig(c, svc, envelope.Config)
		providerConfig := requestProviderConfig(c, svc)
		if versioned, supportsVersioning := providerConfig.(VersionedProviderConfig); supportsVersioning && envelope.ExpectedRevision != nil {
			revision, err := versioned.SaveLocalModelConfigRevision(envelope.Config, *envelope.ExpectedRevision)
			if errors.Is(err, workspace.ErrProviderConfigRevisionConflict) {
				fail(c, http.StatusConflict, err)
				return
			}
			if err != nil {
				failService(c, err)
				return
			}
			ok(c, gin.H{"saved": true, "revision": revision})
			return
		}
		if err := providerConfig.SaveLocalModelConfig(envelope.Config); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"saved": true})
	})
}

func redactModelConfig(c *gin.Context, svc *app.Service, config map[string]any) map[string]any {
	if _, external := externalBusiness(c); external {
		config = redactExternalConfig(config)
	}
	return app.RedactLegacyManagedChannel(config)
}

func preserveManagedModelConfig(c *gin.Context, svc *app.Service, raw json.RawMessage) json.RawMessage {
	var incoming map[string]any
	if err := json.Unmarshal(raw, &incoming); err != nil {
		return raw
	}
	existing := map[string]any{}
	providerConfig := requestProviderConfig(c, svc)
	if versioned, ok := providerConfig.(VersionedProviderConfig); ok {
		if effective, _, err := versioned.LoadEffectiveModelConfig(); err == nil {
			existing = effective.Config
		}
	}
	if _, external := externalBusiness(c); external {
		preserveExternalConfigSecrets(incoming, existing)
	} else {
		preserveBuiltinRelayConnection(incoming, existing)
	}
	encoded, err := json.Marshal(incoming)
	if err != nil {
		return raw
	}
	return encoded
}

const builtinRelayChannelID = "siflux"

// preserveBuiltinRelayConnection pins the built-in relay's connection fields to
// the stored values, so writing the config directly cannot retarget the relay.
func preserveBuiltinRelayConnection(incoming, existing map[string]any) {
	stored := map[string]map[string]any{}
	if list, ok := existing["channels"].([]any); ok {
		for _, item := range list {
			if channel, ok := item.(map[string]any); ok {
				if id, _ := channel["id"].(string); id != "" {
					stored[id] = channel
				}
			}
		}
	}
	list, ok := incoming["channels"].([]any)
	if !ok {
		return
	}
	// 本地配置只允许存在内置中转站：其他渠道一律丢弃，没有时补回中转站。
	filtered := make([]any, 0, 1)
	for _, item := range list {
		if channel, ok := item.(map[string]any); ok {
			if id, _ := channel["id"].(string); id == builtinRelayChannelID {
				filtered = append(filtered, item)
			}
		}
	}
	if len(filtered) == 0 {
		if original, exists := stored[builtinRelayChannelID]; exists {
			copied := make(map[string]any, len(original))
			for key, value := range original {
				copied[key] = value
			}
			filtered = append(filtered, copied)
		} else {
			filtered = append(filtered, map[string]any{
				"id": builtinRelayChannelID, "name": "SiFlux 中转站",
				"baseUrl": "https://api.siflux.cn/v1", "apiFormat": "openai",
			})
		}
	}
	incoming["channels"] = filtered
	list = filtered
	for _, item := range list {
		channel, ok := item.(map[string]any)
		if !ok {
			continue
		}
		id, _ := channel["id"].(string)
		if id != builtinRelayChannelID {
			continue
		}
		original, exists := stored[id]
		for _, key := range []string{"baseUrl", "apiFormat", "name", "referenceAssetOrigin", "secretKey"} {
			if exists {
				if value, ok := original[key]; ok {
					channel[key] = value
					continue
				}
				delete(channel, key)
				continue
			}
			switch key {
			case "baseUrl":
				channel[key] = "https://api.siflux.cn/v1"
			case "apiFormat":
				channel[key] = "openai"
			case "name":
				channel[key] = "SiFlux 中转站"
			case "referenceAssetOrigin", "secretKey":
				channel[key] = ""
			}
		}
	}
}

func workspaceForLocalRequest(c *gin.Context, svc *app.Service) (workspace.Context, error) {
	if scope, err := CurrentWorkspace(c); err == nil {
		return scope, nil
	}
	if svc.IsLocalMode() {
		return workspace.Context{ID: "local"}, nil
	}
	return workspace.Context{}, errors.New("本地工作区未初始化")
}
