import { App, Popover } from "antd";
import { Download, Plus, SlidersHorizontal, Trash2, Upload, Video, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { videoResolutionLabel, videoSecondsLabel } from "@/components/video-settings-panel";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { explainGenerationError, shouldBlockAutomaticRetry } from "@/lib/generation-error";
import { modelCapabilityConfigFor, normalizeVideoValue, videoDurationOptions } from "@/lib/model-capabilities";
import { creationAttachmentsFromReferences, persistableMediaReferences } from "@/lib/standalone-generation-reference";
import { assertUserScope, captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import {
    creationAttachmentFromAsset,
    creationAttachmentFromAudio,
    creationAttachmentFromAudioAsset,
    creationAttachmentFromImage,
    creationAttachmentFromVideo,
    creationAttachmentFromVideoAsset,
    creationAttachmentKind,
    creationAudioAsset,
    creationImageAsset,
    creationVideoAsset,
    removeCreationAttachment,
    type CreationAttachment,
} from "@/pages/create/creation-assets";
import { resolveResourceUrl } from "@/services/api/resources";
import { uploadMediaFile } from "@/services/file-storage";
import { uploadImage } from "@/services/image-storage";
import { useAssetStore, type VideoAsset } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { type VideoGenerationJob } from "./generate-video-history";
import {
    deleteStandaloneVideoJob,
    getStandaloneVideoSnapshot,
    hydrateStandaloneVideo,
    resumeStandaloneVideoJob,
    runStandaloneVideoJob,
    setStandaloneVideoErrorHandler,
    stopStandaloneVideoJob,
    subscribeStandaloneVideo,
} from "./generate-video-session";
import "./generate-video.css";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));

function jobSummary(job: VideoGenerationJob) {
    const statusLabel = { pending: "准备中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已取消", retrievable: "可取回" }[job.status];
    return `${statusLabel} · ${new Date(job.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function downloadVideoAsset(asset: VideoAsset) {
    const url = resolveResourceUrl(asset.data.storageKey, asset.data.url);
    if (!url) return;
    const extension = (asset.data.mimeType.split("/")[1] || "mp4").replace("quicktime", "mov");
    const link = document.createElement("a");
    link.href = url;
    link.download = `${asset.title || "video"}.${extension}`;
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

function compactDurationChoices(values: number[]) {
    if (values.length <= 8) return values;
    const min = values[0];
    const max = values[values.length - 1];
    const mid = values[Math.floor(values.length / 2)];
    return [...new Set([min, mid, max].filter((value): value is number => typeof value === "number"))];
}

export default function GenerateVideoPage() {
    const { message: toast } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const videoModels = useMemo(() => selectableModelsByCapability(config, "video"), [config]);
    const [model, setModel] = useState(config.videoModel || videoModels[0] || "");
    const videoProfile = useMemo(() => modelCapabilityConfigFor(config, model || config.videoModel).video!, [config, model]);
    const initial = useMemo(() => normalizeVideoValue(videoProfile, { seconds: config.videoSeconds, ratio: config.size, resolution: config.vquality }), [config.size, config.videoSeconds, config.vquality, videoProfile]);
    const [prompt, setPrompt] = useState("");
    const [ratio, setRatio] = useState(initial.ratio || videoProfile.defaultRatio || "16:9");
    const [videoQuality, setVideoQuality] = useState(initial.resolution || videoProfile.defaultResolution || "");
    const [seconds, setSeconds] = useState(initial.seconds);
    const [videoGenerateAudio, setVideoGenerateAudio] = useState(String(config.videoGenerateAudio ?? videoProfile.generateAudio.default));
    const [videoWatermark, setVideoWatermark] = useState(String(config.videoWatermark ?? videoProfile.watermark.default));
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const snapshot = useSyncExternalStore(subscribeStandaloneVideo, getStandaloneVideoSnapshot, getStandaloneVideoSnapshot);
    const jobs = snapshot.jobs;
    const [activeId, setActiveId] = useState("");
    const [hydrated, setHydrated] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const activeJob = jobs.find((job) => job.id === activeId) || jobs[0];
    const live = Boolean(activeJob && snapshot.liveIds.includes(activeJob.id));
    const maxImages = videoProfile.references.maxImages || 0;
    const maxVideos = videoProfile.references.maxVideos || 0;
    const maxAudios = videoProfile.references.maxAudios || 0;
    const maxReferences = Math.max(0, maxImages + maxVideos + maxAudios);
    const accept = [maxImages ? "image/*" : "", maxVideos ? "video/*" : "", maxAudios ? "audio/*" : ""].filter(Boolean).join(",");
    const mediaKinds = [
        ...(maxImages ? (["image"] as const) : []),
        ...(maxVideos ? (["video"] as const) : []),
        ...(maxAudios ? (["audio"] as const) : []),
    ];
    const durationChoices = compactDurationChoices(videoDurationOptions(videoProfile));
    const settingsSummary = [ratio, videoQuality ? videoResolutionLabel(videoQuality) : "", videoSecondsLabel(seconds, videoProfile)].filter(Boolean).join(" · ");

    useEffect(() => {
        if (model && videoModels.includes(model)) return;
        setModel(config.videoModel && videoModels.includes(config.videoModel) ? config.videoModel : videoModels[0] || "");
    }, [config.videoModel, videoModels, model]);

    useEffect(() => {
        const next = normalizeVideoValue(videoProfile, { seconds, ratio, resolution: videoQuality });
        setRatio(next.ratio);
        setVideoQuality(next.resolution);
        setSeconds(next.seconds);
        if (!videoProfile.generateAudio.supported) setVideoGenerateAudio("false");
        if (!videoProfile.watermark.supported) setVideoWatermark("false");
    }, [model]);

    useEffect(() => setStandaloneVideoErrorHandler((text) => toast.error(text)), [toast]);

    useEffect(() => {
        let cancelled = false;
        void hydrateStandaloneVideo().then(() => {
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

    const applyComposerFromJob = (job: VideoGenerationJob) => {
        setPrompt(job.prompt);
        setModel(job.model);
        setRatio(job.ratio);
        setVideoQuality(job.videoQuality);
        setSeconds(job.seconds);
        setVideoGenerateAudio(job.videoGenerateAudio);
        setVideoWatermark(job.videoWatermark);
        setAttachments(creationAttachmentsFromReferences(job.references || []));
        setActiveId(job.id);
    };

    const startJob = async (retryJob?: VideoGenerationJob) => {
        const text = (retryJob?.prompt ?? prompt).trim();
        if (!text) {
            toast.warning("请先填写提示词");
            return;
        }
        if (!model) {
            toast.warning("请先在模型配置中添加视频模型");
            navigate("/settings?section=channels");
            return;
        }
        try {
            const id = await runStandaloneVideoJob({
                retryJob,
                prompt: text,
                config,
                model: retryJob?.model ?? model,
                ratio: retryJob?.ratio ?? ratio,
                videoQuality: retryJob?.videoQuality ?? videoQuality,
                seconds: retryJob?.seconds ?? seconds,
                videoGenerateAudio: retryJob?.videoGenerateAudio ?? videoGenerateAudio,
                videoWatermark: retryJob?.videoWatermark ?? videoWatermark,
                references: retryJob?.references?.length ? retryJob.references : persistableMediaReferences(attachments),
            });
            if (id) setActiveId(id);
            if (!retryJob) setPrompt("");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成失败");
        }
    };

    const continueRetrieve = (job: VideoGenerationJob) => {
        if (!job.taskIds.length || snapshot.liveIds.includes(job.id)) return;
        void resumeStandaloneVideoJob(job).then((id) => {
            if (id) setActiveId(id);
        });
    };

    const addFiles = async (files: FileList | File[]) => {
        const expectedScope = captureUserScope();
        const nextFiles = Array.from(files).filter((file) => (file.type.startsWith("image/") && maxImages) || (file.type.startsWith("video/") && maxVideos) || (file.type.startsWith("audio/") && maxAudios));
        if (!nextFiles.length) return;
        try {
            for (const file of nextFiles) {
                assertUserScope(expectedScope);
                if (file.type.startsWith("image/")) {
                    const uploaded = await uploadImage(file, undefined, expectedScope);
                    assertUserScope(expectedScope);
                    addAsset(creationImageAsset({ title: file.name, uploaded, metadata: { source: "standalone-video-page" } }));
                    const attachment = creationAttachmentFromImage(file, uploaded);
                    setAttachments((current) => [...current.filter((item) => creationAttachmentKind(item) !== "image" || item.id !== attachment.id), attachment].filter((item, _, list) => {
                        const images = list.filter((candidate) => creationAttachmentKind(candidate) === "image");
                        return creationAttachmentKind(item) !== "image" || images.indexOf(item) < maxImages;
                    }).slice(0, Math.max(maxReferences, 1)));
                    continue;
                }
                const uploaded = await uploadMediaFile(file, "standalone-video", undefined, expectedScope);
                assertUserScope(expectedScope);
                if (file.type.startsWith("video/")) {
                    addAsset(creationVideoAsset({ title: file.name, uploaded, metadata: { source: "standalone-video-page" } }));
                    const attachment = creationAttachmentFromVideo(file, uploaded);
                    setAttachments((current) => [...current, attachment].filter((item, _, list) => {
                        const videos = list.filter((candidate) => creationAttachmentKind(candidate) === "video");
                        return creationAttachmentKind(item) !== "video" || videos.indexOf(item) < maxVideos;
                    }).slice(0, Math.max(maxReferences, 1)));
                } else {
                    addAsset(creationAudioAsset({ title: file.name, uploaded, metadata: { source: "standalone-video-page" } }));
                    const attachment = creationAttachmentFromAudio(file, uploaded);
                    setAttachments((current) => [...current, attachment].filter((item, _, list) => {
                        const audios = list.filter((candidate) => creationAttachmentKind(candidate) === "audio");
                        return creationAttachmentKind(item) !== "audio" || audios.indexOf(item) < maxAudios;
                    }).slice(0, Math.max(maxReferences, 1)));
                }
            }
        } catch (error) {
            if (userScopeMatches(expectedScope)) toast.error(error instanceof Error ? error.message : "参考素材上传失败");
        }
    };

    const resultAssets = (activeJob?.assetIds || []).flatMap((id) => {
        const asset = assets.find((item) => item.id === id);
        return asset?.kind === "video" ? [asset] : [];
    });
    const showRetrieve = Boolean(activeJob && !live && (activeJob.status === "retrievable" || (activeJob.status === "failed" && activeJob.taskIds.length)));
    const showRetry = Boolean(activeJob && activeJob.status === "failed" && !shouldBlockAutomaticRetry(activeJob.error, activeJob.generationErrorCode));

    return (
        <WorkspacePage fluid scroll={false} className="siflux-image-gen-page">
            <div className="siflux-image-gen" aria-label="视频生成">
                <header className="siflux-image-gen-header">
                    <div>
                        <h1>视频生成</h1>
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
                                <Video />
                                <strong>还没有生成结果</strong>
                            </div>
                        ) : (
                            <div className="siflux-video-gen-list">
                                {resultAssets.map((asset) => (
                                    <figure className="siflux-video-gen-card" key={asset.id}>
                                        <video controls src={resolveResourceUrl(asset.data.storageKey, asset.data.url)} poster={asset.coverUrl || undefined} preload="metadata" />
                                        <div className="siflux-video-gen-card-meta">
                                            <strong>{asset.title || "生成视频"}</strong>
                                            <span>{formatDuration(asset.data.durationMs)}</span>
                                            <button type="button" className="siflux-image-gen-action" onClick={() => downloadVideoAsset(asset)}><Download size={14} />下载</button>
                                        </div>
                                    </figure>
                                ))}
                                {activeJob.status === "succeeded" && activeJob.assetIds.some((id) => !assets.some((asset) => asset.id === id)) ? (
                                    <div className="siflux-video-gen-card-missing">资产库中已删除</div>
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
                                        deleteStandaloneVideoJob(job.id);
                                        if (activeId === job.id) setActiveId(jobs.find((item) => item.id !== job.id)?.id || "");
                                    }}><Trash2 size={14} /></button>
                                </li>
                            ))}
                        </ul>
                    </aside>
                </div>
                <form className="siflux-image-gen-composer" onSubmit={(event) => { event.preventDefault(); void startJob(); }}>
                    {attachments.length ? (
                        <div className="siflux-image-gen-refs">
                            {attachments.map((attachment) => {
                                const kind = creationAttachmentKind(attachment);
                                return (
                                    <span className={`siflux-image-gen-ref${kind === "image" ? "" : " is-media"}`} key={attachment.id}>
                                        {kind === "image" ? (
                                            <img src={attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url)} alt={attachment.name} />
                                        ) : kind === "video" ? (
                                            <video src={attachment.previewUrl || attachment.url} muted />
                                        ) : (
                                            <span>音频</span>
                                        )}
                                        <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => removeCreationAttachment(current, attachment.id))}><X size={12} /></button>
                                    </span>
                                );
                            })}
                        </div>
                    ) : null}
                    <textarea className="siflux-image-gen-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想生成的镜头、动作和氛围" rows={3} />
                    <div className="siflux-image-gen-toolbar">
                        {maxReferences ? (
                            <>
                                <input ref={fileRef} type="file" accept={accept} hidden multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
                                <button type="button" className="siflux-image-gen-action" onClick={() => fileRef.current?.click()}><Upload size={14} />上传参考</button>
                                <button type="button" className="siflux-image-gen-action" onClick={() => setLibraryOpen(true)}><Plus size={14} />资产库</button>
                            </>
                        ) : null}
                        <ModelPicker
                            className="siflux-image-gen-model min-w-0"
                            config={config}
                            value={model}
                            onChange={(value) => {
                                setModel(value);
                                updateConfig("videoModel", value);
                                updateConfig("model", value);
                            }}
                            capability="video"
                            onMissingConfig={() => navigate("/settings?section=channels")}
                        />
                        <Popover
                            trigger="click"
                            placement="topLeft"
                            arrow={false}
                            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
                            content={(
                                <div className="creation-parameter-menu siflux-video-settings">
                                    {videoProfile.ratios.length ? (
                                        <section>
                                            <header><span>画幅</span><strong>{ratio || "默认"}</strong></header>
                                            <div className="siflux-video-settings-grid" role="group" aria-label="画幅">
                                                {videoProfile.ratios.map((value) => (
                                                    <button key={value} type="button" className={value === ratio ? "is-selected" : ""} onClick={() => { setRatio(value); updateConfig("size", value); }}>{value}</button>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}
                                    {videoProfile.resolutions.length ? (
                                        <section>
                                            <header><span>清晰度</span><strong>{videoQuality ? videoResolutionLabel(videoQuality) : "默认"}</strong></header>
                                            <div className="siflux-video-settings-grid is-3" role="group" aria-label="清晰度">
                                                {videoProfile.resolutions.map((value) => (
                                                    <button key={value} type="button" className={value === videoQuality ? "is-selected" : ""} onClick={() => { setVideoQuality(value); updateConfig("vquality", value.replace(/p$/i, "")); }}>{videoResolutionLabel(value)}</button>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}
                                    <section>
                                        <header><span>时长</span><strong>{videoSecondsLabel(seconds, videoProfile)}</strong></header>
                                        <div className="siflux-video-settings-grid" role="group" aria-label="时长">
                                            {durationChoices.map((value) => (
                                                <button key={value} type="button" className={String(value) === seconds ? "is-selected" : ""} onClick={() => { const next = String(value); setSeconds(next); updateConfig("videoSeconds", next); }}>{value === -1 ? "自动" : `${value}s`}</button>
                                            ))}
                                        </div>
                                        {videoProfile.duration.selection === "range" ? (
                                            <input
                                                type="number"
                                                min={videoProfile.duration.min || 1}
                                                max={videoProfile.duration.max || 15}
                                                step={videoProfile.duration.step || 1}
                                                aria-label="自定义时长"
                                                value={seconds}
                                                onChange={(event) => setSeconds(event.target.value)}
                                                onBlur={(event) => {
                                                    const next = normalizeVideoValue(videoProfile, { seconds: event.target.value, ratio, resolution: videoQuality }).seconds;
                                                    setSeconds(next);
                                                    updateConfig("videoSeconds", next);
                                                }}
                                            />
                                        ) : null}
                                    </section>
                                    {videoProfile.generateAudio.supported || videoProfile.watermark.supported ? (
                                        <section>
                                            <header><span>输出</span></header>
                                            <div className="siflux-video-settings-grid is-2">
                                                {videoProfile.generateAudio.supported ? (
                                                    <button type="button" className={videoGenerateAudio === "true" ? "is-selected" : ""} onClick={() => { const next = videoGenerateAudio === "true" ? "false" : "true"; setVideoGenerateAudio(next); updateConfig("videoGenerateAudio", next); }}>生成声音</button>
                                                ) : null}
                                                {videoProfile.watermark.supported ? (
                                                    <button type="button" className={videoWatermark === "true" ? "is-selected" : ""} onClick={() => { const next = videoWatermark === "true" ? "false" : "true"; setVideoWatermark(next); updateConfig("videoWatermark", next); }}>添加水印</button>
                                                ) : null}
                                            </div>
                                        </section>
                                    ) : null}
                                </div>
                            )}
                        >
                            <button type="button" className="siflux-image-gen-action"><SlidersHorizontal size={14} />{settingsSummary}</button>
                        </Popover>
                        {live ? (
                            <button type="button" className="siflux-image-gen-action is-primary" onClick={() => activeJob && stopStandaloneVideoJob(activeJob.id)}>取消等待</button>
                        ) : (
                            <button type="submit" className="siflux-image-gen-action is-primary" disabled={!prompt.trim()}>生成</button>
                        )}
                    </div>
                </form>
                {libraryOpen ? (
                    <Suspense fallback={null}>
                        <AssetLibraryPickerModal
                            open={libraryOpen}
                            mediaKinds={[...mediaKinds]}
                            title="选择参考素材"
                            items={assets.flatMap((asset) => {
                                if (asset.kind === "image" && maxImages) return [{ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: "图片", mediaKind: "image" as const, asset, searchText: (asset.tags || []).join(" ") }];
                                if (asset.kind === "video" && maxVideos) return [{ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: "视频", mediaKind: "video" as const, asset, searchText: (asset.tags || []).join(" ") }];
                                if (asset.kind === "audio" && maxAudios) return [{ id: asset.id, title: asset.title, category: asset.category || "other", kindLabel: "音频", mediaKind: "audio" as const, asset, searchText: (asset.tags || []).join(" ") }];
                                return [];
                            })}
                            categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS }}
                            onClose={() => setLibraryOpen(false)}
                            onConfirm={(selectedIds) => {
                                const next = selectedIds.flatMap((id) => {
                                    const asset = assets.find((item) => item.id === id);
                                    if (asset?.kind === "image") return [creationAttachmentFromAsset(asset)];
                                    if (asset?.kind === "video") return [creationAttachmentFromVideoAsset(asset)];
                                    if (asset?.kind === "audio") return [creationAttachmentFromAudioAsset(asset)];
                                    return [];
                                });
                                setAttachments((current) => [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next].slice(0, Math.max(maxReferences, 1)));
                                setLibraryOpen(false);
                            }}
                        />
                    </Suspense>
                ) : null}
            </div>
        </WorkspacePage>
    );
}
