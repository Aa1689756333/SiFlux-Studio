import { describe, expect, test } from "bun:test";

import { getNodeDefinition, getNodeGenerationMode, getNodeInputKind, getNodeListLabel, getNodeMinSize, getNodeResourceKind, listCreatableNodeDefinitions, shouldKeepAspectRatio } from "../src/lib/canvas/node-registry";
import { connectionInputSummary } from "../src/lib/canvas/canvas-connection-policy";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData, type CanvasNodeMetadata } from "../src/types/canvas";

function node(type: CanvasNodeType, metadata?: CanvasNodeMetadata, id = type): CanvasNodeData {
    return { id, type, title: id, position: { x: 0, y: 0 }, width: 100, height: 100, metadata };
}

const ALL_TYPES = Object.values(CanvasNodeType);

describe("节点注册表——覆盖完整性", () => {
    test("每种节点类型都有定义", () => {
        expect(ALL_TYPES.every((type) => Boolean(getNodeDefinition(type)))).toBe(true);
        for (const type of ALL_TYPES) expect(getNodeMinSize(type)).toBeDefined();
    });

    test("仅生成配置不进创建菜单", () => {
        const hidden = ALL_TYPES.filter((type) => !listCreatableNodeDefinitions().some((def) => def.type === type));
        expect(hidden.sort()).toEqual([CanvasNodeType.Config].sort());
    });
});

describe("节点注册表——几何", () => {
    test("最小尺寸按类型区分", () => {
        expect(getNodeMinSize(CanvasNodeType.Image)).toEqual({ width: 420, height: 236 });
        expect(getNodeMinSize(CanvasNodeType.Text)).toEqual({ width: 220, height: 160 });
    });

    test("仅图片（未开自由比例）锁定宽高比", () => {
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Image))).toBe(true);
        expect(shouldKeepAspectRatio(node(CanvasNodeType.Image, { freeResize: true }))).toBe(false);
        for (const type of [CanvasNodeType.Text, CanvasNodeType.Config, CanvasNodeType.Frame]) {
            expect(shouldKeepAspectRatio(node(type))).toBe(false);
        }
    });
});

describe("节点注册表——素材类型（resourceKind）", () => {
    test("有内容才算素材，空节点不算", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Image, { content: "x" }))).toBe("image");
        expect(getNodeResourceKind(node(CanvasNodeType.Image))).toBeNull();
    });

    test("文本认 content 或 prompt", () => {
        expect(getNodeResourceKind(node(CanvasNodeType.Text, { content: "x" }))).toBe("text");
        expect(getNodeResourceKind(node(CanvasNodeType.Text, { prompt: "p" }))).toBe("text");
        expect(getNodeResourceKind(node(CanvasNodeType.Text))).toBeNull();
    });

    test("生成配置、背板都不是素材", () => {
        for (const type of [CanvasNodeType.Config, CanvasNodeType.Frame]) {
            expect(getNodeResourceKind(node(type, { content: "x" }))).toBeNull();
        }
    });
});

describe("节点注册表——生成模式（generationMode）", () => {
    test("按类型映射", () => {
        expect(getNodeGenerationMode(node(CanvasNodeType.Image))).toBe("image");
    });

    test("生成配置由 metadata 决定，缺省按图片", () => {
        expect(getNodeGenerationMode(node(CanvasNodeType.Config, { generationMode: "image" }))).toBe("image");
        expect(getNodeGenerationMode(node(CanvasNodeType.Config))).toBe("image");
    });

    test("背板不产生生成行为", () => {
        expect(getNodeGenerationMode(node(CanvasNodeType.Frame))).toBeNull();
    });
});

describe("节点注册表——输入计数类别（inputKind）", () => {
    test("生成配置与背板不参与计数，其余各归其类", () => {
        expect(getNodeInputKind(CanvasNodeType.Config)).toBeUndefined();
        expect(getNodeInputKind(CanvasNodeType.Frame)).toBeUndefined();
        expect(getNodeInputKind(CanvasNodeType.Image)).toBe("image");
        expect(getNodeInputKind(CanvasNodeType.Text)).toBe("text");
    });
});

describe("connectionInputSummary——计数与跨类型覆盖", () => {
    const conn = (fromNodeId: string, toNodeId: string): CanvasConnection => ({ id: `c-${fromNodeId}`, fromNodeId, toNodeId });

    test("与内容无关：空图片节点仍计入 imageCount", () => {
        const nodes = [node(CanvasNodeType.Image, undefined, "img"), node(CanvasNodeType.Text, undefined, "target")];
        expect(connectionInputSummary("target", nodes, [conn("img", "target")]).imageCount).toBe(1);
    });

    test("文本节点计入 textCount", () => {
        const nodes = [
            node(CanvasNodeType.Image, undefined, "img"),
            node(CanvasNodeType.Text, undefined, "text"),
            node(CanvasNodeType.Text, undefined, "target"),
        ];
        const summary = connectionInputSummary("target", nodes, [conn("img", "target"), conn("text", "target")]);
        expect(summary.imageCount).toBe(1);
        expect(summary.textCount).toBe(1);
    });

    test("生成配置与背板作为上游一律不计数", () => {
        const nodes = [
            node(CanvasNodeType.Config, undefined, "config"),
            node(CanvasNodeType.Frame, undefined, "frame"),
            node(CanvasNodeType.Text, undefined, "target"),
        ];
        const summary = connectionInputSummary("target", nodes, [conn("config", "target"), conn("frame", "target")]);
        expect(summary).toEqual({ textCount: 0, imageCount: 0, characterCount: 0 });
    });

    test("角色卡覆盖类型归类：图片节点带角色元数据记为角色而非图片", () => {
        const nodes = [node(CanvasNodeType.Image, { workflowKind: "character" }, "char"), node(CanvasNodeType.Text, undefined, "target")];
        const summary = connectionInputSummary("target", nodes, [conn("char", "target")]);
        expect(summary.characterCount).toBe(1);
        expect(summary.imageCount).toBe(0);
    });

    test("不可计数类型即使带角色元数据也不记为角色（排除早于覆盖）", () => {
        const nodes = [node(CanvasNodeType.Frame, { workflowKind: "character" }, "frame"), node(CanvasNodeType.Text, undefined, "target")];
        expect(connectionInputSummary("target", nodes, [conn("frame", "target")]).characterCount).toBe(0);
    });
});

describe("节点注册表——列表标签", () => {
    test("派生自 label，分组显式钉住不带「节点」后缀", () => {
        expect(getNodeListLabel(CanvasNodeType.Image)).toBe("图片节点");
        expect(getNodeListLabel(CanvasNodeType.Text)).toBe("提示词节点");
        expect(getNodeListLabel(CanvasNodeType.Config)).toBe("生图配置节点");
        expect(getNodeListLabel(CanvasNodeType.Frame)).toBe("分组");
    });
});