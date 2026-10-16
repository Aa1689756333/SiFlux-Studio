package desktopstorage

import (
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func writeLegacyFixture(t *testing.T, path string, body string) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

func TestMigrateLegacyRootFreshInstall(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	if err := MigrateLegacyRoot(root); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(root); !os.IsNotExist(err) {
		t.Fatalf("a fresh install must not create the data directory, stat err = %v", err)
	}
}

func TestMigrateLegacyRootMovesWorkspace(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	legacy := filepath.Join(base, "BeefTV")
	writeLegacyFixture(t, filepath.Join(legacy, "canvas.db"), "sqlite")

	if err := MigrateLegacyRoot(root); err != nil {
		t.Fatal(err)
	}
	body, err := os.ReadFile(filepath.Join(root, "canvas.db"))
	if err != nil || string(body) != "sqlite" {
		t.Fatalf("workspace did not arrive, body = %q err = %v", body, err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy directory survived the move, stat err = %v", err)
	}
}

// 指针指向其他卷是最容易丢数据的一种情况：新 root 必须继承指针，
// 否则 Resolve 会返回新 root，用户看到的是空工作区。
func TestMigrateLegacyRootInheritsPointer(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	legacy := filepath.Join(base, "BeefTV")
	volume := filepath.Join(base, "volume")
	if err := os.MkdirAll(volume, 0o700); err != nil {
		t.Fatal(err)
	}
	writeLegacyFixture(t, filepath.Join(legacy, locationFile), `{"dataDir":`+strconv.Quote(volume)+`}`)

	if err := MigrateLegacyRoot(root); err != nil {
		t.Fatal(err)
	}
	resolved, err := Resolve(root)
	if err != nil {
		t.Fatal(err)
	}
	if resolved != volume {
		t.Fatalf("Resolve = %q, want %q", resolved, volume)
	}
	if _, err := os.Stat(filepath.Join(legacy, locationFile)); err != nil {
		t.Fatalf("legacy pointer must stay in place, stat err = %v", err)
	}
}

func TestMigrateLegacyRootKeepsExistingWorkspace(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	legacy := filepath.Join(base, "BeefTV")
	writeLegacyFixture(t, filepath.Join(legacy, "old.db"), "old")
	writeLegacyFixture(t, filepath.Join(root, "new.db"), "new")

	if err := MigrateLegacyRoot(root); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(filepath.Join(root, "new.db")); err != nil || string(body) != "new" {
		t.Fatalf("existing workspace touched, body = %q err = %v", body, err)
	}
	if body, err := os.ReadFile(filepath.Join(legacy, "old.db")); err != nil || string(body) != "old" {
		t.Fatalf("legacy workspace removed, body = %q err = %v", body, err)
	}
}

func TestMigrateLegacyRootEmptyRootDoesNotShadowData(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	legacy := filepath.Join(base, "BeefTV")
	if err := os.MkdirAll(root, 0o700); err != nil {
		t.Fatal(err)
	}
	writeLegacyFixture(t, filepath.Join(legacy, "canvas.db"), "sqlite")

	if err := MigrateLegacyRoot(root); err != nil {
		t.Fatal(err)
	}
	if body, err := os.ReadFile(filepath.Join(root, "canvas.db")); err != nil || string(body) != "sqlite" {
		t.Fatalf("an empty new directory shadowed the legacy workspace, body = %q err = %v", body, err)
	}
}

func TestMigrateLegacyRootIsIdempotent(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	legacy := filepath.Join(base, "BeefTV")
	writeLegacyFixture(t, filepath.Join(legacy, "canvas.db"), "sqlite")

	for run := 0; run < 3; run++ {
		if err := MigrateLegacyRoot(root); err != nil {
			t.Fatalf("run %d: %v", run, err)
		}
	}
	if body, err := os.ReadFile(filepath.Join(root, "canvas.db")); err != nil || string(body) != "sqlite" {
		t.Fatalf("workspace lost across runs, body = %q err = %v", body, err)
	}
	if _, err := os.Stat(legacy); !os.IsNotExist(err) {
		t.Fatalf("legacy directory reappeared, stat err = %v", err)
	}
}

// 既有不变量：指针指向的卷不可访问时必须报错，不能静默建空工作区。
func TestResolveRefusesMissingPointerVolume(t *testing.T) {
	base := t.TempDir()
	root := filepath.Join(base, "SiFlux Studio")
	missing := filepath.Join(base, "detached-volume")
	writeLegacyFixture(t, filepath.Join(root, locationFile), `{"dataDir":`+strconv.Quote(missing)+`}`)

	if _, err := Resolve(root); err == nil {
		t.Fatal("a missing volume must fail instead of silently creating an empty workspace")
	}
}
