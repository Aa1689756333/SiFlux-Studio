package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync/atomic"
	"testing"

	"gorm.io/gorm"
	"infinite-canvas/backend/internal/database"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)


// This uses the product migration, admission and worker with a disk database.
// All provider traffic terminates at this test's loopback fixture.
func TestDBRuntimeGenerationMatrix(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	for _, mode := range []string{"image"} {
		for _, outcome := range []string{"success", "failure"} {
			t.Run(mode+"/"+outcome, func(t *testing.T) {
				var posts atomic.Int64
				upstream := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					w.Header().Set("Content-Type", "application/json")
					w.Header().Set("X-Request-ID", "matrix-request")
					if r.Method == http.MethodPost {
						posts.Add(1)
					}
					if outcome == "failure" {
						w.WriteHeader(400)
						_, _ = w.Write([]byte(`{"error":{"code":"invalid_size","message":"fixture rejection"}}`))
						return
					}
					switch r.URL.Path {
					case "/v1/images/generations":
						_, _ = w.Write([]byte(`{"data":[{"b64_json":"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a9l8AAAAASUVORK5CYII="}]}`))
					default:
						t.Errorf("unexpected provider request %s %s", r.Method, r.URL.Path)
						http.NotFound(w, r)
					}
				}))
				defer upstream.Close()
				dir := t.TempDir()
				s, db := openDBRuntimeMatrix(t, dir)
				task, err := s.CreateTask("local", dbRuntimeRequest(mode, upstream.URL))
				if err != nil {
					t.Fatal(err)
				}
				workerErr := s.taskWorker().processNextTask()
				if outcome == "success" && workerErr != nil {
					t.Fatal(workerErr)
				}
				closeDBRuntimeMatrix(t, s, db)
				s, db = openDBRuntimeMatrix(t, dir)
				defer closeDBRuntimeMatrix(t, s, db)
				stored, err := s.repo.Task(task.ID)
				if err != nil {
					t.Fatal(err)
				}
				want := model.TaskStatusSucceeded
				if outcome == "failure" {
					want = model.TaskStatusFailed
				}
				if stored.Status != want {
					t.Fatalf("status=%s stage=%s error=%s worker=%v", stored.Status, stored.Stage, stored.Error, workerErr)
				}
				if posts.Load() != 1 {
					t.Fatalf("provider submissions=%d", posts.Load())
				}
				if outcome == "failure" {
					rows, err := s.TasksWithOptions("local", TaskListOptions{Limit: 10})
					if err != nil || len(rows) != 1 || rows[0].FailureDiagnostics == nil {
						t.Fatalf("restored diagnostic list=%+v err=%v", rows, err)
					}
					d := rows[0].FailureDiagnostics
					if d.RequestID != "matrix-request" || len(d.Requests) == 0 || d.Requests[0].HTTPStatus != 400 {
						t.Fatalf("persisted diagnostics=%+v", d)
					}
				} else {
					raw, _ := json.Marshal(stored)
					if !strings.Contains(string(raw), "resource:") {
						t.Fatalf("persisted media output missing: %s", raw)
					}
				}
				t.Logf("disk reopen: task=%s mode=%s outcome=%s submissions=%d", task.ID, mode, outcome, posts.Load())
			})
		}
	}
}

func dbRuntimeRequest(mode, base string) CreateTaskRequest {
	protocol := map[string]string{"image": "openai-image"}[mode]
	return CreateTaskRequest{Type: "canvas_" + mode, Prompt: "matrix fixture", Input: map[string]any{"mode": mode, "config": map[string]any{"baseUrl": base, "apiKey": "fixture-key", "model": "fixture-model", "interfaceType": protocol}}}
}

func openDBRuntimeMatrix(t *testing.T, dir string) (*Service, *gorm.DB) {
	t.Helper()
	db, err := database.Open(database.Config{DataDir: dir})
	if err != nil {
		t.Fatal(err)
	}
	if err = database.ConfigurePool(db); err != nil {
		t.Fatal(err)
	}
	if err = database.MigrateLocalSchema(db); err != nil {
		t.Fatal(err)
	}
	return NewLocal(repository.New(db), dir), db
}

func closeDBRuntimeMatrix(t *testing.T, s *Service, db *gorm.DB) {
	t.Helper()
	if err := s.Close(); err != nil {
		t.Error(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	if err := sqlDB.Close(); err != nil {
		t.Error(err)
	}
}