package main

import (
	"errors"
	"strings"

	"infinite-canvas/backend/internal/providerpreset"
	"infinite-canvas/backend/internal/relayconnect"

	wailsruntime "github.com/wailsapp/wails/v2/pkg/runtime"
)

// relayImportEvent notifies the frontend that a one-click configuration link
// arrived from the operating system while the window was already open.
const relayImportEvent = "relay:import"

// relayImport is the payload handed to the frontend. Channel configuration is
// owned by the frontend, so the key travels with it.
type relayImport struct {
	Name    string `json:"name,omitempty"`
	BaseURL string `json:"baseUrl"`
	APIKey  string `json:"apiKey"`
}

// isRelayLinkArg reports whether an argument is a one-click configuration link.
// Only the shape is checked here: a malformed link must not stop the application
// from starting, and acceptRelayLink validates the payload itself.
func isRelayLinkArg(arg string) bool {
	prefix := relayconnect.ImportScheme + "://"
	return len(arg) >= len(prefix) && strings.EqualFold(arg[:len(prefix)], prefix)
}

// relayLinkFromArgs returns the one-click configuration link of a launch. The
// operating system appends it when a registered protocol opens this application.
func relayLinkFromArgs(args []string) string {
	for _, arg := range args {
		if isRelayLinkArg(arg) {
			return arg
		}
	}
	return ""
}

// acceptRelayLink validates a link and queues it for the frontend. Links that do
// not belong to the relay this build ships with are refused: the operating system
// hands these over from whatever page the user happened to visit.
func (a *DesktopApp) acceptRelayLink(link string) bool {
	trimmed := strings.TrimSpace(link)
	if trimmed == "" {
		return false
	}
	payload, err := relayconnect.ParseImportLink(trimmed)
	if err != nil {
		return false
	}
	origin, err := relayconnect.OriginOf(payload.BaseURL)
	if err != nil {
		return false
	}
	expected, err := relayOrigin()
	if err != nil || origin != expected {
		return false
	}
	queued := &relayImport{Name: payload.Name, BaseURL: payload.BaseURL, APIKey: payload.APIKey}
	a.mu.Lock()
	a.relayPending = queued
	// The window may not exist yet on a protocol launch, so the event is skipped
	// and the frontend picks the payload up through TakeRelayImport instead.
	ctx := a.wailsCtx
	a.mu.Unlock()
	if ctx != nil {
		wailsruntime.EventsEmit(ctx, relayImportEvent, queued)
	}
	return true
}

// takeRelayImport hands the queued import to the frontend and forgets it. It is
// served over the desktop asset server rather than exposed as a bound method so
// the reflected Wails surface stays as small as its guard test requires.
func (a *DesktopApp) takeRelayImport() *relayImport {
	a.mu.Lock()
	defer a.mu.Unlock()
	pending := a.relayPending
	a.relayPending = nil
	return pending
}

// relayOrigin reports the origin of the built-in relay channel.
func relayOrigin() (string, error) {
	preset, ok := providerpreset.BuiltinPreset("siflux")
	if !ok {
		return "", errors.New("内置中转站预设缺失")
	}
	return relayconnect.OriginOf(preset.BaseURL)
}
