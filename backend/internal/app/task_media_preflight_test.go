package app

import (
	"errors"
	"path/filepath"
	"testing"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func TestCreateTaskMediaTransportAdmission(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "preflight.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(database.LocalModels()...); err != nil {
		t.Fatal(err)
	}
	svc := NewLocal(repository.New(db), t.TempDir())
	t.Cleanup(func() { _ = svc.Close() })
	// dashscope-wanx-image 是需要公网素材链接的生图协议：本地素材键必须在入库前被拒。
	request := CreateTaskRequest{Type: "canvas_image", Prompt: "move", Input: map[string]any{
		"mode": "image", "prompt": "move",
		"config":          map[string]any{"interfaceType": "dashscope-wanx-image", "model": "wanx-image", "baseUrl": "https://custom.example/v1", "apiKey": "synthetic-key"},
		"referenceImages": []any{map[string]any{"storageKey": "resource:local-image"}},
	}}
	_, err = svc.CreateTask("user", request)
	var appErr *AppError
	if !errors.As(err, &appErr) || appErr.Reason != "reference_media_requires_url" {
		t.Fatalf("wrong admission error: %v", err)
	}
	var count int64
	if err := db.Model(&model.Task{}).Count(&count).Error; err != nil || count != 0 {
		t.Fatalf("rejected task persisted: %d %v", count, err)
	}
	request.Input["referenceImages"] = []any{map[string]any{"url": "https://cdn.example/image.png"}}
	task, err := svc.CreateTask("user", request)
	if err != nil || task.Status != model.TaskStatusQueued {
		t.Fatalf("HTTPS task not accepted: %v", err)
	}
}

func TestTaskCapabilityInvalidConfigDoesNotSkipValidation(t *testing.T) {
	svc := &Service{}
	if err := svc.ValidateTaskCapability(map[string]any{"mode": "video", "config": map[string]any{"videoGenerateAudio": map[string]any{"bad": true}}}); err == nil {
		t.Fatal("malformed configuration skipped validation")
	}
}
