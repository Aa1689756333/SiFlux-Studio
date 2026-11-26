package app

import (
	"errors"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/repository"
)

func TestRouteCatalogFailureStormAndInvalidatedStaleSnapshot(t *testing.T) {
	db, err := gorm.Open(sqlite.Open(":memory:"), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	wantErr := errors.New("injected database outage")
	var queries atomic.Int32
	if err := db.Callback().Query().Before("gorm:query").Register("catalog-outage", func(tx *gorm.DB) { queries.Add(1); tx.AddError(wantErr) }); err != nil {
		t.Fatal(err)
	}
	svc := &Service{repo: repository.New(db), routeCatalogTTL: time.Second, routeCatalogMaxStale: time.Minute}
	router := svc.ensureRouter()
	var wg sync.WaitGroup
	for range 50 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
				t.Errorf("outage error lost: %v", err)
			}
		}()
	}
	wg.Wait()
	if queries.Load() != 1 {
		t.Fatalf("failure storm retried DB %d times", queries.Load())
	}
	router.TestingReplaceSnapshot(&routeCatalogSnapshot{LoadedAt: time.Now().Add(-2 * time.Second), CatalogVersion: 0})
	if _, err := svc.routeCatalogSnapshot(); err != nil {
		t.Fatalf("existing same-version bounded fallback lost: %v", err)
	}
	router.TestingSetVersion(1)
	if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
		t.Fatal("explicitly invalidated version was served stale")
	}
	svc.invalidateRouteCatalog()
	if _, err := svc.routeCatalogSnapshot(); !errors.Is(err, wantErr) {
		t.Fatal(err)
	}
	if queries.Load() != 2 {
		t.Fatal("invalidation failed to reset refresh cooldown")
	}
}