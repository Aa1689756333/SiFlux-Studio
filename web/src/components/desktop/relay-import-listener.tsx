import { App } from "antd";
import { useCallback, useEffect, useRef } from "react";

import { applyFetchedChannelModelCatalog, channelConnectionError, channelConnectionSignature, channelModelFetchErrorMessage, withChannels } from "@/lib/channel-config";
import { fetchChannelModels } from "@/services/api/image";
import { isDesktopRuntime, takePendingRelayImport, type DesktopRelayImport } from "@/services/desktop-runtime";
import { isBuiltinRelayChannel, useConfigStore } from "@/stores/use-config-store";

/** 后端取走待确认导入后即清空，所以这里只要够及时，不必密集轮询。 */
const RELAY_IMPORT_POLL_MS = 4000;

function importKey(payload: DesktopRelayImport) {
    return `${payload.baseUrl}\n${payload.apiKey}`;
}

function hostOf(baseUrl: string) {
    try {
        return new URL(baseUrl).host;
    } catch {
        return baseUrl;
    }
}

/**
 * 接收桌面外壳转交的一键配置链接。
 *
 * Go 侧也会发 relay:import 事件，但本应用从未加载 Wails 的 JS 事件运行时
 * （全仓没有 window.runtime / EventsOn 用法），所以轮询路由是可靠路径；
 * 而且协议唤起可能早于窗口创建，那时事件也已经发过了。
 */
export function DesktopRelayImportListener() {
    const { message, modal } = App.useApp();
    const handled = useRef(new Set<string>());
    const busy = useRef(false);

    const applyImport = useCallback(async (payload: DesktopRelayImport) => {
        const config = useConfigStore.getState().config;
        const channel = config.channels.find(isBuiltinRelayChannel);
        if (!channel) {
            message.error("没有找到内置的 SiFlux 中转站渠道，无法应用这次导入");
            return;
        }
        const name = payload.name.trim();
        const nextChannel = { ...channel, baseUrl: payload.baseUrl, apiKey: payload.apiKey, ...(name ? { name } : {}) };
        const replaceConfig = useConfigStore.getState().replaceConfig;
        replaceConfig(withChannels(config, config.channels.map((item) => (item.id === channel.id ? nextChannel : item))));

        // 与手工填写走同一套判定：写入成功不等于可用，缺 Secret Key 之类要如实说出来。
        const connectionError = channelConnectionError(nextChannel);
        if (connectionError) {
            message.warning(`连接信息已写入，但仍需处理：${connectionError}`);
            return;
        }
        const request = new AbortController();
        try {
            const result = await fetchChannelModels(nextChannel, true, request.signal);
            const latestConfig = useConfigStore.getState().config;
            const latestChannel = latestConfig.channels.find((item) => item.id === channel.id);
            if (!latestChannel) return;
            if (channelConnectionSignature(latestChannel) !== channelConnectionSignature(nextChannel)) {
                message.warning("连接配置已改变，已忽略这次模型目录结果");
                return;
            }
            if (!result.models.length) {
                message.warning("中转站没有返回模型，已保留现有模型列表");
                return;
            }
            useConfigStore.getState().replaceConfig(withChannels(latestConfig, latestConfig.channels.map((item) => (item.id === channel.id ? applyFetchedChannelModelCatalog(item, result) : item))));
            message.success(`已从中转站导入 ${result.models.length} 个模型`);
        } catch (error) {
            message.error(channelModelFetchErrorMessage(error));
        }
    }, [message]);

    const promptImport = useCallback((payload: DesktopRelayImport) => {
        modal.confirm({
            title: "使用中转站页面创建的密钥？",
            content: `来源：${hostOf(payload.baseUrl)}。确认后会写入内置的 SiFlux 中转站渠道，并刷新模型列表。`,
            okText: "导入",
            cancelText: "忽略",
            onOk: () => applyImport(payload),
        });
    }, [applyImport, modal]);

    useEffect(() => {
        if (!isDesktopRuntime()) return;
        let active = true;
        const pump = async () => {
            if (!active || busy.current) return;
            busy.current = true;
            try {
                const payload = await takePendingRelayImport();
                if (!active || !payload) return;
                const key = importKey(payload);
                if (handled.current.has(key)) return;
                handled.current.add(key);
                promptImport(payload);
            } catch {
                // 读取失败不该打断创作，下一轮轮询再试。
            } finally {
                busy.current = false;
            }
        };
        void pump();
        const timer = window.setInterval(() => void pump(), RELAY_IMPORT_POLL_MS);
        window.addEventListener("focus", pump);
        return () => {
            active = false;
            window.clearInterval(timer);
            window.removeEventListener("focus", pump);
        };
    }, [promptImport]);

    return null;
}
