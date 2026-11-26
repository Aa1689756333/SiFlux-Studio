import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, test } from "bun:test";

import {
    canvasMediaNodeOrigin,
    canvasMediaNodeRole,
    canvasMediaNodeSemanticLabel,
    canOpenCanvasNodePromptPanel,
    isCanvasMediaResultNode,
    mediaGeneratorMetadata,
    mediaResultMetadata,
    normalizeCanvasMediaNodeSemantics,
} from "../src/lib/canvas/canvas-node-semantics";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import { getNodeGenerationMode } from "../src/lib/canvas/node-registry";
import "../src/lib/canvas/node-registry/definitions/builtin-nodes";
import { createCanvasNode } from "../src/lib/canvas/canvas-project-domain";

const canvasNodeSource = readFileSync(resolve(import.meta.dir, "../src/components/canvas/canvas-node.tsx"), "utf8");

function mediaNode(metadata: CanvasNodeData["metadata"] = {}): CanvasNodeData {
    return { id: "image-1", type: CanvasNodeType.Image, title: "图片", position: { x: 0, y: 0 }, width: 320, height: 180, metadata };
}

describe("canvas media node semantics", () => {
    test("empty media nodes are generators and own the prompt panel", () => {
        const node = mediaNode();
        expect(canvasMediaNodeRole(node)).toBe("generator");
        expect(canOpenCanvasNodePromptPanel(node)).toBe(true);
    });

    test("populated media generators keep the prompt panel and expose result tools", () => {
        const node = mediaNode({ nodeRole: "generator", content: "blob:image", status: "success" });
        expect(canvasMediaNodeRole(node)).toBe("generator");
        expect(canOpenCanvasNodePromptPanel(node)).toBe(true);
        expect(isCanvasMediaResultNode(node)).toBe(true);
    });

    test("generated result nodes keep their prompt panel and generation capability", () => {
        const node = mediaNode({ nodeRole: "result", resultOrigin: "generated", content: "blob:image", prompt: "revise the result", generationType: "generation" });
        expect(canOpenCanvasNodePromptPanel(node)).toBe(true);
        expect(getNodeGenerationMode(node)).toBe("image");
    });

    test("uploaded and library results do not acquire generation controls", () => {
        const imported = mediaNode({ nodeRole: "result", resultOrigin: "upload", content: "image", prompt: "filename" });
        const library = mediaNode({ nodeRole: "result", resultOrigin: "library", content: "image", assetId: "asset-1" });
        expect(canOpenCanvasNodePromptPanel(imported)).toBe(false);
        expect(canOpenCanvasNodePromptPanel(library)).toBe(false);
        expect(getNodeGenerationMode(imported)).toBeNull();
        expect(getNodeGenerationMode(library)).toBeNull();
    });

    test("explicit role wins over legacy content inference", () => {
        expect(canvasMediaNodeRole(mediaNode({ nodeRole: "generator", content: "preview" }))).toBe("generator");
        expect(canvasMediaNodeRole(mediaNode({ nodeRole: "result" }))).toBe("result");
    });

    test("legacy source fields recover upload, library and generated origins", () => {
        expect(canvasMediaNodeOrigin(mediaNode({ content: "upload", fileUpload: "uploading" }))).toBe("upload");
        expect(canvasMediaNodeOrigin(mediaNode({ content: "library", assetId: "asset-1" }))).toBe("library");
        expect(canvasMediaNodeOrigin(mediaNode({ content: "generated", taskId: "task-1" }))).toBe("generated");
        expect(canvasMediaNodeOrigin(mediaNode({ content: "imported", importSource: "libtv" }))).toBe("imported");
    });

    test("normalization persists inferred semantics without mutating legacy nodes", () => {
        const legacy = mediaNode({ content: "clip", assetId: "asset-1" });
        const normalized = normalizeCanvasMediaNodeSemantics(legacy);
        expect(normalized).not.toBe(legacy);
        expect(legacy.metadata?.nodeRole).toBeUndefined();
        expect(normalized.metadata?.nodeRole).toBe("result");
        expect(normalized.metadata?.resultOrigin).toBe("library");
    });

    test("creation helpers stamp role and origin while preserving caller metadata", () => {
        expect(mediaGeneratorMetadata({ generationMode: "image", prompt: "move" })).toEqual({
            generationMode: "image", prompt: "move", nodeRole: "generator", resultOrigin: undefined,
        });
        expect(mediaResultMetadata("upload", { content: "blob:image", prompt: "filename" })).toEqual({
            content: "blob:image", prompt: "filename", nodeRole: "result", resultOrigin: "upload",
        });
        expect(isCanvasMediaResultNode(mediaNode({ nodeRole: "result", content: "clip" }))).toBe(true);
        expect(isCanvasMediaResultNode(mediaNode())).toBe(false);
    });

    test("generated media remains a generation target after it has a result", () => {
        expect(getNodeGenerationMode(mediaNode())).toBe("image");
        expect(getNodeGenerationMode(mediaNode({ nodeRole: "generator", content: "clip" }))).toBe("image");
        expect(getNodeGenerationMode(mediaNode({ nodeRole: "result", resultOrigin: "derived", content: "clip" }))).toBeNull();
    });

    test("semantic labels distinguish generators and every result origin", () => {
        expect(canvasMediaNodeSemanticLabel(mediaNode({ nodeRole: "generator" }))).toBe("生成节点");
        expect(canvasMediaNodeSemanticLabel(mediaNode({ nodeRole: "result", resultOrigin: "upload", content: "clip" }))).toBe("已上传");
        expect(canvasMediaNodeSemanticLabel(mediaNode({ nodeRole: "result", resultOrigin: "library", content: "clip" }))).toBe("素材库");
        expect(canvasMediaNodeSemanticLabel(mediaNode({ nodeRole: "result", resultOrigin: "generated", content: "clip" }))).toBe("AI 生成");
        expect(canvasMediaNodeSemanticLabel(mediaNode({ nodeRole: "result", resultOrigin: "derived", content: "clip" }))).toBe("处理结果");
    });

    test("keeps internal media semantics out of node-card presentation", () => {
        expect(canvasNodeSource).toContain('data-media-role={canvasMediaNodeRole(data) || undefined}');
        expect(canvasNodeSource).toContain('data-result-origin={canvasMediaNodeOrigin(data) || undefined}');
        expect(canvasNodeSource).not.toContain("MediaSemanticBadge");
        expect(canvasNodeSource).not.toContain("ResourceLabelBadge");
        expect(canvasNodeSource).not.toContain("ResourceStorageBadge");
        expect(canvasNodeSource).not.toContain("AssetTagBadges");
        expect(canvasNodeSource).toContain("dimensionLabel={null}");
    });

    test("central node factory always persists media semantics", () => {
        expect(createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }).metadata?.nodeRole).toBe("generator");
        const library = createCanvasNode(CanvasNodeType.Image, { x: 0, y: 0 }, { content: "clip", assetId: "asset-1" });
        expect(library.metadata?.nodeRole).toBe("result");
        expect(library.metadata?.resultOrigin).toBe("library");
    });
});