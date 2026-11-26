package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/protocol"
)

func TestPluginViewIncludesDocumentationForEveryOfficialProtocol(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	plugins := center.list()
	pluginsByID := make(map[string]PluginView, len(plugins))
	for _, plugin := range plugins {
		pluginsByID[plugin.Manifest.ID] = plugin
	}
	packages, err := filepath.Glob(filepath.Join("..", "..", "..", "plugin-packages", "*.siflux-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	localPackages := 0
	packageIDs := make(map[string]bool, len(packages))
	for _, packagePath := range packages {
		if strings.HasPrefix(filepath.Base(packagePath), "official-payment-") {
			continue
		}
		data, err := os.ReadFile(packagePath)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := protocol.ParsePluginPackage(data)
		if err != nil {
			t.Fatal(err)
		}
		localPackages++
		packageIDs[pkg.Manifest.Metadata.ID] = true
	}
	expectedCount := localPackages
	for _, manifest := range bundledWorkflowPluginManifests() {
		if !packageIDs[manifest.Metadata.ID] {
			expectedCount++
		}
	}
	if len(plugins) != expectedCount {
		t.Fatalf("plugin views = %d, unique local packages plus bundled plugins = %d", len(plugins), expectedCount)
	}
	for _, packagePath := range packages {
		if strings.HasPrefix(filepath.Base(packagePath), "official-payment-") {
			continue
		}
		data, err := os.ReadFile(packagePath)
		if err != nil {
			t.Fatal(err)
		}
		pkg, err := protocol.ParsePluginPackage(data)
		if err != nil {
			t.Fatalf("parse %s: %v", filepath.Base(packagePath), err)
		}
		plugin, ok := pluginsByID[pkg.Manifest.Metadata.ID]
		if !ok {
			t.Errorf("fresh runtime did not install official plugin %q", pkg.Manifest.Metadata.ID)
			continue
		}
		expectedSource := PluginOriginOfficial
		if plugin.Source != expectedSource {
			t.Errorf("plugin %q source = %q, want %s", plugin.Manifest.ID, plugin.Source, expectedSource)
		}
		expected := strings.TrimSpace(string(pkg.Files["README.md"])) + "\n\n---\n\n" + strings.TrimSpace(string(pkg.Files["docs/interface.md"]))
		if strings.TrimSpace(plugin.Manifest.Documentation) != expected {
			t.Errorf("freshly installed plugin %q did not expose its complete packaged documentation", plugin.Manifest.ID)
		}
		if !strings.Contains(plugin.Manifest.Documentation, "## Manifest 完整接口定义") {
			t.Errorf("freshly installed plugin %q has no embedded full manifest contract", plugin.Manifest.ID)
		}
	}
}

func TestPluginRuntimeRefreshesExistingOfficialPackageDocumentation(t *testing.T) {
	packagePath := filepath.Join("..", "..", "..", "plugin-packages", "openai-images.siflux-plugin")
	packageData, err := os.ReadFile(packagePath)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := protocol.ParsePluginPackage(packageData)
	if err != nil {
		t.Fatal(err)
	}
	stale := pkg.Manifest
	stale.Metadata.Documentation = "# OpenAI Images\n\n旧版本摘要。"
	stale.Metadata.Enabled = false
	staleRaw, err := json.Marshal(stale)
	if err != nil {
		t.Fatal(err)
	}
	registryData, err := json.Marshal([]pluginRegistryRecord{{
		ID: pkg.Manifest.Metadata.ID, Raw: staleRaw, Source: PluginOriginOfficial,
		FileName: filepath.Base(packagePath), PackageSHA256: "stale-package-hash",
	}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}

	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, plugin := range center.list() {
		if plugin.Manifest.ID != pkg.Manifest.Metadata.ID {
			continue
		}
		expected := strings.TrimSpace(string(pkg.Files["README.md"])) + "\n\n---\n\n" + strings.TrimSpace(string(pkg.Files["docs/interface.md"]))
		if strings.TrimSpace(plugin.Manifest.Documentation) != expected {
			t.Fatal("existing official plugin kept stale documentation instead of importing the rebuilt package")
		}
		if plugin.Status != "disabled" {
			t.Fatalf("official plugin enabled state was not preserved during refresh: %s", plugin.Status)
		}
		if plugin.SHA256 == "" || plugin.SHA256 == "stale-package-hash" {
			t.Fatalf("official plugin package hash was not refreshed: %q", plugin.SHA256)
		}
		return
	}
	t.Fatal("refreshed OpenAI Images plugin is missing")
}

func TestBundledWorkflowPluginsControlAvailability(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	svc := &Service{pluginRuntime: center}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-image"); err == nil {
		t.Fatal("bundled RunningHub plugin was enabled by default")
	}
	if _, err := center.setEnabled(WorkflowPluginRunningHub, true); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-image"); err != nil {
		t.Fatalf("enabled RunningHub plugin rejected: %v", err)
	}
	if _, err := center.setEnabled(WorkflowPluginRunningHub, false); err != nil {
		t.Fatal(err)
	}
	if err := svc.RequireWorkflowPluginForInterface("runninghub-workflow-video"); err == nil {
		t.Fatal("disabled RunningHub plugin remained available")
	}
	if got := svc.WorkflowPluginStatuses()[WorkflowPluginRunningHub]; got != "disabled" {
		t.Fatalf("RunningHub status = %q, want disabled", got)
	}
}

func TestBundledProviderCatalogExposesUpstreamOperation(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	catalog := (&Service{pluginRuntime: center}).PluginProviderCatalog(string(protocol.SurfaceAdminSystemChannel), string(protocol.CapabilityVideo), false)
	for _, item := range catalog {
		if item.ID != "xai-video" {
			continue
		}
		if item.Create != "POST /v1/videos/generations" || strings.Contains(item.Create, "__host__") {
			t.Fatalf("xAI catalog create operation = %q", item.Create)
		}
		return
	}
	t.Fatal("xAI bundled provider missing from administrator catalog")
}

func TestPluginRuntimeIsTheProtocolSourceOfTruth(t *testing.T) {
	dataDir := t.TempDir()
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if got := center.registrySnapshot().List("", "", false); len(got) == 0 {
		t.Fatal("bundled providers were not reconciled into the unified plugin registry")
	}
	if _, err := center.install([]byte(`{"apiVersion":"siflux.plugin/v1"}`), "legacy.json"); err == nil {
		t.Fatal("bare JSON manifest was accepted by the upload runtime")
	}
	manifest := []byte(`{"apiVersion":"siflux.plugin/v1","id":"uploaded-runtime","version":"1.0.0","name":"Uploaded Runtime","author":"Test","documentation":"# Uploaded Runtime","contributes":{"providers":[{"id":"uploaded-runtime","label":"Uploaded Runtime","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"prompt":"request.prompt"}},"response":{"statusPaths":["status"]}}]}}`)
	plugin, err := center.install(testPluginPackage(t, manifest), "uploaded-runtime.siflux-plugin")
	if err != nil {
		t.Fatal(err)
	}
	if plugin.Status != "enabled" || !center.registrySnapshot().IsCapability("uploaded-runtime", protocol.CapabilityVideo) {
		t.Fatalf("installed plugin was not activated: %#v", plugin)
	}
	updatedManifest := []byte(`{"apiVersion":"siflux.plugin/v1","id":"uploaded-runtime","version":"2.0.0","name":"Uploaded Runtime v2","author":"Test","documentation":"# Uploaded Runtime v2","contributes":{"providers":[{"id":"uploaded-runtime","label":"Uploaded Runtime v2","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","fields":{"prompt":"request.prompt"}},"response":{"statusPaths":["status"]}}]}}`)
	updated, err := center.install(testPluginPackage(t, updatedManifest), "uploaded-runtime-v2.siflux-plugin")
	if err != nil || updated.Manifest.Version != "2.0.0" || updated.Manifest.Name != "Uploaded Runtime v2" {
		t.Fatalf("plugin update = %#v, err = %v", updated, err)
	}
	if _, err := center.setEnabled("uploaded-runtime", false); err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("uploaded-runtime"); !ok {
		t.Fatal("disabled plugin was removed from registry snapshot instead of being represented as unavailable")
	}
	if center.registrySnapshot().IsCapability("uploaded-runtime", protocol.CapabilityVideo) {
		t.Fatal("disabled plugin remained selectable")
	}
	if err := center.uninstall("uploaded-runtime"); err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("uploaded-runtime"); ok {
		t.Fatal("uninstalled plugin remained selectable")
	}
}

func TestSeedanceLegacyProtocolResolvesInstalledProvider(t *testing.T) {
	dataDir := t.TempDir()
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"newapi", "openai-video", "openai-videos"} {
		adapter, ok := center.registrySnapshot().Resolve(id)
		if !ok || adapter.Metadata().ID != "newapi" {
			t.Fatalf("%s did not resolve installed newapi provider", id)
		}
		if err := validateGenerationInterfaceWithRegistry(center.registrySnapshot(), "video", id); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := center.setEnabled("openai-videos", false); err != nil {
		t.Fatal(err)
	}
	// Restart must preserve disabled state for the canonical ID and old profiles.
	center, err = newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, id := range []string{"newapi", "openai-video", "openai-videos"} {
		adapter, ok := center.registrySnapshot().Resolve(id)
		if !ok || adapter.Metadata().Enabled {
			t.Fatalf("%s bypassed disabled plugin", id)
		}
		if err := validateGenerationInterfaceWithRegistry(center.registrySnapshot(), "video", id); err == nil {
			t.Fatalf("%s accepted disabled plugin", id)
		}
	}
}

func TestPluginRuntimeDropsRemovedOfficialProtocol(t *testing.T) {
	staleManifest := json.RawMessage(`{"apiVersion":"siflux.plugin/v2","id":"removed-official-protocol","version":"1.0.0","name":"Removed Official Protocol","author":"Test","documentation":"# Removed\n\n## SiFlux运行时合同","contributes":{"providers":[{"id":"removed-official-protocol","label":"Removed","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/tasks","body":{"prompt":{"$ref":"request.prompt"}}},"response":{"status":"pending"}}]}}`)
	registryData, err := json.Marshal([]pluginRegistryRecord{{ID: "removed-official-protocol", Raw: staleManifest, Source: PluginOriginOfficial}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := center.registrySnapshot().Resolve("removed-official-protocol"); ok {
		t.Fatal("removed official protocol survived bootstrap")
	}
}

func TestPluginRuntimeRejectsDeprecatedPaymentContribution(t *testing.T) {
	manifest := json.RawMessage(`{"apiVersion":"siflux.plugin/v1","id":"uploaded-payment-provider","version":"1.0.0","name":"Uploaded Payment Provider","author":"Test","enabled":true,"runtime":{"backend":"host:untrusted-payment"},"contributes":{"paymentProviders":[{"id":"untrusted-payment","label":"Untrusted Payment","icon":"brand:untrusted","checkoutMode":"redirect","expiryPolicy":{"defaultMinutes":30,"minMinutes":5,"maxMinutes":1440}}]}}`)
	registryData, err := json.Marshal([]pluginRegistryRecord{{ID: "uploaded-payment-provider", Raw: manifest, Source: "uploaded"}})
	if err != nil {
		t.Fatal(err)
	}
	dataDir := t.TempDir()
	if err := os.WriteFile(filepath.Join(dataDir, "plugin_registry.json"), registryData, 0o600); err != nil {
		t.Fatal(err)
	}
	center, err := newPluginRuntime(dataDir)
	if err != nil {
		t.Fatal(err)
	}
	for _, plugin := range center.list() {
		if plugin.Manifest.ID != "uploaded-payment-provider" {
			continue
		}
		if plugin.Status != "invalid" || !strings.Contains(plugin.Error, "at least one contribution") {
			t.Fatalf("deprecated payment plugin = %#v", plugin)
		}
		return
	}
	t.Fatal("deprecated payment plugin was not retained as invalid")
}

func TestAutoDLPluginPackageLoadsAsOfficialRuntime(t *testing.T) {
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	var plugin *PluginView
	for _, item := range center.list() {
		if item.Manifest.ID == "autodl-comfyui" {
			copy := item
			plugin = &copy
			break
		}
	}
	if plugin == nil || plugin.Status != "enabled" || plugin.Source != PluginOriginOfficial || plugin.Package != protocol.PluginPackageFormat {
		t.Fatalf("official AutoDL plugin = %#v", plugin)
	}
	if !center.registrySnapshot().IsCapability("autodl-comfyui", protocol.CapabilityVideo) {
		t.Fatal("AutoDL package provider was not registered")
	}
	catalog := (&Service{pluginRuntime: center}).PluginProviderCatalog(string(protocol.SurfaceAdminSystemChannel), string(protocol.CapabilityVideo), false)
	var autoDL *PluginProviderCatalogItem
	for index := range catalog {
		if catalog[index].ID == "autodl-comfyui" {
			autoDL = &catalog[index]
		}
		if catalog[index].ID == "autodl-comfyui-plugin" {
			t.Fatal("legacy AutoDL provider ID leaked into administrator catalog")
		}
	}
	if autoDL == nil || len(autoDL.Workflows) == 0 {
		t.Fatalf("AutoDL administrator catalog = %#v", catalog)
	}
}

func TestProviderTaskNotReadyStrictClassification(t *testing.T) {
	tests := []struct {
		name string
		err  providerHTTPError
		want bool
	}{
		{name: "error code", err: providerHTTPError{StatusCode: 400, Body: `{"code":"task_not_exist"}`}, want: true},
		{name: "error message", err: providerHTTPError{StatusCode: 400, Body: `{"message":"task_not_exist"}`}, want: true},
		{name: "not found spelling", err: providerHTTPError{StatusCode: 404, Body: `{"code":"task_not_found"}`}, want: true},
		{name: "other status", err: providerHTTPError{StatusCode: 502, Body: `{"code":"task_not_exist"}`}},
		{name: "unstructured body", err: providerHTTPError{StatusCode: 400, Body: "task_not_exist"}},
		{name: "partial match", err: providerHTTPError{StatusCode: 400, Body: `{"code":"task_not_exist_later"}`}},
		{name: "other provider error", err: providerHTTPError{StatusCode: 400, Body: `{"code":"invalid_parameter"}`}},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			if got := isProviderTaskNotReadyError(test.err); got != test.want {
				t.Fatalf("isProviderTaskNotReadyError() = %v, want %v", got, test.want)
			}
		})
	}
}

func newDeclarativeNewAPIChannel2TestAdapter(t *testing.T) protocol.Adapter {
	t.Helper()
	adapter, err := protocol.LoadManifest([]byte(`{
		"apiVersion":"siflux.plugin/v1",
		"id":"newapi-channel-2","version":"1.0.0","name":"NewAPI Channel 2","author":"Test","documentation":"# Test",
		"contributes":{"providers":[{"id":"newapi-channel-2","label":"NewAPI Channel 2","capabilities":["video"],"scopes":["canvas"],"create":{"method":"POST","path":"/video/generations","fields":{"model":"request.model"}},"poll":{"method":"GET","path":"/video/generations/{{taskId}}"},"response":{"taskIdPaths":["id"],"statusPaths":["status"],"resultPaths":["video_url"],"resultKind":"video"}}]}
	}`))
	if err != nil {
		t.Fatal(err)
	}
	return adapter
}

func testPluginPackage(t *testing.T, manifest []byte) []byte {
	t.Helper()
	var buffer bytes.Buffer
	writer := zip.NewWriter(&buffer)
	file, err := writer.Create("manifest.json")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := file.Write(manifest); err != nil {
		t.Fatal(err)
	}
	if err := writer.Close(); err != nil {
		t.Fatal(err)
	}
	return buffer.Bytes()
}