package relayconnect

import (
	"encoding/base64"
	"encoding/json"
	"strings"
	"testing"
)

func TestParseImportLinkRoundTripsAndAcceptsPageOutput(t *testing.T) {
	payload := Import{Name: "SIFLUX", BaseURL: "https://api.siflux.cn/v1", APIKey: "sk-abc123"}
	link, err := ImportLinkFor(payload)
	if err != nil {
		t.Fatalf("ImportLinkFor: %v", err)
	}
	parsed, err := ParseImportLink(link)
	if err != nil {
		t.Fatalf("ParseImportLink: %v", err)
	}
	if parsed != payload {
		t.Fatalf("往返不一致：%+v", parsed)
	}

	// The relay page builds its links in the browser with btoa + encodeURIComponent.
	body, err := json.Marshal(map[string]string{"name": "SIFLUX", "baseUrl": "https://api.siflux.cn/v1", "apiKey": "sk-browser"})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	browserLink := ImportScheme + "://provider/import?v=1&data=" + strings.ReplaceAll(strings.ReplaceAll(base64.StdEncoding.EncodeToString(body), "+", "%2B"), "=", "%3D")
	fromBrowser, err := ParseImportLink(browserLink)
	if err != nil {
		t.Fatalf("解析页面生成的链接: %v", err)
	}
	if fromBrowser.APIKey != "sk-browser" || fromBrowser.BaseURL != "https://api.siflux.cn/v1" {
		t.Fatalf("页面生成的链接解析错误：%+v", fromBrowser)
	}
}

func TestParseImportLinkAcceptsURLSafeBase64(t *testing.T) {
	body, err := json.Marshal(Import{BaseURL: "https://api.siflux.cn/v1", APIKey: "sk-+/="})
	if err != nil {
		t.Fatalf("Marshal: %v", err)
	}
	encoded := base64.RawURLEncoding.EncodeToString(body)
	parsed, err := ParseImportLink(ImportScheme + "://provider/import?v=1&data=" + encoded)
	if err != nil {
		t.Fatalf("ParseImportLink: %v", err)
	}
	if parsed.APIKey != "sk-+/=" {
		t.Fatalf("URL-safe Base64 解析错误：%+v", parsed)
	}
}

func TestParseImportLinkRejectsMalformedLinks(t *testing.T) {
	valid, err := ImportLinkFor(Import{BaseURL: "https://api.siflux.cn/v1", APIKey: "sk-ok"})
	if err != nil {
		t.Fatalf("ImportLinkFor: %v", err)
	}
	base := func(mutate func(link string) string) string { return mutate(valid) }
	for _, testCase := range []struct {
		name string
		link string
	}{
		{name: "empty", link: ""},
		{name: "other scheme", link: base(func(s string) string { return strings.Replace(s, ImportScheme+"://", "other://", 1) })},
		{name: "wrong path", link: base(func(s string) string { return strings.Replace(s, "provider/import", "provider/add", 1) })},
		{name: "missing version", link: base(func(s string) string { return strings.Replace(s, "&v=1", "", 1) })},
		{name: "unsupported version", link: base(func(s string) string { return strings.Replace(s, "v=1", "v=2", 1) })},
		{name: "missing data", link: ImportScheme + "://provider/import?v=1"},
		{name: "not base64", link: ImportScheme + "://provider/import?v=1&data=%%%"},
		{name: "not json", link: ImportScheme + "://provider/import?v=1&data=" + base64.StdEncoding.EncodeToString([]byte("nope"))},
		{name: "oversized", link: ImportScheme + "://provider/import?v=1&data=" + strings.Repeat("A", maxImportLinkLen)},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := ParseImportLink(testCase.link); err == nil {
				t.Fatalf("应拒绝链接 %q", testCase.link)
			}
		})
	}
}

func TestParseImportLinkRejectsUnsafePayload(t *testing.T) {
	build := func(payload map[string]string) string {
		body, err := json.Marshal(payload)
		if err != nil {
			t.Fatalf("Marshal: %v", err)
		}
		return ImportScheme + "://provider/import?v=1&data=" + base64.StdEncoding.EncodeToString(body)
	}
	for _, testCase := range []struct {
		name    string
		payload map[string]string
	}{
		{name: "missing base url", payload: map[string]string{"apiKey": "sk-1"}},
		{name: "missing key", payload: map[string]string{"baseUrl": "https://api.siflux.cn/v1"}},
		{name: "key with space", payload: map[string]string{"baseUrl": "https://api.siflux.cn/v1", "apiKey": "sk-1 2"}},
		{name: "userinfo in base url", payload: map[string]string{"baseUrl": "https://user:pass@api.siflux.cn/v1", "apiKey": "sk-1"}},
		{name: "query in base url", payload: map[string]string{"baseUrl": "https://api.siflux.cn/v1?debug=1", "apiKey": "sk-1"}},
		{name: "non http scheme", payload: map[string]string{"baseUrl": "ftp://api.siflux.cn/v1", "apiKey": "sk-1"}},
		{name: "relative base url", payload: map[string]string{"baseUrl": "/v1", "apiKey": "sk-1"}},
	} {
		t.Run(testCase.name, func(t *testing.T) {
			if _, err := ParseImportLink(build(testCase.payload)); err == nil {
				t.Fatalf("应拒绝载荷 %+v", testCase.payload)
			}
		})
	}
}

func TestOriginOfDropsPathAndRejectsUnusableAddresses(t *testing.T) {
	origin, err := OriginOf("https://api.siflux.cn/v1")
	if err != nil || origin != "https://api.siflux.cn" {
		t.Fatalf("OriginOf = %q err=%v", origin, err)
	}
	for _, raw := range []string{"", "  ", "/v1", "ftp://api.siflux.cn/v1"} {
		if _, err := OriginOf(raw); err == nil {
			t.Fatalf("OriginOf(%q) 应被拒绝", raw)
		}
	}
}
