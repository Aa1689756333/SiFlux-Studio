package workspace

import (
	"testing"

	"infinite-canvas/backend/internal/providerpreset"
)

func TestBuiltinRelayPresetOwnsIdentityAndKeepsLocalCredential(t *testing.T) {
	preset, ok := providerpreset.BuiltinPreset("siflux")
	if !ok {
		t.Fatal("builtin relay preset missing")
	}
	channel, err := presetChannelMap(preset, map[string]any{"baseUrl": "https://elsewhere.example/v1", "apiKey": "stored", "models": []any{"custom-model"}})
	if err != nil {
		t.Fatal(err)
	}
	if channel["id"] != "siflux" || channel["name"] != "SiFlux 中转站" || channel["baseUrl"] != "https://api.siflux.cn/v1" {
		t.Fatalf("preset identity must stay authoritative: %#v", channel)
	}
	if channel["apiFormat"] != "openai" || channel["pinned"] != true || channel["scope"] != "user" {
		t.Fatalf("preset channel metadata changed: %#v", channel)
	}
	if channel["apiKey"] != "stored" {
		t.Fatalf("local credential must survive: %#v", channel)
	}
	if models := channel["models"].([]string); len(models) != 1 || models[0] != "custom-model" {
		t.Fatalf("models = %#v", models)
	}
}

func TestMergeRetiresStoredHostedManagedChannelOnly(t *testing.T) {
	stored := map[string]map[string]any{
		// The retired production preset wrote this origin, so a stored copy must go.
		"hosted-origin": {"id": "beefapi", "baseUrl": "https://beeftv.app/v1", "apiKey": "stored"},
		// Everything else stays addressable, including the managed-credential lookup.
		"legacy-enterprise-origin": {"id": "beefapi", "baseUrl": "https://enterprise.beefapi.com"},
		"self-hosted-origin":       {"id": "beefapi", "baseUrl": "https://private-provider.test/v1"},
		"no-origin":                {"id": "beefapi", "apiKey": "stored"},
	}
	for name, channel := range stored {
		t.Run(name, func(t *testing.T) {
			merged, err := mergeBuiltinProviderPresets(map[string]any{"channels": []any{channel}})
			if err != nil {
				t.Fatal(err)
			}
			_, found := mergedChannelByID(t, merged, "beefapi")
			if want := !isRetiredManagedChannel(channel); found != want {
				t.Fatalf("channel presence = %v, want %v for %#v", found, want, channel)
			}
		})
	}
}

func mergedChannelByID(t *testing.T, config map[string]any, id string) (map[string]any, bool) {
	t.Helper()
	channels, ok := config["channels"].([]any)
	if !ok {
		t.Fatalf("merged config has no channel list: %#v", config)
	}
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if ok && channel["id"] == id {
			return channel, true
		}
	}
	return nil, false
}
