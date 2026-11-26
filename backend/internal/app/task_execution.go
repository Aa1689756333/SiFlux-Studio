package app

import (
	"context"
	"encoding/json"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	localtask "infinite-canvas/backend/internal/task"
)

// processTask never dispatches historical retired task kinds or disguised modes.
func (s *Service) processTask(ctx context.Context, task model.Task) (map[string]interface{}, []map[string]interface{}, error) {
	if err := validateTaskType(task.Type); err != nil { return nil, nil, err }
	decryptedInput, err := s.decryptTaskInputJSON(task.InputJSON)
	if err != nil { return nil, nil, err }
	var input map[string]any
	if err := json.Unmarshal([]byte(decryptedInput), &input); err != nil { return nil, nil, err }
	if err := localtask.ValidateImageInput(input); err != nil { return nil, nil, err }
	task.InputJSON = decryptedInput
	ctx = withTaskExecutionID(ctx, task.ID)
	ctx = withProviderAnalytics(ctx, s, task)
	runtime, _ := generation.RuntimeFromContext(ctx)
	runtime.Stages = appTaskStagePort{service: s, task: task}
	ctx = generation.WithRuntime(ctx, runtime)
	ctx = context.WithValue(ctx, imageTaskContext{}, task)
	if result, recovered, err := s.recoverImageSubmission(ctx, task); recovered { return result, nil, err }
	result, err := s.processCanvasGenerationTask(ctx, task.UserID, task.ProjectID, task.Type, task.Prompt, task.InputJSON)
	return result, nil, err
}
