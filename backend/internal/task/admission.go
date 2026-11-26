package task

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func (s *Service) admit(userID string, req CreateRequest) (*model.Task, error) {
	if IsRetiredAgentTaskInput(req.Operation, req.Input) {
		return nil, kernel.BadAuthRequest(RetiredAgentBoundaryMessage)
	}
	taskType := strings.TrimSpace(req.Type)
	if err := ValidateType(taskType); err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	if err := ValidateImageInput(req.Input); err != nil {
		return nil, err
	}
	operationKey, err := ClientOperationID(req.Input)
	if err != nil {
		return nil, err
	}
	var operationHash string
	if operationKey != "" {
		operationHash, err = ClientOperationHash(req)
		if err != nil {
			return nil, err
		}
	}
	if operationKey != "" {
		if s.store == nil {
			return nil, kernel.WrapAppError(kernel.CodeInternal, "任务服务不可用", errStoreRequired)
		}
		existing, lookupErr := s.store.TaskByClientOperation(userID, operationKey)
		if lookupErr != nil {
			return nil, lookupErr
		}
		if existing != nil {
			return admitExisting(*existing, req, s.deps.Present)
		}
	}
	if err := s.requireAdmitCollaborators(); err != nil {
		return nil, err
	}
	if s.deps.Runtime.IsDraining() {
		return nil, drainError(DrainCreateMessage)
	}
	prompt := strings.TrimSpace(req.Prompt)
	if prompt == "" {
		return nil, kernel.BadAuthRequest(PromptRequiredMessage)
	}
	normalizedInput, err := NormalizeInput(req.Input)
	if err != nil {
		return nil, err
	}
	if err := s.validateRetryType(userID, taskType, normalizedInput); err != nil {
		return nil, err
	}
	normalizedInput, err = s.deps.Secrets.ResolveManaged(normalizedInput)
	if err != nil {
		return nil, err
	}
	selected, err := s.deps.Catalog.Select(userID, SelectRequest{
		Input:          normalizedInput,
		LogicalModelID: strings.TrimSpace(req.LogicalModelID),
		Type:           taskType,
		Operation:      req.Operation,
	})
	if err != nil {
		return nil, err
	}
	if selected.Input != nil {
		normalizedInput = selected.Input
	}
	if err := ValidateImageInput(normalizedInput); err != nil {
		return nil, err
	}
	if err := s.deps.Catalog.RequireCustomChannels(normalizedInput); err != nil {
		return nil, err
	}
	if err := s.deps.Catalog.ValidateCapability(normalizedInput); err != nil {
		return nil, err
	}
	if s.deps.Media.ContainsInlineData(normalizedInput) {
		return nil, kernel.BadAuthRequest(InlineMediaRejectedMessage)
	}
	if err := s.deps.Media.ValidateTransport(userID, normalizedInput); err != nil {
		return nil, err
	}

	limit, err := s.deps.Policy.ActiveTaskLimit()
	if err != nil {
		return nil, err
	}
	if s.store == nil {
		return nil, localStorageFailed(errStoreRequired)
	}
	activeTasks, err := s.store.ActiveTaskCount(userID)
	if err != nil {
		return nil, localStorageFailed(err)
	}
	if activeTasks >= int64(limit) {
		return nil, activeLimitError(limit)
	}

	task := model.Task{
		ID:        s.newID(),
		UserID:    userID,
		TraceID:   req.TraceID,
		RequestID: req.RequestID,
		ProjectID: req.ProjectID,
		Type:      taskType,
		Status:    model.TaskStatusQueued,
		Stage:     "等待队列调度",
		Progress:  5,
		Prompt:    prompt,
		Operation: req.Operation,
		Provider:  req.Provider,
		Model:     req.Model,
	}
	if operationKey != "" {
		task.ClientOperationID = &operationKey
		task.ClientOperationHash = operationHash
	}
	if id := strings.TrimSpace(req.AdmissionID); id != "" {
		task.ID = id
	}
	if selected.Binding != nil {
		binding := selected.Binding
		task.LogicalModelID = binding.LogicalModelID
		task.LogicalModelRevisionID = binding.LogicalModelRevisionID
		task.RouteID = binding.RouteID
		task.ChannelModelID = binding.ChannelModelID
		task.RouteRun = 1
		task.Model = binding.Model
		task.Provider = "managed"
	}
	if err := s.deps.Projects.EnsureActive(userID, req.ProjectID); err != nil {
		return nil, err
	}
	if req.PrepareOnly {
		encoded, encodeErr := encodeTaskInput(normalizedInput)
		if encodeErr != nil {
			return nil, encodeErr
		}
		task.InputJSON = encoded
		return &task, nil
	}
	if err := s.deps.Secrets.Protect(normalizedInput); err != nil {
		return nil, err
	}
	inputJSON, err := encodeTaskInput(normalizedInput)
	if err != nil {
		return nil, err
	}
	task.InputJSON = inputJSON
	if s.deps.Persist == nil {
		return nil, localStorageFailed(errors.New("task persistence is required"))
	}
	if s.deps.Present == nil {
		return nil, unavailable()
	}
	err = s.deps.Persist.CreateAdmitted(&task, limit)
	if mapped, mapErr := mapPersistError(err, req, s.deps.Present, limit); mapErr != nil || mapped != nil {
		return mapped, mapErr
	}
	if s.deps.Activity != nil {
		s.deps.Activity.Record(userID, "task", 1)
	}
	s.log(userID, task.ID, "info", "任务已进入队列", "")
	return presentTask(s.deps.Present, task)
}

func (s *Service) requireAdmitCollaborators() error {
	if s.deps.Runtime == nil || s.deps.Catalog == nil || s.deps.Secrets == nil || s.deps.Media == nil || s.deps.Projects == nil || s.deps.Policy == nil {
		return unavailable()
	}
	return nil
}

func encodeTaskInput(input map[string]any) (string, error) {
	encoded, err := json.Marshal(input)
	if err != nil {
		return "", fmt.Errorf("序列化任务输入失败：%w", err)
	}
	return string(encoded), nil
}
