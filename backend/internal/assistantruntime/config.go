package assistantruntime

import (
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
)

const hostConfigFile = "agent_config.json"

// HostConfig 记录当前使用的文本模型与宿主启动命令；由本机用户在设置里配置。
type HostConfig struct {
	Model       string   `json:"model"`
	HostCommand string   `json:"hostCommand"`
	HostArgs    []string `json:"hostArgs,omitempty"`
	UpdatedAt   string   `json:"updatedAt,omitempty"`
}

func (h *Host) EffectiveConfig() (HostConfig, bool) {
	config, configured := readHostConfig(h.dataDir())
	if strings.TrimSpace(config.HostCommand) == "" {
		if bundled := BundledConfig(h.executablePath(), h.goos()); bundled.HostCommand != "" {
			config.HostCommand = bundled.HostCommand
			config.HostArgs = bundled.HostArgs
			configured = true
		}
	}
	return config, configured
}

func (h *Host) WriteConfig(config HostConfig) error {
	return writeHostConfig(h.dataDir(), config)
}

func readHostConfig(dataDir string) (HostConfig, bool) {
	raw, err := os.ReadFile(filepath.Join(dataDir, hostConfigFile))
	if err != nil {
		return HostConfig{}, false
	}
	var config HostConfig
	if json.Unmarshal(raw, &config) != nil {
		return HostConfig{}, false
	}
	return config, true
}

func writeHostConfig(dataDir string, config HostConfig) error {
	encoded, err := json.MarshalIndent(config, "", "  ")
	if err != nil {
		return err
	}
	tmp, err := os.CreateTemp(dataDir, ".agent-config-*")
	if err != nil {
		return err
	}
	name := tmp.Name()
	defer os.Remove(name)
	if err := tmp.Chmod(0o600); err != nil {
		tmp.Close()
		return err
	}
	if _, err := tmp.Write(encoded); err != nil {
		tmp.Close()
		return err
	}
	if err := tmp.Close(); err != nil {
		return err
	}
	return os.Rename(name, filepath.Join(dataDir, hostConfigFile))
}

// BundledConfig 从可执行文件布局解析随包 Node 运行时。
// 桌面两种布局都直接执行 Node；Windows 不能依赖 POSIX shell。
//
// 没有随包运行时（开发构建、自部署源码目录）时，按 agent-host/run-agent-host.sh 的同一约定
// 回退到 PATH 上的 node（其次 bun），入口从工作目录向上查找 agent-host/server.mjs。
// 回退只影响「找不到随包运行时」的情形，发行形态仍然优先使用包内运行时。
func BundledConfig(executable, goos string) HostConfig {
	if strings.TrimSpace(executable) == "" {
		return HostConfig{}
	}
	roots := packagedAgentHostRoots(executable)
	if wd, err := os.Getwd(); err == nil {
		if root := sourceAgentHostRoot(wd); root != "" {
			roots = append(roots, root)
		}
	}
	nodeRelative := filepath.Join("runtime", "bin", "node")
	if goos == "windows" {
		nodeRelative = filepath.Join("runtime", "node.exe")
	}
	for _, root := range roots {
		entry := filepath.Join(root, "server.mjs")
		if !isRegularFile(entry) {
			continue
		}
		if node := filepath.Join(root, nodeRelative); isRegularFile(node) {
			return HostConfig{HostCommand: node, HostArgs: []string{entry}}
		}
		if node := systemNodeRuntime(); node != "" {
			return HostConfig{HostCommand: node, HostArgs: []string{entry}}
		}
	}
	return HostConfig{}
}

// packagedAgentHostRoots 是发行形态的候选目录：macOS 在 Resources 下，Linux/Windows 与可执行文件同级。
func packagedAgentHostRoots(executable string) []string {
	dir := filepath.Dir(executable)
	return []string{
		filepath.Join(dir, "..", "Resources", "agent-host"),
		filepath.Join(dir, "agent-host"),
	}
}

// sourceAgentHostRoot 从 start 向上逐级查找源码目录里的 agent-host/server.mjs。
// 深度有限，避免在无关目录里长时间回溯。
func sourceAgentHostRoot(start string) string {
	dir := filepath.Clean(start)
	for depth := 0; depth < 8; depth++ {
		candidate := filepath.Join(dir, "agent-host")
		if isRegularFile(filepath.Join(candidate, "server.mjs")) {
			return candidate
		}
		if filepath.Base(dir) == "agent-host" && isRegularFile(filepath.Join(dir, "server.mjs")) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

// systemNodeRuntime 按启动器脚本的顺序回退：node 优先，其次 bun。
func systemNodeRuntime() string {
	for _, name := range []string{"node", "bun"} {
		if path, err := exec.LookPath(name); err == nil {
			return path
		}
	}
	return ""
}

func isRegularFile(path string) bool {
	info, err := os.Stat(path)
	return err == nil && !info.IsDir()
}
