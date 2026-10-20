import { App, Popover } from "antd";
import { Download, Music2, SlidersHorizontal, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import {
    audioFormatLabel,
    audioSettingsSummary,
    audioSpeechProfile,
    audioSpeedLabel,
    audioVoiceLabel,
    normalizeAudioSpeedValue,
    resolveAudioSpeechSettings,
} from "@/lib/audio-generation";
import { explainGenerationError, shouldBlockAutomaticRetry } from "@/lib/generation-error";
import { resolveResourceUrl } from "@/services/api/resources";
import { useAssetStore, type AudioAsset } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { type AudioGenerationJob } from "./generate-audio-history";
import {
    deleteStandaloneAudioJob,
    getStandaloneAudioSnapshot,
    hydrateStandaloneAudio,
    resumeStandaloneAudioJob,
    runStandaloneAudioJob,
    setStandaloneAudioErrorHandler,
    stopStandaloneAudioJob,
    subscribeStandaloneAudio,
} from "./generate-audio-session";
import "./generate-audio.css";

function jobSummary(job: AudioGenerationJob) {
    const statusLabel = { pending: "准备中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已取消", retrievable: "可取回" }[job.status];
    return `${statusLabel} · ${new Date(job.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function downloadAudioAsset(asset: AudioAsset) {
    const url = resolveResourceUrl(asset.data.storageKey, asset.data.url);
    if (!url) return;
    const extension = (asset.data.mimeType.split("/")[1] || "mp3").replace("mpeg", "mp3");
    const link = document.createElement("a");
    link.href = url;
    link.download = `${asset.title || "audio"}.${extension}`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
}

function formatDuration(ms?: number) {
    if (!ms) return "";
    const total = Math.max(0, Math.round(ms / 1000));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

export default function GenerateAudioPage() {
    const { message: toast } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const audioModels = useMemo(() => selectableModelsByCapability(config, "audio"), [config]);
    const [model, setModel] = useState(config.audioModel || audioModels[0] || "");
    const profile = useMemo(() => audioSpeechProfile(model), [model]);
    const initialSettings = useMemo(() => resolveAudioSpeechSettings(model || config.audioModel, config), [config, model]);
    const [prompt, setPrompt] = useState("");
    const [voice, setVoice] = useState(initialSettings.audioVoice);
    const [format, setFormat] = useState(initialSettings.audioFormat);
    const [speed, setSpeed] = useState(initialSettings.audioSpeed);
    const [pitch, setPitch] = useState(initialSettings.audioPitch);
    const [volume, setVolume] = useState(initialSettings.audioVolume);
    const [instructions, setInstructions] = useState(initialSettings.audioInstructions);
    const snapshot = useSyncExternalStore(subscribeStandaloneAudio, getStandaloneAudioSnapshot, getStandaloneAudioSnapshot);
    const jobs = snapshot.jobs;
    const [activeId, setActiveId] = useState("");
    const [hydrated, setHydrated] = useState(false);

    const activeJob = jobs.find((job) => job.id === activeId) || jobs[0];
    const live = Boolean(activeJob && snapshot.liveIds.includes(activeJob.id));
    const settingsSummary = audioSettingsSummary({ model, audioVoice: voice, audioFormat: format, audioSpeed: speed, audioPitch: pitch, audioVolume: volume });

    useEffect(() => {
        if (model && audioModels.includes(model)) return;
        setModel(config.audioModel && audioModels.includes(config.audioModel) ? config.audioModel : audioModels[0] || "");
    }, [config.audioModel, audioModels, model]);

    useEffect(() => {
        const next = resolveAudioSpeechSettings(model, { audioVoice: voice, audioFormat: format, audioSpeed: speed, audioPitch: pitch, audioVolume: volume, audioInstructions: instructions });
        setVoice(next.audioVoice);
        setFormat(next.audioFormat);
        setSpeed(next.audioSpeed);
        setPitch(next.audioPitch);
        setVolume(next.audioVolume);
        setInstructions(next.audioInstructions);
    }, [model]);

    useEffect(() => setStandaloneAudioErrorHandler((text) => toast.error(text)), [toast]);

    useEffect(() => {
        let cancelled = false;
        void hydrateStandaloneAudio().then(() => {
            if (!cancelled) setHydrated(true);
        });
        return () => {
            cancelled = true;
        };
    }, []);

    useEffect(() => {
        if (!hydrated) return;
        if (activeId && jobs.some((job) => job.id === activeId)) return;
        setActiveId(jobs[0]?.id || "");
    }, [activeId, hydrated, jobs]);

    const applyComposerFromJob = (job: AudioGenerationJob) => {
        setPrompt(job.prompt);
        setModel(job.model);
        setVoice(job.audioVoice);
        setFormat(job.audioFormat);
        setSpeed(job.audioSpeed);
        setPitch(job.audioPitch);
        setVolume(job.audioVolume);
        setInstructions(job.audioInstructions);
        setActiveId(job.id);
    };

    const startJob = async (retryJob?: AudioGenerationJob) => {
        const text = (retryJob?.prompt ?? prompt).trim();
        if (!text) {
            toast.warning("请先填写提示词");
            return;
        }
        if (!model) {
            toast.warning("请先在模型配置中添加音频模型");
            navigate("/settings?section=channels");
            return;
        }
        try {
            const id = await runStandaloneAudioJob({
                retryJob,
                prompt: text,
                config,
                model: retryJob?.model ?? model,
                audioVoice: retryJob?.audioVoice ?? voice,
                audioFormat: retryJob?.audioFormat ?? format,
                audioSpeed: retryJob?.audioSpeed ?? speed,
                audioPitch: retryJob?.audioPitch ?? pitch,
                audioVolume: retryJob?.audioVolume ?? volume,
                audioInstructions: retryJob?.audioInstructions ?? instructions,
            });
            if (id) setActiveId(id);
            if (!retryJob) setPrompt("");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成失败");
        }
    };

    const continueRetrieve = (job: AudioGenerationJob) => {
        if (!job.taskIds.length || snapshot.liveIds.includes(job.id)) return;
        void resumeStandaloneAudioJob(job).then((id) => {
            if (id) setActiveId(id);
        });
    };

    const resultAssets = (activeJob?.assetIds || []).flatMap((id) => {
        const asset = assets.find((item) => item.id === id);
        return asset?.kind === "audio" ? [asset] : [];
    });
    const showRetrieve = Boolean(activeJob && !live && (activeJob.status === "retrievable" || (activeJob.status === "failed" && activeJob.taskIds.length)));
    const showRetry = Boolean(activeJob && activeJob.status === "failed" && !shouldBlockAutomaticRetry(activeJob.error, activeJob.generationErrorCode));

    return (
        <WorkspacePage fluid scroll={false} className="siflux-image-gen-page">
            <div className="siflux-image-gen" aria-label="音频生成">
                <header className="siflux-image-gen-header">
                    <div>
                        <h1>音频生成</h1>
                    </div>
                </header>
                <div className="siflux-image-gen-body">
                    <section className="siflux-image-gen-results" aria-label="生成结果">
                        {activeJob?.status === "running" ? <p className="siflux-image-gen-status">正在生成，离开本页后仍会继续。</p> : null}
                        {activeJob?.error ? (
                            <div className="siflux-image-gen-error">
                                <GenerationFailureNotice
                                    explanation={explainGenerationError(activeJob.error, { taskId: activeJob.taskIds[0], stage: activeJob.generationErrorCode })}
                                    onRetry={showRetry ? () => void startJob(activeJob) : undefined}
                                    retryLabel="按相同参数重试"
                                />
                                {showRetrieve ? (
                                    <button type="button" className="siflux-image-gen-action" disabled={live} onClick={() => continueRetrieve(activeJob)}>继续取回</button>
                                ) : null}
                            </div>
                        ) : null}
                        {activeJob?.status === "retrievable" && !activeJob.error ? (
                            <p className="siflux-image-gen-status">
                                任务仍可取回，不会重新扣费。
                                <button type="button" className="siflux-image-gen-action" disabled={live} onClick={() => continueRetrieve(activeJob)}>继续取回</button>
                            </p>
                        ) : null}
                        {!activeJob || (!resultAssets.length && activeJob.status !== "running" && !activeJob.error) ? (
                            <div className="siflux-image-gen-empty">
                                <Music2 />
                                <strong>还没有生成结果</strong>
                            </div>
                        ) : (
                            <div className="siflux-audio-gen-list">
                                {resultAssets.map((asset) => (
                                    <figure className="siflux-audio-gen-card" key={asset.id}>
                                        <audio controls src={resolveResourceUrl(asset.data.storageKey, asset.data.url)} preload="metadata" />
                                        <div className="siflux-audio-gen-card-meta">
                                            <strong>{asset.title || "生成音频"}</strong>
                                            <span>{formatDuration(asset.data.durationMs)}</span>
                                            <button type="button" className="siflux-image-gen-action" onClick={() => downloadAudioAsset(asset)}><Download size={14} />下载</button>
                                        </div>
                                    </figure>
                                ))}
                                {activeJob.status === "succeeded" && activeJob.assetIds.some((id) => !assets.some((asset) => asset.id === id)) ? (
                                    <div className="siflux-audio-gen-card-missing">资产库中已删除</div>
                                ) : null}
                            </div>
                        )}
                    </section>
                    <aside className="siflux-image-gen-history" aria-label="本页历史">
                        <header>本页历史</header>
                        <ul>
                            {jobs.map((job) => (
                                <li key={job.id}>
                                    <button type="button" className={`siflux-image-gen-history-item${job.id === activeJob?.id ? " is-active" : ""}`} onClick={() => applyComposerFromJob(job)}>
                                        <span>
                                            <strong>{job.prompt || "未命名生成"}</strong>
                                            <small>{jobSummary(job)}</small>
                                        </span>
                                    </button>
                                    <button type="button" className="siflux-image-gen-history-delete" aria-label="删除这条历史" onClick={() => {
                                        deleteStandaloneAudioJob(job.id);
                                        if (activeId === job.id) setActiveId(jobs.find((item) => item.id !== job.id)?.id || "");
                                    }}><Trash2 size={14} /></button>
                                </li>
                            ))}
                        </ul>
                    </aside>
                </div>
                <form className="siflux-image-gen-composer" onSubmit={(event) => { event.preventDefault(); void startJob(); }}>
                    <textarea className="siflux-image-gen-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="输入要朗读的文本，或描述想生成的声音" rows={3} />
                    <div className="siflux-image-gen-toolbar">
                        <ModelPicker
                            className="siflux-image-gen-model min-w-0"
                            config={config}
                            value={model}
                            onChange={(value) => {
                                setModel(value);
                                updateConfig("audioModel", value);
                                updateConfig("model", value);
                            }}
                            capability="audio"
                            onMissingConfig={() => navigate("/settings?section=channels")}
                        />
                        <Popover
                            trigger="click"
                            placement="topLeft"
                            arrow={false}
                            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
                            content={(
                                <div className="creation-parameter-menu siflux-audio-settings">
                                    {profile.showVoice ? (
                                        <section>
                                            <header><span>音色</span><strong>{audioVoiceLabel(voice, model) || "默认"}</strong></header>
                                            <div className="siflux-audio-settings-grid" role="group" aria-label="音色">
                                                {profile.voices.map((item) => (
                                                    <button key={item.value} type="button" className={item.value === voice ? "is-selected" : ""} onClick={() => { setVoice(item.value); updateConfig("audioVoice", item.value); }}>{item.label}</button>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}
                                    <section>
                                        <header><span>格式</span><strong>{audioFormatLabel(format, model)}</strong></header>
                                        <div className="siflux-audio-settings-grid is-format" role="group" aria-label="音频格式">
                                            {profile.formats.map((item) => (
                                                <button key={item.value} type="button" className={item.value === format ? "is-selected" : ""} onClick={() => { setFormat(item.value); updateConfig("audioFormat", item.value); }}>{item.label}</button>
                                            ))}
                                        </div>
                                    </section>
                                    {profile.showSpeed ? (
                                        <section>
                                            <header><span>语速</span><strong>{audioSpeedLabel(speed, model)}</strong></header>
                                            <div className="siflux-audio-settings-grid" role="group" aria-label="语速">
                                                {profile.speedOptions.map((value) => (
                                                    <button key={value} type="button" className={value === speed ? "is-selected" : ""} onClick={() => { setSpeed(value); updateConfig("audioSpeed", value); }}>{audioSpeedLabel(value, model)}</button>
                                                ))}
                                            </div>
                                            <input
                                                type="number"
                                                min={profile.speedMin}
                                                max={profile.speedMax}
                                                step={0.05}
                                                aria-label="自定义语速"
                                                value={speed}
                                                onChange={(event) => setSpeed(event.target.value)}
                                                onBlur={(event) => {
                                                    const next = normalizeAudioSpeedValue(event.target.value, model);
                                                    setSpeed(next);
                                                    updateConfig("audioSpeed", next);
                                                }}
                                            />
                                        </section>
                                    ) : null}
                                    {profile.showInstructions ? (
                                        <details>
                                            <summary>声音指令</summary>
                                            <textarea
                                                value={instructions}
                                                placeholder="例如：自然、温暖、适合旁白。"
                                                onChange={(event) => {
                                                    setInstructions(event.target.value);
                                                    updateConfig("audioInstructions", event.target.value);
                                                }}
                                            />
                                        </details>
                                    ) : null}
                                </div>
                            )}
                        >
                            <button type="button" className="siflux-image-gen-action"><SlidersHorizontal size={14} />{settingsSummary}</button>
                        </Popover>
                        {live ? (
                            <button type="button" className="siflux-image-gen-action is-primary" onClick={() => activeJob && stopStandaloneAudioJob(activeJob.id)}>取消等待</button>
                        ) : (
                            <button type="submit" className="siflux-image-gen-action is-primary" disabled={!prompt.trim()}>生成</button>
                        )}
                    </div>
                </form>
            </div>
        </WorkspacePage>
    );
}
