import type { AiTextMessage } from "@/services/api/image";
import { imageReferenceLabel } from "@/lib/image-reference-prompt";
import type { ReferenceImage } from "@/types/image";
import { CanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";
import { getGenerationResourceNodes, getMentionResourceNodes } from "@/lib/canvas/canvas-resource-references";
import { getNodeResourceKind } from "@/lib/canvas/node-registry";
import { nodeReferenceImage } from "@/lib/canvas/canvas-project-generation";
import { isCanvasWorkflowProvider } from "@/lib/canvas/canvas-workflow";
import type { Asset } from "@/stores/use-asset-store";

export type NodeGenerationContext = {
    prompt: string;
    referenceImages: ReferenceImage[];
    textCount: number;
    imageCount: number;
};

export type NodeGenerationInput = {
    nodeId: string;
    type: "text" | "image";
    title: string;
    text?: string;
    image?: ReferenceImage;
};

export function buildNodeGenerationContext(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], prompt: string, assets: Asset[], promptOnly = false): NodeGenerationContext {
    const connectedInputs = withArkAssetReferenceInputs(buildNodeGenerationInputs(nodeId, nodes, connections), nodes, assets);
    const sourceNode = nodes.find((node) => node.id === nodeId);
    const portraitTextureInput = sourceNode?.type === CanvasNodeType.Image && sourceNode.metadata?.content && sourceNode.metadata?.portraitTexture
        ? (() => {
              const image = readReferenceImage(sourceNode);
              return image ? [{ nodeId: sourceNode.id, type: "image" as const, title: sourceNode.title, image }] : [];
          })()
        : [];
    // 显式 @ 引用必须与提示词面板展示的资源集合一致；默认自动输入仍只取入边，
    // 避免已有图片在没有 @图片N 时被悄悄当作自身参考图。
    const mentionInputs = withArkAssetReferenceInputs(mergeGenerationInputs(buildNodeMentionGenerationInputs(nodeId, nodes, connections), portraitTextureInput, buildAssetGenerationInputs(assets)), nodes, assets);
    assertResolvableGenerationMentions(prompt, mentionInputs);
    const hasExplicitResourceMention = hasResolvableGenerationMention(prompt, mentionInputs);
    const isWorkflowSource = sourceNode?.type === CanvasNodeType.Config && isCanvasWorkflowProvider(sourceNode.metadata);
    const hasConnectedMedia = connectedInputs.some((input) => input.type === "image");
    if ((promptOnly && hasConnectedMedia) || (Boolean(sourceNode?.metadata?.composerContent?.trim()) && (sourceNode?.type === CanvasNodeType.Config || isWorkflowSource)) || hasExplicitResourceMention) {
        return buildComposerGenerationContext(mentionInputs, prompt, autoIncludeWorkflowMedia(mentionInputs, sourceNode, promptOnly, hasConnectedMedia), connectedInputs);
    }

    const textInputs = connectedInputs.filter((input) => input.type === "text");
    const upstreamText = textInputs
        .map((input) => input.text)
        .filter(Boolean)
        .join("\n\n");
    const referenceImages = connectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));

    return {
        prompt: promptOnly ? prompt : upstreamText ? `${prompt}\n\n${upstreamText}` : prompt,
        referenceImages,
        textCount: textInputs.length,
        imageCount: referenceImages.length,
    };
}

/**
 * 工作流节点由字段映射接收全部连线图片；普通节点只在提示词显式 @ 时才带入。
 */
function autoIncludeWorkflowMedia(mentionInputs: NodeGenerationInput[], sourceNode: CanvasNodeData | undefined, promptOnly: boolean, hasConnectedMedia: boolean) {
    const isWorkflowSource = sourceNode?.type === CanvasNodeType.Config && isCanvasWorkflowProvider(sourceNode.metadata);
    if (isWorkflowSource) return true;
    void mentionInputs;
    return promptOnly && hasConnectedMedia;
}

function buildComposerGenerationContext(inputs: NodeGenerationInput[], prompt: string, includeWorkflowMedia: boolean, workflowMediaInputs: NodeGenerationInput[] = []): NodeGenerationContext {
    const normalizedPrompt = normalizeGenerationNodeMentionTokens(prompt, inputs);
    const slotInputByToken = new Map(generationSlotEntries(inputs).map(({ token, input }) => [token, input]));
    const assetInputById = new Map(inputs.filter((input) => input.nodeId.startsWith("asset:")).map((input) => [input.nodeId.slice("asset:".length), input]));
    const nodeInputById = new Map(inputs.filter((input) => !input.nodeId.startsWith("asset:")).map((input) => [input.nodeId, input]));
    const selectedInputs: NodeGenerationInput[] = [];
    const labelByNodeId = new Map<string, string>();
    const textBlocks: string[] = [];
    const counts = { image: 0, text: 0 };
    let hasToken = false;
    let lastIndex = 0;
    let nextPrompt = "";

    if (includeWorkflowMedia) {
        // 先固定“图片1”等提示词标签的顺序，和工作流槽位保持一致；
        // 用户先 @ 第二张图时，提示词也不会把它误标成第一张。
        workflowMediaInputs.forEach((input) => {
            if (input.type === "text" || labelByNodeId.has(input.nodeId)) return;
            labelByNodeId.set(input.nodeId, generationLabel(input.type, counts[input.type]++));
        });
    }

    for (const match of normalizedPrompt.matchAll(GENERATION_MENTION_PATTERN)) {
        if (match.index === undefined) continue;
        nextPrompt += normalizedPrompt.slice(lastIndex, match.index);
        const input = resolveGenerationMention(normalizedPrompt, match, slotInputByToken, nodeInputById, assetInputById);
        if (input) {
            hasToken = true;
            let label = labelByNodeId.get(input.nodeId);
            if (!label) {
                label = generationLabel(input.type, counts[input.type]++);
                labelByNodeId.set(input.nodeId, label);
                if (input.type === "text") textBlocks.push(`【${label}】\n${input.text || ""}`);
                else selectedInputs.push(input);
            }
            nextPrompt += input.type === "text" ? `【${label}】` : `@${label}`;
        } else nextPrompt += match[0];
        lastIndex = match.index + match[0].length;
    }

    nextPrompt += normalizedPrompt.slice(lastIndex);
    // 显式 @文本 引用是用户写进输入框的内容，必须内联真实文本；promptOnly 只拦自动上游文本。
    if (textBlocks.length) nextPrompt = `${nextPrompt.trim()}\n\n${textBlocks.join("\n\n")}`;
    if (includeWorkflowMedia) {
        // 工作流按保存的字段槽位接收图片，配置节点不能因为提示词里没有逐个 @ 就丢失已连接图片；
        // 先按连线顺序放入媒体，素材库中的显式 @ 引用仍保留在后面。
        const explicitInputs = selectedInputs.splice(0);
        const selectedNodeIds = new Set<string>();
        workflowMediaInputs.forEach((input) => {
            if (input.type === "text" || selectedNodeIds.has(input.nodeId)) return;
            selectedInputs.push(input);
            selectedNodeIds.add(input.nodeId);
        });
        explicitInputs.forEach((input) => {
            if (selectedNodeIds.has(input.nodeId)) return;
            selectedInputs.push(input);
            selectedNodeIds.add(input.nodeId);
        });
    }
    const referenceImages = selectedInputs.map((input) => input.image).filter((image): image is ReferenceImage => Boolean(image));

    if (!hasToken && !textBlocks.length && !selectedInputs.length) {
        return {
            prompt,
            referenceImages: [],
            textCount: 0,
            imageCount: 0,
        };
    }

    return {
        prompt: nextPrompt,
        referenceImages,
        textCount: counts.text,
        imageCount: referenceImages.length,
    };
}

const GENERATION_MENTION_PATTERN = /@\[(node|asset):([^\]]+)\]|@(图片|文本)(\d+)/g;

export function generationInputMentionLabel(input: NodeGenerationInput, inputs: NodeGenerationInput[]) {
    const entry = generationSlotEntries(inputs).find((item) => item.input.nodeId === input.nodeId);
    return entry?.label || generationLabel(input.type, 0);
}

export function normalizeGenerationNodeMentionTokens(prompt: string, inputs: NodeGenerationInput[]) {
    const labelByNodeId = new Map(generationSlotEntries(inputs).map(({ input, label }) => [input.nodeId, label]));
    return prompt.replace(/@\[node:([^\]]+)\]/g, (token, nodeId: string) => {
        const label = labelByNodeId.get(nodeId);
        return label ? `@${label}` : token;
    });
}

function hasResolvableGenerationMention(prompt: string, inputs: NodeGenerationInput[]) {
    return inspectGenerationMentions(prompt, inputs).hasResolved;
}

function assertResolvableGenerationMentions(prompt: string, inputs: NodeGenerationInput[]) {
    const { unresolved } = inspectGenerationMentions(prompt, inputs);
    if (!unresolved.length) return;
    throw new Error(`提示词中的 ${unresolved.join("、")} 没有对应的画布资源，请重新选择引用后再生成`);
}

function inspectGenerationMentions(prompt: string, inputs: NodeGenerationInput[]) {
    const normalizedPrompt = normalizeGenerationNodeMentionTokens(prompt, inputs);
    const slotInputByToken = new Map(generationSlotEntries(inputs).map(({ token, input }) => [token, input]));
    const nodeInputById = new Map(inputs.filter((input) => !input.nodeId.startsWith("asset:")).map((input) => [input.nodeId, input]));
    const assetInputById = new Map(inputs.filter((input) => input.nodeId.startsWith("asset:")).map((input) => [input.nodeId.slice("asset:".length), input]));
    const unresolved = new Set<string>();
    let hasResolved = false;
    for (const match of normalizedPrompt.matchAll(GENERATION_MENTION_PATTERN)) {
        if (match[3]) {
            const end = (match.index || 0) + match[0].length;
            if (!hasMentionBoundary(normalizedPrompt, end)) continue;
        }
        if (resolveGenerationMention(normalizedPrompt, match, slotInputByToken, nodeInputById, assetInputById)) hasResolved = true;
        else unresolved.add(match[0]);
    }
    return { hasResolved, unresolved: [...unresolved] };
}

function generationSlotEntries(inputs: NodeGenerationInput[]) {
    const counts = { image: 0, text: 0 };
    return inputs.flatMap((input) => {
        if (input.nodeId.startsWith("asset:")) return [];
        const label = generationLabel(input.type, counts[input.type]++);
        return [{ input, label, token: `@${label}` }];
    });
}

function resolveGenerationMention(
    prompt: string,
    match: RegExpMatchArray,
    slotInputByToken: Map<string, NodeGenerationInput>,
    nodeInputById: Map<string, NodeGenerationInput>,
    assetInputById: Map<string, NodeGenerationInput>,
) {
    if (match[3]) {
        const end = (match.index || 0) + match[0].length;
        return hasMentionBoundary(prompt, end) ? slotInputByToken.get(match[0]) : undefined;
    }
    if (match[1] === "node") return nodeInputById.get(match[2]);
    if (match[1] === "asset") return assetInputById.get(match[2]);
    return undefined;
}

function hasMentionBoundary(value: string, index: number) {
    const char = value[index];
    return !char || /\s|[,.!?;:，。！？；：、)\]}】）]/.test(char);
}

export function buildNodeGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return buildGenerationInputs(getGenerationResourceNodes(nodeId, nodes, connections));
}

function buildNodeMentionGenerationInputs(nodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[]): NodeGenerationInput[] {
    return buildGenerationInputs(getMentionResourceNodes(nodeId, nodes, connections));
}

function buildGenerationInputs(resourceNodes: CanvasNodeData[]): NodeGenerationInput[] {
    return resourceNodes.flatMap((node): NodeGenerationInput[] => {
        const image = readReferenceImage(node);
        if (image) return [{ nodeId: node.id, type: "image" as const, title: node.title, image }];
        const text = readNodeTextInput(node);
        if (text) return [{ nodeId: node.id, type: "text" as const, title: node.title, text }];
        return [];
    });
}

function mergeGenerationInputs(...groups: NodeGenerationInput[][]) {
    const seen = new Set<string>();
    return groups.flatMap((group) =>
        group.filter((input) => {
            if (seen.has(input.nodeId)) return false;
            seen.add(input.nodeId);
            return true;
        }),
    );
}

function buildAssetGenerationInputs(assets: Asset[]): NodeGenerationInput[] {
    return assets.flatMap((asset): NodeGenerationInput[] => {
        const nodeId = `asset:${asset.id}`;
        if (asset.kind === "text") return [{ nodeId, type: "text", title: asset.title, text: asset.data.content }];
        if (asset.kind === "image") return [{ nodeId, type: "image", title: asset.title, image: { id: asset.id, name: asset.title, type: asset.data.mimeType, dataUrl: asset.data.dataUrl, storageKey: asset.data.storageKey, bytes: asset.data.bytes, width: asset.data.width, height: asset.data.height, ...(asset.arkAssetId ? { arkAssetId: asset.arkAssetId } : {}) } }];
        return [];
    });
}

// 图片节点绑定的素材若已录入方舟素材 ID，把 ID 附加到参考图上；是否改用 asset:// 引用
// 由 generation-task 按渠道决定，非方舟渠道与本地回退路径不受影响。
function withArkAssetReferenceInputs(inputs: NodeGenerationInput[], nodes: CanvasNodeData[], assets: Asset[]): NodeGenerationInput[] {
    if (!assets.length) return inputs;
    const nodeById = new Map(nodes.map((node) => [node.id, node]));
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    return inputs.map((input) => {
        if (input.type !== "image" || !input.image || input.image.arkAssetId) return input;
        const boundAssetId = nodeById.get(input.nodeId)?.metadata?.assetId;
        const arkAssetId = boundAssetId ? assetById.get(boundAssetId)?.arkAssetId : undefined;
        return arkAssetId ? { ...input, image: { ...input.image, arkAssetId } } : input;
    });
}

export function buildNodeResponseMessages(context: NodeGenerationContext): AiTextMessage[] {
    if (!context.referenceImages.length) {
        return [{ role: "user", content: context.prompt }];
    }

    return [
        {
            role: "user",
            content: [{ type: "text" as const, text: context.prompt }, ...context.referenceImages.map((image) => ({ type: "image_url" as const, image_url: { url: image.dataUrl } }))],
        },
    ];
}

export async function hydrateNodeGenerationContext(context: NodeGenerationContext) {
    const { imageToDataUrl } = await import("@/services/image-storage");
    const referenceImages = await Promise.all(context.referenceImages.map(async (image) => ({ ...image, dataUrl: await imageToDataUrl(image) })));
    return { ...context, referenceImages, imageCount: referenceImages.length };
}

function readNodeTextInput(node: CanvasNodeData) {
    return node.metadata?.content || node.metadata?.prompt || "";
}

function generationLabel(type: NodeGenerationInput["type"], index: number) {
    if (type === "image") return imageReferenceLabel(index);
    return `文本${index + 1}`;
}

function readReferenceImage(node: CanvasNodeData): ReferenceImage | null {
    if (getNodeResourceKind(node) !== "image") return null;
    return nodeReferenceImage(node);
}
