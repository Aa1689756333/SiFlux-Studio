import { App, Button, Dropdown, Input } from "antd";
import { MoreHorizontal, Plus, Search, Sparkles } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { PageHeader, WorkspacePage } from "@/components/layout/workspace-page";
import { WorkspaceErrorState, WorkspaceState } from "@/components/layout/workspace-state";
import { formatSkillCount, formatSkillDate, groupSkills } from "@/pages/skills/skill-catalog";
import { SkillDetailModal } from "@/pages/skills/skill-detail-drawer";
import { SkillEditorDrawer } from "@/pages/skills/skill-editor-drawer";
import { SkillInstallModal } from "@/pages/skills/skill-install-modal";
import { deleteSkill, getSkill, listAddedSkills, removeSkill, type Skill } from "@/services/api/skills";

export default function LocalSkillsPage() {
    const { message, modal } = App.useApp();
    const [skills, setSkills] = useState<Skill[]>([]);
    const [loading, setLoading] = useState(true);
    const [loadError, setLoadError] = useState("");
    const [search, setSearch] = useState("");
    const [reloadKey, setReloadKey] = useState(0);
    const [activeSkill, setActiveSkill] = useState<Skill | null>(null);
    const [detailLoading, setDetailLoading] = useState(false);
    const [mutatingID, setMutatingID] = useState("");
    const [editorOpen, setEditorOpen] = useState(false);
    const [installOpen, setInstallOpen] = useState(false);
    const [editingSkill, setEditingSkill] = useState<Skill | null>(null);

    const reload = useCallback(() => setReloadKey((value) => value + 1), []);

    useEffect(() => {
        let cancelled = false;
        setLoading(true);
        setLoadError("");
        listAddedSkills()
            .then((result) => {
                if (cancelled) return;
                setSkills(result.skills.filter((skill) => skill.isAdded));
            })
            .catch((error) => {
                if (cancelled) return;
                setSkills([]);
                setLoadError(error instanceof Error ? error.message : "技能加载失败");
            })
            .finally(() => {
                if (!cancelled) setLoading(false);
            });
        return () => {
            cancelled = true;
        };
    }, [reloadKey]);

    const visible = useMemo(() => {
        const needle = search.trim().toLowerCase();
        if (!needle) return skills;
        return skills.filter((skill) => `${skill.skillName} ${skill.description}`.toLowerCase().includes(needle));
    }, [search, skills]);

    const openSkill = async (skill: Skill) => {
        setActiveSkill(skill);
        setDetailLoading(true);
        try {
            const result = await getSkill(skill.skillId);
            setActiveSkill(result.skill);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能详情加载失败");
            setActiveSkill(null);
        } finally {
            setDetailLoading(false);
        }
    };

    const openEditor = async (skill?: Skill) => {
        if (!skill) {
            setEditingSkill(null);
            setEditorOpen(true);
            return;
        }
        try {
            const result = skill.instruction ? { skill } : await getSkill(skill.skillId);
            setActiveSkill(null);
            setEditingSkill(result.skill);
            setEditorOpen(true);
        } catch (error) {
            message.error(error instanceof Error ? error.message : "技能读取失败");
        }
    };

    const uninstall = async (skill: Skill) => {
        setMutatingID(skill.skillId);
        try {
            await removeSkill(skill.skillId);
            setActiveSkill((current) => current?.skillId === skill.skillId ? null : current);
            setSkills((items) => items.filter((item) => item.skillId !== skill.skillId));
            message.success("已从本地技能库移出");
        } catch (error) {
            message.error(error instanceof Error ? error.message : "移出失败");
        } finally {
            setMutatingID("");
        }
    };

    const confirmUninstall = (skill: Skill) => {
        modal.confirm({
            title: `移出“${skill.skillName}”？`,
            content: "只从本地技能库移除，Agent 之后不能再选用它。对话记录不会删除。",
            okText: "移出",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: () => uninstall(skill),
        });
    };

    const confirmDelete = (skill: Skill) => {
        modal.confirm({
            title: `删除“${skill.skillName}”？`,
            content: "删除后无法恢复。",
            okText: "删除技能",
            okButtonProps: { danger: true },
            cancelText: "取消",
            onOk: async () => {
                try {
                    await deleteSkill(skill.skillId);
                    setActiveSkill(null);
                    message.success("技能已删除");
                    reload();
                } catch (error) {
                    message.error(error instanceof Error ? error.message : "技能删除失败");
                    throw error;
                }
            },
        });
    };

    return (
        <>
            <WorkspacePage className="library-page skills-library-page" grid>
                <PageHeader
                    title="技能"
                    description="本地安装和管理技能，供 Agent 选用。不经过技能广场。"
                    actions={(
                        <div className="flex flex-wrap gap-2">
                            <Button onClick={() => void openEditor()}>新建技能</Button>
                            <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>
                        </div>
                    )}
                />
                <Input
                    className="max-w-sm"
                    prefix={<Search className="size-4 text-foreground/38" />}
                    value={search}
                    allowClear
                    placeholder="搜索本地技能"
                    onChange={(event) => setSearch(event.target.value)}
                />
                {loading && !skills.length ? (
                    <div className="library-grid skill-library-grid py-6">{Array.from({ length: 6 }, (_, index) => <div key={index} className="h-[220px] animate-pulse rounded-[var(--r-xl)] bg-foreground/[.035]" />)}</div>
                ) : loadError ? (
                    <WorkspaceErrorState compact description={loadError} onRetry={reload} />
                ) : visible.length ? (
                    <div className="library-grid skill-library-grid">
                        {visible.map((skill) => (
                            <article key={skill.skillId} className="product-collection-card library-card library-card-surface skill-library-card group is-added">
                                <div className="skill-card-top">
                                    <span className="library-icon-tile skill-card-icon" aria-hidden="true"><Sparkles /></span>
                                    <button type="button" className="skill-card-title-button" onClick={() => void openSkill(skill)}>
                                        <h3>{skill.skillName}</h3>
                                    </button>
                                    <Dropdown
                                        trigger={["click"]}
                                        menu={{
                                            items: [
                                                ...(skill.isOwner ? [{ key: "edit", label: "编辑技能" }] : []),
                                                { key: "remove", label: "移出技能库", danger: true },
                                                ...(skill.isOwner ? [{ key: "delete", label: "删除技能", danger: true }] : []),
                                            ],
                                            onClick: ({ key }) => {
                                                if (key === "edit") void openEditor(skill);
                                                else if (key === "delete") confirmDelete(skill);
                                                else confirmUninstall(skill);
                                            },
                                        }}
                                    >
                                        <button type="button" aria-label="技能操作" className="skill-card-more">
                                            <MoreHorizontal className="size-4" />
                                        </button>
                                    </Dropdown>
                                </div>
                                <button type="button" className="skill-card-description" onClick={() => void openSkill(skill)}>
                                    <p>{skill.description || "暂无技能简介"}</p>
                                </button>
                                <div className="skill-card-footer">
                                    {skill.version ? <span className="skill-card-flag">v{skill.version}</span> : null}
                                    {skill.isOwner ? <span className="skill-card-owner-flag">我创建的</span> : null}
                                </div>
                                <div className="skill-card-action">
                                    <Button onClick={() => void openSkill(skill)}>查看</Button>
                                    <Button loading={mutatingID === skill.skillId} onClick={() => confirmUninstall(skill)}>移出</Button>
                                </div>
                            </article>
                        ))}
                    </div>
                ) : (
                    <WorkspaceState
                        compact
                        className="min-h-[188px]"
                        icon="skills"
                        title={search.trim() ? "没有找到匹配技能" : "还没有本地技能"}
                        description={search.trim() ? "换个关键词试试。" : "安装 Markdown 或 ZIP 技能包后，Agent 就可以选用。"}
                        action={search.trim() ? <Button onClick={() => setSearch("")}>清除搜索</Button> : <Button type="primary" icon={<Plus className="size-4" />} onClick={() => setInstallOpen(true)}>安装技能</Button>}
                    />
                )}
            </WorkspacePage>
            <SkillDetailModal
                skill={activeSkill}
                loading={detailLoading}
                mutating={Boolean(activeSkill && mutatingID === activeSkill.skillId)}
                onClose={() => setActiveSkill(null)}
                onAdd={(skill) => void uninstall(skill)}
                onLike={() => undefined}
                onEdit={(skill) => void openEditor(skill)}
                onSync={() => undefined}
            />
            <SkillInstallModal
                open={installOpen}
                onClose={() => setInstallOpen(false)}
                onInstalled={() => {
                    setInstallOpen(false);
                    reload();
                }}
                onManualCreate={() => {
                    setInstallOpen(false);
                    void openEditor();
                }}
            />
            <SkillEditorDrawer
                open={editorOpen}
                skill={editingSkill}
                onClose={() => setEditorOpen(false)}
                onSaved={() => {
                    setEditorOpen(false);
                    setEditingSkill(null);
                    reload();
                }}
            />
        </>
    );
}
