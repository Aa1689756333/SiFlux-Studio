package assistantruntime

import (
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"testing"
)

// 开发构建与自部署源码目录没有随包 Node 运行时，必须按 run-agent-host.sh 的同一约定
// 回退到 PATH 上的 node，否则宿主永远起不来（host_start_failed）。
func TestBundledConfigFallsBackToPathNode(t *testing.T) {
	root := t.TempDir()
	agentHost := filepath.Join(root, "agent-host")
	if err := os.MkdirAll(filepath.Join(root, "sub", "dir"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(agentHost, 0o755); err != nil {
		t.Fatal(err)
	}
	entry := filepath.Join(agentHost, "server.mjs")
	if err := os.WriteFile(entry, []byte("// entry\n"), 0o644); err != nil {
		t.Fatal(err)
	}

	binDir := t.TempDir()
	nodeName := "node"
	if runtime.GOOS == "windows" {
		nodeName = "node.bat"
	}
	if err := os.WriteFile(filepath.Join(binDir, nodeName), []byte("@echo off\r\n"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", binDir)

	previous, err := os.Getwd()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.Chdir(filepath.Join(root, "sub", "dir")); err != nil {
		t.Fatal(err)
	}
	defer func() {
		if err := os.Chdir(previous); err != nil {
			t.Fatalf("恢复工作目录失败: %v", err)
		}
	}()

	// 可执行文件在别处（go run / 开发构建），包内布局不存在，只能靠源码目录回退。
	executable := filepath.Join(t.TempDir(), "backend")
	got := BundledConfig(executable, runtime.GOOS)

	if got.HostCommand == "" {
		t.Fatal("没有随包运行时应回退到 PATH 上的 node，实际未解析出启动命令")
	}
	if !strings.HasSuffix(got.HostCommand, nodeName) {
		t.Fatalf("启动命令应指向 PATH 上的 node，实际 %q", got.HostCommand)
	}
	if len(got.HostArgs) != 1 || got.HostArgs[0] != entry {
		t.Fatalf("入口应为 %q，实际 %v", entry, got.HostArgs)
	}
}

func TestSourceAgentHostRootWalksUpFromWorkingDir(t *testing.T) {
	root := t.TempDir()
	agentHost := filepath.Join(root, "agent-host")
	if err := os.MkdirAll(agentHost, 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentHost, "server.mjs"), []byte("// entry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	deep := filepath.Join(root, "backend", "internal", "handler")
	if err := os.MkdirAll(deep, 0o755); err != nil {
		t.Fatal(err)
	}

	if got := sourceAgentHostRoot(deep); got != agentHost {
		t.Fatalf("应从工作目录向上找到 %q，实际 %q", agentHost, got)
	}
	if got := sourceAgentHostRoot(agentHost); got != agentHost {
		t.Fatalf("工作目录本身就是 agent-host 时应返回自身，实际 %q", got)
	}
	if got := sourceAgentHostRoot(t.TempDir()); got != "" {
		t.Fatalf("无关目录不应解析出 agent-host，实际 %q", got)
	}
}

// 包内运行时存在时优先使用它，不受 PATH 影响（发行形态行为不变）。
func TestBundledConfigPrefersPackagedRuntime(t *testing.T) {
	root := t.TempDir()
	agentHost := filepath.Join(root, "agent-host")
	nodeRelative := filepath.Join("runtime", "bin", "node")
	if runtime.GOOS == "windows" {
		nodeRelative = filepath.Join("runtime", "node.exe")
	}
	if err := os.MkdirAll(filepath.Join(agentHost, filepath.Dir(nodeRelative)), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(agentHost, "server.mjs"), []byte("// entry\n"), 0o644); err != nil {
		t.Fatal(err)
	}
	packaged := filepath.Join(agentHost, nodeRelative)
	if err := os.WriteFile(packaged, []byte("binary"), 0o755); err != nil {
		t.Fatal(err)
	}
	t.Setenv("PATH", t.TempDir())

	executable := filepath.Join(agentHost, "..", "BeefTV")
	got := BundledConfig(executable, runtime.GOOS)

	if got.HostCommand != packaged {
		t.Fatalf("应优先使用包内运行时 %q，实际 %q", packaged, got.HostCommand)
	}
}
