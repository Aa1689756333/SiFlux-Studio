import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "@/stores/use-config-store";

function configWithImageChannel(overrides: Partial<AiConfig> = {}): AiConfig {
    const channels = [
        createModelChannel({
            id: "a",
            name: "本地渠道",
            models: ["img-1", "img-2"],
            modelProfiles: [
                { model: "img-1", capability: "image", protocol: "openai-image" },
                { model: "img-2", capability: "image", protocol: "openai-image" },
            ],
        }),
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, imageModel: "a::img-1", ...overrides } }).config;
}

function assistantSelection(config: AiConfig) {
    const markup = renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);
    const start = markup.indexOf('id="default-assistant-title"');
    expect(start).toBeGreaterThan(-1);
    return markup.slice(start).match(/class="ant-select-content[^"]*" title="([^"]*)"/)?.[1];
}

describe("模型配置页的 Agent 模型一行", () => {
    test("排在默认生图模型之后，且不再提供默认文本模型", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithImageChannel()} onChange={() => {}} />);
        const imageIndex = markup.indexOf("默认生图模型");
        const agentIndex = markup.indexOf("Agent 模型");
        expect(imageIndex).toBeGreaterThan(-1);
        expect(agentIndex).toBeGreaterThan(imageIndex);
        expect(markup).not.toContain("默认文本模型");
        expect(markup).not.toContain("助手模型");
        expect(markup).not.toContain("自动选择");
    });

    test("未单独指定时直接选中默认生图模型", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithImageChannel()} onChange={() => {}} />);
        expect(markup).toContain('aria-label="Agent 模型"');
        expect(assistantSelection(configWithImageChannel())).toContain("img-1");
    });

    test("选中态跟着 assistantModel 走，失效选择不会被悄悄替换", () => {
        expect(assistantSelection(configWithImageChannel({ assistantModel: "a::img-2" }))).toContain("img-2");
        const unavailable = renderToStaticMarkup(
            <ModelDefaultGrid config={configWithImageChannel({ assistantModel: "gone::img-1" })} onChange={() => {}} />,
        );
        expect(unavailable).toContain("已选模型不可用，请重新选择");
    });
});