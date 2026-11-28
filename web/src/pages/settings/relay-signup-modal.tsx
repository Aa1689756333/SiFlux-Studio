import { useCallback, useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Space, Tabs, message } from "antd";
import { CheckCircle2, Loader2, Mail, UserRound } from "lucide-react";
import {
    connectRelayAccount,
    disconnectRelayAccount,
    fetchRelayQuota,
    fetchRelaySignupOptions,
    relayQuotaAmount,
    sendRelayVerificationCode,
    signUpRelayAccount,
    type RelaySignInResult,
    type RelaySignupOptions,
} from "@/services/api/relay-auth";

type RelayMode = "register" | "login";

type RelaySignupModalProps = {
    open: boolean;
    onClose: () => void;
    onConnected: (result: RelaySignInResult) => void;
    /** 已连接时先展示账户概览，而不是直接让用户重新登录。 */
    connected?: boolean;
    /** 退出账号后通知外层刷新配置。 */
    onDisconnected?: () => void;
};

const CODE_COOLDOWN_SECONDS = 60;

/**
 * 内置服务的接入向导：注册时走邮箱验证码，登录直接复用既有账号。
 * 密码只在本次请求里使用，后端不会保存，也不会返回值里带出。
 */
export function RelaySignupModal({ open, onClose, onConnected, connected = false, onDisconnected }: RelaySignupModalProps) {
    const [mode, setMode] = useState<RelayMode>("login");
    const [form] = Form.useForm<{ username: string; password: string; email: string; code: string }>();
    const [options, setOptions] = useState<RelaySignupOptions | null>(null);
    const [optionsError, setOptionsError] = useState("");
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<RelaySignInResult | null>(null);
    const [cooldown, setCooldown] = useState(0);
    const [accountView, setAccountView] = useState(false);
    const [disconnecting, setDisconnecting] = useState(false);
    const showAccount = !result && (accountView || connected);
    const accountQuota = useQuery({
        queryKey: ["relay-quota", "account", open],
        queryFn: () => fetchRelayQuota(),
        enabled: open && showAccount,
        retry: false,
        staleTime: 30_000,
    });
    const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

    const stopCooldown = useCallback(() => {
        if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
        }
    }, []);

    const startCooldown = useCallback(() => {
        stopCooldown();
        setCooldown(CODE_COOLDOWN_SECONDS);
        timerRef.current = setInterval(() => {
            setCooldown((current) => {
                if (current <= 1) {
                    stopCooldown();
                    return 0;
                }
                return current - 1;
            });
        }, 1000);
    }, [stopCooldown]);

    useEffect(() => () => stopCooldown(), [stopCooldown]);

    useEffect(() => {
        if (!open) return;
        setError("");
        setAccountView(connected);
        setResult(null);
        setMode("login");
        setCooldown(0);
        stopCooldown();
        form.resetFields();
        setLoadingOptions(true);
        setOptionsError("");
        const controller = new AbortController();
        fetchRelaySignupOptions(controller.signal)
            .then((next) => {
                setOptions(next);
                if (!next.registerEnabled || !next.passwordRegisterEnabled) setMode("login");
            })
            .catch((reason: unknown) => {
                setOptionsError(reason instanceof Error ? reason.message : "读取服务配置失败");
            })
            .finally(() => setLoadingOptions(false));
        return () => controller.abort();
    }, [open, form, stopCooldown, connected]);

    const requiresEmailCode = Boolean(options?.emailVerification);
    const registerBlocked = Boolean(options && (!options.registerEnabled || !options.passwordRegisterEnabled || options.turnstile));

    const handleSendCode = async () => {
        const email = String(form.getFieldValue("email") || "").trim();
        if (!email.includes("@")) {
            setError("请先填写有效的邮箱地址");
            return;
        }
        setSendingCode(true);
        setError("");
        try {
            await sendRelayVerificationCode(email);
            startCooldown();
            message.success("验证码已发送，请查看邮箱");
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "验证码发送失败");
        } finally {
            setSendingCode(false);
        }
    };

    const handleSubmit = async () => {
        let values: { username: string; password: string; email: string; code: string };
        try {
            values = await form.validateFields();
        } catch {
            return;
        }
        setSubmitting(true);
        setError("");
        try {
            const next =
                mode === "register"
                    ? await signUpRelayAccount({
                          username: values.username.trim(),
                          password: values.password,
                          email: String(values.email || "").trim(),
                          code: String(values.code || "").trim(),
                      })
                    : await connectRelayAccount({
                          username: values.username.trim(),
                          password: values.password,
                      });
            setResult(next);
            message.success("SiFlux 服务已连接");
            onConnected(next);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "接入失败，请稍后重试");
        } finally {
            setSubmitting(false);
        }
    };

    const handleDisconnect = async () => {
        setDisconnecting(true);
        setError("");
        try {
            await disconnectRelayAccount();
            message.success("已退出账号");
            onDisconnected?.();
            onClose();
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "退出失败，请稍后重试");
        } finally {
            setDisconnecting(false);
        }
    };
    const handleClose = () => {
        if (submitting) return;
        setError("");
        setResult(null);
        onClose();
    };

    const balance = result ? relayQuotaAmount(result.quota, result.quotaPerUnit) : "";

    return (
        <Modal
            open={open}
            onCancel={handleClose}
            footer={null}
            width={480}
            centered
            destroyOnHidden
            title={<span className="text-base font-semibold">连接 SiFlux 服务</span>}
            maskClosable={!submitting}
        >
            <div className="pt-2">
                {!showAccount ? (
                    <Tabs
                        className="relay-auth-tabs mb-3"
                        activeKey={mode}
                        onChange={(key) => {
                            setMode(key as RelayMode);
                            setError("");
                        }}
                        items={[
                            { key: "login", label: "登录" },
                            { key: "register", label: "注册" },
                        ]}
                    />
                ) : null}

                {loadingOptions ? (
                    <div className="mb-3 flex items-center gap-2 text-xs text-foreground/60">
                        <Loader2 className="size-3.5 animate-spin" />
                        正在读取服务配置…
                    </div>
                ) : null}

                {optionsError ? (
                    <Alert className="mb-3" type="error" showIcon message="无法连接 SiFlux 服务" description={optionsError} />
                ) : null}

                {registerBlocked && !result ? (
                    <Alert
                        className="mb-3"
                        type="warning"
                        showIcon
                        message={options?.turnstile ? "该服务要求人机验证" : "SiFlux 服务暂未开放密码注册"}
                        description="请前往网页完成注册后，回到这里用「已有账号」接入。"
                    />
                ) : null}

                {error ? <Alert className="mb-3" type="error" showIcon message={error} /> : null}

                {showAccount ? (
                    <div className="space-y-4">
                        <div className="rounded-xl border border-border/60 px-4 py-3">
                            <div className="text-xs text-foreground/55">账户余额</div>
                            <div className="mt-1 text-2xl font-semibold leading-tight">
                                {accountQuota.data && accountQuota.data.granted > 0
                                    ? `$${accountQuota.data.remaining.toFixed(2)}`
                                    : accountQuota.isLoading ? "…" : "余额未知"}
                            </div>
                        </div>
                        <div className="flex gap-2">
                            <Button danger block loading={disconnecting} onClick={() => void handleDisconnect()}>退出账号</Button>
                            <Button type="primary" block onClick={handleClose}>完成</Button>
                        </div>
                    </div>
                ) : null}


                {result ? (
                    <div className="space-y-4">
                        <div className="flex items-center gap-2.5 rounded-xl border border-emerald-500/25 bg-emerald-500/10 px-4 py-3">
                            <CheckCircle2 className="size-5 shrink-0 text-emerald-500" />
                            <div className="min-w-0">
                                <div className="truncate text-sm font-medium">已连接{result.displayName || result.username}</div>
                            </div>
                        </div>

                        <div className="grid grid-cols-2 gap-2.5">
                            <div className="rounded-xl border border-border/60 px-4 py-3">
                                <div className="text-xs text-foreground/55">账户余额</div>
                                <div className="mt-1 text-lg font-semibold leading-tight">{balance || "—"}</div>
                            </div>
                            <div className="rounded-xl border border-border/60 px-4 py-3">
                                <div className="text-xs text-foreground/55">可用模型</div>
                                <div className="mt-1 text-lg font-semibold leading-tight">{result.models.length}</div>
                            </div>
                        </div>

                        {result.modelsError ? (
                            <Alert type="warning" showIcon message="模型列表未能拉取" description={result.modelsError} />
                        ) : null}

                        <Button type="primary" size="large" block onClick={handleClose}>
                            完成
                        </Button>
                    </div>
                ) : showAccount ? null : (
                    <Form form={form} layout="vertical" requiredMark={false} disabled={submitting} size="middle">
                        <Form.Item
                            name="username"
                            label="用户名"
                            className="mb-3.5"
                            rules={[{ required: true, message: "请填写用户名" }]}
                        >
                            <Input
                                prefix={<UserRound className="mr-1 size-4 text-foreground/40" />}
                                placeholder="用于登录 SiFlux 服务"
                                autoComplete="username"
                            />
                        </Form.Item>
                        <Form.Item
                            name="password"
                            label="密码"
                            className="mb-3.5"
                            rules={[
                                { required: true, message: "请填写密码" },
                                { min: 8, message: "密码至少 8 位" },
                            ]}
                        >
                            <Input.Password placeholder="至少 8 位" autoComplete={mode === "register" ? "new-password" : "current-password"} />
                        </Form.Item>
                        {mode === "register" ? (
                            <>
                                <Form.Item
                                    name="email"
                                    label="邮箱"
                                    className="mb-3.5"
                                    rules={[
                                        { required: requiresEmailCode, message: "请填写邮箱" },
                                        { type: "email", message: "邮箱格式不正确" },
                                    ]}
                                >
                                    <Input
                                        prefix={<Mail className="mr-1 size-4 text-foreground/40" />}
                                        placeholder="用于接收验证码"
                                        autoComplete="email"
                                    />
                                </Form.Item>
                                {requiresEmailCode ? (
                                    <Form.Item label="邮箱验证码" className="mb-4" required>
                                        <Space.Compact className="w-full">
                                            <Form.Item name="code" noStyle rules={[{ required: true, message: "请填写验证码" }]}>
                                                <Input placeholder="6 位验证码" maxLength={8} autoComplete="one-time-code" className="text-center tracking-[0.4em]" />
                                            </Form.Item>
                                            <Button
                                                className="shrink-0 tabular-nums"
                                                onClick={() => void handleSendCode()}
                                                loading={sendingCode}
                                                disabled={cooldown > 0}
                                            >
                                                {cooldown > 0 ? `${cooldown}s 后重发` : "发送验证码"}
                                            </Button>
                                        </Space.Compact>
                                    </Form.Item>
                                ) : null}
                            </>
                        ) : null}

                        <Button
                            type="primary"
                            size="large"
                            block
                            className="mt-1"
                            loading={submitting}
                            disabled={registerBlocked && mode === "register"}
                            onClick={() => void handleSubmit()}
                        >
                            {mode === "register" ? "注册并接入" : "登录并接入"}
                        </Button>
                    </Form>
                )}
            </div>
        </Modal>
    );
}
