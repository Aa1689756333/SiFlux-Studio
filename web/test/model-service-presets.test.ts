import { expect, test } from "bun:test";
import { serviceConnectionError, serviceModelProfile, modelCatalogRequestURL } from "../src/lib/model-service-presets";
import { modelConnectionResultDetail, testChannelModelConnection } from "../src/lib/model-connection-test";
import { applyFetchedChannelModelCatalog } from "../src/lib/channel-config";
import { modelConfigChannelStatusLabel } from "../src/pages/settings/channel-settings-pane";
import { backendProviderConfig } from "../src/services/api/generation-task";
import { configWithoutCachedSecrets, createModelChannel, defaultConfig } from "../src/stores/use-config-store";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import type { ModelProtocolDefinition } from "../src/lib/model-protocols";
import { currentModelConnectionReceipt, useModelConnectionTests } from "../src/stores/use-model-connection-tests";

const protocols = [
    ["chat-completion", "text"], ["openai-response", "text"], ["gemini-generate-content", "text"],
    ["openai-image", "image"], ["gemini-image", "image"], ["volcengine-ark-image", "image"],
].map(([value, capability]) => ({ value, capability, enabled: true } as ModelProtocolDefinition));

test("catalog endpoint metadata maps image endpoints and host presets to installed protocols", () => {
    const channel = createModelChannel({ baseUrl: "https://api.example.com/v1", apiFormat: "openai" });
    const item = { id: "image-endpoint", supportedEndpointTypes: ["images.generations"] };
    const profile = serviceModelProfile(channel, item, protocols);
    expect(profile.capability).toBe("image");
    expect(profile.protocol).toBe("openai-image");
    expect(profile.capabilityConfig?.image).toMatchObject({ size: { parameter: "size", default: "1:1" }, quality: { supported: true } });

    // Opaque names carry no endpoint contract; they stay on the relay text default.
    for (const id of ["sd-native-full-2.0", "原生不卡人脸-全参2.5"]) {
        expect(serviceModelProfile(channel, { id, supportedEndpointTypes: ["full-video"] }, protocols)).toMatchObject({ capability: "text", protocol: "chat-completion" });
    }

    // The host preset decides which installed image adapter is proposed.
    const ark = createModelChannel({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3" });
    expect(serviceModelProfile(ark, { id: "doubao-seedream" }, protocols).protocol).toBe("volcengine-ark-image");
    const regionalArk = { ...ark, baseUrl: "https://ark.cn-shanghai.volces.com/api/v3" };
    expect(serviceModelProfile(regionalArk, { id: "doubao-seedream" }, protocols).protocol).toBe("volcengine-ark-image");

    // Only installed, enabled adapters survive the lookup.
    expect(serviceModelProfile(channel, item, protocols.map((p) => ({ ...p, enabled: false }))).protocol).toBeUndefined();
    expect(serviceModelProfile(channel, item, protocols.filter((p) => p.value !== "openai-image")).protocol).toBeUndefined();
});

test("test receipts apply only to the exact tested connection and model profile", () => {
    const channel = createModelChannel({ id: "receipt-channel", apiKey: "synthetic-key", modelProfiles: [{ model: "test", capability: "text", protocol: "chat-completion" }] });
    useModelConnectionTests.getState().record(channel, "test", { success: true, detail: "OK" });
    const receipts = useModelConnectionTests.getState().receipts;
    expect(currentModelConnectionReceipt(receipts, channel, "test")?.success).toBe(true);
    expect(currentModelConnectionReceipt(receipts, { ...channel, apiKey: "changed" }, "test")).toBeUndefined();
    expect(currentModelConnectionReceipt(receipts, { ...channel, baseUrl: "https://other.example" }, "test")).toBeUndefined();
    expect(currentModelConnectionReceipt(receipts, { ...channel, referenceAssetOrigin: "https://assets.example.com" }, "test")).toBeUndefined();
    expect(currentModelConnectionReceipt(receipts, { ...channel, headers: [{ name: "X-Key", value: "other" }] }, "test")).toBeUndefined();
    expect(currentModelConnectionReceipt(receipts, { ...channel, modelProfiles: [{ model: "test", capability: "text", protocol: "openai-response" }] }, "test")).toBeUndefined();
});

test("native provider models use installed native adapters and never invent a missing adapter", () => {
    const gemini = createModelChannel({ baseUrl: "https://generativelanguage.googleapis.com", apiFormat: "gemini" });
    expect(serviceModelProfile(gemini, { id: "gemini-pro" }, protocols).protocol).toBe("gemini-generate-content");
    expect(serviceModelProfile(gemini, { id: "gemini-image" }, protocols).protocol).toBe("gemini-image");
    expect(serviceModelProfile(gemini, { id: "gemini-image" }, protocols.filter((p) => p.value !== "gemini-image")).protocol).toBeUndefined();
    const ark = createModelChannel({ baseUrl: "https://ark.cn-beijing.volces.com/api/v3" });
    expect(serviceModelProfile(ark, { id: "doubao-seedream" }, protocols, "image").protocol).toBe("volcengine-ark-image");
    const unrelated = { ...ark, baseUrl: "https://ark.cn-shanghai.volces.com.example.org/api/v3" };
    expect(serviceModelProfile(unrelated, { id: "doubao-seedream-image" }, protocols, "image").protocol).toBe("openai-image");
});

test("refresh keeps selected/manual models and user capability limits", () => {
    const config = defaultModelCapabilityConfig("openai-image", "image-manual")!;
    const channel = createModelChannel({ id: "custom", models: ["image-manual"], modelProfiles: [{ model: "image-manual", capability: "image", protocol: "openai-image", capabilityConfig: config }] });
    const next = applyFetchedChannelModelCatalog(channel, { models: ["image-manual", "new-model"], catalog: [{ id: "image-manual", modelType: "image" }, { id: "new-model" }] });
    expect(next.models).toEqual(["image-manual"]);
    expect(next.modelProfiles?.find((p) => p.model === "image-manual")).toEqual(channel.modelProfiles![0]);
});

test("connection validation rejects full endpoints and embedded credentials", () => {
    const channel = createModelChannel({ baseUrl: "https://api.example.com/v1", apiKey: "synthetic-key" });
    expect(serviceConnectionError(channel)).toBe("");
    expect(modelCatalogRequestURL(channel)).toBe("https://api.example.com/v1/models");
    expect(serviceConnectionError({ ...channel, baseUrl: "https://api.example.com/v1/chat/completions" })).not.toBe("");
    expect(serviceConnectionError({ ...channel, baseUrl: "https://secret@api.example.com" })).not.toBe("");
    expect(serviceConnectionError({ ...channel, referenceAssetOrigin: "https://assets.example.com" })).toBe("");
    for (const referenceAssetOrigin of ["http://assets.example.com", "https://assets.example.com/path", "https://user@assets.example.com", "https://assets.example.com?key=value"]) {
        expect(serviceConnectionError({ ...channel, referenceAssetOrigin })).not.toBe("");
    }
});

test("explicit asset origin survives channel creation and generation request assembly", () => {
    const channel = createModelChannel({ id: "custom", baseUrl: "https://api.example.com/v1", referenceAssetOrigin: " https://assets.example.com ", models: ["gpt-image-1"], modelProfiles: [{ model: "gpt-image-1", capability: "image", protocol: "openai-image" }] });
    const config = { ...defaultConfig, channels: [channel], model: "custom::gpt-image-1" };
    expect(channel.referenceAssetOrigin).toBe("https://assets.example.com");
    expect(backendProviderConfig(config, "image")).toMatchObject({ referenceAssetOrigin: channel.referenceAssetOrigin, interfaceType: "openai-image" });
});

test("saved credentials do not imply tested generation and browser cache omits all credential copies", () => {
    const channel = createModelChannel({ id: "manual", apiKey: "synthetic-key", secretKey: "synthetic-secret", headers: [{ name: "X-Key", value: "synthetic-header" }] });
    expect(modelConfigChannelStatusLabel(channel, { status: "saved", revision: 1, dirty: false, error: "" })).toBe("已保存 · 尚未测试");
    const config = { ...defaultConfig, apiKey: "synthetic-root", channels: [channel] };
    expect(JSON.stringify(configWithoutCachedSecrets(config))).not.toContain("synthetic-");
    expect(config.channels[0].apiKey).toBe("synthetic-key");
});

test("generation test uses production config including headers and waits for a final output", async () => {
    const capabilityConfig = defaultModelCapabilityConfig("openai-image", "test-image")!;
    const channel = createModelChannel({ id: "manual", apiKey: "synthetic-key", models: ["test-image"], headers: [{ name: "X-Project", value: "test-project" }], modelProfiles: [{ model: "test-image", capability: "image", protocol: "openai-image", capabilityConfig }] });
    let resolve!: (value: { images: Array<{ dataUrl: string; storageKey: string }> }) => void;
    const completion = new Promise<{ images: Array<{ dataUrl: string; storageKey: string }> }>((r) => { resolve = r; });
    let done = false;
    const testResult = testChannelModelConnection(channel, "test-image", "image", "openai-image", async (options) => {
        expect(options.mode).toBe("image");
        const request = backendProviderConfig(options.config, "image");
        expect(request).toMatchObject({ headers: channel.headers, model: "test-image", apiKey: "synthetic-key", interfaceType: "openai-image" });
        return completion;
    }).then((value) => { done = true; return value; });
    await Promise.resolve();
    expect(done).toBe(false);
    resolve({ images: [{ storageKey: "resource:generated", dataUrl: "" }] });
    expect(await testResult).toContain("已完成图片生成");
    expect(() => modelConnectionResultDetail({}, "image")).toThrow("没有返回可用结果");
    expect(() => modelConnectionResultDetail({ text: " " }, "text")).toThrow();
});

test("image test uses the profile size and quality defaults", async () => {
    const capabilityConfig = defaultModelCapabilityConfig("openai-image", "test-image")!;
    capabilityConfig.image!.size.default = "16:9";
    capabilityConfig.image!.quality.default = "high";
    const channel = createModelChannel({ apiKey: "synthetic", modelProfiles: [{ model: "test-image", capability: "image", protocol: "openai-image", capabilityConfig }] });
    await testChannelModelConnection(channel, "test-image", "image", "openai-image", async ({ config }) => {
        expect(config.size).toBe("16:9");
        expect(config.quality).toBe("high");
        expect(config.imageModel.endsWith("::test-image")).toBe(true);
        return { images: [{ storageKey: "fixture", dataUrl: "" }] };
    });
});