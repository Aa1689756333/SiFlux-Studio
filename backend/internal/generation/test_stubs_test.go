package generation

import (
	"context"
	"net/http"
	"sync"
	"time"
)

// 本文件提供生成执行器测试共用的最小桩；只在测试构建中编译。

type passImagePort struct{}

func (passImagePort) Intercept(*http.Request) (bool, []byte, string, error) {
	return false, nil, "", nil
}

type nopReceipts struct{}

func (nopReceipts) Observe(TransportObservation)              {}
func (nopReceipts) NotifyPoll(context.Context, string, error) {}
func (nopReceipts) SyncProgress(string, []byte)               {}

type recordingReceipts struct {
	mu    sync.Mutex
	calls []TransportObservation
}

func (r *recordingReceipts) Observe(observation TransportObservation) {
	r.mu.Lock()
	defer r.mu.Unlock()
	r.calls = append(r.calls, observation)
}

func (r *recordingReceipts) NotifyPoll(context.Context, string, error) {}
func (r *recordingReceipts) SyncProgress(string, []byte)               {}

func (r *recordingReceipts) snapshot() []TransportObservation {
	r.mu.Lock()
	defer r.mu.Unlock()
	return append([]TransportObservation(nil), r.calls...)
}

type stubLimits struct {
	limit int
}

func (s stubLimits) GeneratedFileBytes(context.Context) (int64, error)  { return 64 << 20, nil }
func (s stubLimits) ResourceUploadBytes(context.Context) (int64, error) { return 64 << 20, nil }
func (s stubLimits) CircuitOpen(context.Context, string) (bool, error)  { return false, nil }
func (s stubLimits) AcquireChannelSlot(context.Context, string, string, time.Duration) (func(), int, error) {
	return func() {}, s.limit, nil
}
func (s stubLimits) RecordChannelResult(context.Context, string, bool) error { return nil }

func taskRuntime(extras ...func(*Runtime)) Runtime {
	runtime := Runtime{
		Images:   passImagePort{},
		Receipts: nopReceipts{},
		Limits:   stubLimits{limit: 1},
		Call:     CallMeta{UserID: "user-1", TaskID: "task-1"},
	}
	for _, extra := range extras {
		extra(&runtime)
	}
	return runtime
}
