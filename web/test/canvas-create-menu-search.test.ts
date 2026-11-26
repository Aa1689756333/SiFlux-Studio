import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const source = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-create-menu.tsx"), "utf8");
const toolbarSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-toolbar.tsx"), "utf8");
const definitions = readFileSync(resolve(import.meta.dir, "../src/lib/canvas/tool-registry/definitions/add-node-menu-tools.tsx"), "utf8");
const contextMenuSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-context-menu.tsx"), "utf8");

describe("LibTV add-node menu search", () => {
    test("exposes a list-layout search control", () => {
        expect(source).toContain('aria-label={searchOpen ? "关闭节点搜索" : "搜索节点"}');
        expect(source).toContain('placeholder="搜索节点"');
    });

    test("filters labels and badges without changing command callbacks", () => {
        expect(source).toContain('`${command.label} ${command.badge || ""}`');
        expect(source).toContain("visibleCommands.filter");
        expect(source).toContain("if (!command.disabledReason) command.onClick()");
    });

    test("uses the LibTV compact list and exposes the resource-history entry", () => {
        expect(toolbarSource).toContain('<CanvasCreateMenu commands={commands} layout="list" />');
        expect(toolbarSource).toContain("w-[232px]");
        expect(definitions).toContain('label: "从生图历史选择"');
        expect(definitions).toContain('label: "上传图片"');
        expect(definitions).toContain('label: "图片素材库"');
        expect(definitions).not.toContain('label: "智能剪辑"');
    });

    test("right-click add-node menu carries the supported node set without disabled placeholders", () => {
        expect(definitions).toContain("nodeCommand(CanvasNodeType.Image");
        expect(definitions).toContain("nodeCommand(CanvasNodeType.Text");
        expect(definitions).toContain("nodeCommand(CanvasNodeType.Frame");
        expect(definitions).not.toContain("CANVAS_DEVELOPING_LABEL");
        expect(contextMenuSource).toContain('w-[232px]');
        expect(contextMenuSource).toContain('layout="list"');
        expect(contextMenuSource).toContain("resolveAddNodeMenuCommands(createContext)");
    });
});
