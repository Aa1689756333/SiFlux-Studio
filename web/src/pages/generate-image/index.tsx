import { App, Popover } from "antd";
import { Download, Image as ImageIcon, Plus, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { lazy, Suspense, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import { useNavigate } from "react-router";

import { CachedResourceImage } from "@/components/cached-resource-image";
import { GenerationFailureNotice } from "@/components/generation/generation-failure-notice";
import { ImageSizePicker } from "@/components/image-size-picker";
import { ModelPicker } from "@/components/model-picker";
import { WorkspacePage } from "@/components/layout/workspace-page";
import { canvasImageReferenceLimitError } from "@/lib/canvas/canvas-project-generation";
import { explainGenerationError, shouldBlockAutomaticRetry } from "@/lib/generation-error";
import { mergedImageCapabilityConfig } from "@/lib/model-selection";
import { creationAttachmentsFromReferences, persistableMediaReferences } from "@/lib/standalone-generation-reference";
import { assertUserScope, captureUserScope, userScopeMatches } from "@/lib/user-scope-guard";
import { uploadImage } from "@/services/image-storage";
import { resolveResourceUrl } from "@/services/api/resources";
import { ASSET_CATEGORY_LABELS } from "@/lib/asset-category";
import { creationAttachmentFromAsset, creationAttachmentFromImage, creationFileAccepted, creationImageAsset, removeCreationAttachment, type CreationAttachment } from "@/pages/create/creation-assets";
import { useAssetStore, type ImageAsset } from "@/stores/use-asset-store";
import { selectableModelsByCapability, useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";
import type { ReferenceImage } from "@/types/image";

import { type ImageGenerationJob } from "./generate-image-history";
import {
    deleteStandaloneImageJob,
    getStandaloneImageSnapshot,
    hydrateStandaloneImage,
    resumeStandaloneImageJob,
    runStandaloneImageJob,
    setStandaloneImageErrorHandler,
    stopStandaloneImageJob,
    subscribeStandaloneImage,
} from "./generate-image-session";
import "./generate-image.css";

const AssetLibraryPickerModal = lazy(() => import("@/components/assets/asset-library-picker-modal").then((module) => ({ default: module.AssetLibraryPickerModal })));

function jobSummary(job: ImageGenerationJob) {
    const statusLabel = { pending: "准备中", running: "生成中", succeeded: "已完成", failed: "失败", cancelled: "已取消", retrievable: "可取回" }[job.status];
    return `${statusLabel} · ${new Date(job.createdAt).toLocaleString("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" })}`;
}

function attachmentToReferenceImage(attachment: CreationAttachment): ReferenceImage | null {
    if (!attachment.type.startsWith("image/")) return null;
    const dataUrl = "dataUrl" in attachment ? attachment.dataUrl : attachment.url || attachment.previewUrl || "";
    if (!dataUrl && !attachment.storageKey) return null;
    return {
        id: attachment.id,
        name: attachment.name,
        type: attachment.type,
        dataUrl,
        url: attachment.url,
        storageKey: attachment.storageKey,
        bytes: attachment.bytes,
        width: "width" in attachment ? attachment.width : undefined,
        height: "height" in attachment ? attachment.height : undefined,
    };
}

function downloadImageAsset(asset: ImageAsset) {
    const url = asset.data.dataUrl || asset.coverUrl;
    if (!url) return;
    const link = document.createElement("a");
    link.href = url;
    link.download = `${asset.title || "image"}.png`;
    link.rel = "noopener";
    document.body.append(link);
    link.click();
    link.remove();
}

export default function GenerateImagePage() {
    const { message: toast } = App.useApp();
    const navigate = useNavigate();
    const config = useEffectiveConfig();
    const updateConfig = useConfigStore((state) => state.updateConfig);
    const assets = useAssetStore((state) => state.assets);
    const addAsset = useAssetStore((state) => state.addAsset);
    const imageModels = useMemo(() => selectableModelsByCapability(config, "image"), [config]);
    const [model, setModel] = useState(config.imageModel || imageModels[0] || "");
    const imageProfile = useMemo(() => mergedImageCapabilityConfig(config, model || config.imageModel), [config, model]);
    const [prompt, setPrompt] = useState("");
    const [ratio, setRatio] = useState(imageProfile.size.default || "1:1");
    const [quality, setQuality] = useState(imageProfile.quality.default || "auto");
    const [count, setCount] = useState("1");
    const [attachments, setAttachments] = useState<CreationAttachment[]>([]);
    const snapshot = useSyncExternalStore(subscribeStandaloneImage, getStandaloneImageSnapshot, getStandaloneImageSnapshot);
    const jobs = snapshot.jobs;
    const [activeId, setActiveId] = useState("");
    const [hydrated, setHydrated] = useState(false);
    const [libraryOpen, setLibraryOpen] = useState(false);
    const fileRef = useRef<HTMLInputElement>(null);

    const activeJob = jobs.find((job) => job.id === activeId) || jobs[0];
    const live = Boolean(activeJob && snapshot.liveIds.includes(activeJob.id));
    const maxReferences = imageProfile.references.maxImages ?? 14;
    const referenceImages = attachments.flatMap((attachment) => {
        const image = attachmentToReferenceImage(attachment);
        return image ? [image] : [];
    });

    useEffect(() => {
        if (model && imageModels.includes(model)) return;
        setModel(config.imageModel && imageModels.includes(config.imageModel) ? config.imageModel : imageModels[0] || "");
    }, [config.imageModel, imageModels, model]);

    useEffect(() => setStandaloneImageErrorHandler((text) => toast.error(text)), [toast]);

    useEffect(() => {
        let cancelled = false;
        void hydrateStandaloneImage().then(() => {
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

    const applyComposerFromJob = (job: ImageGenerationJob) => {
        setPrompt(job.prompt);
        setModel(job.model);
        setRatio(job.ratio);
        setQuality(job.quality);
        setCount(String(job.count));
        setAttachments(creationAttachmentsFromReferences(job.references || []));
        setActiveId(job.id);
    };

    const startJob = async (retryJob?: ImageGenerationJob) => {
        const text = (retryJob?.prompt ?? prompt).trim();
        if (!text) {
            toast.warning("请先填写提示词");
            return;
        }
        if (!model) {
            toast.warning("请先在模型配置中添加图片模型");
            navigate("/settings?section=channels");
            return;
        }
        const limitError = canvasImageReferenceLimitError({ ...config, model, imageModel: model }, referenceImages);
        if (!retryJob && limitError) {
            toast.warning(limitError);
            return;
        }
        try {
            const id = await runStandaloneImageJob({
                retryJob,
                prompt: text,
                config,
                model: retryJob?.model ?? model,
                ratio: retryJob?.ratio ?? ratio,
                quality: retryJob?.quality ?? quality,
                count: retryJob?.count ?? Math.max(1, Math.floor(Number(count) || 1)),
                references: retryJob?.references?.length ? retryJob.references : persistableMediaReferences(attachments),
            });
            if (id) setActiveId(id);
            if (!retryJob) setPrompt("");
        } catch (error) {
            toast.error(error instanceof Error ? error.message : "生成失败");
        }
    };

    const continueRetrieve = (job: ImageGenerationJob) => {
        if (!job.taskIds.length || snapshot.liveIds.includes(job.id)) return;
        void resumeStandaloneImageJob(job).then((id) => {
            if (id) setActiveId(id);
        });
    };

    const addFiles = async (files: FileList | File[]) => {
        const expectedScope = captureUserScope();
        const images = Array.from(files).filter((file) => creationFileAccepted("image", file));
        if (!images.length) return;
        try {
            for (const file of images) {
                assertUserScope(expectedScope);
                const uploaded = await uploadImage(file, undefined, expectedScope);
                assertUserScope(expectedScope);
                addAsset(creationImageAsset({ title: file.name, uploaded, metadata: { source: "standalone-image-page" } }));
                const attachment = creationAttachmentFromImage(file, uploaded);
                setAttachments((current) => [...current, attachment].slice(0, maxReferences));
            }
        } catch (error) {
            if (userScopeMatches(expectedScope)) toast.error(error instanceof Error ? error.message : "参考图上传失败");
        }
    };

    const resultAssets = (activeJob?.assetIds || []).flatMap((id) => {
        const asset = assets.find((item) => item.id === id);
        return asset?.kind === "image" ? [asset] : [];
    });
    const showRetrieve = Boolean(activeJob && !live && (activeJob.status === "retrievable" || (activeJob.status === "failed" && activeJob.taskIds.length)));
    const showRetry = Boolean(activeJob && activeJob.status === "failed" && !shouldBlockAutomaticRetry(activeJob.error, activeJob.generationErrorCode));

    return (
        <WorkspacePage fluid scroll={false} className="siflux-image-gen-page">
            <div className="siflux-image-gen" aria-label="图片生成">
                <header className="siflux-image-gen-header">
                    <div>
                        <h1>图片生成</h1>
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
                                <ImageIcon />
                                <strong>还没有生成结果</strong>
                            </div>
                        ) : (
                            <div className="siflux-image-gen-grid">
                                {resultAssets.map((asset) => (
                                    <figure className="siflux-image-gen-card" key={asset.id}>
                                        <CachedResourceImage storageKey={asset.data.storageKey} src={resolveResourceUrl(asset.data.storageKey, asset.data.dataUrl || asset.coverUrl)} alt={asset.title || "生成图片"} />
                                        <button type="button" className="siflux-image-gen-download" onClick={() => downloadImageAsset(asset)}><Download size={14} />下载</button>
                                    </figure>
                                ))}
                                {activeJob.status === "succeeded" && activeJob.assetIds.some((id) => !assets.some((asset) => asset.id === id)) ? (
                                    <div className="siflux-image-gen-card"><div className="siflux-image-gen-card-missing">资产库中已删除</div></div>
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
                                        deleteStandaloneImageJob(job.id);
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
                            {attachments.map((attachment) => (
                                <span className="siflux-image-gen-ref" key={attachment.id}>
                                    <img src={attachment.previewUrl || ("dataUrl" in attachment ? attachment.dataUrl : attachment.url)} alt={attachment.name} />
                                    <button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => setAttachments((current) => removeCreationAttachment(current, attachment.id))}><X size={12} /></button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <textarea className="siflux-image-gen-prompt" value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述你想生成的画面" rows={3} />
                    <div className="siflux-image-gen-toolbar">
                        <input ref={fileRef} type="file" accept="image/*" hidden multiple onChange={(event) => { if (event.target.files) void addFiles(event.target.files); event.target.value = ""; }} />
                        <button type="button" className="siflux-image-gen-action" onClick={() => fileRef.current?.click()}><Upload size={14} />上传参考图</button>
                        <button type="button" className="siflux-image-gen-action" onClick={() => setLibraryOpen(true)}><Plus size={14} />资产库</button>
                        <ModelPicker
                            className="siflux-image-gen-model min-w-0"
                            config={config}
                            value={model}
                            onChange={(value) => {
                                setModel(value);
                                updateConfig("imageModel", value);
                                updateConfig("model", value);
                            }}
                            capability="image"
                            onMissingConfig={() => navigate("/settings?section=channels")}
                        />
                        <Popover
                            trigger="click"
                            placement="topLeft"
                            arrow={false}
                            classNames={{ root: "creation-control-popover", container: "creation-control-popover-surface", content: "creation-control-popover-content" }}
                            content={(
                                <div className="creation-parameter-menu siflux-image-gen-size-menu">
                                    <ImageSizePicker profile={imageProfile} size={ratio} quality={quality} onChange={(size, nextQuality) => { setRatio(size); if (nextQuality) setQuality(nextQuality); }} />
                                    {imageProfile.maxOutputs > 1 ? (
                                        <section className="siflux-image-gen-size-count">
                                            <header>
                                                <span>生成数量</span>
                                                <strong>{count} 张</strong>
                                            </header>
                                            <div className="siflux-image-gen-count" role="group" aria-label="生成张数">
                                                {["1", "2", "3", "4"].filter((value) => Number(value) <= imageProfile.maxOutputs).map((value) => (
                                                    <button key={value} type="button" className={value === count ? "is-selected" : ""} onClick={() => setCount(value)}>{value}</button>
                                                ))}
                                            </div>
                                        </section>
                                    ) : null}
                                </div>
                            )}
                        >
                            <button type="button" className="siflux-image-gen-action"><SlidersHorizontal size={14} />{ratio}{imageProfile.maxOutputs > 1 ? ` · ${count} 张` : ""}</button>
                        </Popover>
                        {live ? (
                            <button type="button" className="siflux-image-gen-action is-primary" onClick={() => activeJob && stopStandaloneImageJob(activeJob.id)}>取消等待</button>
                        ) : (
                            <button type="submit" className="siflux-image-gen-action is-primary" disabled={!prompt.trim()}>生成</button>
                        )}
                    </div>
                </form>
                {libraryOpen ? (
                    <Suspense fallback={null}>
                        <AssetLibraryPickerModal
                            open={libraryOpen}
                            mediaKinds={["image"]}
                            title="选择参考图"
                            items={assets.filter((asset): asset is ImageAsset => asset.kind === "image").map((asset) => ({
                                id: asset.id,
                                title: asset.title,
                                category: asset.category || "other",
                                kindLabel: "图片",
                                mediaKind: "image",
                                asset,
                                searchText: (asset.tags || []).join(" "),
                            }))}
                            categoryLabels={{ all: "全部素材", ...ASSET_CATEGORY_LABELS }}
                            onClose={() => setLibraryOpen(false)}
                            onConfirm={(selectedIds) => {
                                const next = selectedIds.flatMap((id) => {
                                    const asset = assets.find((item) => item.id === id);
                                    return asset?.kind === "image" ? [creationAttachmentFromAsset(asset)] : [];
                                });
                                setAttachments((current) => [...current.filter((item) => !next.some((candidate) => candidate.id === item.id)), ...next].slice(0, maxReferences));
                                setLibraryOpen(false);
                            }}
                        />
                    </Suspense>
                ) : null}
            </div>
        </WorkspacePage>
    );
}
