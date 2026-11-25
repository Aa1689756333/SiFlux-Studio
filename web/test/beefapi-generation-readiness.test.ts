import { describe, expect, test } from "bun:test";

import { defaultModelCapabilityConfig } from "../src/lib/model-capabilities";
import { channelHasGenerationCredential, createModelChannel, defaultConfig, encodeChannelModel, MANAGED_BEEFAPI_CREDENTIAL_REF, resolveModelRequestConfig, useConfigStore, type AiConfig } from "../src/stores/use-config-store";

function imageCapability(model: string) {
    const capability = defaultModelCapabilityConfig("openai-image", model);
    capability.image!.references.maxImages = 3;
    return capability;
}

function beefAPIConfig(connected: boolean): AiConfig {
    const image = "gpt-image-2";
    const channel = createModelChannel({
        id: "beefapi",
        name: "BeefAPI",
        pinned: true,
        baseUrl: "https://enterprise.beefapi.com",
        apiKey: "",
        models: [image],
        credentialRef: connected ? MANAGED_BEEFAPI_CREDENTIAL_REF : undefined,
        hasApiKey: connected,
        modelProfiles: [
            { model: image, capability: "image", protocol: "openai-image", capabilityConfig: imageCapability(image) },
        ],
    });
    return {
        ...defaultConfig,
        channels: [channel],
        imageModel: encodeChannelModel("beefapi", image),
        model: encodeChannelModel("beefapi", image),
    };
}

function manualConfig(apiKey: string): AiConfig {
    const channel = createModelChannel({
        id: "manual",
        name: "工作室渠道",
        baseUrl: "https://api.example.com",
        apiKey,
        models: ["local-image"],
        modelProfiles: [
            { model: "local-image", capability: "image", protocol: "openai-image", capabilityConfig: imageCapability("local-image") },
        ],
    });
    return {
        ...defaultConfig,
        channels: [channel],
        imageModel: encodeChannelModel("manual", "local-image"),
        model: encodeChannelModel("manual", "local-image"),
    };
}

describe("managed BeefAPI generation readiness", () => {
    test("connected empty-key enterprise channel is canvas-ready for image", () => {
        const config = beefAPIConfig(true);
        const ready = useConfigStore.getState().isAiConfigReady;
        expect(channelHasGenerationCredential(config.channels[0])).toBe(true);
        expect(ready(config, config.imageModel)).toBe(true);
        expect(resolveModelRequestConfig(config, config.imageModel).interfaceType).toBe("openai-image");
    });

    test("disconnected empty-key enterprise channel is not canvas-ready", () => {
        const config = beefAPIConfig(false);
        const ready = useConfigStore.getState().isAiConfigReady;
        expect(channelHasGenerationCredential(config.channels[0])).toBe(false);
        expect(ready(config, config.imageModel)).toBe(false);
    });

    test("manual provider keys stay required and are not treated as managed", () => {
        const ready = useConfigStore.getState().isAiConfigReady;
        const withKey = manualConfig("manual-secret");
        const withoutKey = manualConfig("");
        expect(ready(withKey, withKey.imageModel)).toBe(true);
        expect(ready(withoutKey, withoutKey.imageModel)).toBe(false);

        const spoofed = manualConfig("");
        spoofed.channels[0].credentialRef = MANAGED_BEEFAPI_CREDENTIAL_REF;
        spoofed.channels[0].hasApiKey = true;
        expect(ready(spoofed, spoofed.imageModel)).toBe(false);
    });

    test("duplicate model names keep the selected channel credential in both orders", () => {
        const ready = useConfigStore.getState().isAiConfigReady;
        const sharedImage = "gpt-image-2";
        const imageProfile = { model: sharedImage, capability: "image" as const, protocol: "openai-image" as const, capabilityConfig: imageCapability(sharedImage) };
        for (const order of ["manual-first", "beef-first"] as const) {
            const manualEmpty = createModelChannel({
                id: "manual",
                name: "工作室渠道",
                baseUrl: "https://api.example.com",
                apiKey: "",
                models: [sharedImage],
                modelProfiles: [imageProfile],
            });
            const manualKeyed = createModelChannel({
                ...manualEmpty,
                apiKey: "manual-secret",
            });
            const managed = createModelChannel({
                id: "beefapi",
                name: "BeefAPI",
                pinned: true,
                baseUrl: "https://enterprise.beefapi.com",
                apiKey: "",
                credentialRef: MANAGED_BEEFAPI_CREDENTIAL_REF,
                hasApiKey: true,
                models: [sharedImage],
                modelProfiles: [imageProfile],
            });
            const arrange = (manual: typeof manualEmpty): AiConfig => ({
                ...defaultConfig,
                channels: order === "manual-first" ? [manual, managed] : [managed, manual],
                imageModel: encodeChannelModel("beefapi", sharedImage),
                model: encodeChannelModel("beefapi", sharedImage),
            });
            const selectedManaged = arrange(manualEmpty);
            expect(ready(selectedManaged, selectedManaged.imageModel)).toBe(true);
            expect(resolveModelRequestConfig(selectedManaged, selectedManaged.imageModel).model).toBe(sharedImage);
            expect(resolveModelRequestConfig(selectedManaged, selectedManaged.imageModel).apiKey).toBe("");

            const selectedManualEmpty = {
                ...selectedManaged,
                imageModel: encodeChannelModel("manual", sharedImage),
                model: encodeChannelModel("manual", sharedImage),
            };
            expect(ready(selectedManualEmpty, selectedManualEmpty.imageModel)).toBe(false);

            const selectedManualKeyed = arrange(manualKeyed);
            selectedManualKeyed.imageModel = encodeChannelModel("manual", sharedImage);
            selectedManualKeyed.model = encodeChannelModel("manual", sharedImage);
            expect(ready(selectedManualKeyed, selectedManualKeyed.imageModel)).toBe(true);
            expect(resolveModelRequestConfig(selectedManualKeyed, selectedManualKeyed.imageModel).model).toBe(sharedImage);
            expect(resolveModelRequestConfig(selectedManualKeyed, selectedManualKeyed.imageModel).apiKey).toBe("manual-secret");
        }
    });

    test("connected managed request config never exports the enterprise key", () => {
        const config = beefAPIConfig(true);
        config.channels[0].apiKey = "must-not-export";
        const resolved = resolveModelRequestConfig(config, config.imageModel);
        expect(resolved.apiKey).toBe("");
        expect(resolved.secretKey).toBe("");
        expect(resolved.credentialRef).toBe(MANAGED_BEEFAPI_CREDENTIAL_REF);
        expect(useConfigStore.getState().isAiConfigReady(config, config.imageModel)).toBe(true);
    });
});