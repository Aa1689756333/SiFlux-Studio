package bootstrap

import (
	"context"
	"encoding/json"
	"net/http"
	"reflect"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func seedOpsAcceptanceCanvas(t *testing.T, h *desktopHarness) (string, string, int64) {
	t.Helper()
	owner, err := h.rt.service.LocalWorkspaceOwner()
	if err != nil {
		t.Fatal(err)
	}
	const id = "ops-acceptance"
	_, err = h.rt.service.UpsertUserCanvasProject(owner.ID, []byte(`{"id":"ops-acceptance","title":"Acceptance","revision":0,"nodes":[{"id":"n1","type":"image","title":"Original","position":{"x":0,"y":0}},{"id":"n2","type":"image","title":"Other","position":{"x":400,"y":0}}],"connections":[]}`))
	if err != nil {
		t.Fatal(err)
	}
	raw, err := h.rt.service.UserCanvasProject(owner.ID, id)
	if err != nil {
		t.Fatal(err)
	}
	var doc struct {
		Revision int64 `json:"revision"`
	}
	if err := json.Unmarshal(raw, &doc); err != nil {
		t.Fatal(err)
	}
	return owner.ID, id, doc.Revision
}

func acceptanceJSON(t *testing.T, value any) string {
	t.Helper()
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	return string(raw)
}

func restartOpsAcceptanceRuntime(t *testing.T, h *desktopHarness) {
	t.Helper()
	if err := h.rt.Close(context.Background()); err != nil {
		t.Fatal(err)
	}
	rt, err := Open(context.Background(), Config{Profile: ProfileDesktop, DataDir: h.dataDir, ListenAddr: "127.0.0.1:0", AutoMigrate: true})
	if err != nil {
		t.Fatal(err)
	}
	h.rt = rt
	// Later phases reuse this runtime, so its lifetime belongs to the parent test.
	h.t.Cleanup(func() { _ = rt.Close(context.Background()) })
}

// 操作回执的幂等与跨重启回放：同一 opId + 同一 payload 只写入一次，
// 相同 opId 换 payload 被拒绝。
func TestOpsAcceptanceReplaySurvivesRestart(t *testing.T) {
	h := newDesktopHarness(t)
	userID, canvasID, revision := seedOpsAcceptanceCanvas(t, h)
	params := map[string]any{"canvasId": canvasID, "expectedRevision": revision, "nodes": []any{map[string]any{"type": "image", "title": "Created once"}}}
	body := acceptanceJSON(t, map[string]any{"opId": "persistent-write", "params": params})
	call := func(body string) (map[string]any, string, int) {
		w := h.desktopUI(http.MethodPost, "/ops/canvas.nodes.create", body)
		data, reason := decodeEnvelope(t, w)
		return data, reason, w.Code
	}
	first, reason, status := call(body)
	if status != http.StatusOK || first["replayed"] != false {
		t.Fatalf("initial write: %d %s %#v", status, reason, first)
	}
	for _, phase := range []string{"same-runtime", "reopened-database"} {
		t.Run(phase, func(t *testing.T) {
			if phase == "reopened-database" {
				restartOpsAcceptanceRuntime(t, h)
			}
			replayed, reason, status := call(body)
			if status != http.StatusOK || replayed["replayed"] != true || !reflect.DeepEqual(first["result"], replayed["result"]) {
				t.Fatalf("replay mismatch: %d %s %#v", status, reason, replayed)
			}
			changed := map[string]any{"canvasId": canvasID, "expectedRevision": revision, "nodes": []any{map[string]any{"type": "image", "title": "Changed payload"}}}
			_, reason, status = call(acceptanceJSON(t, map[string]any{"opId": "persistent-write", "params": changed}))
			if status != http.StatusConflict || reason != "operation_id_reused_with_different_payload" {
				t.Fatalf("changed payload: %d %s", status, reason)
			}
			raw, err := h.rt.service.UserCanvasProject(userID, canvasID)
			if err != nil {
				t.Fatal(err)
			}
			var doc struct {
				Revision int64 `json:"revision"`
				Nodes    []any `json:"nodes"`
			}
			if err := json.Unmarshal(raw, &doc); err != nil {
				t.Fatal(err)
			}
			if doc.Revision != revision+1 || len(doc.Nodes) != 3 {
				t.Fatalf("duplicate mutation: %+v", doc)
			}
			var count int64
			if err := h.rt.db.Model(&model.AgentOpRecord{}).Where("user_id = ? AND op_id = ?", userID, "persistent-write").Count(&count).Error; err != nil {
				t.Fatal(err)
			}
			if count != 1 {
				t.Fatalf("operation record count = %d", count)
			}
		})
	}
}
