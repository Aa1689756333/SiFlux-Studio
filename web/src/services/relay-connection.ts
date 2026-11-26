import { applyFetchedChannelModelCatalog } from "@/lib/channel-config";
import { fetchChannelModels } from "@/services/api/image";
import { refreshModelConfigFromServer } from "@/components/workspace/workspace-bootstrap-hydrator";
import { useConfigStore } from "@/stores/use-config-store";

/**
 * 中转站注册/登录成功后的收尾：
 * 后端已经把 API Key 写入本地渠道，这里把配置同步回内存并补齐模型能力。
 */
export async function completeRelayConnection(channelId: string) {
    await refreshModelConfigFromServer();
    const channel = useConfigStore.getState().config.channels.find((item) => item.id === channelId);
    if (!channel) return;
    const result = await fetchChannelModels(channel, true);
    if (!result.models.length) return;
    const latest = useConfigStore.getState().config;
    useConfigStore.getState().replaceConfig({
        ...latest,
        channels: latest.channels.map((item) =>
            item.id === channelId ? applyFetchedChannelModelCatalog(item, result) : item,
        ),
    });
}

/** 判断内置中转站是否已经接入（已保存 API Key）。 */
export function relayChannelConnected(channels: { id: string; pinned?: boolean; apiKey?: string; hasApiKey?: boolean }[]) {
    const channel = channels.find((item) => item.id === "siflux" && item.pinned);
    if (!channel) return false;
    return Boolean(String(channel.apiKey || "").trim()) || Boolean(channel.hasApiKey);
}