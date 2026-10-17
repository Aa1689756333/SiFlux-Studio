import { ArrowRight, Plus, RefreshCw } from "lucide-react";
import { Link, useNavigate } from "react-router";
import type { CanvasLibrarySummary } from "@/services/api/workspace-data";
import { ProjectPreview } from "@/components/canvas/canvas-project-card";
import { IMAGE_ONLY_RELEASE } from "@/lib/release-flags";
import { beefTVCapabilityItems } from "./home-data";
function formatDate(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "刚刚更新";
    return new Intl.DateTimeFormat("zh-CN", { year: "numeric", month: "2-digit", day: "2-digit" }).format(date).replaceAll("/", "-");
}

export function HomeDashboard({ projects, loading, error, onRetry }: { projects: CanvasLibrarySummary[]; loading: boolean; error: boolean; onRetry: () => void }) {
    const navigate = useNavigate();
    return (
        <main className="siflux-home" aria-label="SiFlux Studio 首页">
            {!IMAGE_ONLY_RELEASE && <section className="siflux-home-hero" aria-label="新建画布">
                <span className="siflux-home-dot-base" aria-hidden />
                <span className="siflux-home-dot-flow" aria-hidden />
                <span className="siflux-home-dot-flow siflux-home-dot-flow-delay" aria-hidden />
                <button type="button" className="siflux-home-create" onClick={() => navigate("/canvas?mode=new")}>
                    <span className="siflux-home-create-icon"><Plus /></span>
                    <span className="siflux-home-create-title">新建画布创作</span>
                </button>
            </section>}

            <nav className="siflux-capabilities" aria-label="创作能力">
                {beefTVCapabilityItems.map(({ id, label, detail, to, icon: Icon, disabled }) => (
                    disabled ? (
                        <span key={id} className="siflux-capability is-disabled" aria-disabled="true" title={`${label}：${detail}`}>
                            <span className="siflux-capability-icon"><Icon /></span>
                            <strong>{label}</strong>
                        </span>
                    ) : (
                        <Link key={id} to={to} className="siflux-capability" title={detail}>
                            <span className="siflux-capability-icon"><Icon /></span>
                            <strong>{label}</strong>
                        </Link>
                    )
                ))}
            </nav>

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
