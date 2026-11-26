import { http } from "@/services/api/request";

/** 内置中转站暴露的注册能力，来自 NewAPI 的 /api/status。 */
export type RelaySignupOptions = {
    systemName: string;
    registerEnabled: boolean;
    passwordRegisterEnabled: boolean;
    passwordLoginEnabled: boolean;
    emailVerification: boolean;
    turnstile: boolean;
    quotaPerUnit: number;
};

/** 注册或登录成功后的账号信息与写入结果。 */
export type RelaySignInResult = {
    channelId: string;
    username: string;
    displayName: string;
    group: string;
    quota: number;
    usedQuota: number;
    quotaPerUnit: number;
    models: string[];
    tokenName: string;
    revision: number;
    modelsError?: string;
};

export type RelaySignupPayload = {
    username: string;
    password: string;
    email: string;
    code: string;
};

export type RelayConnectPayload = {
    username: string;
    password: string;
};

/** 读取中转站当前的注册与验证策略。 */
export function fetchRelaySignupOptions(signal?: AbortSignal) {
    return http.get<RelaySignupOptions>("/relay/signup-options", { signal });
}

/** 请求中转站向指定邮箱发送注册验证码。 */
export function sendRelayVerificationCode(email: string, signal?: AbortSignal) {
    return http.post<{ sent: boolean }>("/relay/verification-code", { email }, { signal });
}

/** 在中转站创建账号，并自动写入应用令牌。 */
export function signUpRelayAccount(payload: RelaySignupPayload, signal?: AbortSignal) {
    return http.post<RelaySignInResult>("/relay/signup", payload, { signal });
}

/** 用已有账号接入，自动写入应用令牌。 */
export function connectRelayAccount(payload: RelayConnectPayload, signal?: AbortSignal) {
    return http.post<RelaySignInResult>("/relay/connect", payload, { signal });
}

/** 中转站账户余额，金额单位为结算货币（通常为美元）。 */
export type RelayQuota = {
    granted: number;
    spent: number;
    remaining: number;
    usageKnown: boolean;
};

/** 查询已接入账户的当前余额。 */
export function fetchRelayQuota(signal?: AbortSignal) {
    return http.get<RelayQuota>("/relay/quota", { signal });
}

/** 把中转站额度换算成可展示的金额。 */
export function relayQuotaAmount(quota: number, quotaPerUnit: number) {
    if (!Number.isFinite(quota) || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) return "";
    const amount = quota / quotaPerUnit;
    return amount.toFixed(2);
}