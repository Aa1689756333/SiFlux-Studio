// 首发曾只开放生图。改为 false 后恢复视频、音频等入口。
export const IMAGE_ONLY_RELEASE = false;

// 与 1.0.2 一样先藏起 Agent 助手、3D 导演台和 MCP；文本/图片/音视频入口保持可见。
export const HIDE_AGENT_DIRECTOR_MCP = true;

export function hideAgentDirectorMcp() {
    return IMAGE_ONLY_RELEASE || HIDE_AGENT_DIRECTOR_MCP;
}
