package bootstrap

import (
	"net/http"
	"net/http/httptest"
	"testing"

	"infinite-canvas/backend/internal/agentops"
)

func TestOpsAcceptanceUIBootstrapCredentialIsolation(t *testing.T) {
	t.Setenv("SIFLUX_UI_BOOTSTRAP", "")
	h := newDesktopHarness(t)
	foreign := newDesktopHarness(t)
	for _, tc := range []struct{ name, launch, bootstrap string }{
		{"missing-both", "", ""},
		{"missing-bootstrap", h.rt.LaunchToken(), ""},
		{"missing-launch", "", h.rt.UIBootstrapToken()},
		{"foreign-bootstrap", h.rt.LaunchToken(), foreign.rt.UIBootstrapToken()},
		{"foreign-launch", foreign.rt.LaunchToken(), h.rt.UIBootstrapToken()},
		{"foreign-pair", foreign.rt.LaunchToken(), foreign.rt.UIBootstrapToken()},
	} {
		t.Run(tc.name, func(t *testing.T) {
			w := h.call(requestOptions{method: "POST", path: "/assistant/ui-session", body: `{}`, origin: "wails://wails", launchToken: tc.launch, uiBootstrap: tc.bootstrap})
			if w.Code != http.StatusForbidden {
				t.Fatalf("POST /assistant/ui-session: %d %s", w.Code, w.Body.String())
			}
		})
	}
	if w := h.desktopUI("POST", "/assistant/ui-session", ""); w.Code != http.StatusOK {
		t.Fatalf("valid UI rejected: %d %s", w.Code, w.Body.String())
	}
}

func TestOpsAcceptanceOriginAndLoopbackAtRouter(t *testing.T) {
	t.Setenv("SIFLUX_ALLOWED_ORIGINS", "https://app.siflux.local")
	t.Setenv("SIFLUX_UI_BOOTSTRAP", "")
	h := newDesktopHarness(t)
	owner, err := agentops.EnsureOwnerToken(h.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, tc := range []struct {
		name, host, remote, origin string
		want                       int
	}{
		{"same-origin", "127.0.0.1:54321", "127.0.0.1:12345", "http://127.0.0.1:54321", 200},
		{"no-origin", "127.0.0.1:54321", "127.0.0.1:12345", "", 200},
		{"ipv6-loopback", "[::1]:54321", "[::1]:12345", "http://[::1]:54321", 200},
		{"allowed-origin", "127.0.0.1:54321", "127.0.0.1:12345", "https://app.siflux.local", 200},
		{"different-port", "127.0.0.1:54321", "127.0.0.1:12345", "http://127.0.0.1:54322", 403},
		{"localhost-suffix", "127.0.0.1:54321", "127.0.0.1:12345", "http://localhost.attacker.example", 403},
		{"allowlist-suffix", "127.0.0.1:54321", "127.0.0.1:12345", "https://app.siflux.local.attacker.example", 403},
		{"opaque-origin", "127.0.0.1:54321", "127.0.0.1:12345", "null", 403},
		{"foreign-host", "attacker.example", "127.0.0.1:12345", "https://app.siflux.local", 403},
		{"foreign-remote", "127.0.0.1:54321", "203.0.113.4:12345", "https://app.siflux.local", 403},
	} {
		t.Run(tc.name, func(t *testing.T) {
			for _, ui := range []bool{false, true} {
				method, path := "GET", "/ops"
				if ui {
					method, path = "POST", "/assistant/ui-session"
				}
				r := httptest.NewRequest(method, "http://"+tc.host+"/api"+path, nil)
				r.RemoteAddr = tc.remote
				r.Header.Set("Origin", tc.origin)
				// Forwarded headers must not override the transport peer or target host.
				r.Header.Set("X-Forwarded-For", "127.0.0.1")
				r.Header.Set("X-Forwarded-Host", "127.0.0.1:54321")
				// 桌面形态的整张 API 由启动令牌把关；identity 由 owner 通道决定。
				r.Header.Set("X-Desktop-Token", h.rt.LaunchToken())
				if ui {
					r.Header.Set("x-siflux-UI-Bootstrap", h.rt.UIBootstrapToken())
				} else {
					r.Header.Set("x-siflux-Owner", owner)
				}
				w := httptest.NewRecorder()
				h.rt.Handler().ServeHTTP(w, r)
				if w.Code != tc.want {
					t.Fatalf("%s: got %d want %d: %s", path, w.Code, tc.want, w.Body.String())
				}
			}
		})
	}
}
