package app

import (
	"encoding/json"
	"strings"

	"infinite-canvas/backend/internal/workspace"
)

// A legacy channel written by the retired managed channel. It is no longer created or offered;
// these helpers only keep already-stored configs redacted on read and intact on save.
const legacyManagedChannelID = "beefapi"

func cloneAnyMap(value map[string]any) (map[string]any, error) {
	if value == nil {
		return map[string]any{}, nil
	}
	body, err := json.Marshal(value)
	if err != nil {
		return nil, err
	}
	var clone map[string]any
	if err := json.Unmarshal(body, &clone); err != nil {
		return nil, err
	}
	return clone, nil
}

func findChannelByID(channels []any, id string) map[string]any {
	for _, raw := range channels {
		channel, ok := raw.(map[string]any)
		if ok && channel["id"] == id {
			return channel
		}
	}
	return nil
}

// RedactLegacyManagedChannel masks secrets of a stored legacy channel before it reaches the UI.
func RedactLegacyManagedChannel(config map[string]any) map[string]any {
	if config == nil {
		return config
	}
	redacted, err := cloneAnyMap(config)
	if err != nil {
		return config
	}
	channels, _ := redacted["channels"].([]any)
	for index, raw := range channels {
		channel, ok := raw.(map[string]any)
		if !ok {
			continue
		}
		id, _ := channel["id"].(string)
		if id != legacyManagedChannelID {
			continue
		}
		apiKey, _ := channel["apiKey"].(string)
		secretKey, _ := channel["secretKey"].(string)
		hasKey := strings.TrimSpace(apiKey) != "" || strings.TrimSpace(secretKey) != ""
		channel["apiKey"] = ""
		channel["secretKey"] = ""
		if hasKey {
			channel["hasApiKey"] = true
		}
		delete(channel, "encryptedApiKey")
		delete(channel, "deviceCode")
		delete(channel, "device_code")
		channels[index] = channel
	}
	redacted["channels"] = channels
	return redacted
}

// PreserveLegacyManagedChannel keeps a stored legacy channel's secrets and catalog when a save
// omits them, mirroring the previous managed=false behavior.
func PreserveLegacyManagedChannel(incoming, existing map[string]any) {
	if incoming == nil {
		return
	}
	incomingChannels, _ := incoming["channels"].([]any)
	existingChannels, _ := existing["channels"].([]any)
	previous := findChannelByID(existingChannels, legacyManagedChannelID)
	found := false
	for index, raw := range incomingChannels {
		channel, ok := raw.(map[string]any)
		if !ok || channel["id"] != legacyManagedChannelID {
			continue
		}
		found = true
		delete(channel, "deviceCode")
		delete(channel, "device_code")
		delete(channel, "encryptedApiKey")
		if previous != nil {
			channel["models"] = previous["models"]
			channel["modelProfiles"] = previous["modelProfiles"]
			if baseURL, _ := previous["baseUrl"].(string); strings.TrimSpace(baseURL) != "" {
				channel["baseUrl"] = previous["baseUrl"]
			}
			incomingKey, _ := channel["apiKey"].(string)
			if incomingKey == "" || incomingKey == workspace.RedactedSecret {
				if value, ok := previous["apiKey"]; ok {
					channel["apiKey"] = value
				}
			}
			incomingSecret, _ := channel["secretKey"].(string)
			if incomingSecret == "" || incomingSecret == workspace.RedactedSecret {
				if value, ok := previous["secretKey"]; ok {
					channel["secretKey"] = value
				}
			}
		}
		incomingChannels[index] = channel
	}
	if !found && previous != nil {
		cloned, err := cloneAnyMap(previous)
		if err == nil {
			delete(cloned, "deviceCode")
			delete(cloned, "device_code")
			delete(cloned, "encryptedApiKey")
			incomingChannels = append([]any{cloned}, incomingChannels...)
		}
	}
	incoming["channels"] = incomingChannels
}
