package bootstrap

import (
	"context"
	"encoding/json"
	"net/http/httptest"
	"strings"
	"testing"
)

// desktopHarness 按桌面形态打开运行时，并提供一个「像桌面界面那样」发请求的入口。
type desktopHarness struct {
	rt      *Runtime
	dataDir string
	t       *testing.T
}

func newDesktopHarness(t *testing.T) *desktopHarness {
	t.Helper()
	dir := t.TempDir()
	rt, err := Open(context.Background(), Config{Profile: ProfileDesktop, DataDir: dir, ListenAddr: "127.0.0.1:0", AutoMigrate: true})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = rt.Close(context.Background()) })
	return &desktopHarness{rt: rt, dataDir: dir, t: t}
}

type requestOptions struct {
	method       string
	path         string
	body         string
	origin       string
	launchToken  string
	uiBootstrap  string
	remoteAddr   string
	extraHeaders map[string]string
}

func (h *desktopHarness) call(options requestOptions) *httptest.ResponseRecorder {
	h.t.Helper()
	body := options.body
	if body == "" {
		body = "{}"
	}
	request := httptest.NewRequest(options.method, "http://127.0.0.1:54321/api"+options.path, strings.NewReader(body))
	request.RemoteAddr = "127.0.0.1:12345"
	if options.remoteAddr != "" {
		request.RemoteAddr = options.remoteAddr
	}
	request.Header.Set("Content-Type", "application/json")
	if options.origin != "" {
		request.Header.Set("Origin", options.origin)
	}
	if options.launchToken != "" {
		request.Header.Set("X-Desktop-Token", options.launchToken)
	}
	if options.uiBootstrap != "" {
		request.Header.Set("x-siflux-UI-Bootstrap", options.uiBootstrap)
	}
	for name, value := range options.extraHeaders {
		request.Header.Set(name, value)
	}
	recorder := httptest.NewRecorder()
	h.rt.Handler().ServeHTTP(recorder, request)
	return recorder
}

// desktopUI 模拟受信任的桌面界面：启动令牌 + UI 引导密钥 + Wails 原生 Origin。
func (h *desktopHarness) desktopUI(method, path, body string) *httptest.ResponseRecorder {
	return h.call(requestOptions{method: method, path: path, body: body,
		origin: "wails://wails", launchToken: h.rt.LaunchToken(), uiBootstrap: h.rt.UIBootstrapToken()})
}

func decodeEnvelope(t *testing.T, recorder *httptest.ResponseRecorder) (map[string]any, string) {
	t.Helper()
	var envelope struct {
		Data   map[string]any `json:"data"`
		Reason string         `json:"reason"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &envelope); err != nil {
		t.Fatalf("响应不是合法 JSON：%s", recorder.Body.String())
	}
	return envelope.Data, envelope.Reason
}
