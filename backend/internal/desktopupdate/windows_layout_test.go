package desktopupdate

import (
	"os"
	"path/filepath"
	"testing"
)

func TestWindowsLayoutAllowsExeAndPluginsOnly(t *testing.T) {
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, pluginDirName, "unpacked-plugin"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, windowsExeName), []byte("MZ"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, pluginDirName, "core.siflux-plugin"), []byte("plugin"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, pluginDirName, "unpacked-plugin", "manifest.json"), []byte("{}"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := validateWindowsLayout(root); err != nil {
		t.Fatalf("minimal Windows layout rejected: %v", err)
	}
}

func TestWindowsSwapLeavesMissingSidecarsInPlace(t *testing.T) {
	root := t.TempDir()
	old, next := filepath.Join(root, "old"), filepath.Join(root, "new")
	if err := os.MkdirAll(filepath.Join(old, pluginDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(next, pluginDirName), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, windowsExeName), []byte("old-exe"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(next, windowsExeName), []byte("new-exe"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, pluginDirName, "core.siflux-plugin"), []byte("old-plugin"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(next, pluginDirName, "core.siflux-plugin"), []byte("new-plugin"), 0o644); err != nil {
		t.Fatal(err)
	}
	if err := os.MkdirAll(filepath.Join(old, "agent-host"), 0o755); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "agent-host", "keep.txt"), []byte("keep"), 0o644); err != nil {
		t.Fatal(err)
	}
	req := HelperRequest{Platform: "windows-amd64", TargetPath: filepath.Join(old, windowsExeName), StagedPath: next, BackupPath: filepath.Join(root, "backup")}
	if err := SwapInstall(req); err != nil {
		t.Fatal(err)
	}
	if b, err := os.ReadFile(filepath.Join(old, windowsExeName)); err != nil || string(b) != "new-exe" {
		t.Fatalf("exe not replaced: %q %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(old, pluginDirName, "core.siflux-plugin")); err != nil || string(b) != "new-plugin" {
		t.Fatalf("plugins not replaced: %q %v", b, err)
	}
	if b, err := os.ReadFile(filepath.Join(old, "agent-host", "keep.txt")); err != nil || string(b) != "keep" {
		t.Fatalf("existing agent-host should stay when update omits it: %q %v", b, err)
	}
}
