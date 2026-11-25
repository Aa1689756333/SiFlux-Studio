import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dir, "..");
const read = (relative: string) => readFileSync(resolve(root, relative), "utf8");

describe("standalone agent page", () => {
    test("sidebar exposes Agent next to 生图 and registers the standalone route", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        const router = read("src/router.tsx");
        expect(sidebar).toContain('{ id: "image", title: "生图", icon: ImageIcon, to: "/generate/image" }');
        expect(sidebar).toContain('{ id: "agent", title: "Agent", icon: Bot, to: "/agent" }');
        expect(sidebar).not.toContain("/canvas?mode=new&start=agent");
        expect(router).toContain('path: "/agent"');
        expect(router).toContain("loadAgentPage");
    });

    test("sidebar groups creative entries before the workspace and Agent configuration", () => {
        const sidebar = read("src/components/layout/workspace-sidebar-nav.tsx");
        let cursor = -1;
        for (const token of ['id: "image"', 'id: "agent"', 'heading: "工作区"', 'toolItem("canvas", "/canvas")', 'toolItem("assets", "/assets")', 'id: "settings"', 'heading: "Agent 配置"', 'toolItem("skills", "/skills")', 'toolItem("agents", "/agents")']) {
            const index = sidebar.indexOf(token);
            expect(index).toBeGreaterThan(cursor);
            cursor = index;
        }
        for (const removed of ["新建项目", "项目库", "用量统计", "文本对话", "音频生成", "视频生成", "3D 导演台"]) {
            expect(sidebar).not.toContain(removed);
        }
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
