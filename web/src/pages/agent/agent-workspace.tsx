import { Button, Dropdown } from "antd";
import { ArrowUpRight, History, MessageSquarePlus, X } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import { assetLibraryQueryKey, assetPickerQueryKey } from "@/components/assets/asset-view-session";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { referencedAssetIdsInPrompt } from "@/lib/canvas/canvas-resource-references";
import { appQueryClient } from "@/lib/query-client";
import { getActiveUserScope, getActiveUserScopeEpoch, subscribeUserScope } from "@/lib/user-scope";
import { captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { CanvasAssistantAttachments } from "@/pages/canvas/canvas-assistant-attachments";
import { CanvasAssistantComposer } from "@/pages/canvas/canvas-assistant-composer";
import { assistantSkillLabel, assistantStatusNotice, assistantVisibleReply } from "@/pages/canvas/canvas-assistant-copy";
import { CanvasAssistantReply, CanvasAssistantUserMessage } from "@/pages/canvas/canvas-assistant-turn";
import { useCanvasAssistant } from "@/pages/canvas/use-canvas-assistant";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { WORKSPACE_AGENT_CONVERSATION_ID, type AssistantAttachment, type AssistantSkillSelection, type AssistantTurn } from "@/services/api/agent-assistant";
import { attachmentRangeError, readAssistantInputDraft, saveAssistantInputDraft, uploadAssistantAttachment } from "@/services/assistant-attachments";
import { listAddedSkills, type Skill } from "@/services/api/skills";

import "./agent.css";
import "@/pages/canvas/canvas-assistant-sidebar.css";

const AGENT_PAGE = {
    conversationId: WORKSPACE_AGENT_CONVERSATION_ID,
    title: "Agent助手",
    subtitle: "对话式创作助手，可使用工具和技能，不进入无限画布",
    starters: ["帮我写一段分镜", "把这段提示词写得更具体", "规划一组镜头节奏"],
};

function AgentTurnView({ turn }: { turn: AssistantTurn }) {
    return (
        <div className="canvas-assistant-turn">
            <CanvasAssistantUserMessage text={turn.userText} selectedCount={0} />
            <CanvasAssistantAttachments attachments={turn.attachments || []} />
            {(turn.skills || []).map((skill) => (
                <span className="canvas-assistant-chip" key={skill.skillId}>{assistantSkillLabel(skill)}</span>
            ))}
            {turn.supplementInputs?.length
                ? turn.supplementInputs.map((input, index) => (
                    <div key={`supplement:${index}`}>
                        <CanvasAssistantUserMessage text={input.message} selectedCount={0} />
                        <CanvasAssistantAttachments attachments={input.attachments || []} />
                    </div>
                ))
                : (turn.supplements || []).map((text, index) => <CanvasAssistantUserMessage key={`supplement:${index}`} text={text} selectedCount={0} />)}
            {turn.reply ? <CanvasAssistantReply text={turn.reply} /> : null}
            {turn.cancelled ? <p className="canvas-assistant-meta">这一条已经停下了。</p> : null}
            {turn.error ? (
                <div className="canvas-assistant-feedback" role="status">
                    <strong>这一步没有完成</strong>
                    <span className="canvas-assistant-failed">{turn.error}</span>
                </div>
            ) : null}
        </div>
    );
}

export function AgentWorkspace() {
    const config = AGENT_PAGE;
    const navigate = useNavigate();
    const assistant = useCanvasAssistant({ canvasId: config.conversationId });
    const setOpen = assistant.setOpen;
    const [draft, setDraft] = useState("");
    const [attachments, setAttachments] = useState<AssistantAttachment[]>([]);
    const [selectedSkills, setSelectedSkills] = useState<AssistantSkillSelection[]>([]);
    const [uploads, setUploads] = useState<{ id: string; file: File; busy: boolean; error?: string }[]>([]);
    const attachmentCount = useRef(0);
    attachmentCount.current = attachments.length + uploads.length;
    const [inputError, setInputError] = useState("");
    const [draftLoaded, setDraftLoaded] = useState(false);
    const [draftReadAttempt, setDraftReadAttempt] = useState(0);
    const [loadedDraftIdentity, setLoadedDraftIdentity] = useState<string | null>(null);
    const draftWriteVersion = useRef(0);
    const [skillsOpen, setSkillsOpen] = useState(false);
    const [skillInstallOpen, setSkillInstallOpen] = useState(false);
    const [skillInstallGeneration, setSkillInstallGeneration] = useState(0);
    const [availableSkills, setAvailableSkills] = useState<Skill[]>([]);
    const [skillsLoading, setSkillsLoading] = useState(false);
    const [skillsError, setSkillsError] = useState("");
    const inputGeneration = useRef(0);
    const inputScope = useRef(captureUserScope());
    const accountEpoch = useSyncExternalStore(subscribeUserScope, () => `${getActiveUserScope()}:${getActiveUserScopeEpoch()}`, () => "");
    const draftIdentity = JSON.stringify([config.conversationId, accountEpoch]);
    const logRef = useRef<HTMLDivElement | null>(null);
    const followLatestRef = useRef(true);

    useEffect(() => {
        setOpen(true);
    }, [setOpen]);

    useEffect(() => {
        const generation = ++inputGeneration.current, expected = captureUserScope();
        inputScope.current = expected;
        setDraftLoaded(false); setLoadedDraftIdentity(null); setDraft(""); setAttachments([]); setSelectedSkills([]); setUploads([]); setInputError(""); setAvailableSkills([]); setSkillsOpen(false); setSkillInstallOpen(false);
        void readAssistantInputDraft(config.conversationId, expected).then((saved) => {
            if (generation !== inputGeneration.current || !userScopeMatches(expected)) return;
            if (saved) { setDraft(saved.text || ""); setAttachments(saved.attachments || []); setSelectedSkills(saved.skills || []); }
            setDraftLoaded(true);
            setLoadedDraftIdentity(draftIdentity);
        }).catch(() => { if (generation === inputGeneration.current) { setInputError("暂时无法读取未发送的素材，请重新添加。"); setDraftLoaded(true); } });
    }, [accountEpoch, config.conversationId, draftIdentity, draftReadAttempt]);

    useEffect(() => {
        if (!draftLoaded || loadedDraftIdentity !== draftIdentity) return;
        const generation = inputGeneration.current;
        const version = ++draftWriteVersion.current;
        void saveAssistantInputDraft(config.conversationId, { text: draft, attachments, skills: selectedSkills }, inputScope.current)
            .catch(() => { if (generation === inputGeneration.current && version === draftWriteVersion.current) setInputError("未发送内容暂时无法保存，请保持窗口打开。"); });
    }, [attachments, config.conversationId, draft, draftIdentity, draftLoaded, loadedDraftIdentity, selectedSkills]);

    const upload = useCallback(async (id: string, file: File) => {
        const generation = inputGeneration.current, expected = inputScope.current;
        setUploads((items) => items.map((item) => item.id === id ? { ...item, busy: true, error: undefined } : item));
        try {
            const attachment = await uploadAssistantAttachment(file, expected, id);
            if (generation !== inputGeneration.current || !userScopeMatches(expected)) return;
            void appQueryClient.invalidateQueries({ queryKey: assetLibraryQueryKey(expected) });
            void appQueryClient.invalidateQueries({ queryKey: assetPickerQueryKey(expected) });
            setAttachments((items) => [...items, attachment]);
            setUploads((items) => items.filter((item) => item.id !== id));
        } catch (error) {
            if (generation !== inputGeneration.current || !userScopeMatches(expected)) return;
            setUploads((items) => items.map((item) => item.id === id ? { ...item, busy: false, error: error instanceof Error ? error.message : "上传没有完成" } : item));
        }
    }, []);

    const addFiles = useCallback((files: File[]) => {
        if (!draftLoaded || loadedDraftIdentity !== draftIdentity || !userScopeMatches(inputScope.current)) return;
        if (attachmentCount.current + files.length > 8) { setInputError("一次最多添加 8 份参考素材"); return; }
        setInputError("");
        attachmentCount.current += files.length;
        const entries = files.map((file) => ({ id: crypto.randomUUID(), file, busy: true }));
        setUploads((items) => [...items, ...entries]);
        entries.forEach((item) => void upload(item.id, item.file));
    }, [draftIdentity, draftLoaded, loadedDraftIdentity, upload]);

    const loadSkills = useCallback(async () => {
        const expected = inputScope.current;
        setSkillsLoading(true); setSkillsError("");
        try {
            const data = await listAddedSkills();
            if (userScopeMatches(expected)) setAvailableSkills(data.skills.filter((skill) => skill.status === 1 && skill.isAdded));
        } catch {
            setSkillsError("没有读到已安装技能，请重试。");
        } finally {
            setSkillsLoading(false);
        }
    }, []);

    const turnCount = assistant.turns.length;
    useLayoutEffect(() => {
        const node = logRef.current;
        if (node && followLatestRef.current) node.scrollTop = node.scrollHeight;
    }, [turnCount, assistant.streamed, assistant.pendingUserText, assistant.lifecycleNotice]);

    const notice = assistant.status && !assistant.status.available && assistant.status.reason !== "host_starting" ? assistantStatusNotice(assistant.status.reason) : null;
    const inputReady = draftLoaded && loadedDraftIdentity === draftIdentity;
    const composerDisabled = !inputReady;
    const composerReason = !draftLoaded ? "正在读取未发送内容…" : loadedDraftIdentity !== draftIdentity ? "未能读取草稿，请重新读取后继续。" : undefined;

    const send = useCallback(() => {
        const text = draft;
        if ((!text.trim() && !attachments.length) || !draftLoaded || loadedDraftIdentity !== draftIdentity || !userScopeMatches(inputScope.current) || uploads.length || attachments.some((item) => attachmentRangeError(item)) || assistant.awaitingReceipt || assistant.sessionBusy || assistant.supplementBusy || (assistant.streaming && !assistant.canSupplement)) return;
        followLatestRef.current = true;
        setDraft("");
        setAttachments([]);
        setSelectedSkills([]);
        const assetReferences = [...new Set([...referencedAssetIdsInPrompt(text), ...attachments.flatMap((item) => item.assetId ? [item.assetId] : [])])]
            .map((id) => ({ kind: "asset" as const, id }));
        void assistant.send(text, [], assetReferences, { attachments, skills: selectedSkills, permissionMode: "read-only" });
    }, [assistant, attachments, draft, draftIdentity, draftLoaded, loadedDraftIdentity, selectedSkills, uploads.length]);

    const sessionItems = assistant.sessions.length
        ? assistant.sessions.map((session) => ({
            key: session.sessionId,
            label: session.title || "还没有内容的对话",
            onClick: () => void assistant.activateSession(session.sessionId),
        }))
        : [{ key: "empty", label: "还没有别的对话", disabled: true }];

    return (
        <WorkspacePage fluid scroll={false} className="siflux-agent-page">
            <div className="siflux-agent-shell canvas-assistant-panel" aria-label={config.title}>
                <header className="siflux-agent-header">
                    <div>
                        <h1>{config.title}</h1>
                        <p>{config.subtitle}</p>
                    </div>
                    <div className="siflux-agent-header-actions">
                        <Button type="text" size="small" aria-label="新对话" disabled={assistant.streaming || assistant.sessionBusy} icon={<MessageSquarePlus className="size-4" />} onClick={() => void assistant.startNewSession()}>新对话</Button>
                        <Dropdown trigger={["click"]} placement="bottomRight" menu={{ items: sessionItems, selectedKeys: assistant.sessionId ? [assistant.sessionId] : [] }}>
                            <Button type="text" size="small" aria-label="历史对话" disabled={assistant.streaming || assistant.sessionBusy} icon={<History className="size-4" />}>历史</Button>
                        </Dropdown>
                    </div>
                </header>

                {notice ? (
                    <div className="canvas-assistant-notice" role="status">
                        <span>{notice.text}</span>
                        {notice.action === "model-settings" ? (
                            <Button size="small" onClick={() => navigate("/settings?section=channels")}>{notice.actionLabel}</Button>
                        ) : notice.action === "retry" ? (
                            <Button size="small" loading={assistant.statusBusy} onClick={() => void assistant.restartHost()}>{notice.actionLabel}</Button>
                        ) : null}
                    </div>
                ) : null}

                <div ref={logRef} className="siflux-agent-log canvas-assistant-log" onScroll={() => { const node = logRef.current; if (node) followLatestRef.current = node.scrollHeight - node.scrollTop - node.clientHeight < 48; }}>
                    {assistant.historyError ? <div className="canvas-assistant-notice" role="status"><span>{assistant.historyError}</span><Button size="small" onClick={() => void assistant.reloadHistory()}>重新读取</Button></div> : !assistant.historyLoaded && assistant.status?.reason !== "model_not_configured" ? <p className="canvas-assistant-meta" role="status">正在读取对话…</p> : null}
                    {assistant.historyLoaded && turnCount === 0 && !assistant.pendingUserText && !assistant.pendingAttachments.length ? (
                        <div className="canvas-assistant-empty">
                            <h3>想让 Agent 助手帮你做什么？</h3>
                            {config.starters.map((label) => (
                                <button key={label} type="button" className="canvas-assistant-starter" onClick={() => setDraft(label)}>
                                    <span>{label}</span><ArrowUpRight size={14} aria-hidden="true" />
                                </button>
                            ))}
                        </div>
                    ) : null}

                    {assistant.turns.map((turn) => <AgentTurnView key={turn.turnId} turn={turn} />)}

                    {assistant.pendingUserText || assistant.pendingAttachments.length ? (
                        <div className="canvas-assistant-turn">
                            <CanvasAssistantUserMessage text={assistant.pendingUserText || ""} selectedCount={0} />
                            <CanvasAssistantAttachments attachments={assistant.pendingAttachments} />
                            {assistant.awaitingReceipt ? <p className="canvas-assistant-meta" role="status">正在读取这次处理的最终结果，已有内容仍然保留。</p> : null}
                            {assistant.pendingSkills.map((skill) => <span className="canvas-assistant-chip" key={skill.skillId}>{assistantSkillLabel(skill)}</span>)}
                            {assistant.supplements.map((item, index) => (
                                <div key={index}>
                                    <CanvasAssistantUserMessage text={item.text} selectedCount={0} />
                                    <CanvasAssistantAttachments attachments={item.attachments || []} />
                                    <p className="canvas-assistant-meta" role="status">{item.status === "accepted" ? "助手已收到补充要求。" : item.status === "sending" ? "正在发送补充要求…" : "未能确认收到补充要求。请查看最新回复后再决定是否发送。"}</p>
                                </div>
                            ))}
                            {assistantVisibleReply(assistant.streamed || "") ? <CanvasAssistantReply text={assistant.streamed} /> : null}
                            {assistant.streaming && (assistant.lifecycleNotice || !assistantVisibleReply(assistant.streamed || "")) ? (
                                <p className="canvas-assistant-meta">{assistant.lifecycleNotice || "助手正在处理…"}</p>
                            ) : null}
                        </div>
                    ) : null}

                    {assistant.error ? (
                        <div className="canvas-assistant-card">
                            <span>{assistant.error}</span>
                            <div className="canvas-assistant-card-actions">
                                {assistant.canRetry ? <Button size="small" onClick={assistant.retryLast}>重试</Button> : null}
                                {!assistant.canRetry && !assistant.historyError ? <Button size="small" onClick={() => void assistant.reloadHistory()}>重新读取</Button> : null}
                                <Button size="small" type="text" onClick={assistant.dismissError}>知道了</Button>
                            </div>
                        </div>
                    ) : null}
                </div>

                <CanvasAssistantComposer
                    value={inputReady ? draft : ""}
                    onChange={setDraft}
                    onSend={send}
                    onStop={() => void assistant.stop()}
                    streaming={assistant.streaming}
                    permissionMode="read-only"
                    permissionLocked
                    disabled={composerDisabled}
                    disabledReason={composerReason}
                    references={[]}
                    selectedCount={0}
                    selectionAttached={false}
                    onDetachSelection={() => undefined}
                    modelBusy={assistant.modelBusy}
                    canSupplement={assistant.canSupplement}
                    supplementBusy={assistant.supplementBusy}
                    hasAttachments={inputReady && attachments.length > 0}
                    inputBusy={!draftLoaded || loadedDraftIdentity !== draftIdentity || assistant.awaitingReceipt || uploads.length > 0 || attachments.some((item) => Boolean(attachmentRangeError(item)))}
                    onFiles={addFiles}
                    onOpenSkills={() => { setSkillsOpen((value) => !value); void loadSkills(); }}
                    inputContent={
                        <>
                            <CanvasAssistantAttachments attachments={inputReady ? attachments : []} onChange={(index, value) => setAttachments((items) => items.map((item, i) => i === index ? value : item))} onRemove={(index) => setAttachments((items) => items.filter((_, i) => i !== index))} />
                            {(inputReady ? uploads : []).map((item) => (
                                <div key={item.id} className="canvas-assistant-notice" role="status">
                                    <span>{item.file.name} · {item.busy ? "正在保存素材…" : item.error}</span>
                                    {!item.busy ? <><Button size="small" onClick={() => void upload(item.id, item.file)}>重试上传</Button><Button size="small" onClick={() => setUploads((items) => items.filter((value) => value.id !== item.id))}>移除</Button></> : null}
                                </div>
                            ))}
                            {inputError ? <p className="canvas-assistant-meta" role="status">{inputError}</p> : null}
                            {draftLoaded && loadedDraftIdentity !== draftIdentity ? <Button size="small" onClick={() => setDraftReadAttempt((value) => value + 1)}>重新读取草稿</Button> : null}
                            {(inputReady ? selectedSkills : []).map((skill) => (
                                <span className="canvas-assistant-chip" key={skill.skillId}>
                                    技能：{skill.skillName || skill.skillId} · {skill.version || skill.versionId}
                                    <button aria-label={`移除技能 ${skill.skillName || skill.skillId}`} onClick={() => setSelectedSkills((items) => items.filter((item) => item.skillId !== skill.skillId))}><X size={12} /></button>
                                </span>
                            ))}
                            {skillsOpen && inputReady ? (
                                <div className="canvas-assistant-picker" aria-label="已安装技能">
                                    {skillsLoading ? <span>正在读取技能…</span> : skillsError ? <><span role="status">{skillsError}</span><Button size="small" onClick={() => void loadSkills()}>重新读取</Button></> : availableSkills.length ? availableSkills.map((skill) => (
                                        <button key={skill.skillId} type="button" aria-pressed={selectedSkills.some((item) => item.skillId === skill.skillId)} onClick={() => setSelectedSkills((items) => items.some((item) => item.skillId === skill.skillId) ? items.filter((item) => item.skillId !== skill.skillId) : [...items, { skillId: skill.skillId, versionId: skill.versionId, contentHash: skill.contentHash, skillName: skill.skillName, version: skill.version }])}>{skill.skillName} · {skill.version}</button>
                                    )) : <span>还没有已安装的技能。</span>}
                                    <Button size="small" onClick={() => { setSkillInstallGeneration(inputGeneration.current); setSkillInstallOpen(true); }}>安装技能</Button>
                                </div>
                            ) : null}
                        </>
                    }
                />
                <SkillInstallModal open={skillInstallOpen} onClose={() => setSkillInstallOpen(false)} onInstalled={(skill) => {
                    if (skillInstallGeneration !== inputGeneration.current || !userScopeMatches(inputScope.current)) return;
                    setSkillInstallOpen(false);
                    if (!skill.versionId || !/^[a-f0-9]{64}$/i.test(skill.contentHash)) {
                        setInputError("技能已安装，但没有读到可用版本，请重新读取技能。");
                        void loadSkills();
                        return;
                    }
                    setSelectedSkills((items) => [...items.filter((item) => item.skillId !== skill.skillId), { skillId: skill.skillId, versionId: skill.versionId, contentHash: skill.contentHash, skillName: skill.skillName, version: skill.version }]);
                    setSkillsOpen(true);
                    void loadSkills();
                }} />
            </div>
        </WorkspacePage>
    );
}
