
let connectionEpoch = 0;
export function getBeefAPIConnectionEpoch() {
    return connectionEpoch;
}

export type BeefAPIAccount = {
    id: string;
    username?: string;
    display_name?: string;
    email?: string;
};

export type BeefAPIConnectionState = "disconnected" | "connecting" | "connection_error" | "pending" | "connected" | "expired" | "cancelled" | "rejected" | "store_error" | "catalog_failed" | "revoked";

export type BeefAPIConnectionSummary = {
    state: BeefAPIConnectionState | string;
    userCode?: string;
    verificationUri?: string;
    expiresAt?: string;
    account?: BeefAPIAccount | null;
    keyName?: string;
    tokenId?: string;
    market?: string;
    walletUrl?: string;
    balance?: "unknown" | "zero" | "available" | string;
    catalogFailed?: boolean;
    errorReason?: string;
    connectedAt?: string;
    credentialRef?: string;
    hasCredential?: boolean;
};

const RETIRED = "托管渠道已下线，连接的接口已删除";

function retiredSummary(): BeefAPIConnectionSummary {
    return { state: "disconnected", hasCredential: false };
}

/** 托管渠道已下线：不再发起请求，直接报告未连接。 */
export function getBeefAPIConnection(_signal?: AbortSignal) {
    return Promise.resolve(retiredSummary());
}

export function startBeefAPIConnection(_signal?: AbortSignal): Promise<BeefAPIConnectionSummary> {
    connectionEpoch++;
    return Promise.reject(new Error(RETIRED));
}

export function cancelBeefAPIConnection(_signal?: AbortSignal) {
    connectionEpoch++;
    return Promise.resolve(retiredSummary());
}

export function disconnectBeefAPIConnection(_signal?: AbortSignal) {
    connectionEpoch++;
    return Promise.resolve(retiredSummary());
}

export function openBeefAPIWallet(_signal?: AbortSignal): Promise<{ opened: boolean }> {
    return Promise.reject(new Error(RETIRED));
}

export function beefAPIConnectionLabel(summary: BeefAPIConnectionSummary | null | undefined) {
    const state = summary?.state || "disconnected";
    switch (state) {
        case "connecting":
            return summary?.errorReason || "正在连接 BeefTV";
        case "connection_error":
            return summary?.errorReason || "无法连接 BeefTV 服务，请检查网络后重试";
        case "pending":
            return summary?.errorReason || (summary?.userCode ? `请在浏览器中确认 ${summary.userCode}` : "请在浏览器中确认授权");
        case "connected":
            return connectedAccountLabel(summary);
        case "expired":
            return "授权已过期，请重新连接";
        case "cancelled":
            return "已取消本次连接";
        case "rejected":
            return "授权被拒绝";
        case "store_error":
            return "保存连接失败，请重试";
        case "catalog_failed":
            return "模型列表读取失败，请重试";
        case "revoked":
            return "连接已失效，请重新连接";
        default:
            return "未连接";
    }
}

function connectedAccountLabel(summary: BeefAPIConnectionSummary | null | undefined) {
    const account = summary?.account;
    const name = account?.email || account?.display_name || account?.username;
    if (name && summary?.balance === "zero") return `已连接 ${name}，余额为 0`;
    if (name) return `已连接 ${name}`;
    if (summary?.balance === "zero") return "已连接，余额为 0";
    return "已连接";
}
