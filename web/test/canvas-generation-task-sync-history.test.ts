import { describe, expect, test } from "bun:test";

import { buildGenerationTaskNodeResult, type GenerationResultMediaIO } from "../src/lib/canvas/canvas-generation-task-sync";
import { CanvasNodeType, type CanvasNodeData } from "../src/types/canvas";
import type { GenerationTask } from "../src/services/api/task-center";

function imageNode(): CanvasNodeData {
    return {
        id: "image-node",
        type: CanvasNodeType.Image,
        title: "主图",
        position: { x: 40, y: 40 },
        width: 320,
        height: 180,
        metadata: { prompt: "历史结果" },
    };
}

function task(type: string, result: unknown): GenerationTask {
    return {
        id: `task-${type}`,
        projectId: "7vvfM674HnenwTekmj88V",
        type,
        status: "succeeded",
        prompt: "历史结果",
        resultJson: JSON.stringify(result),
        attempts: 1,
        createdAt: "2026-09-24T00:00:00.000Z",
        updatedAt: "2026-09-24T00:00:00.000Z",
    };
}

function mockIO() {
    const resolveImageCalls: Array<[string | undefined, string]> = [];
    const uploaded: string[] = [];
    const io: GenerationResultMediaIO = {
        resolveImageUrl: async (storageKey, fallback = "") => {
            resolveImageCalls.push([storageKey, fallback]);
            return `resolved-image:${storageKey}:${fallback}`;
        },
        uploadImage: async (src) => {
            uploaded.push(src);
            return { url: "uploaded-image", storageKey: "image:new", width: 12, height: 8, bytes: 4, mimeType: "image/png" };
        },
    };
    return { io, resolveImageCalls, uploaded };
}

describe("buildGenerationTaskNodeResult history reuse", () => {
    test("reuses image: IndexedDB keys without upload even when the blob URL is expired", async () => {
        const { io, resolveImageCalls, uploaded } = mockIO();
        const image = await buildGenerationTaskNodeResult(
            imageNode(),
            task("canvas_image", {
                images: [{ dataUrl: "blob:http://127.0.0.1/expired-image", storageKey: "image:local-1", width: 64, height: 36 }],
            }),
            undefined,
            io,
        );

        expect(image.metadata?.storageKey).toBe("image:local-1");
        expect(resolveImageCalls).toEqual([["image:local-1", "blob:http://127.0.0.1/expired-image"]]);
        expect(uploaded).toEqual([]);
    });

    test("reuses owned resource HTTP URLs for image when storageKey is missing", async () => {
        const { io, resolveImageCalls, uploaded } = mockIO();
        const imageUrl = "http://127.0.0.1:3184/api/resources/image-owned/file";
        const image = await buildGenerationTaskNodeResult(
            imageNode(),
            task("canvas_image", {
                images: [{ dataUrl: imageUrl, width: 64, height: 36 }],
            }),
            undefined,
            io,
        );

        expect(image.metadata?.storageKey).toBe("resource:image-owned");
        expect(resolveImageCalls[0]?.[0]).toBe("resource:image-owned");
        expect(uploaded).toEqual([]);
    });
});