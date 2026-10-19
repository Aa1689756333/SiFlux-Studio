package generation

import (
	"errors"
	"net/http"
	"net/url"
	"os"
	"strings"

	"infinite-canvas/backend/internal/providerpreset"
)

// ErrImageOwnerMissing is returned when a recoverable image POST has
// no Images port or the port declined to take ownership. Callers must not
// open a new upstream request.
var ErrImageOwnerMissing = errors.New("图片请求缺少恢复所有者")

// RecoverableImageEndpoint reports whether req is a paid image create that must
// run through ImageSubmissionPort. Replay of a stored request is only safe on
// relays that acknowledge Idempotency-Key, so every other host stays on the
// normal POST path.
func RecoverableImageEndpoint(req *http.Request) bool {
	// 重放依赖中转站按 Idempotency-Key 去重，未验证前保持关闭。
	if os.Getenv("CANVAS_IMAGE_IDEMPOTENT_REPLAY") != "1" {
		return false
	}
	if req == nil || req.URL == nil || req.Method != http.MethodPost || req.URL.Scheme != "https" || req.URL.User != nil || req.URL.RawQuery != "" || (req.URL.Port() != "" && req.URL.Port() != "443") {
		return false
	}
	if !strings.HasSuffix(strings.TrimSuffix(req.URL.Path, "/"), "/images/generations") {
		return false
	}
	return idempotentImageHost(strings.ToLower(req.URL.Hostname()))
}

// idempotentImageHosts holds operator-configured extra hosts.
var idempotentImageHosts []string

// SetIdempotentImageHosts installs extra relay hosts that acknowledge
// Idempotency-Key. The built-in SiFlux relay is always included.
func SetIdempotentImageHosts(hosts []string) {
	cleaned := make([]string, 0, len(hosts))
	for _, h := range hosts {
		if h = strings.ToLower(strings.TrimSpace(h)); h != "" {
			cleaned = append(cleaned, h)
		}
	}
	idempotentImageHosts = cleaned
}

func idempotentImageHost(host string) bool {
	if host == "" {
		return false
	}
	for _, allowed := range append(builtinIdempotentHosts(), idempotentImageHosts...) {
		if host == allowed {
			return true
		}
	}
	return false
}

func builtinIdempotentHosts() []string {
	preset, ok := providerpreset.BuiltinPreset("siflux")
	if !ok {
		return nil
	}
	parsed, err := url.Parse(preset.BaseURL)
	if err != nil || parsed.Hostname() == "" {
		return nil
	}
	return []string{strings.ToLower(parsed.Hostname())}
}
