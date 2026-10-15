package main

import (
	"fmt"
	"strings"
)

// Desktop platform flags may be supplied by LaunchServices/WebView. Positional
// CLI commands must never continue into desktop startup or open a database.
func validateDesktopArgs(args []string) error {
	linkSeen := false
	for i := 0; i < len(args); i++ {
		arg := args[i]
		switch arg {
		case "mcp", "ops", "canvas", "asset", "task", "client", "help", "--help", "-h", "--version", "--json", "-json":
			return fmt.Errorf("此程序是 SiFlux Studio 桌面应用。CLI/MCP 请使用命令行程序；在 SiFlux Studio 设置中重新复制客户端配置")
		}
		// Cocoa also accepts preference overrides as flag/value pairs.
		if (strings.HasPrefix(arg, "-NS") || strings.HasPrefix(arg, "-Apple")) && i+1 < len(args) && !strings.HasPrefix(args[i+1], "-") {
			i++
			continue
		}
		if !strings.HasPrefix(arg, "-") {
			if !isRelayLinkArg(arg) {
				return fmt.Errorf("SiFlux Studio 桌面应用不支持命令 %q；CLI/MCP 请使用命令行程序", arg)
			}
			if linkSeen {
				return fmt.Errorf("SiFlux Studio 桌面应用一次只能接收一个一键配置链接")
			}
			linkSeen = true
		}
	}
	return nil
}
