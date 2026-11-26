package app

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/taskruntime"
)

// taskWorkerCoordinator 是 app 侧兼容入口：保留现有方法名给测试和 Service 调用方，
// 实际领取、租约、排空和执行窗口由 internal/taskruntime 拥有。
type taskWorkerCoordinator struct {
	service *Service
	runtime *taskruntime.Runtime
}

const workerSlotLeaseDuration = time.Minute

func newTaskWorkerCoordinator(service *Service) *taskWorkerCoordinator {
	w := &taskWorkerCoordinator{service: service}
	w.runtime = newAppTaskRuntime(w)
	return w
}

func (s *Service) taskWorker() *taskWorkerCoordinator {
	if s.taskWorkerCoordinator != nil {
		return s.taskWorkerCoordinator
	}
	// 部分单元测试直接构造 Service 字面量；延迟创建保持这些测试和内部工具兼容。
	return newTaskWorkerCoordinator(s)
}

func (w *taskWorkerCoordinator) start(ctx context.Context) {
	s := w.service
	s.startGenerationDeliveryRecovery(ctx)
	// 旧内置 Agent 的后台调度已整体从产品生命周期移出：
	//   - 不再启动记忆自动压缩（它会按周期调用用户的文本模型）；
	//   - 不再按运行模式启动 advanceCloudAgents 轮次调度。
	// 两者都不会在 local/hosted 任何 profile 下重新驱动旧 Agent 的半成品流程。
	// 历史任务、运行状态、偏好与记忆数据保留在本地数据库，不做破坏性迁移。
	if w.runtime == nil {
		w.runtime = newAppTaskRuntime(w)
	}
	w.runtime.StartLoop()
}

func (w *taskWorkerCoordinator) processNextTask() error {
	if w.runtime == nil {
		w.runtime = newAppTaskRuntime(w)
	}
	return w.runtime.ProcessOne(context.Background()).Err
}

func (w *taskWorkerCoordinator) executeClaimed(session taskruntime.Session) taskruntime.Outcome {
	s := w.service
	task := session.Task()
	ctx := session.Context()
	// 产品边界：旧内置 Agent 的 cloud_agent / cloud_agent_step 任务不再执行。历史遗留的
	// 排队任务若被领走，会在这里以明确原因终止，而不是当成普通文本生成调用模型；
	// 保留任务行本身（数据不删）以便追溯。
	if retiredAgentTask(task) {
		// 任务已被终态收尾（含失败日志），这不是 worker 执行失败，因此返回 nil。
		err := s.terminalCoordinator().refuse(task, "功能已下线", retiredAgentBoundaryMessage)
		return taskruntime.Outcome{Kind: taskruntime.KindRejected, Err: err, Applied: err == nil}
	}
	terminal := s.terminalCoordinator()
	if err := validateTaskType(task.Type); err != nil {
		refuseErr := terminal.refuse(task, "功能已下线", err.Error())
		return taskruntime.Outcome{Kind: taskruntime.KindRejected, Err: refuseErr, Applied: refuseErr == nil}
	}
	_ = s.log(task.UserID, task.ID, "info", "后端任务开始处理", "")
	// 取消请求可能在任务领取和注册 worker context 之间到达；再次读取终态
	// 可以避免这种极窄窗口仍然向上游发起调用。
	if latest, latestErr := s.repo.Task(task.ID); latestErr == nil && latest.Status == model.TaskStatusCancelled {
		err := terminal.handleAlreadyCancelled(*latest)
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: err, Applied: true}
	}

	task.Stage = "调用生成模型"
	task.Progress = 35
	if taskUsesUpstreamReportedProgress(task.Type) {
		// 图片/视频百分比只能来自供应商状态响应。连接和提交阶段只展示文案，
		// 不能再用统一的 35% 冒充真实生成进度。
		task.Stage = "正在连接上游"
		task.Progress = 0
	}
	if err := s.repo.UpdateTaskProgressForLease(task.ID, task.LeaseOwner, task.Stage, task.Progress); err != nil {
		return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: fmt.Errorf("更新任务进度失败，任务暂未调用上游：%w", err)}
	}
	routeAttempt, err := s.beginTaskRouteAttempt(task)
	if err != nil {
		uncertain := isRouteDispatchUncertain(err)
		termErr := terminal.markPreparationFailure(task, "路由准备失败", err, uncertain, "路由准备失败，上游请求未发出")
		kind := taskruntime.KindFailed
		if uncertain {
			kind = taskruntime.KindUncertain
		}
		return taskruntime.Outcome{Kind: kind, Err: termErr, Applied: terminalWriteApplied(termErr, err)}
	}
	routeResult, stateErr := s.routeExecutor().execute(ctx, task, routeAttempt)
	if stateErr != nil {
		kind := taskruntime.KindFailed
		if isRouteDispatchUncertain(stateErr) {
			kind = taskruntime.KindUncertain
		}
		return taskruntime.Outcome{Kind: kind, Err: stateErr, ProviderAccepted: strings.TrimSpace(task.ProviderRequestID) != ""}
	}
	if session.Lost() {
		return leaseLostOutcome(session, strings.TrimSpace(task.ProviderRequestID) != "")
	}
	result, canvasOps, err := routeResult.result, routeResult.canvasOps, routeResult.err
	providerSucceeded := routeResult.providerSucceeded
	providerAccepted := providerSucceeded || strings.TrimSpace(task.ProviderRequestID) != ""
	if err == nil {
		result, err = s.persistTaskGeneratedMediaResult(*task, result)
	}
	if err != nil {
		channelSlotFailedBeforeRequest := false
		if code, _ := ChannelSlotFailureDetails(err); code != "" {
			channelSlotFailedBeforeRequest = true
		}
		if session.Lost() {
			_ = s.log(task.UserID, task.ID, "warn", "任务租约失效，等待其他 worker 恢复", session.LostErr().Error())
			return leaseLostOutcome(session, providerAccepted)
		}
		if s.shouldDeferImageRecovery(*task, err, providerSucceeded) {
			deferErr := s.deferImageRecovery(*task)
			return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Err: deferErr, Applied: deferErr == nil, ProviderAccepted: true}
		}
		var imageRecovery imageRecoveryError
		if errors.Is(err, context.DeadlineExceeded) && !errors.As(err, &imageRecovery) {
			err = errors.New(taskTimeoutMessage(task.Type))
		}
		return executionFailureOutcome(terminal, task, err, providerSucceeded, providerAccepted, channelSlotFailedBeforeRequest)
	}
	latest, err := s.repo.Task(task.ID)
	if err != nil {
		return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: err, ProviderAccepted: providerAccepted}
	}
	if latest.Status == model.TaskStatusCancelled {
		termErr := terminal.handleCancelledResult(*latest)
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: termErr, Applied: true, ProviderAccepted: providerAccepted}
	}
	resultJSON, err := json.Marshal(result)
	if err != nil {
		return persistenceFailureOutcome(terminal, task, fmt.Errorf("序列化任务结果失败：%w", err), providerAccepted)
	}
	opsJSON, err := json.Marshal(canvasOps)
	if err != nil {
		return persistenceFailureOutcome(terminal, task, fmt.Errorf("序列化画布操作失败：%w", err), providerAccepted)
	}
	if session.Lost() {
		return leaseLostOutcome(session, true)
	}
	if err := s.saveTaskCompletionWithinStorageQuota(task, resultJSON, opsJSON, len(canvasOps) > 0); err != nil {
		if s.shouldDeferImageRecovery(*task, err, true) {
			deferErr := s.deferImageRecovery(*task)
			return taskruntime.Outcome{Kind: taskruntime.KindSuspended, Err: deferErr, Applied: deferErr == nil, ProviderAccepted: true}
		}
		return persistenceFailureOutcome(terminal, task, err, true)
	}
	termErr := terminal.handleSuccess(task)
	return taskruntime.Outcome{Kind: taskruntime.KindCompleted, Err: termErr, Applied: true, ProviderAccepted: true}
}

func leaseLostOutcome(session taskruntime.Session, providerAccepted bool) taskruntime.Outcome {
	err := session.LostErr()
	if err == nil {
		err = taskruntime.ErrLeaseLost
	}
	kind := taskruntime.KindLeaseLost
	if providerAccepted {
		kind = taskruntime.KindUncertain
	}
	return taskruntime.Outcome{
		Kind:             kind,
		Err:              fmt.Errorf("任务租约失效，停止保存上游结果：%w", err),
		ProviderAccepted: providerAccepted,
	}
}

func executionFailureOutcome(terminal *taskTerminalCoordinator, task *model.Task, err error, providerSucceeded, providerAccepted, channelSlotFailedBeforeRequest bool) taskruntime.Outcome {
	termErr := terminal.handleExecutionFailure(task, err, providerSucceeded, channelSlotFailedBeforeRequest)
	if errors.Is(err, context.Canceled) && termErr == nil {
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Applied: true, ProviderAccepted: providerAccepted}
	}
	kind := taskruntime.KindFailed
	var imageRecovery imageRecoveryError
	var unknown providerSubmissionUnknownError
	if errors.As(err, &imageRecovery) || errors.As(err, &unknown) {
		kind = taskruntime.KindUncertain
	}
	return taskruntime.Outcome{Kind: kind, Err: termErr, Applied: terminalWriteApplied(termErr, err), ProviderAccepted: providerAccepted}
}

func persistenceFailureOutcome(terminal *taskTerminalCoordinator, task *model.Task, err error, providerAccepted bool) taskruntime.Outcome {
	handled, termErr := terminal.handleResultPersistenceFailure(task, err)
	if handled {
		return taskruntime.Outcome{Kind: taskruntime.KindCancelled, Err: termErr, Applied: termErr == nil, ProviderAccepted: providerAccepted}
	}
	return taskruntime.Outcome{Kind: taskruntime.KindFailed, Err: termErr, Applied: terminalWriteApplied(termErr, err), ProviderAccepted: providerAccepted}
}

func terminalWriteApplied(termErr, cause error) bool {
	if termErr == nil {
		return true
	}
	var joined interface{ Unwrap() []error }
	if errors.As(termErr, &joined) {
		return false
	}
	return cause != nil && errors.Is(termErr, cause)
}

func taskUsesUpstreamReportedProgress(taskType string) bool {
	return taskType == "canvas_image"
}

func taskFailureMessage(err error) string {
	if err == nil {
		return persistableTaskFailureMessage(err)
	}
	return truncateRunes(persistableTaskFailureMessage(err), 2_000)
}

func taskExecutionTimeoutWithPolicy(taskType string, policy RuntimeTaskPolicy) time.Duration {
	if taskType == "canvas_image" { return time.Duration(policy.ImageTimeoutMinutes) * time.Minute }
	return time.Duration(policy.DefaultTimeoutMinutes) * time.Minute
}

func taskTimeoutMessage(taskType string) string {
	if strings.HasPrefix(taskType, "canvas_image") {
		return "图片生成等待超时，请稍后重试。"
	}
	return "任务执行超时，请稍后重试。"
}
