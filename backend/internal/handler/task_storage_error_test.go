package handler

import (
	"infinite-canvas/backend/internal/model"
	"net/http"
	"strings"
	"testing"
)

func TestTaskStorageFailureIsLocalAndDoesNotExposeDatabaseDetails(t *testing.T) {
	h := newRetiredAgentHarness(t)
	seedSystemImageChannel(t, h.db)
	if err := h.db.Migrator().DropColumn(&model.Task{}, "FailureDiagnostics"); err != nil {
		t.Fatal(err)
	}
	response := h.do(t, http.MethodPost, "/api/tasks", map[string]any{
		"type": "canvas_image", "prompt": "一只猫在丛林中漫步", "model": "image-test",
		"input": map[string]any{"mode": "image", "config": map[string]any{"channelId": "channel", "model": "image-test"}},
	})
	body := response.Body.String()
	if response.Code != 500 || !strings.Contains(body, "local_storage_failed") || !strings.Contains(body, "尚未提交生成") || strings.Contains(body, "failure_diagnostics") {
		t.Fatalf("status=%d body=%s", response.Code, body)
	}
	var count int64
	h.db.Model(&model.Task{}).Count(&count)
	if count != 0 {
		t.Fatalf("created %d tasks on failed admission", count)
	}
}
