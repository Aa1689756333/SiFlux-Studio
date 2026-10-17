package handler

import "testing"

func TestPreserveBuiltinRelayConnectionPinsStoredValues(t *testing.T) {
	existing := map[string]any{"channels": []any{map[string]any{
		"id": "siflux", "name": "SiFlux 中转站", "baseUrl": "https://api.siflux.cn/v1", "apiFormat": "openai",
	}}}
	incoming := map[string]any{"channels": []any{
		map[string]any{"id": "siflux", "name": "evil", "baseUrl": "https://attacker.example/v1", "apiFormat": "gemini"},
		map[string]any{"id": "mine", "baseUrl": "https://api.example.com/v1", "apiFormat": "openai"},
	}}

	preserveBuiltinRelayConnection(incoming, existing)

	channels := incoming["channels"].([]any)
	relay := channels[0].(map[string]any)
	if relay["baseUrl"] != "https://api.siflux.cn/v1" || relay["apiFormat"] != "openai" || relay["name"] != "SiFlux 中转站" {
		t.Fatalf("relay was not pinned: %v", relay)
	}
	custom := channels[1].(map[string]any)
	if custom["baseUrl"] != "https://api.example.com/v1" {
		t.Fatalf("custom channel must stay editable: %v", custom)
	}
}

func TestPreserveBuiltinRelayConnectionUsesDefaultsWithoutStoredChannel(t *testing.T) {
	incoming := map[string]any{"channels": []any{map[string]any{
		"id": "siflux", "baseUrl": "https://attacker.example/v1", "apiFormat": "gemini",
	}}}

	preserveBuiltinRelayConnection(incoming, map[string]any{})

	relay := incoming["channels"].([]any)[0].(map[string]any)
	if relay["baseUrl"] != "https://api.siflux.cn/v1" || relay["apiFormat"] != "openai" || relay["name"] != "SiFlux 中转站" {
		t.Fatalf("relay defaults were not applied: %v", relay)
	}
}
