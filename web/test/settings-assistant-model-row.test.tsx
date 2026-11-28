import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { ModelDefaultGrid } from "@/pages/settings/model-default-grid";
import { createModelChannel, defaultConfig, normalizeConfigSnapshot, type AiConfig } from "@/stores/use-config-store";

function configWithChannels(overrides: Partial<AiConfig> = {}): AiConfig {
    const channels = [
        createModelChannel({
            id: "a",
            name: "本地渠道",
            models: ["img-1", "chat-1", "chat-2"],
            modelProfiles: [
                { model: "img-1", capability: "image", protocol: "openai-image" },
                { model: "chat-1", capability: "text", protocol: "chat-completion" },
                { model: "chat-2", capability: "text", protocol: "claude-api" },
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
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={configWithChannels()} onChange={() => {}} />);
        const imageIndex = markup.indexOf("默认生图模型");
        const agentIndex = markup.indexOf("Agent 模型");
        expect(imageIndex).toBeGreaterThan(-1);
        expect(agentIndex).toBeGreaterThan(imageIndex);
        expect(markup).not.toContain("默认文本模型");
        expect(markup).not.toContain("助手模型");
    });

    test("Agent 模型只列对话模型，未指定时自动选中首个", () => {
        const config = configWithChannels();
        expect(assistantSelection(config)).toContain("chat-1");
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={config} onChange={() => {}} />);
        const start = markup.indexOf('id="default-assistant-title"');
        const agentSection = markup.slice(start);
        expect(agentSection).toContain('aria-label="Agent 模型"');
        // 生图模型不能出现在 Agent 的选择里。
        expect(agentSection).not.toContain("img-1");
    });

    test("选中态跟着 assistantModel 走，失效的旧值自动改选可用模型", () => {
        expect(assistantSelection(configWithChannels({ assistantModel: "a::chat-2" }))).toContain("chat-2");
        const stale = configWithChannels({ assistantModel: "gone::chat-1" });
        expect(assistantSelection(stale)).toContain("chat-1");
        const markup = renderToStaticMarkup(<ModelDefaultGrid config={stale} onChange={() => {}} />);
        expect(markup).not.toContain("已选模型不可用");
    });
});