import { expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

test("settings page focuses on channel and model configuration", () => {
    const source = readFileSync(resolve(import.meta.dir, "../src/pages/settings/index.tsx"), "utf8");
    expect(source).not.toContain("创作偏好");
    expect(source).not.toContain("配置默认模型、生成参数和素材存储。");
    expect(source).not.toContain("音频默认值");
    expect(source).not.toContain("音频指令");
    expect(source).not.toContain("默认音频指令");
    expect(source).toContain("ChannelSettingsPane");
    expect(source).toContain("ModelDefaultGrid");
});

test("preference blocks keep a visible gap from neighbouring surfaces", () => {
    const css = readFileSync(resolve(import.meta.dir, "../src/styles/globals.css"), "utf8").replace(/\r\n/g, "\n");
    expect(css).toContain(".settings-preference-heading { margin-bottom: var(--space-5); }");
    expect(css).toContain(".app-user-workspace.settings-page .settings-preference-block {\n    padding: 20px 20px 12px;");
    // 积分中心弹窗已从产品移除，其布局规则不应残留。
    expect(css).not.toContain(".workspace-wallet-tabs");
});