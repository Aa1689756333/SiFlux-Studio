import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "@/stores/use-config-store";

function configWithTextChannel(overrides: Partial<AiConfig> = {}): AiConfig {
    const channels = [
        createModelChannel({
            id: "a",
            name: "本地渠道",
            models: ["chat-1", "chat-2"],
            modelProfiles: [
                { model: "chat-1", capability: "text", protocol: "chat-completion" },
                { model: "chat-2", capability: "text", protocol: "claude-api" },
            ],
        }),
    ];
    return normalizeConfigSnapshot({ config: { ...defaultConfig, channels, textModel: "a::chat-1", ...overrides } }).config;
}

function assistantSelection(config: AiConfig) {
    const markup = renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);
    const start = markup.indexOf('id="default-assistant-title"');
    expect(start).toBeGreaterThan(-1);
    return markup.slice(start).match(/class="ant-select-content[^"]*" title="([^"]*)"/)?.[1];
}

describe("模型配置页的助手模型一行", () => {
    test("排在默认生图模型之后，且不再提供默认文本模型", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel()} onChange={() => {}} />);
        const imageIndex = markup.indexOf("默认生图模型");
        const assistantIndex = markup.indexOf("助手模型");
        expect(imageIndex).toBeGreaterThan(-1);
        expect(assistantIndex).toBeGreaterThan(imageIndex);
        expect(markup).not.toContain("默认文本模型");
        expect(markup).not.toContain("默认音频模型");
    });

    test("默认显示自动选择，并提供可访问的助手模型选择框", () => {
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel()} onChange={() => {}} />);
        expect(markup).toContain("自动选择");
        expect(markup).toContain('aria-label="助手模型"');
        // 只有文本模型时，助手选择框可用，生图选择框保持禁用。
        expect(markup).not.toMatch(/aria-label="助手模型"[^>]*disabled=""/);
        expect(markup).toMatch(/aria-label="默认生图模型"[^>]*disabled=""/);
    });

    test("选中态跟着 assistantModel 走：为空选中跟随项，有值选中对应模型", () => {
        expect(assistantSelection(configWithTextChannel())).toBe("自动选择");
        expect(assistantSelection(configWithTextChannel({ assistantModel: "a::chat-2" }))).toBe("chat-2");
        // 失效的显式选择不能悄悄改用默认模型。
        expect(assistantSelection(configWithTextChannel({ assistantModel: "gone::chat-1" }))).toBeUndefined();
        const unavailable = renderToStaticMarkup(<ModelDefaultGrid config={configWithTextChannel({ assistantModel: "gone::chat-1" })} onChange={() => {}} />);
        expect(unavailable).toContain("已选模型不可用，请重新选择");
    });
});
