package canvas

import (
	"encoding/json"
	"errors"
	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/repository"
	"net/http"
	"path/filepath"
	"testing"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
)

func TestCanvasSaveRevisionContract(t *testing.T) {
	svc := newCanvasHistoryTestService(t)
	actor := &model.User{ID: "owner"}
	missing := json.RawMessage(`{"id":"canvas","nodes":[]}`)
	_, err := svc.UpsertUserCanvasProject(actor.ID, missing)
	var appError *kernel.AppError
	if !errors.As(err, &appError) || appError.Status != http.StatusPreconditionRequired {
		t.Fatalf("unversioned save = %v", err)
	}
	raw := json.RawMessage(`{"id":"canvas","revision":0,"title":"initial","nodes":[{"id":"old","type":"image"}],"viewport":{"x":999,"y":0,"k":2}}`)
	created, err := svc.UpsertUserCanvasProject(actor.ID, raw)
	if err != nil {
		t.Fatal(err)
	}
	if created.Revision != 1 {
		t.Fatalf("revision = %d", created.Revision)
	}
	update := json.RawMessage(`{"id":"canvas","revision":1,"title":"new","nodes":[{"id":"old","type":"image"},{"id":"node-2","type":"image"}],"updatedAt":"2099-01-01T00:00:00Z","remoteContentHash":"local-only","viewport":{"x":500,"y":10,"k":3}}`)
	saved, err := svc.UpsertUserCanvasProject(actor.ID, update)
	if err != nil {
		t.Fatal(err)
	}
	if saved.Revision != 2 || saved.UpdatedAt.Year() == 2099 {
		t.Fatalf("invalid server metadata: %#v", saved)
	}
	_, err = svc.UpsertUserCanvasProject(actor.ID, update)
	if !errors.As(err, &appError) || appError.Status != http.StatusConflict {
		t.Fatalf("stale save = %v", err)
	}
	got, err := svc.UserCanvasProject(actor.ID, "canvas")
	if err != nil {
		t.Fatal(err)
	}
	var project map[string]any
	if err := json.Unmarshal(got, &project); err != nil {
		t.Fatal(err)
	}
	if project["revision"] != float64(2) || len(project["nodes"].([]any)) != 2 {
		t.Fatalf("read lost metadata/content: %s", got)
	}
	if project["remoteContentHash"] != nil || project["viewport"].(map[string]any)["x"] != float64(0) {
		t.Fatalf("content save persisted local preferences: %s", got)
	}
	if _, err := svc.UserCanvasProject("unrelated", "canvas"); err == nil {
		t.Fatal("unrelated user could read canvas")
	}
}

func newCanvasHistoryTestService(t *testing.T) *Service {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(filepath.Join(t.TempDir(), "canvas.db")), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	if err := db.AutoMigrate(
		&model.CanvasProject{}, &model.CanvasSnapshot{}, &model.CanvasSnapshotResource{}, &model.CanvasUnitLink{},
		&model.Resource{}, &model.Asset{}, &model.AssetVersion{}, &model.AssetRepresentation{}, &model.AssetFolder{},
		&model.CanvasLibraryFolder{}, &model.CanvasDrawing{},
		&model.Task{}, &model.TaskLog{}, &model.Result{}, &model.TaskTextDelta{}, &model.ApiCallLog{},
		&model.CreationRun{}, &model.CreationSubmission{},
		&model.Project{}, &model.StyleProfile{}, &model.VoiceProfile{},
		&model.Shot{}, &model.ShotArtifact{}, &model.ShotAssetReference{},
		&model.ProjectAssetCandidate{}, &model.ProjectAssetLink{},
		&model.WorkflowInstance{}, &model.WorkflowStepInstance{},
		&model.CharacterVoiceBinding{}, &model.ArkPrivateAssetBinding{},
	); err != nil {
		t.Fatal(err)
	}
	sqlDB, _ := db.DB()
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return New(repository.New(db), nil)
}

func newCanvasLibraryTestPair(t *testing.T) (*Service, *Service, *gorm.DB) {
	t.Helper()
	svc := newCanvasHistoryTestService(t)
	return svc, New(svc.repo, nil), svc.repo.DB()
}

func migrateUploadSettlementTables(t *testing.T, db *gorm.DB) {
	t.Helper()
	if err := db.AutoMigrate(&model.UserDailyUploadUsage{}, &model.UserUploadReservation{}); err != nil {
		t.Fatal(err)
	}
}

func mustOpenSQLite(t *testing.T, path string) *gorm.DB {
	t.Helper()
	db, err := gorm.Open(sqlite.Open(path), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	sqlDB.SetMaxOpenConns(1)
	sqlDB.SetMaxIdleConns(1)
	t.Cleanup(func() { _ = sqlDB.Close() })
	return db
}
