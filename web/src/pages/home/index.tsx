import { useMemo } from "react";
import { ArrowRight, Bot, Image as ImageIcon, LayoutGrid, Plus } from "lucide-react";
import { Link } from "react-router";

import { useCanvasStore } from "@/stores/canvas/use-canvas-store";
import { listCanvasWorkspaceProjectRoots } from "@/lib/canvas/canvas-workspace-project";

const entries = [
    {
        to: "/generate/image",
        icon: ImageIcon,
        title: "生图",
        description: "直接填写提示词出图，结果可继续在画布上组合。",
    },
    {
        to: "/agent",
        icon: Bot,
        title: "Agent 生图",
        description: "用对话描述需求，由助手改写提示词并提交生成。",
    },
    {
        to: "/canvas",
        icon: LayoutGrid,
        title: "画布",
        description: "把图片、提示词和生图配置排布成一块可复用的工作区。",
    },
];

function formatWhen(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚";
    return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit" }).format(date);
}

export default function HomePage() {
    const projects = useCanvasStore((state) => state.projects);
    const recent = useMemo(
        () =>
            listCanvasWorkspaceProjectRoots(projects)
                .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
                .slice(0, 6),
        [projects],
    );

    return (
        <div className="mx-auto w-full max-w-5xl space-y-8 px-1 pb-10 pt-6">
                <section className="grid gap-3 sm:grid-cols-3">
                    {entries.map((entry) => {
                        const Icon = entry.icon;
                        return (
                            <Link
                                key={entry.to}
                                to={entry.to}
                                className="group flex flex-col gap-3 rounded-2xl border border-border/60 bg-surface/40 p-5 transition-colors hover:border-primary/40 hover:bg-surface/70"
                            >
                                <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                                    <Icon className="size-5" strokeWidth={1.8} />
                                </span>
                                <span className="text-base font-semibold">{entry.title}</span>
                                <span className="text-sm leading-6 text-foreground/65">{entry.description}</span>
                                <span className="mt-auto flex items-center gap-1 text-sm text-primary opacity-0 transition-opacity group-hover:opacity-100">
                                    进入 <ArrowRight className="size-3.5" />
                                </span>
                            </Link>
                        );
                    })}
                </section>

                <section className="space-y-3">
                    <div className="flex items-center justify-between">
                        <h2 className="text-sm font-semibold text-foreground/80">最近画布</h2>
                        <Link to="/canvas" className="flex items-center gap-1 text-sm text-foreground/55 hover:text-primary">
                            全部画布 <ArrowRight className="size-3.5" />
                        </Link>
                    </div>
                    {recent.length ? (
                        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                            {recent.map((project) => (
                                <Link
                                    key={project.id}
                                    to={`/canvas/${project.id}`}
                                    className="flex items-center justify-between gap-3 rounded-xl border border-border/60 bg-surface/30 px-4 py-3 transition-colors hover:border-primary/40"
                                >
                                    <span className="min-w-0">
                                        <span className="block truncate text-sm font-medium">{project.title || "未命名画布"}</span>
                                        <span className="mt-0.5 block text-xs text-foreground/50">
                                            {project.nodes.length} 个节点 · {formatWhen(project.updatedAt)}
                                        </span>
                                    </span>
                                    <ArrowRight className="size-4 shrink-0 text-foreground/35" />
                                </Link>
                            ))}
                        </div>
                    ) : (
                        <Link
                            to="/canvas"
                            className="flex items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 py-10 text-sm text-foreground/55 transition-colors hover:border-primary/40 hover:text-primary"
                        >
                            <Plus className="size-4" />
                            还没有画布，新建一个开始
                        </Link>
                    )}
                </section>
        </div>
    );
}