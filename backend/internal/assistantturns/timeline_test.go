package assistantturns_test

import (
	"testing"

	"infinite-canvas/backend/internal/assistantturns"
)

func TestTimelineChangeCannotAuthorizeOtherDocumentDifferences(t *testing.T) {
	before := map[string]any{"nodes": []any{map[string]any{"id": "n", "title": "original"}}, "connections": []any{}, "timeline": map[string]any{"durationMs": 1000}, "title": "keep", "plugin": "keep"}
	after := map[string]any{"nodes": before["nodes"], "connections": before["connections"], "timeline": map[string]any{"durationMs": 2000}, "title": "keep", "plugin": "keep"}
	change := &assistantturns.Change{TimelineUpdated: true}
	if !assistantturns.MatchesChange(before, after, change) {
		t.Fatal("timeline diff rejected")
	}
	after["plugin"] = "unrelated"
	if assistantturns.MatchesChange(before, after, change) {
		t.Fatal("arbitrarydiff accepted")
	}
	after["plugin"] = "keep"
	after["nodes"] = []any{map[string]any{"id": "n", "title": "unexpected"}}
	if assistantturns.MatchesChange(before, after, change) {
		t.Fatal("undeclarednode diff accepted")
	}
	change.UpdatedNodeIDs = []string{"n"}
	if !assistantturns.MatchesChange(before, after, change) {
		t.Fatal("declarednode+timeline rejected")
	}
	after["nodes"] = []any{map[string]any{"id": "n", "title": "unexpected"}, map[string]any{"id": "new", "title": "created then edited"}}
	change.CreatedNodeIDs = []string{"new"}
	change.UpdatedNodeIDs = []string{"n", "new"}
	if !assistantturns.MatchesChange(before, after, change) {
		t.Fatal("created then updated node rejected")
	}
}
