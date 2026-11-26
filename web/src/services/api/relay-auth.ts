import { http } from "@/services/api/request";

/** 内置服务暴露的注册能力，来自 NewAPI 的 /api/status。 */
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

/** 读取服务当前的注册与验证策略。 */
export function fetchRelaySignupOptions(signal?: AbortSignal) {
    return http.get<RelaySignupOptions>("/relay/signup-options", { signal });
}

/** 请求服务向指定邮箱发送注册验证码。 */
export function sendRelayVerificationCode(email: string, signal?: AbortSignal) {
    return http.post<{ sent: boolean }>("/relay/verification-code", { email }, { signal });
}

/** 在服务创建账号，并自动写入应用令牌。 */
export function signUpRelayAccount(payload: RelaySignupPayload, signal?: AbortSignal) {
    return http.post<RelaySignInResult>("/relay/signup", payload, { signal });
}

/** 用已有账号接入，自动写入应用令牌。 */
export function connectRelayAccount(payload: RelayConnectPayload, signal?: AbortSignal) {
    return http.post<RelaySignInResult>("/relay/connect", payload, { signal });
}

/** 服务账户余额，金额单位为结算货币（通常为美元）。 */
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

/** 把服务额度换算成可展示的金额。 */
export function relayQuotaAmount(quota: number, quotaPerUnit: number) {
    if (!Number.isFinite(quota) || !Number.isFinite(quotaPerUnit) || quotaPerUnit <= 0) return "";
    const amount = quota / quotaPerUnit;
    return amount.toFixed(2);
}