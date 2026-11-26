import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Alert, Button, Form, Input, Modal, Segmented, Steps, message } from "antd";
import { CheckCircle2, Loader2, Mail, UserRound } from "lucide-react";
import {
    connectRelayAccount,
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
};

const CODE_COOLDOWN_SECONDS = 60;

/**
 * 内置中转站的接入向导：注册时走邮箱验证码，登录直接复用既有账号。
 * 密码只在本次请求里使用，后端不会保存，也不会返回值里带出。
 */
export function RelaySignupModal({ open, onClose, onConnected }: RelaySignupModalProps) {
    const [mode, setMode] = useState<RelayMode>("register");
    const [form] = Form.useForm<{ username: string; password: string; email: string; code: string }>();
    const [options, setOptions] = useState<RelaySignupOptions | null>(null);
    const [optionsError, setOptionsError] = useState("");
    const [loadingOptions, setLoadingOptions] = useState(false);
    const [sendingCode, setSendingCode] = useState(false);
    const [submitting, setSubmitting] = useState(false);
    const [error, setError] = useState("");
    const [result, setResult] = useState<RelaySignInResult | null>(null);
    const [cooldown, setCooldown] = useState(0);
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
        setResult(null);
        setMode("register");
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
                setOptionsError(reason instanceof Error ? reason.message : "读取中转站配置失败");
            })
            .finally(() => setLoadingOptions(false));
        return () => controller.abort();
    }, [open, form, stopCooldown]);

    const requiresEmailCode = Boolean(options?.emailVerification);
    const registerBlocked = Boolean(options && (!options.registerEnabled || !options.passwordRegisterEnabled || options.turnstile));

    const currentStep = useMemo(() => {
        if (result) return 2;
        if (mode === "login") return 0;
        return requiresEmailCode ? 1 : 0;
    }, [result, mode, requiresEmailCode]);

    const steps = useMemo(() => {
        if (mode === "login") {
            return [{ title: "账号" }, { title: "完成" }];
        }
        return requiresEmailCode
            ? [{ title: "账号" }, { title: "邮箱验证" }, { title: "完成" }]
            : [{ title: "账号" }, { title: "完成" }];
    }, [mode, requiresEmailCode]);

    const activeStep = mode === "login" ? (result ? 1 : 0) : result ? steps.length - 1 : 0;

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
            message.success("中转站账号已接入");
            onConnected(next);
        } catch (reason) {
            setError(reason instanceof Error ? reason.message : "接入失败，请稍后重试");
        } finally {
            setSubmitting(false);
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
            width={520}
            centered
            destroyOnHidden
            title="连接 SiFlux 中转站"
            maskClosable={!submitting}
        >
            <div className="space-y-4 pt-1">
                {!result ? (
                    <Segmented
                        block
                        value={mode}
                        onChange={(value) => {
                            setMode(value as RelayMode);
                            setError("");
                        }}
                        options={[
                            { label: "注册新账号", value: "register" },
                            { label: "已有账号", value: "login" },
                        ]}
                    />
                ) : null}

                {steps.length > 1 ? <Steps size="small" current={activeStep} items={steps.map((step) => ({ title: step.title }))} /> : null}

                {loadingOptions ? (
                    <div className="flex items-center gap-2 text-sm text-foreground/70">
                        <Loader2 className="size-4 animate-spin" />
                        正在读取中转站配置…
                    </div>
                ) : null}

                {optionsError ? (
                    <Alert type="error" showIcon message="无法连接中转站" description={optionsError} />
                ) : null}

                {registerBlocked && !result ? (
                    <Alert
                        type="warning"
                        showIcon
                        message={options?.turnstile ? "该中转站要求人机验证" : "该中转站暂未开放密码注册"}
                        description="请前往网页完成注册后，回到这里用「已有账号」接入。"
                    />
                ) : null}

                {error ? <Alert type="error" showIcon message={error} /> : null}

                {result ? (
                    <div className="space-y-3">
                        <div className="flex items-center gap-2 text-base font-medium">
                            <CheckCircle2 className="size-5 text-emerald-500" />
                            已接入{result.displayName || result.username}
                        </div>
                        <div className="grid grid-cols-2 gap-3 text-sm">
                            <div className="rounded-lg border border-border/60 p-3">
                                <div className="text-foreground/60">账户余额</div>
                                <div className="mt-1 text-lg font-semibold">{balance || "—"}</div>
                            </div>
                            <div className="rounded-lg border border-border/60 p-3">
                                <div className="text-foreground/60">可用模型</div>
                                <div className="mt-1 text-lg font-semibold">{result.models.length}</div>
                            </div>
                        </div>
                        <p className="m-0 text-sm leading-6 text-foreground/70">
                            已在中转站创建专用令牌「{result.tokenName}」，可在中转站单独查看与吊销。API Key 已自动填入渠道，无需手动复制。
                        </p>
                        {result.modelsError ? (
                            <Alert type="warning" showIcon message="模型列表未能拉取" description={result.modelsError} />
                        ) : null}
                        <Button type="primary" block onClick={handleClose}>
                            完成
                        </Button>
                    </div>
                ) : (
                    <Form form={form} layout="vertical" requiredMark={false} disabled={submitting} className="space-y-1">
                        <Form.Item
                            name="username"
                            label="用户名"
                            rules={[{ required: true, message: "请填写用户名" }]}
                        >
                            <Input prefix={<UserRound className="size-4 text-foreground/50" />} placeholder="用于登录中转站" autoComplete="username" />
                        </Form.Item>
                        <Form.Item
                            name="password"
                            label="密码"
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
                                    rules={[
                                        { required: requiresEmailCode, message: "请填写邮箱" },
                                        { type: "email", message: "邮箱格式不正确" },
                                    ]}
                                    extra={requiresEmailCode ? "注册需要邮箱验证码" : undefined}
                                >
                                    <Input prefix={<Mail className="size-4 text-foreground/50" />} placeholder="用于接收验证码" autoComplete="email" />
                                </Form.Item>
                                {requiresEmailCode ? (
                                    <Form.Item label="验证码" required>
                                        <div className="flex gap-2">
                                            <Form.Item
                                                name="code"
                                                noStyle
                                                rules={[{ required: true, message: "请填写验证码" }]}
                                            >
                                                <Input placeholder="6 位验证码" maxLength={8} autoComplete="one-time-code" />
                                            </Form.Item>
                                            <Button onClick={() => void handleSendCode()} loading={sendingCode} disabled={cooldown > 0} className="shrink-0">
                                                {cooldown > 0 ? `${cooldown}s` : "发送验证码"}
                                            </Button>
                                        </div>
                                    </Form.Item>
                                ) : null}
                            </>
                        ) : null}
                        <Button
                            type="primary"
                            block
                            loading={submitting}
                            disabled={registerBlocked && mode === "register"}
                            onClick={() => void handleSubmit()}
                        >
                            {mode === "register" ? "注册并接入" : "登录并接入"}
                        </Button>
                        <p className="m-0 pt-1 text-center text-xs leading-5 text-foreground/50">
                            账号注册与充值在中转站完成，应用只保存自动生成的 API Key。
                        </p>
                    </Form>
                )}
            </div>
        </Modal>
    );
}