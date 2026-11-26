package handler

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// creationAuthCall 以固定的回环地址发起请求，保证桌面信任判定与真实客户端一致。
func creationAuthCall(t *testing.T, router http.Handler, method, path string, headers map[string]string, body string) *httptest.ResponseRecorder {
	t.Helper()
	request := httptest.NewRequest(method, "http://127.0.0.1:18090"+path, strings.NewReader(body))
	request.Host = "127.0.0.1:18090"
	request.RemoteAddr = "127.0.0.1:12345"
	request.Header.Set("Content-Type", "application/json")
	for key, value := range headers {
		request.Header.Set(key, value)
	}
	recorder := httptest.NewRecorder()
	router.ServeHTTP(recorder, request)
	return recorder
}
