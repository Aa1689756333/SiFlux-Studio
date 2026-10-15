//go:build windows

package main

import (
	"fmt"
	"os"
	"strings"
	"testing"

	"golang.org/x/sys/windows/registry"
)

// The protocol registration is the kind of platform code that reports success
// while doing nothing, so it is exercised against a scratch scheme that is
// removed again instead of the installed one.
func TestRegisterURLSchemeWritesProtocolValues(t *testing.T) {
	scheme := fmt.Sprintf("sifluxstudio-test-%d", os.Getpid())
	executable := `C:\Program Files\SiFlux Studio\SiFluxStudio.exe`
	t.Cleanup(func() {
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+scheme+`\shell\open\command`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+scheme+`\shell\open`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+scheme+`\shell`)
		_ = registry.DeleteKey(registry.CURRENT_USER, `Software\Classes\`+scheme)
	})
	if err := registerURLSchemeFor(scheme, executable); err != nil {
		t.Fatalf("registerURLSchemeFor: %v", err)
	}
	protocol, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+scheme, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("打开协议项: %v", err)
	}
	defer protocol.Close()
	description, _, err := protocol.GetStringValue("")
	if err != nil || description != "URL:"+scheme+" protocol" {
		t.Fatalf("协议说明 = %q err=%v", description, err)
	}
	if marker, _, err := protocol.GetStringValue("URL Protocol"); err != nil || marker != "" {
		t.Fatalf("URL Protocol 标识 = %q err=%v", marker, err)
	}
	command, err := registry.OpenKey(registry.CURRENT_USER, `Software\Classes\`+scheme+`\shell\open\command`, registry.QUERY_VALUE)
	if err != nil {
		t.Fatalf("打开命令项: %v", err)
	}
	defer command.Close()
	registered, _, err := command.GetStringValue("")
	if err != nil {
		t.Fatalf("读取命令: %v", err)
	}
	// The link must reach the executable as one argument, quotes included: an
	// unquoted path with spaces would be split by the shell, and a quoted URL
	// keeps its own ampersands intact.
	if registered != `"C:\Program Files\SiFlux Studio\SiFluxStudio.exe" "%1"` {
		t.Fatalf("注册命令 = %q", registered)
	}
	if !strings.Contains(registered, "%1") {
		t.Fatalf("注册命令缺少参数占位符：%q", registered)
	}
}
