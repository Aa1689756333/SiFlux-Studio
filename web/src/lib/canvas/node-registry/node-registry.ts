import { CanvasNodeType, type CanvasNodeData, type CanvasNodeTypeId } from "@/types/canvas";

import type { CanvasNodeDefinition } from "./node-definition";

const definitions = new Map<CanvasNodeTypeId, CanvasNodeDefinition>();
const supportedTypes = new Set([CanvasNodeType.Image, CanvasNodeType.Text, CanvasNodeType.Config, CanvasNodeType.Frame]);
const FALLBACK_MIN_SIZE = { width: 220, height: 160 } as const;

/** 仅注册保留的内置类型；重复初始化按类型覆盖，历史未知节点不参与注册。 */
export function registerNodeDefinitions(defs: CanvasNodeDefinition[]) {
    const ids = new Set<string>();
    for (const def of defs) {
        if (!supportedTypes.has(def.type)) throw new Error(`画布节点类型已移除：${def.type}`);
        if (ids.has(def.type)) throw new Error(`节点类型重复：${def.type}`);
        ids.add(def.type);
    }
    for (const def of defs) definitions.set(def.type, def);
}

export function getNodeDefinition(type: CanvasNodeTypeId) {
    return definitions.get(type);
}

export function listNodeDefinitions() {
    return [...definitions.values()];
}

/** 添加节点菜单可见的节点定义 */
export function listCreatableNodeDefinitions() {
    return listNodeDefinitions().filter((def) => def.showInCreateMenu);
}

/** UI 短标签 */
export function getNodeLabel(type: CanvasNodeTypeId) {
    return definitions.get(type)?.label || "已移除类型";
}

/** 列表/搜索标签，缺省派生自 label */
export function getNodeListLabel(type: CanvasNodeTypeId) {
    const def = definitions.get(type);
    if (!def) return "已移除类型";
    return def.listLabel || `${def.label}节点`;
}

export function getNodeIcon(type: CanvasNodeTypeId) {
    return definitions.get(type)?.icon ?? null;
}

/** 手动拉伸的最小尺寸 */
export function getNodeMinSize(type: CanvasNodeTypeId) {
    return definitions.get(type)?.minSize ?? FALLBACK_MIN_SIZE;
}

/** 拉伸时是否锁定宽高比 */
export function shouldKeepAspectRatio(node: CanvasNodeData) {
    return definitions.get(node.type)?.keepAspectRatio?.(node) ?? false;
}

/**
 * 该节点作为 @ 引用素材时的类型，非素材返回 null。
 * 只按类型判定——角色卡那类跨类型覆盖由调用方在此之前处理。
 */
export function getNodeResourceKind(node: CanvasNodeData) {
    return definitions.get(node.type)?.resourceKind?.(node) ?? null;
}

/** 该节点作为生成节点时的生成模式，不产生生成行为返回 null */
export function getNodeGenerationMode(node: CanvasNodeData) {
    return definitions.get(node.type)?.generationMode?.(node) ?? null;
}

/** 该节点作为上游输入被计数时的类别，不参与计数返回 undefined */
export function getNodeInputKind(type: CanvasNodeTypeId) {
    return definitions.get(type)?.inputKind;
}

export function getNodeAcceptedInputKind(type: CanvasNodeTypeId) {
    return definitions.get(type)?.acceptsInputKind;
}

export function getNodeAcceptedInputKinds(type: CanvasNodeTypeId) {
    const accepted = definitions.get(type)?.acceptsInputKind;
    if (!accepted) return [];
    return Array.isArray(accepted) ? accepted : [accepted];
}

export function getNodeMaxInputCount(type: CanvasNodeTypeId) {
    return definitions.get(type)?.maxInputCount;
}
