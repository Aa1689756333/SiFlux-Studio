import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("standalone agent page", () => {
    test("home and sidebar hide Agent until the release flag is turned off", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const flags = read("src/lib/release-flags.ts");
        const router = read("src/router.tsx");
        expect(flags).toContain("HIDE_AGENT_DIRECTOR_MCP = true");
        expect(sidebar).toContain('item.id !== "agent"');
        expect(sidebar).toContain('item.id !== "director"');
        expect(sidebar).toContain('item.id !== "agents"');
        expect(sidebar).not.toContain("Beef Agent");
        expect(sidebar).not.toContain("/canvas?mode=new&start=agent");
        expect(router).toContain('path: "/agent"');
        expect(router).toContain("hideAgentDirectorMcp()");
    });

    test("sidebar puts 新建画布 first and follows the requested menu order", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        expect(sidebar).toContain('title: "新建画布"');
        expect(sidebar).not.toContain('title: "新建项目"');
        const titles = [...sidebar.matchAll(/title: "([^"]+)"/g)].map((match) => match[1]);
        const menu = titles.filter((title) => ["首页", "Agent助手", "文本对话", "图片生成", "音频生成", "视频生成", "3D 导演台", "项目库", "资产", "模型配置", "用量统计", "MCP"].includes(title));
        expect(menu).toEqual(["首页", "Agent助手", "文本对话", "图片生成", "音频生成", "视频生成", "3D 导演台", "项目库", "资产", "模型配置", "用量统计", "MCP"]);
        expect(sidebar).toContain("hideAgentDirectorMcp()");
    });

    test("standalone page is a workspace conversation, not a canvas panel", () => {
        const page = read("src/pages/agent/index.tsx");
        const workspace = read("src/pages/agent/agent-workspace.tsx");
        const api = read("src/services/api/agent-assistant.ts");
        expect(api).toContain('WORKSPACE_AGENT_CONVERSATION_ID = "workspace-agent"');
        expect(workspace).toContain("WORKSPACE_AGENT_CONVERSATION_ID");
        expect(workspace).toContain('permissionMode: "read-only"');
        expect(workspace).toContain("不进入无限画布");
        expect(workspace).not.toContain("CanvasAssistantSidebar");
        expect(workspace).not.toContain("onLocateNodes");
        expect(workspace).not.toContain("onRunProposal");
        expect(workspace).not.toContain("standalone-agent");
        expect(page).not.toContain("/canvas?mode=new");
        expect(page).not.toContain("createCanvas");
        expect(workspace).not.toContain("createCanvas");
    });

    test("composer keeps attach, skills, model, and send in one compact row", () => {
        const composer = read("src/pages/canvas/canvas-assistant-composer.tsx");
        const picker = read("src/pages/canvas/canvas-assistant-model-picker.tsx");
        const css = read("src/pages/canvas/canvas-assistant-sidebar.css");
        const footer = composer.slice(composer.indexOf("canvas-assistant-composer-footer"));
        expect(footer.indexOf("添加参考素材")).toBeGreaterThan(-1);
        expect(footer.indexOf("添加参考素材")).toBeLessThan(footer.indexOf("选择技能"));
        expect(footer.indexOf("选择技能")).toBeLessThan(footer.indexOf("CanvasAssistantModelPicker"));
        expect(footer.indexOf("CanvasAssistantModelPicker")).toBeLessThan(footer.indexOf('aria-label="发送"'));
        expect(composer).not.toContain("canvas-assistant-composer-tools");
        expect(picker).toContain("width: 148");
        expect(css).toContain(".canvas-assistant-composer-spacer");
    });
});
