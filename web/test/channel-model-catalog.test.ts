import { afterEach, describe, expect, test } from "bun:test";
import { App } from "antd";
import axios from "axios";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { applyFetchedChannelModelCatalog } from "../src/lib/channel-config";
import { mergeFetchedChannelModelProfiles, type ChannelModelCatalogItem } from "../src/lib/channel-model-catalog";
import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { ChannelModelSettings } from "../src/pages/settings/channel-model-settings";
import { fetchChannelModels } from "../src/services/api/image";
import { apiClient } from "../src/services/api/request";
import { createModelChannel, defaultConfig, modelDisplayName, normalizeConfigSnapshot, resolveModelRequestConfig, selectableModelsByCapability, type AiConfig } from "../src/stores/use-config-store";

const originalAxiosRequest = axios.request;
const originalApiRequest = apiClient.request;

afterEach(() => {
    axios.request = originalAxiosRequest;
    apiClient.request = originalApiRequest;
});

test("backend discovery forwards cancellation and preserves AbortError", async () => {
    const controller = new AbortController();
    let received: AbortSignal | undefined;
    apiClient.request = (async (config: { signal?: AbortSignal }) => {
        received = config.signal;
        throw new DOMException("cancelled", "AbortError");
    }) as typeof apiClient.request;
    await expect(fetchChannelModels(createModelChannel({ id: "custom", baseUrl: "https://example.test/v1", apiKey: "dummy" }), true, controller.signal)).rejects.toBeInstanceOf(DOMException);
    expect(received).toBe(controller.signal);
});

const imageCatalog: ChannelModelCatalogItem = {
    id: "gpt-image-2",
    displayName: "GPT Image 2",
    modelType: "image",
    supportedEndpointTypes: ["image-generation"],
    maxImages: 8,
};

function configForCatalog(catalog: ChannelModelCatalogItem[], input: Partial<AiConfig> = {}) {
    const channel = createModelChannel({
        id: "flow",
        name: "Flow2API",
        baseUrl: "https://flow.example",
        apiKey: "synthetic-test-key",
        apiFormat: "openai",
        models: catalog.map((item) => item.id),
    });
    const configured = { ...channel, modelProfiles: mergeFetchedChannelModelProfiles(channel, catalog) };
    return normalizeConfigSnapshot({
        config: {
            ...defaultConfig,
            ...input,
            channels: [configured],
            model: `flow::${catalog[0]!.id}`,
            imageModel: `flow::${catalog[0]!.id}`,
        },
    }).config;
}

function imageCapabilityConfig(protocol: Parameters<typeof defaultModelCapabilityConfig>[0], model: string) {
    const capabilityConfig = defaultModelCapabilityConfig(protocol, model);
    capabilityConfig.image!.size.values = ["1024x1024", "2048x2048"];
    capabilityConfig.image!.size.default = "2048x2048";
    return capabilityConfig;
}

describe("public channel model catalog", () => {
    test("backend catalogue authentication failure keeps its actionable message", async () => {
        apiClient.request = (async () => ({ status: 502, data: { code: 502, data: null, msg: "模型服务鉴权失败，请检查 API Key", reason: "bad_gateway" } })) as typeof apiClient.request;
        await expect(fetchChannelModels(createModelChannel({ apiKey: "synthetic-invalid" }), true)).rejects.toThrow("模型服务鉴权失败，请检查 API Key");
    });

    test("direct discovery forwards custom headers for OpenAI and Gemini", async () => {
        const requests: Array<Record<string, unknown>> = [];
        axios.request = (async (request: Record<string, unknown>) => {
            requests.push(request);
            return { status: 200, data: { data: [{ id: "custom-model" }], models: [{ name: "models/gemini-pro" }] } };
        }) as typeof axios.request;
        for (const apiFormat of ["openai", "gemini"] as const) {
            await fetchChannelModels(createModelChannel({ baseUrl: "https://provider.example", apiFormat, apiKey: "synthetic-key", headers: [{ name: "X-Project-Key", value: "synthetic-header" }] }));
        }
        expect(requests).toHaveLength(2);
        for (const request of requests) {
            const headers = request.headers as Record<string, string>;
            expect(JSON.parse(atob(headers["x-canvas-upstream-headers"]))).toEqual([{ name: "X-Project-Key", value: "synthetic-header" }]);
        }
    });

    test("drops retired media catalog entries without expanding compatibility IDs", async () => {
        apiClient.request = (async () => ({
            data: {
                code: 0,
                data: {
                    models: [
                        { id: "image-fast", displayName: "Image Fast", modelType: "image" },
                        { id: "image-quality", displayName: "Image Quality", modelType: "image" },
                        { id: "text-reasoner", displayName: "Text Reasoner", modelType: "text" },
                        { ...imageCatalog, compatibilityMap: [{ modelId: "image_portrait_10s" }] },
                        { id: "veo-lite", displayName: "Veo Lite", modelType: "video" },
                        { id: "speech-hd", displayName: "Speech HD", modelType: "audio" },
                    ],
                },
            },
        })) as typeof apiClient.request;
        const channel = createModelChannel({ baseUrl: "https://flow.example", apiKey: "synthetic-test-key", models: [] });

        const result = await fetchChannelModels(channel, true);

        expect(result.models).toEqual(["gpt-image-2", "image-fast", "image-quality", "text-reasoner"]);
        expect(result.models).not.toContain("veo-lite");
        expect(result.models).not.toContain("speech-hd");
        expect(result.models).not.toContain("image_portrait_10s");
        expect(result.catalog.find((item) => item.id === "gpt-image-2")).toEqual(imageCatalog);
        expect(result.catalog.find((item) => item.id === "gpt-image-2")).not.toHaveProperty("compatibilityMap");
    });

    test("keeps the fetched BeefAPI catalog dynamic while normalizing discovered image profiles", () => {
        const channel = createModelChannel({
            id: "beefapi",
            name: "BeefAPI",
            baseUrl: "https://api.siflux.cn",
            apiKey: "synthetic-test-key",
            models: ["gpt-5.6-sol", "gpt-image-2", "hy-image-v3", "brand-new-upstream-model"],
        });
        const normalized = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], imageModel: "beefapi::gpt-image-2" } }).config;
        const beef = normalized.channels[0]!;

        expect(beef.models).toEqual(["gpt-5.6-sol", "gpt-image-2", "hy-image-v3", "brand-new-upstream-model"]);
        expect(beef.modelProfiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ model: "gpt-5.6-sol", capability: "text", protocol: "chat-completion" }),
            expect.objectContaining({ model: "gpt-image-2", capability: "image", protocol: "openai-image" }),
            expect.objectContaining({ model: "brand-new-upstream-model", capability: "text", protocol: "chat-completion" }),
            expect.objectContaining({ model: "hy-image-v3", capability: "image", protocol: "openai-image" }),
        ]));
        expect(resolveModelRequestConfig(normalized, "beefapi::gpt-image-2").interfaceType).toBe("openai-image");
        expect(resolveModelRequestConfig(normalized, "beefapi::gpt-5.6-sol").interfaceType).toBe("chat-completion");
    });

    test("repairs stale chat protocols on known BeefAPI image models without changing custom routes", () => {
        const make = (baseUrl: string) => createModelChannel({ id: "test", baseUrl, apiKey: "synthetic-key", models: ["gpt-image-2"], modelProfiles: [{ model: "gpt-image-2", capability: "text", protocol: "chat-completion" }] });
        const official = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [make("https://api.siflux.cn")] } }).config;
        expect(selectableModelsByCapability(official, "image")).toEqual(["test::gpt-image-2"]);
        expect(resolveModelRequestConfig(official, "test::gpt-image-2").interfaceType).toBe("openai-image");
        const custom = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [make("https://studio.example")] } }).config;
        expect(resolveModelRequestConfig(custom, "test::gpt-image-2").interfaceType).toBe("chat-completion");
    });

    test("preserves an explicitly configured BeefAPI text protocol", () => {
        const channel = createModelChannel({
            id: "beefapi",
            name: "BeefAPI",
            baseUrl: "https://enterprise.beefapi.com",
            models: ["custom-text-model"],
            modelProfiles: [{ model: "custom-text-model", capability: "text", protocol: "openai-response" }],
        });
        const normalized = normalizeConfigSnapshot({ config: { ...defaultConfig, channels: [channel], textModel: "beefapi::custom-text-model" } }).config;

        expect(normalized.channels[0]?.modelProfiles).toEqual(expect.arrayContaining([
            expect.objectContaining({ model: "custom-text-model", capability: "text", protocol: "openai-response" }),
        ]));
        expect(resolveModelRequestConfig(normalized, "beefapi::custom-text-model").interfaceType).toBe("openai-response");
    });

    test("preserves OpenAI-compatible capability metadata during direct model discovery", async () => {
        axios.request = (async () => ({
            data: {
                data: [
                    { id: "image-v1", display_name: "Image V1", model_type: "image", supported_endpoint_types: ["openai-image"] },
                    { id: "text-v1", display_name: "Text V1", model_type: "text", supported_endpoint_types: ["openai"] },
                ],
            },
        })) as typeof axios.request;
        const channel = createModelChannel({ baseUrl: "https://provider.example", apiKey: "synthetic-test-key", models: [] });

        const result = await fetchChannelModels(channel);

        expect(result.models).toEqual(["image-v1", "text-v1"]);
        expect(result.catalog).toEqual([
            expect.objectContaining({ id: "image-v1", modelType: "image", supportedEndpointTypes: ["openai-image"] }),
            expect.objectContaining({ id: "text-v1", modelType: "text", supportedEndpointTypes: ["openai"] }),
        ]);
    });

    test("refresh application preserves discovered capabilities in the saved channel", () => {
        const channel = createModelChannel({ id: "beefapi", name: "BeefAPI", baseUrl: "https://enterprise.beefapi.com", models: ["old-model"] });
        const next = applyFetchedChannelModelCatalog(channel, {
            models: ["gpt-image-2"],
            catalog: [{ id: "gpt-image-2", displayName: "GPT Image 2", modelType: "image", supportedEndpointTypes: ["openai"] }],
        });

        expect(next.models).toEqual(["gpt-image-2"]);
        expect(next.modelProfiles).toEqual([expect.objectContaining({ model: "gpt-image-2", capability: "image" })]);
    });

    test("maps Omni metadata to friendly image configuration without inventing size values", () => {
        const config = configForCatalog([imageCatalog]);
        const model = "flow::gpt-image-2";
        const profile = config.channels[0]!.modelProfiles![0]!;

        expect(modelDisplayName(config, model)).toBe("GPT Image 2");
        expect(selectableModelsByCapability(config, "image")).toEqual([model]);
        expect(selectableModelsByCapability(config, "text")).toEqual([]);
        expect(profile.capability).toBe("image");
        expect(profile.capabilityConfig?.image).toMatchObject({
            references: { maxImages: 8 },
        });
    });

    test("does not infer a protocol from endpoint-only media metadata", () => {
        const catalog: ChannelModelCatalogItem = { id: "endpoint-video", supportedEndpointTypes: ["openai-video"] };

        const config = configForCatalog([catalog]);

        expect(config.channels[0]!.modelProfiles).toEqual([]);
    });

    test("preserves a manually configured capability profile when a catalog only returns an ID", () => {
        const channel = createModelChannel({
            id: "manual",
            name: "Manual",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            models: ["manual-image"],
        });
        const capabilityConfig = imageCapabilityConfig("openai-image", "manual-image");
        channel.modelProfiles = [{ model: "manual-image", displayName: "Manual Image", capability: "image", protocol: "openai-image", billingMode: "fixed_request", unitPriceMicrocredits: 0, capabilityConfig }];

        const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "manual-image" }]);

        expect(profiles[0]?.capabilityConfig).toEqual(capabilityConfig);
        expect(profiles[0]?.displayName).toBe("Manual Image");
    });

    test("preserves an ID-only manual model profile when the per-model protocol is missing", () => {
        const channel = createModelChannel({
            id: "manual-text-channel",
            name: "Manual Text Channel",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            interfaceType: "chat-completion",
            models: ["manual-image"],
        });
        const capabilityConfig = imageCapabilityConfig("openai-image", "manual-image");
        const existing = {
            model: "manual-image",
            displayName: "Manual Image",
            capability: "image" as const,
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 4321,
            inputTokenPriceMicrocredits: 11,
            outputTokenPriceMicrocredits: 22,
            cachedTokenPriceMicrocredits: 3,
            capabilityConfig,
        };
        channel.modelProfiles = [existing];

        const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "manual-image", displayName: "Catalog Image" }]);

        expect(profiles[0]).toEqual({ ...existing, displayName: "Catalog Image" });
    });

    test("uses modelType only for capability and preserves an existing manual protocol and profile", () => {
        const channel = createModelChannel({
            id: "manual-partial",
            name: "Manual Partial",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            interfaceType: "chat-completion",
            models: ["image-x"],
        });
        const capabilityConfig = imageCapabilityConfig("gemini-image", "image-x");
        channel.modelProfiles = [{ model: "image-x", capability: "image", protocol: "gemini-image", billingMode: "fixed_request", unitPriceMicrocredits: 7654, capabilityConfig }];

        const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "image-x", modelType: "image" }]);

        expect(profiles).toEqual(channel.modelProfiles);
    });

    test("preserves an ID-only manual image model profile when both protocol sources are missing", () => {
        const channel = createModelChannel({
            id: "manual-no-protocol",
            name: "Manual No Protocol",
            baseUrl: "https://manual.example",
            apiKey: "synthetic-test-key",
            apiFormat: "openai",
            models: ["manual-image"],
        });
        const capabilityConfig = imageCapabilityConfig("openai-image", "manual-image");
        const existing = {
            model: "manual-image",
            displayName: "Manual Image",
            capability: "image" as const,
            billingMode: "fixed_request" as const,
            unitPriceMicrocredits: 8765,
            inputTokenPriceMicrocredits: 31,
            outputTokenPriceMicrocredits: 47,
            cachedTokenPriceMicrocredits: 5,
            capabilityConfig,
        };
        channel.modelProfiles = [existing];

        const profiles = mergeFetchedChannelModelProfiles(channel, [{ id: "manual-image", displayName: "Catalog Image" }]);

        expect(profiles).toEqual([{ ...existing, displayName: "Catalog Image" }]);
    });

    test("shows the public display name in channel model settings instead of only the internal ID", () => {
        const config = configForCatalog([imageCatalog]);

        const html = renderToStaticMarkup(React.createElement(App, null, React.createElement(ChannelModelSettings, { channel: config.channels[0]!, onChange: () => undefined })));

        expect(html).toContain("GPT Image 2");
    });

    test("builds the creation catalog only from public backend models and user channels", () => {
        const platform = createModelChannel({
            id: "public-logical-models",
            name: "平台模型",
            scope: "system",
            apiKey: "system",
            models: ["frontend-image"],
            modelProfiles: [{ model: "frontend-image", capability: "image", billingMode: "fixed_request", unitPriceMicrocredits: 0 }],
        });
        const custom = createModelChannel({
            id: "custom-channel",
            name: "我的渠道",
            baseUrl: "https://custom.example.com",
            apiKey: "synthetic-test-key",
            models: ["custom-image-v1"],
        });
        const normalized = normalizeConfigSnapshot({
            config: {
                ...defaultConfig,
                channels: [platform, custom, createModelChannel({ id: "default", name: "默认渠道", apiKey: "", models: ["gpt-image-2"] })],
                models: ["default::gpt-image-2", "ghost-image"],
                imageModels: ["default::gpt-image-2", "ghost-image"],
                imageModel: "default::gpt-image-2",
            },
        }).config;
        const staleSnapshot = { ...normalized, models: [...normalized.models, "ghost-image"], imageModels: [...normalized.imageModels, "ghost-image"] };

        expect(selectableModelsByCapability(staleSnapshot, "image")).toEqual(["public-logical-models::frontend-image", "custom-channel::custom-image-v1"]);
        expect(staleSnapshot.channels.some((channel) => channel.id === "default")).toBe(false);
        expect(selectableModelsByCapability(staleSnapshot, "image")).not.toContain("default::gpt-image-2");
        expect(selectableModelsByCapability(staleSnapshot, "image")).not.toContain("ghost-image");
    });
});