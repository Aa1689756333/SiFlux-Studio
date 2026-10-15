package main

import (
	"testing"

	"infinite-canvas/backend/internal/relayconnect"
)

func relayLink(t *testing.T, baseURL, apiKey string) string {
	t.Helper()
	link, err := relayconnect.ImportLinkFor(relayconnect.Import{Name: "SIFLUX", BaseURL: baseURL, APIKey: apiKey})
	if err != nil {
		t.Fatalf("ImportLinkFor: %v", err)
	}
	return link
}

func TestRelayLinkFromArgsPicksTheProtocolArgument(t *testing.T) {
	link := relayLink(t, "https://api.siflux.cn/v1", "sk-1")
	for _, args := range [][]string{
		{link},
		{"--disable-gpu", link},
		{link, "-psn_0_12345"},
		{"--data-dir=C:\\data", link},
	} {
		if got := relayLinkFromArgs(args); got != link {
			t.Fatalf("relayLinkFromArgs(%v) = %q", args, got)
		}
	}
	for _, args := range [][]string{nil, {"--disable-gpu"}, {"sifluxstudio:missing-authority"}, {"other://provider/import"}} {
		if got := relayLinkFromArgs(args); got != "" {
			t.Fatalf("relayLinkFromArgs(%v) = %q，应当没有链接", args, got)
		}
	}
	// The scheme comparison is case insensitive: browsers and shells both lower
	// case it, but a clipboard round trip must not break the import.
	upper := "SIFLUXSTUDIO://provider/import?v=1&data=x"
	if got := relayLinkFromArgs([]string{upper}); got != upper {
		t.Fatalf("relayLinkFromArgs(%v) = %q", []string{upper}, got)
	}
}

func TestAcceptRelayLinkQueuesBuiltinRelayImport(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	link := relayLink(t, "https://api.siflux.cn/v1", "sk-queued")

	if !app.acceptRelayLink(link) {
		t.Fatal("内置中转站的链接应被接受")
	}
	pending := app.takeRelayImport()
	if pending == nil {
		t.Fatal("接受的链接应进入待确认队列")
	}
	if pending.APIKey != "sk-queued" || pending.BaseURL != "https://api.siflux.cn/v1" || pending.Name != "SIFLUX" {
		t.Fatalf("队列内容错误：%+v", pending)
	}
	if again := app.takeRelayImport(); again != nil {
		t.Fatalf("待确认内容只能取走一次，实际 %+v", again)
	}
}

func TestAcceptRelayLinkRejectsForeignAndMalformedLinks(t *testing.T) {
	app := newDesktopApp(t.TempDir())
	// Any page the user visits can open the registered protocol, so an import
	// pointing at another host must never reach the confirmation step.
	foreign := relayLink(t, "https://evil.example/v1", "sk-foreign")
	// The plain HTTP form of the relay is a downgrade of the pinned address.
	downgraded := relayLink(t, "http://api.siflux.cn/v1", "sk-downgrade")
	for _, link := range []string{"", "   ", foreign, downgraded, "sifluxstudio://provider/import?v=2&data=e30", "sifluxstudio://provider/import?v=1&data=%%%"} {
		if app.acceptRelayLink(link) {
			t.Fatalf("应拒绝链接 %q", link)
		}
	}
	if pending := app.takeRelayImport(); pending != nil {
		t.Fatalf("被拒绝的链接不应入队：%+v", pending)
	}
}

func TestRelayOriginMatchesBuiltinPreset(t *testing.T) {
	origin, err := relayOrigin()
	if err != nil {
		t.Fatalf("relayOrigin: %v", err)
	}
	if origin != "https://api.siflux.cn" {
		t.Fatalf("内置中转站 origin = %q", origin)
	}
}
