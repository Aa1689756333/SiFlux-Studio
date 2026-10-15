//go:build windows

package main

import (
	"fmt"
	"os"
	"path/filepath"

	"infinite-canvas/backend/internal/relayconnect"

	"golang.org/x/sys/windows/registry"
)

// registerURLScheme makes sifluxstudio:// links open this executable. It runs on
// every launch so the command follows a moved or updated installation. The key
// lives under HKCU, matching the installer's per-user model: no elevation.
func registerURLScheme() error {
	executable, err := os.Executable()
	if err != nil {
		return fmt.Errorf("定位程序路径失败：%w", err)
	}
	absolute, err := filepath.Abs(executable)
	if err != nil {
		return fmt.Errorf("解析程序路径失败：%w", err)
	}
	return registerURLSchemeFor(relayconnect.ImportScheme, absolute)
}

// registerURLSchemeFor writes the protocol registration for one scheme and
// executable. The scheme is a parameter so the registration can be exercised
// against a scratch key instead of the installed one.
func registerURLSchemeFor(scheme, executable string) error {
	base := `Software\Classes\` + scheme
	protocol, _, err := registry.CreateKey(registry.CURRENT_USER, base, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("注册一键配置协议失败：%w", err)
	}
	defer protocol.Close()
	if err := protocol.SetStringValue("", "URL:"+scheme+" protocol"); err != nil {
		return fmt.Errorf("写入协议说明失败：%w", err)
	}
	if err := protocol.SetStringValue("URL Protocol", ""); err != nil {
		return fmt.Errorf("写入协议标识失败：%w", err)
	}
	command, _, err := registry.CreateKey(registry.CURRENT_USER, base+`\shell\open\command`, registry.SET_VALUE)
	if err != nil {
		return fmt.Errorf("注册一键配置命令失败：%w", err)
	}
	defer command.Close()
	// The command is a Windows command line, not a Go literal: %q would double
	// every backslash and leave a path Windows cannot resolve.
	return command.SetStringValue("", `"`+executable+`" "%1"`)
}
