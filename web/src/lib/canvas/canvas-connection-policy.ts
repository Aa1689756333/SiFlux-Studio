import { maxModelInputCapacity, type ModelInputSummary } from "@/lib/model-selection";
import { getNodeAcceptedInputKinds, getNodeGenerationMode, getNodeInputKind, getNodeListLabel, getNodeMaxInputCount, type CanvasNodeInputKind } from "@/lib/canvas/node-registry";
import type { AiConfig } from "@/stores/use-config-store";
import { type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

type ConnectionCandidate = Pick<CanvasConnection, "fromNodeId" | "toNodeId">;
type CanvasConnectionPolicyOptions = {
    // 仅跳过参考素材数量上限，媒体类型不兼容仍然拒绝。
    ignoreCapacity?: boolean;
};

export function canvasConnectionError(config: AiConfig, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate: ConnectionCandidate, options: CanvasConnectionPolicyOptions = {}) {
    const target = nodes.find((node) => node.id === candidate.toNodeId);
    if (!target) return "找不到连线目标节点";
    const acceptedInputKinds = getNodeAcceptedInputKinds(target.type);
    if (acceptedInputKinds.length) {
        const source = nodes.find((node) => node.id === candidate.fromNodeId);
        const sourceKind = source ? getNodeInputKind(source.type) : undefined;
        if (!sourceKind || !acceptedInputKinds.includes(sourceKind)) {
            const labels = acceptedInputKinds.map(acceptedInputKindLabel).join("或");
            return `${getNodeListLabel(target.type)}只接受${labels}输入`;
        }
        const maxInputCount = getNodeMaxInputCount(target.type);
        if (maxInputCount) {
            const inputCount = new Set(
                [...connections, { id: "candidate", ...candidate }]
                    .filter((connection) => connection.toNodeId === target.id)
                    .map((connection) => connection.fromNodeId),
            ).size;
            if (inputCount > maxInputCount) return `当前节点最多连接 ${maxInputCount} 个输入`;
        }
    }
    const mode = getNodeGenerationMode(target);
    if (!mode) return "";
    const input = connectionInputSummary(target.id, nodes, connections, candidate);
    if (mode === "image") {
        const visualInputCount = input.imageCount + input.characterCount;
        return options.ignoreCapacity ? "" : capacityError(config, visualInputCount, "参考图");
    }
    return "";
}

function acceptedInputKindLabel(kind: CanvasNodeInputKind) {
    return kind === "image" ? "图片" : "文本";
}

export function connectionInputSummary(targetNodeId: string, nodes: CanvasNodeData[], connections: CanvasConnection[], candidate?: ConnectionCandidate): ModelInputSummary {
    const sourceIds = new Set([...connections, ...(candidate ? [{ id: "candidate", ...candidate }] : [])].filter((connection) => connection.toNodeId === targetNodeId).map((connection) => connection.fromNodeId));
    const input: ModelInputSummary = { textCount: 0, imageCount: 0, characterCount: 0 };
    sourceIds.forEach((sourceId) => {
        const source = nodes.find((node) => node.id === sourceId);
        if (!source) return;
        // 生成配置与背板不是参考素材，不参与容量计数——这一步必须早于角色卡判定，
        // 否则一个带角色元数据的配置/背板节点会被多算成角色。
        const inputKind = getNodeInputKind(source.type);
        if (!inputKind) return;
        // 角色卡是跨类型覆盖：落在可计数类型上时改记为角色。
        if (source.metadata?.workflowKind === "character") input.characterCount += 1;
        else if (inputKind === "image") input.imageCount += 1;
        else input.textCount += 1;
    });
    return input;
}

function capacityError(config: AiConfig, count: number, label: string) {
    const maximum = maxModelInputCapacity(config, "image", "image");
    if (maximum === null || count <= maximum) return "";
    return maximum > 0 ? `已配置模型最多支持 ${maximum} 张${label}` : `已配置模型均不支持${label}`;
}
