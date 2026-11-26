package bootstrap

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestDesktopAssistantCredentialsAreSeparated(t *testing.T) {
	dir := t.TempDir()
	rt, err := Open(context.Background(), Config{Profile: ProfileDesktop, DataDir: dir, ListenAddr: "127.0.0.1:0", AutoMigrate: true})
	if err != nil {
		t.Fatal(err)
	}
	defer rt.Close(context.Background())
	request := func(method, path, origin, launch, ui string) *httptest.ResponseRecorder {
		r := httptest.NewRequest(method, "http://127.0.0.1:54321/api"+path, strings.NewReader(`{"params":{"canvasId":"test","nodeId":"test","expectedRevision":0,"patch":{"title":"forbidden"}},"opId":"test"}`))
		r.RemoteAddr = "127.0.0.1:12345"
		r.Header.Set("Content-Type", "application/json")
		r.Header.Set("Origin", origin)
		r.Header.Set("X-Desktop-Token", launch)
		r.Header.Set("x-siflux-UI-Bootstrap", ui)
		w := httptest.NewRecorder()
		rt.Handler().ServeHTTP(w, r)
		return w
	}
	for _, origin := range []string{"", "wails://wails", "http://wails.localhost", "https://wails.localhost"} {
		w := request("POST", "/assistant/ui-session", origin, rt.LaunchToken(), "")
		if w.Code != http.StatusForbidden {
			t.Fatalf("launch token alone elevated origin %q: %d", origin, w.Code)
		}
	}
	for _, origin := range []string{"wails://wails", "http://wails.localhost", "https://wails.localhost"} {
		w := request("POST", "/assistant/ui-session", origin, rt.LaunchToken(), rt.UIBootstrapToken())
		if w.Code != http.StatusOK {
			t.Fatalf("native UI bootstrap %q failed: %d %s", origin, w.Code, w.Body.String())
		}
	}
	if w := request("POST", "/assistant/ui-session", "wails://attacker", rt.LaunchToken(), rt.UIBootstrapToken()); w.Code != 403 {
		t.Fatal("unknown origin accepted")
	}
	w := request("OPTIONS", "/assistant/chat", "wails://wails", "", "")
	if !strings.Contains(w.Header().Get("Access-Control-Allow-Headers"), "x-siflux-Ui-Session") {
		t.Fatal("native stream preflight omits UI session header")
	}
}
