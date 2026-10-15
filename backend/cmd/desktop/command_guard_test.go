package main

import "testing"

func TestDesktopRejectsCLICommands(t *testing.T) {
	for _, args := range [][]string{{"mcp", "serve"}, {"ops", "--json"}, {"canvas", "get"}, {"client", "register"}, {"unknown-command"}, {"--json", "mcp", "serve"}} {
		if err := validateDesktopArgs(args); err == nil {
			t.Fatalf("desktop accepted CLI arguments %v", args)
		}
	}
	for _, args := range [][]string{nil, {"-psn_0_12345"}, {"--disable-gpu"}, {"--user-data-dir=platform-profile"}, {"-NSDocumentRevisionsDebugMode", "YES"}, {"-AppleLanguages", "(en)"}} {
		if err := validateDesktopArgs(args); err != nil {
			t.Fatalf("desktop rejected platform arguments %v: %v", args, err)
		}
	}
}

func TestDesktopAcceptsOneRelayLinkArgument(t *testing.T) {
	link := "sifluxstudio://provider/import?v=1&data=e30"
	for _, args := range [][]string{{link}, {"--disable-gpu", link}, {link, "-psn_0_12345"}} {
		if err := validateDesktopArgs(args); err != nil {
			t.Fatalf("desktop rejected relay link %v: %v", args, err)
		}
	}
	// A malformed link still starts the application: acceptRelayLink validates the
	// payload, and refusing to launch would strand the user with no window.
	if err := validateDesktopArgs([]string{"sifluxstudio://broken"}); err != nil {
		t.Fatalf("desktop rejected malformed relay link: %v", err)
	}
	if err := validateDesktopArgs([]string{link, link}); err == nil {
		t.Fatal("desktop accepted two relay links")
	}
	if err := validateDesktopArgs([]string{link, "serve"}); err == nil {
		t.Fatal("desktop accepted a relay link together with a CLI command")
	}
}
