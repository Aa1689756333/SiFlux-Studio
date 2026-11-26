import { describe, expect, test } from "bun:test";

import { autoMentionCanvasResourceReferences, findCanvasResourceAutoLinkMatch, type CanvasResourceReference, applyCanvasConnectionPromptSync, buildAssetMentionReferences, buildCanvasNodeMentionReferenceMap, buildNodeMentionReferences, buildOrderedCanvasResourceReferences, canvasResourceMentionToken, imageGenerationReferenceConnections, reorderCanvasResourceConnections, replaceCanvasReferenceMentions } from "../src/lib/canvas/canvas-resource-references";
import { bindCanvasNodeResourceAsset, bindMissingCanvasResourceAssets, canvasNodeToAsset, canvasNodesMissingResourceAssetBinding } from "../src/lib/canvas/canvas-node-asset";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "../src/types/canvas";

const smartReferences: CanvasResourceReference[] = [
    { id: "image-6", nodeId: "image-6", kind: "image", label: "图片6", title: "宫门全景", active: true },
    { id: "text-1", nodeId: "text-1", kind: "text", label: "文本1", title: "唐妙菱", active: true },
];

describe("canvas smart references", () => {
    test("converts repeated names and aliases without rewriting existing mentions", () => {
        expect(autoMentionCanvasResourceReferences("图片6在前景，图6退后；宫门全景可见。唐妙菱看向图片60。", smartReferences))
            .toBe("@图片6 在前景，@图片6 退后；@图片6 可见。@文本1 看向图片60。");
        const existing = "已有 @图片6 和 @[node:image-6]、@[asset:宫门全景]。";
        expect(autoMentionCanvasResourceReferences(existing, smartReferences)).toBe(existing);
        expect(autoMentionCanvasResourceReferences("请使用 2。不要改约2秒。", smartReferences)).toBe("请使用 @文本1。不要改约2秒。");
    });

    test("returns exact replacement offsets for names and shelf orders", () => {
        for (const alias of ["唐妙菱", "文本1", "2", "image2", "image 2"]) {
            const prompt = `请使用 ${alias}，然后继续`;
            expect(findCanvasResourceAutoLinkMatch(prompt, 4 + alias.length, smartReferences))
                .toEqual({ reference: smartReferences[1], start: 4, end: 4 + alias.length, query: alias });
        }
    });

    test("skips inactive, library and skill references and ambiguous names", () => {
        const excluded: CanvasResourceReference[] = [
            { ...smartReferences[0], active: false },
            { ...smartReferences[1], assetId: "library" },
            { ...smartReferences[1], kind: "skill" },
        ];
        expect(autoMentionCanvasResourceReferences("宫门全景 唐妙菱 1", excluded)).toBe("宫门全景 唐妙菱 1");
        expect(findCanvasResourceAutoLinkMatch("唐妙菱", 3, excluded)).toBeNull();
        const ambiguous = [smartReferences[0], { ...smartReferences[1], title: "宫门全景" }];
        expect(autoMentionCanvasResourceReferences("宫门全景", ambiguous)).toBe("宫门全景");
        expect(findCanvasResourceAutoLinkMatch("宫门全景", 4, ambiguous)).toBeNull();
    });

    test("does not complete partial identifiers, existing tokens or ordinary numbers", () => {
        for (const [prompt, cursor] of [
            ["@图片6", 4], ["@[node:宫门全景", 10], ["@前缀宫门全景", 7],
            ["myimage2", 8], ["图片60", 3], ["2秒", 1], ["约2", 2], ["20", 1],
            ["", 0], ["2", 5],
        ] as const) {
            expect(findCanvasResourceAutoLinkMatch(prompt, cursor, smartReferences)).toBeNull();
        }
    });

    test("escapes regular expression characters and preserves explicit mention tokens", () => {
        const reference = { ...smartReferences[0], title: "场景(夜)+", mentionToken: "@[node:image-6]" };
        expect(autoMentionCanvasResourceReferences("场景(夜)+出现", [reference])).toBe("@[node:image-6] 出现");
        expect(findCanvasResourceAutoLinkMatch(reference.title, reference.title.length, [reference])?.reference).toBe(reference);
    });
});

function configNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Config,
        title: id,
        position: { x: 0, y: 0 },
        width: 320,
        height: 180,
        metadata: {},
    };
}

function textNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Text,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 60,
        metadata: { content: id },
    };
}

function imageNode(id: string): CanvasNodeData {
    return {
        id,
        type: CanvasNodeType.Image,
        title: id,
        position: { x: 0, y: 0 },
        width: 100,
        height: 100,
        metadata: { content: `data:image/png;base64,${id}` },
    };
}

function connection(fromNodeId: string, toNodeId: string): CanvasConnection {
    return { id: `conn-${fromNodeId}-${toNodeId}`, fromNodeId, toNodeId };
}

describe("canvas resource mention slots", () => {
    test("finds resource-backed media nodes that must be linked before syncing a canvas snapshot", () => {
        const source = imageNode("legacy-image");
        source.metadata = { content: "https://cdn.example.com/image.png", storageKey: "resource:image-resource" };
        const urlOnly = imageNode("url-only-image");
        urlOnly.metadata = { content: "/api/resources/image-resource/file" };
        const alreadyBound = imageNode("bound-image");
        alreadyBound.metadata = { content: "https://cdn.example.com/other.png", storageKey: "resource:other-resource", assetId: "asset-other" };
        const localOnly = imageNode("local-image");
        localOnly.metadata = { content: "data:image/png;base64,local" };
        const substringInQuery = imageNode("query-image");
        substringInQuery.metadata = { content: "https://cdn.example.com/preview.png?redirect=/api/resources/fake-res/file" };
        const substringInNote = imageNode("note-image");
        substringInNote.metadata = { content: "note: see /api/resources/fake-res/file" };

        expect(canvasNodesMissingResourceAssetBinding([source, urlOnly, alreadyBound, localOnly, substringInQuery, substringInNote]).map((node) => node.id)).toEqual(["legacy-image", "url-only-image"]);

        const urlOnlyAsset = canvasNodeToAsset(urlOnly, { canvasId: "canvas-1", source: "canvas-upload" });
        expect(urlOnlyAsset?.kind).toBe("image");
        expect(urlOnlyAsset && "storageKey" in urlOnlyAsset.data ? urlOnlyAsset.data.storageKey : undefined).toBe("resource:image-resource");
    });

    test("history insert reuses the owned asset for the same resource without guessing across conflicting siblings", () => {
        const original = imageNode("original");
        original.metadata = { assetId: "asset-owned", storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const conflictingSibling = imageNode("conflicting");
        conflictingSibling.metadata = { assetId: "asset-other-copy", storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const history = imageNode("history");
        history.metadata = { storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const bound = bindCanvasNodeResourceAsset(history, [original], []);
        expect(bound.metadata?.assetId).toBe("asset-owned");
        expect(canvasNodesMissingResourceAssetBinding([original, bound])).toEqual([]);
        expect(bindCanvasNodeResourceAsset(history, [original, conflictingSibling], []).metadata?.assetId).toBeUndefined();

        const fromStore = bindCanvasNodeResourceAsset(history, [], [{
            id: "asset-from-store",
            kind: "image",
            title: "场景图",
            coverUrl: "",
            tags: [],
            createdAt: "2026-09-24T00:00:00.000Z",
            updatedAt: "2026-09-24T00:00:00.000Z",
            data: { dataUrl: "/api/resources/image-owned/file", storageKey: "resource:image-owned", width: 100, height: 100, bytes: 8, mimeType: "image/png" },
        }]);
        expect(fromStore.metadata?.assetId).toBe("asset-from-store");
        expect(bindCanvasNodeResourceAsset(history, [], []).metadata?.assetId).toBeUndefined();
    });

    test("history insert binds cached unbound siblings and the new node to the same resource", async () => {
        const original = imageNode("original");
        original.metadata = { assetId: "asset-owned", storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const cachedHistory = imageNode("cached-history");
        cachedHistory.metadata = { storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const inserted = imageNode("inserted-history");
        inserted.metadata = { storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const ensured: string[] = [];
        const bound = await bindMissingCanvasResourceAssets([original, cachedHistory, inserted], [], async (node) => {
            ensured.push(node.id);
            return { assetId: "asset-should-not-create" };
        });
        expect(ensured).toEqual([]);
        expect(bound.map((node) => node.id)).toEqual(["original", "cached-history", "inserted-history"]);
        expect(bound.map((node) => node.metadata?.assetId)).toEqual(["asset-owned", "asset-owned", "asset-owned"]);
        expect(canvasNodesMissingResourceAssetBinding(bound)).toEqual([]);

        const unboundOriginal = imageNode("unbound-original");
        unboundOriginal.metadata = { storageKey: "resource:image-owned", content: "/api/resources/image-owned/file" };
        const created: string[] = [];
        const repaired = await bindMissingCanvasResourceAssets([unboundOriginal, cachedHistory, inserted], [], async (node) => {
            created.push(node.id);
            return { assetId: "asset-ensured" };
        });
        expect(created).toEqual(["unbound-original"]);
        expect(repaired.map((node) => node.metadata?.assetId)).toEqual(["asset-ensured", "asset-ensured", "asset-ensured"]);
    });

    test("素材库图片与文本引用分别暴露预览与正文", () => {
        const references = buildAssetMentionReferences([
            {
                id: "image-asset",
                kind: "image",
                title: "场景图",
                coverUrl: "https://cdn.example.com/cover.png",
                tags: [],
                createdAt: "2026-08-31T00:00:00.000Z",
                updatedAt: "2026-08-31T00:00:00.000Z",
                data: { dataUrl: "https://cdn.example.com/image.png", storageKey: "resource:image", width: 1280, height: 720, bytes: 1, mimeType: "image/png" },
            },
            {
                id: "text-asset",
                kind: "text",
                title: "旁白",
                coverUrl: "https://cdn.example.com/text-cover.png",
                tags: [],
                createdAt: "2026-08-31T00:00:00.000Z",
                updatedAt: "2026-08-31T00:00:00.000Z",
                data: { content: "第一幕" },
            },
        ]);

        expect(references[0]?.kind).toBe("image");
        expect(references[0]?.previewUrl).toBe("https://cdn.example.com/image.png");
        expect(references[0]?.storageKey).toBe("resource:image");
        expect(references[1]?.kind).toBe("text");
        expect(references[1]?.previewUrl).toBe("https://cdn.example.com/text-cover.png");
        expect(references[1]?.text).toBe("第一幕");
    });

    test("仅有持久资源键的媒体节点仍可恢复为素材且不伪造临时地址", () => {
        const node = imageNode("storage-key-only-image");
        node.metadata = {
            storageKey: "  image:user:durable  ",
            mimeType: "image/png",
        };

        const asset = canvasNodeToAsset(node, { canvasId: "canvas", source: "canvas-upload" });

        expect(asset?.kind).toBe("image");
        expect(asset?.kind === "image" ? asset.data.dataUrl : "not-image").toBe("");
        expect(asset?.kind === "image" ? asset.data.storageKey : undefined).toBe("image:user:durable");
    });

    test("画布节点引用只保存类型位置，不保存节点 ID", () => {
        const target = configNode("target");
        const image = imageNode("image-a");
        const [reference] = buildNodeMentionReferences(target, [image, target], [connection(image.id, target.id)]);

        expect(reference.label).toBe("图片1");
        expect(canvasResourceMentionToken(reference)).toBe("@图片1");
        expect(canvasResourceMentionToken(reference)).not.toContain(image.id);
    });

    test("图片和文本分别按各自类型顺序编号", () => {
        const target = configNode("target");
        const nodes = [imageNode("image-a"), textNode("text-a"), imageNode("image-b"), target];
        const connections = nodes.slice(0, -1).map((node) => connection(node.id, target.id));

        expect(buildNodeMentionReferences(target, nodes, connections).map((reference) => reference.label)).toEqual(["图片1", "文本1", "图片2"]);
    });

    test("批量索引保持直接引用和配置节点引用语义", () => {
        const image = imageNode("image-a");
        const text = textNode("text-a");
        const target = imageNode("target");
        const config = configNode("config");
        const nodes = [image, text, target, config];
        const connections = [connection(image.id, target.id), connection(target.id, config.id), connection(text.id, config.id)];
        const references = buildCanvasNodeMentionReferenceMap(nodes, connections);

        expect(references.get(target.id)?.map((reference) => reference.nodeId)).toEqual([text.id]);
        expect(references.get(config.id)?.map((reference) => reference.nodeId)).toEqual([target.id, text.id]);
        expect(references.get(image.id)?.map((reference) => reference.nodeId)).toEqual([]);
        expect(buildNodeMentionReferences(image, nodes, connections).map((reference) => reference.nodeId)).toEqual([image.id]);
    });

    test("素材库身份 token 保持稳定", () => {
        expect(canvasResourceMentionToken({
            id: "asset:asset-a",
            nodeId: "",
            assetId: "asset-a",
            kind: "image",
            label: "场景图",
            title: "场景图",
            active: false,
        })).toBe("@[asset:asset-a]");
    });

    test("按连线顺序暴露画布资源引用，并按类型稳定编号", () => {
        const references = buildOrderedCanvasResourceReferences([imageNode("image-a"), textNode("text-a")]);
        expect(references.map((reference) => reference.label)).toEqual(["图片1", "文本1"]);
        expect(references.map((reference) => reference.active)).toEqual([true, true]);
    });
});

describe("remove canvas resource mention tokens", () => {
    test("断开首图时同步紧邻中文、连续引用及两位数编号", () => {
        const images = Array.from({ length: 10 }, (_, index) => imageNode(`image-${index}`));
        const target = {
            ...configNode("target"),
            metadata: { composerContent: "@图片1@图片2的人物参考@图片10，@[node:image-1]保持一致" },
        };
        const nodes = [...images, target];
        const connections = images.map((image) => connection(image.id, target.id));
        const result = applyCanvasConnectionPromptSync(nodes, connections, nodes, connections.slice(1));
        expect(result.find((node) => node.id === target.id)?.metadata?.composerContent)
            .toBe("@图片1的人物参考@图片9，@图片1保持一致");
    });

    test("取消引用后会清掉对应的 @图片N", () => {
        const image = imageNode("image-a");
        const target = {
            ...configNode("target"),
            metadata: { composerContent: "@图片1 生成角色设定图：保持同一角色身份。" },
        };
        const previousConnections = [connection(image.id, target.id)];
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], previousConnections, [image, target], []).filter((node) => node.id === target.id);

        expect(nextTarget.metadata?.composerContent).toBe("生成角色设定图：保持同一角色身份。");
        expect(nextTarget.metadata?.composerContent).not.toContain("@图片1");
    });

    test("同时存在节点 token 时一并清掉", () => {
        const image = imageNode("image-a");
        const target = {
            ...configNode("target"),
            metadata: { composerContent: "让 @图片1 和 @[node:image-a] 一起进入画面" },
        };
        const [nextTarget] = applyCanvasConnectionPromptSync([image, target], [connection(image.id, target.id)], [image, target], []).filter((node) => node.id === target.id);
        expect(nextTarget.metadata?.composerContent).toBe("让 和 一起进入画面");
        expect(nextTarget.metadata?.composerContent).not.toContain("@图片1");
        expect(nextTarget.metadata?.composerContent).not.toContain("@[node:image-a]");
    });

    test("多图时只清被移除的那张，并把剩余引用重新编号", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = {
            ...configNode("target"),
            metadata: { composerContent: "比较 @图片1 和 @图片2" },
        };
        const previousConnections = [connection(imageA.id, target.id), connection(imageB.id, target.id)];
        const nextConnections = [connection(imageB.id, target.id)];
        const [nextTarget] = applyCanvasConnectionPromptSync([imageA, imageB, target], previousConnections, [imageA, imageB, target], nextConnections).filter((node) => node.id === target.id);

        expect(nextTarget.metadata?.composerContent).toBe("比较 和 @图片1");
    });
});

describe("image generation reference connections", () => {
    test("把源节点的参考图连线复制到新结果，避免提示词图片丢失", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const source = textNode("prompt");
        const nodes = [imageA, imageB, source];
        const connections = [connection(imageA.id, source.id), connection(imageB.id, source.id)];
        const copied = imageGenerationReferenceConnections(source.id, "result", nodes, connections, () => "new-id");
        expect(copied.map((item) => item.fromNodeId)).toEqual(["image-a", "image-b"]);
        expect(copied.every((item) => item.toNodeId === "result")).toBe(true);
    });
});

describe("reorder canvas resource connections", () => {
    test("直接引用按指定顺序换位并同步编号提示词", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = { ...configNode("target"), metadata: { composerContent: "比较 @图片1 和 @图片2" } };
        const nodes = [imageA, imageB, target];
        const previousConnections = [connection(imageA.id, target.id), connection(imageB.id, target.id)];
        const nextConnections = reorderCanvasResourceConnections(target.id, [imageB.id, imageA.id], nodes, previousConnections);
        expect(nextConnections.map((item) => item.fromNodeId)).toEqual([imageB.id, imageA.id]);
        const nextNodes = applyCanvasConnectionPromptSync(nodes, previousConnections, nodes, nextConnections);
        expect(nextNodes.find((node) => node.id === target.id)?.metadata?.composerContent).toBe("比较 @图片2 和 @图片1");
    });

    test("配置节点承接的引用可排序且不改变主链和无关连线", () => {
        const imageA = imageNode("image-a");
        const imageB = imageNode("image-b");
        const target = imageNode("target");
        const config = configNode("config");
        const other = textNode("other");
        const main = connection(target.id, config.id);
        const unrelated = connection(imageA.id, other.id);
        const previousConnections = [main, connection(imageA.id, config.id), unrelated, connection(imageB.id, config.id)];
        const nextConnections = reorderCanvasResourceConnections(target.id, [imageB.id, imageA.id], [imageA, imageB, target, config, other], previousConnections);
        expect(nextConnections).toEqual([main, connection(imageB.id, config.id), unrelated, connection(imageA.id, config.id)]);
        expect(nextConnections[0]).toBe(main);
        expect(nextConnections[2]).toBe(unrelated);
    });
});

describe("replace canvas reference mentions", () => {
    test("替换参考图时将提示词内所有提及同张图片的标记全部替换", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "图片1",
            title: "卡通可爱动画风画册",
            active: true,
        };
        const prompt = "@图片1 参考 @图片2 生成，保持 @图片1 的色调与 @卡通可爱动画风画册 的画风";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "@图片3", "未来赛博超跑");
        expect(replaced).toBe("@图片3 参考 @图片2 生成，保持 @图片3 的色调与 @未来赛博超跑 的画风");
    });

    test("不会误替换较长数字或无关标记", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "图片1",
            title: "画册",
            active: true,
        };
        const prompt = "@图片1 和 @图片10 及 @图片11，不要改动 @图片10";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "@图片9");
        expect(replaced).toBe("@图片9 和 @图片10 及 @图片11，不要改动 @图片10");
    });

    test("自动规范化带有或缺失@前缀的参数", () => {
        const oldRef: CanvasResourceReference = {
            id: "node-old",
            nodeId: "node-old",
            kind: "image",
            label: "@图片1",
            title: "@画册",
            active: true,
        };
        const prompt = "@图片1 的画风结合 @画册 的色调";
        const replaced = replaceCanvasReferenceMentions(prompt, oldRef, "图片2", "新封面");
        expect(replaced).toBe("@图片2 的画风结合 @新封面 的色调");
    });
});
