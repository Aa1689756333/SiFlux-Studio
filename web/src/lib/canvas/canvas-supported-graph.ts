import { isBuiltinCanvasNodeType, type CanvasConnection, type CanvasNodeData } from "@/types/canvas";

/**
 * 精简版本只保留 image/text/config/frame 四种节点。
 * 旧画布里的视频、音频、脚本等节点在载入时直接丢弃，同时移除指向它们的连线，
 * 保证界面、撤销栈和后续保存都不会再带上这些已移除的类型。
 */
export function retainSupportedCanvasGraph(
    nodes: CanvasNodeData[],
    connections: CanvasConnection[],
): { nodes: CanvasNodeData[]; connections: CanvasConnection[] } {
    const keptNodes = nodes.filter((node) => isBuiltinCanvasNodeType(node.type));
    if (keptNodes.length === nodes.length) return { nodes, connections };
    const keptIds = new Set(keptNodes.map((node) => node.id));
    const keptConnections = connections.filter((connection) => keptIds.has(connection.fromNodeId) && keptIds.has(connection.toNodeId));
    return { nodes: keptNodes, connections: keptConnections };
}