package app

import (
	"context"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestValidateTaskType(t *testing.T) {
	tests := []struct {
		name     string
		taskType string
		wantErr  bool
	}{
		{name: "missing", taskType: "", wantErr: true},
		{name: "canvas image", taskType: "canvas_image"},
		{name: "removed video operation", taskType: "video_image_to_video", wantErr: true},
		{name: "unknown canvas type", taskType: "canvas_unknown", wantErr: true},
		{name: "unknown type", taskType: "workflow_router", wantErr: true},
	}

	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if err := validateTaskType(tt.taskType); (err != nil) != tt.wantErr {
				t.Fatalf("validateTaskType(%q) error = %v, wantErr %v", tt.taskType, err, tt.wantErr)
			}
		})
	}
}

func TestProcessTaskRejectsUnknownType(t *testing.T) {
	_, _, err := (&Service{}).processTask(context.Background(), model.Task{
		Type:      "workflow_router",
		InputJSON: `{}`,
	})
	if err == nil {
		t.Fatal("processTask() error = nil, want unsupported task type error")
	}
	if err.Error() != "不支持的任务类型：workflow_router" {
		t.Fatalf("processTask() error = %q, want unsupported task type error", err)
	}
}