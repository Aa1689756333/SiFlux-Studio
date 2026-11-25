package app

import (
	"net/http"
	"testing"
	"time"

	"infinite-canvas/backend/internal/generation"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/modelcatalog"
)

func routeUnknownFixture(t *testing.T) (*Service, *model.Task, *model.RouteAttempt) {
	t.Helper()
	svc, db := newTimelineTaskTestService(t)
	task := &model.Task{ID: "tsk-unknown-route", UserID: "usr-1", Type: "canvas_video", Status: model.TaskStatusRunning, LogicalModelID: "lm-1"}
	if err := db.Create(task).Error; err != nil {
		t.Fatal(err)
	}
	attempt := &model.RouteAttempt{ID: "attempt-1", TaskID: task.ID, Status: "dispatching", DispatchState: "not_sent", StartedAt: time.Now()}
	if err := svc.repo.CreateRouteAttempt(attempt); err != nil {
		t.Fatal(err)
	}
	return svc, task, attempt
}

func TestUnknownRouteFailureDoesNotRecoverNestedRejectionEvidence(t *testing.T) {
	svc, task, attempt := routeUnknownFixture(t)
	err := generation.SubmissionUnknownError{Cause: generation.HTTPError{StatusCode: http.StatusTooManyRequests, Body: `{"error":{"code":"rate_limit"}}`}}
	svc.finishTaskRouteAttempt(attempt, task, err)
	stored, loadErr := svc.repo.LatestRouteAttempt(task.ID)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if stored.DispatchState != "submission_unknown" || stored.FailureCode != "submission_unknown" {
		t.Fatalf("unknown receipt leaked nested evidence: %+v", stored)
	}
	next, nextErr := svc.nextRouteAttemptAfterFailure(task, stored, err)
	if nextErr != nil {
		t.Fatal(nextErr)
	}
	if next != nil {
		t.Fatalf("unknown receipt switched routes: %#v", next)
	}
}

func TestIndependentPreparationRemainsRejectedNoJobForRoutes(t *testing.T) {
	svc, task, attempt := routeUnknownFixture(t)
	err := generation.RequestPreparationError{Cause: generation.HTTPError{StatusCode: http.StatusServiceUnavailable, Body: `{"error":{"code":"image_reference_upload_failed"}}`}}
	svc.finishTaskRouteAttempt(attempt, task, err)
	stored, loadErr := svc.repo.LatestRouteAttempt(task.ID)
	if loadErr != nil {
		t.Fatal(loadErr)
	}
	if stored.DispatchState != "rejected_no_job" || stored.FailureCode != "request_not_sent" && stored.FailureCode != "upstream_503" {
		t.Fatalf("independent preparation dispatch = %+v", stored)
	}
	if !modelcatalog.ShouldSwitchRouteAfterFailure(task, stored, routeFailureInfo(err)) {
		t.Fatal("independent preparation should remain eligible to switch routes")
	}
}
