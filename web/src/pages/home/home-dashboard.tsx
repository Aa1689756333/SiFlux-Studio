import { ArrowRight, AudioLines, HardDrive, Image as ImageIcon, Plus, RefreshCw, Video } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { CanvasLibrarySummary } from "@/services/api/workspace-data";
import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { IMAGE_ONLY_RELEASE } from "@/lib/release-flags";

export type HomeUsageOverview = {
    imageOutputs: number;
    videoOutputs: number;
    audioOutputs: number;
    storageUsed: string;
    storageHint: string;
    loading: boolean;
};

function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚更新";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("/", "-");
}

function OverviewCard({ to, icon: Icon, label, value, hint }: { to: string; icon: typeof ImageIcon; label: string; value: string; hint: string }) {
    return (
        <Link to={to} className="siflux-home-stat">
            <span className="siflux-home-stat-icon"><Icon /></span>
            <span className="siflux-home-stat-copy">
                <small>{label}</small>
                <strong>{value}</strong>
                <em>{hint}</em>
            </span>
        </Link>
    );
}

export function HomeDashboard({
    projects, loading, error, onRetry, usage,
}: {
    projects: CanvasLibrarySummary[];
    loading: boolean;
    error: boolean;
    onRetry: () => void;
    usage: HomeUsageOverview;
}) {
    const navigate = useNavigate();
    const pending = usage.loading ? "…" : undefined;
    return (
        <main className="siflux-home" aria-label="SiFlux Studio 首页">
            <section className="siflux-home-section siflux-usage-overview">
                <header className="siflux-section-heading"><h2>用量概览</h2><Link to="/usage">查看全部 <ArrowRight /></Link></header>
                <div className="siflux-home-stats">
                    <OverviewCard to="/usage" icon={ImageIcon} label="图片产出" value={pending ?? String(usage.imageOutputs)} hint="近 7 天 · 张" />
                    {!IMAGE_ONLY_RELEASE ? <OverviewCard to="/usage" icon={Video} label="视频产出" value={pending ?? String(usage.videoOutputs)} hint="近 7 天 · 条" /> : null}
                    {!IMAGE_ONLY_RELEASE ? <OverviewCard to="/usage" icon={AudioLines} label="音频产出" value={pending ?? String(usage.audioOutputs)} hint="近 7 天 · 条" /> : null}
                    <OverviewCard to="/usage" icon={HardDrive} label="存储占用" value={pending && !usage.storageUsed ? "…" : usage.storageUsed} hint={usage.storageHint} />
                </div>
            </section>
            <section className="siflux-home-section siflux-recents">
                <header className="siflux-section-heading"><h2>最近项目</h2><Link to="/project">查看全部 <ArrowRight /></Link></header>
                {error ? (
                    <button className="siflux-home-error" type="button" onClick={onRetry}><RefreshCw />画布读取失败，点击重试</button>
                ) : (
                    <div className="siflux-recent-grid">
                        {loading ? Array.from({ length: 4 }, (_, index) => <div className="siflux-recent-card is-loading" key={index} />) : projects.length ? projects.map((project) => {
                            return <Link to={`/canvas/${project.id}`} className="siflux-recent-card" key={project.id}>
                                <span className="siflux-recent-preview"><ProjectPreview project={{ id: project.id, nodes: project.previewNodes }} emptyVariant="libtv" /></span>
                                <span className="siflux-recent-copy"><strong>{project.title || "未命名"}</strong><small>{formatDate(project.updatedAt)}</small></span>
                                <ArrowRight className="siflux-recent-arrow" />
                            </Link>;
                        }) : <button type="button" className="siflux-recent-card is-empty" onClick={() => navigate("/canvas?mode=new")}><span className="siflux-recent-preview"><Plus /></span><span className="siflux-recent-copy"><strong>创建第一个画布</strong><small>让灵感有一个开始的地方</small></span></button>}
                    </div>
                )}
            </section>
        </main>
    );
}
