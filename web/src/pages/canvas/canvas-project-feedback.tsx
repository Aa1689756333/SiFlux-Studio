import { motion } from "motion/react";
import { CheckCircle2, CloudUpload, TriangleAlert } from "lucide-react";

import type { GenerationTask } from "@/services/api/task-center";
import { canvasThemes } from "@/lib/canvas-theme";
import { aceternityMotion } from "@/lib/aceternity-motion";

export type CanvasUploadStatus = {
    id: number;
    title: string;
    detail: string;
    step: number;
    total: number;
    done?: boolean;
    error?: boolean;
};

type CanvasTheme = (typeof canvasThemes)[keyof typeof canvasThemes];

export function CanvasUploadStatusToast({ status, theme }: { status: CanvasUploadStatus; theme: CanvasTheme }) {
    const accent = status.error ? theme.accent.danger : status.done ? "#22c55e" : theme.node.activeStroke;
    return (
        <motion.div
            data-canvas-no-zoom
            aria-live="polite"
            initial={{ opacity: 0, x: 22, scale: 0.94 }}
            animate={{ opacity: 1, x: 0, scale: 1 }}
            transition={aceternityMotion.spring.panel}
            className="pointer-events-none absolute right-4 top-20 z-[var(--z-panel-floating)] w-[var(--panel-width-compact)] overflow-hidden rounded-[var(--panel-radius-wide-tight)] border px-4 py-4 backdrop-blur-2xl"
            style={{
                background: theme.spatial.elevated,
                borderColor: status.error ? `${theme.accent.danger}66` : status.done ? "rgba(34,197,94,.4)" : theme.spatial.glowStrong,
                color: theme.node.text,
                boxShadow: `0 24px 72px ${theme.spatial.shadow}, inset 0 1px 0 rgba(255,255,255,.14)`,
            }}
        >
            <div className="absolute inset-x-0 top-0 h-px" style={{ background: `linear-gradient(90deg, transparent, ${accent}, transparent)` }} />
            <div className="flex items-start gap-3">
                <motion.span
                    animate={status.done || status.error ? { scale: [0.8, 1.08, 1] } : { y: [0, -2, 0] }}
                    transition={status.done || status.error ? { duration: aceternityMotion.duration.panel } : { duration: 1.5, repeat: Number.POSITIVE_INFINITY }}
                    className="mt-0.5 grid size-9 shrink-0 place-items-center rounded-[var(--dock-radius)] border"
                    style={{ background: theme.spatial.surface, borderColor: `${accent}44`, color: accent }}
                >
                    {status.error ? <TriangleAlert className="size-4" /> : status.done ? <CheckCircle2 className="size-4" /> : <CloudUpload className="size-4" />}
                </motion.span>
                <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold">{status.title}</span>
                    <span className="mt-1 block truncate text-[var(--fs-label)]" style={{ color: theme.node.muted }}>
                        {status.detail}
                    </span>
                </span>
                <span className="shrink-0 rounded-full border px-2 py-1 text-[var(--fs-tiny)] font-semibold tabular-nums" style={{ background: theme.spatial.surface, borderColor: theme.toolbar.border, color: theme.node.muted }}>
                    {status.step}/{status.total}
                </span>
            </div>
            <div className="mt-4 flex items-center gap-1.5">
                {Array.from({ length: status.total }, (_, index) => (
                    <motion.span
                        key={index}
                        animate={{ opacity: index < status.step ? 1 : 0.24, scaleX: index < status.step ? 1 : 0.88 }}
                        className="h-1.5 min-w-0 flex-1 rounded-full"
                        style={{ background: index < status.step ? accent : theme.toolbar.itemHover, transformOrigin: "left" }}
                    />
                ))}
            </div>
            <span className="sr-only">处理步骤 {status.step}/{status.total}</span>
        </motion.div>
    );
}

export function TaskDetailItem({ label, value }: { label: string; value: string }) {
    return (
        <div className="min-w-0">
            <div className="text-[var(--fs-tiny)] opacity-50">{label}</div>
            <div className="mt-1 truncate text-xs font-medium" title={value}>
                {value}
            </div>
        </div>
    );
}

export function taskStatusText(status: GenerationTask["status"]) {
    if (status === "queued") return "排队中";
    if (status === "running") return "生成中";
    if (status === "succeeded") return "任务完成";
    if (status === "failed") return "任务失败";
    return "任务已取消";
}
