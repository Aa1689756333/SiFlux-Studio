package app

import (
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"

	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/repository"
)

// 每个测试独立的 sqlite 内存库，避免共享缓存串库；同时承载需要完整本地库结构的任务测试。
func newTimelineTaskTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := fmt.Sprintf("file:%s_%d?mode=memory&cache=shared", t.Name(), time.Now().UnixNano())
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatalf("open sqlite: %v", err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatalf("migrate: %v", err)
	}
	return &Service{repo: repository.New(db)}, db
}

// 本地回环上游只在测试里放行，生产仍由 SSRF 防护默认拒绝私网。
func allowLoopbackProviderTest(t *testing.T) {
	t.Helper()
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,localhost")
}

// 磁盘数据库服务：用于需要跨重启验证的用例。
func openDiskTaskTestService(t *testing.T, dir string) (*Service, *gorm.DB) {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(dir, "app-test.db")), &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db), dataDir: dir, mode: serviceModeLocal}, db
}
