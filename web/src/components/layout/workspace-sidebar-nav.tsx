import { Bot, ChevronRight, House, Image as ImageIcon, ScrollText, Settings2, Sun, Moon, UserRound } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { LayoutGroup, motion, useReducedMotion } from "motion/react";
import { useEffect, useMemo, useRef, useState, type ComponentType, type CSSProperties } from "react";
import { Link, useLocation } from "react-router";

import { AppUpdateEntry } from "@/components/layout/app-update-entry";

import { Kbd } from "@/components/ui/base/kbd";
import { navigationTools, type NavigationToolSlug } from "@/constant/navigation-tools";
import { aceternityMotion } from "@/lib/aceternity-motion";
import { cn } from "@/lib/utils";
import { preloadWorkspaceRoute } from "@/lib/workspace-route-modules";
import { useThemeStore } from "@/stores/use-theme-store";
import { RelaySignupModal } from "@/pages/settings/relay-signup-modal";
import { Button } from "antd";
import { completeRelayConnection, relayChannelConnected } from "@/services/relay-connection";
import { refreshModelConfigFromServer } from "@/components/workspace/workspace-bootstrap-hydrator";
import { fetchRelayQuota } from "@/services/api/relay-auth";
import { useConfigStore } from "@/stores/use-config-store";
import { message } from "antd";
import { AnimatedThemeToggler } from "@/components/ui/animated-theme-toggler";

export type WorkspaceNavItem = {
    id: string;
    title: string;
    icon?: ComponentType<{ className?: string; strokeWidth?: number }>;
    to?: string;
    shortcut?: string;
    badge?: string | number;
    disabled?: boolean;
    action?: "search";
    children?: WorkspaceNavItem[];
};

type WorkspaceNavGroup = {
    heading?: string;
    items: WorkspaceNavItem[];
};

function toolItem(slug: NavigationToolSlug, to: string): WorkspaceNavItem {
    const tool = navigationTools.find((item) => item.slug === slug);
    return { id: slug, title: tool?.label ?? slug, icon: tool?.icon, to };
}

function buildNav(): { groups: WorkspaceNavGroup[]; footer: WorkspaceNavItem[] } {
    return {
        groups: [
            { items: [
                { id: "home", title: "主页", icon: House, to: "/" },
            ] },
            { heading: "创作", items: [
                { id: "image", title: "生图", icon: ImageIcon, to: "/generate/image" },
                { id: "agent", title: "Agent 生图", icon: Bot, to: "/agent" },
                toolItem("canvas", "/canvas"),
            ] },
            { heading: "工作区", items: [
                toolItem("assets", "/assets"),
            ] },
            { heading: "Agent 配置", items: [
                toolItem("skills", "/skills"),
                    ] },
            { items: [
                { id: "logs", title: "运行日志", icon: ScrollText, to: "/logs" },
                { id: "settings", title: "系统设置", icon: Settings2, to: "/settings" },
            ] },
        ],
        footer: [],
    };
}

function NavItem({
    item,
    activeId,
    onSelect,
    onOpenSearch,
    level = 0,
    collapsed = false,
}: {
    item: WorkspaceNavItem;
    activeId: string;
    onSelect: (id: string) => void;
    onOpenSearch: () => void;
    level?: number;
    collapsed?: boolean;
}) {
    const isActive = activeId === item.id || (item.id === "settings" && activeId.startsWith("settings:"));
    const hasChildren = Boolean(item.children?.length);
    const [isOpen, setIsOpen] = useState(false);
    const reducedMotion = useReducedMotion();

    // 激活分支自动展开（如设置分区子项），保证当前位置可见。
    useEffect(() => {
        if (isActive && hasChildren) setIsOpen(true);
    }, [isActive, hasChildren]);

    const Icon = item.icon;
    const rowStyle = collapsed ? undefined : ({ paddingLeft: `${level * 12 + 10}px` } as CSSProperties);

    const rowContent = (
        <>
            <span className="app-workspace-nav-main flex min-w-0 items-center gap-2.5">
                {Icon ? (
                    <span className="app-workspace-nav-icon" aria-hidden>
                        <Icon className="size-4 shrink-0" strokeWidth={1.8} />
                    </span>
                ) : (
                    <span className="size-1.5 shrink-0 rounded-full bg-current opacity-40" aria-hidden />
                )}
                {!collapsed ? <span className="app-workspace-nav-title truncate">{item.title}</span> : null}
            </span>
            <span className="app-workspace-nav-meta flex shrink-0 items-center gap-2">
                {item.disabled && !collapsed ? <span className="text-[var(--fs-micro)] font-normal text-foreground/35">正在开发</span> : null}
                {item.shortcut ? (
                    <Kbd className="hidden group-hover:inline-flex">{item.shortcut}</Kbd>
                ) : null}
                {item.badge !== undefined ? <span className="flex min-w-5 items-center justify-center rounded-full bg-primary/10 px-1.5 py-0.5 text-[var(--fs-tiny)] font-medium tabular-nums text-primary">{item.badge}</span> : null}
                {hasChildren ? <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/40 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} /> : null}
            </span>
        </>
    );

    const rowClassName = cn(
        "app-workspace-nav-link group relative isolate flex min-h-11 w-full items-center justify-between gap-2 rounded-[var(--r-md)] px-3 py-2 text-[var(--fs-body)] transition-[color,transform] duration-200 select-none",
        collapsed && "is-collapsed",
        item.disabled ? "is-disabled text-foreground/30" : isActive ? "is-active font-medium" : "text-foreground/62 hover:bg-surface-hover hover:text-foreground",
    );
    const activePill = isActive ? (
        <motion.span
            layoutId="workspace-nav-active-pill"
            className="app-workspace-nav-active-pill"
            aria-hidden
            transition={reducedMotion ? { duration: 0 } : aceternityMotion.spring.dock}
        />
    ) : null;

    const handleClick = () => {
        if (item.action === "search") {
            onOpenSearch();
            return;
        }
        if (hasChildren) {
            setIsOpen((open) => !open);
            return;
        }
        onSelect(item.id);
    };

    // 局部 const：闭包内 TS 保留窄化，供 preload 回调使用。
    const linkTo = item.to;
    const disabledLabel = item.disabled ? `${item.title}：正在开发` : undefined;

    return (
        <div className="flex w-full flex-col">
            {linkTo && !item.disabled ? (
                <Link
                    to={linkTo}
                    className={rowClassName}
                    data-nav-id={item.id}
                    style={rowStyle}
                    aria-label={collapsed ? item.title : undefined}
                    title={collapsed ? item.title : undefined}
                    onClick={handleClick}
                    onFocus={() => preloadWorkspaceRoute(linkTo)}
                    onPointerDown={() => preloadWorkspaceRoute(linkTo)}
                    onPointerEnter={() => preloadWorkspaceRoute(linkTo)}
                >
                    {activePill}
                    {rowContent}
                </Link>
            ) : item.disabled ? (
                <span className={rowClassName} data-nav-id={item.id} style={rowStyle} aria-disabled="true" title={disabledLabel}>
                    {rowContent}
                </span>
            ) : (
                <button type="button" className={rowClassName} data-nav-id={item.id} style={rowStyle} aria-label={collapsed ? item.title : undefined} title={collapsed ? item.title : undefined} onClick={handleClick} aria-expanded={hasChildren ? isOpen : undefined}>
                    {activePill}
                    {rowContent}
                </button>
            )}

            {hasChildren && !collapsed ? (
                <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                    <div className="relative flex min-h-0 flex-col gap-0.5 overflow-hidden pt-0.5">
                        <span className="app-workspace-nav-guide-line" style={{ left: `${(level + 1) * 12 + 12.5}px` }} />
                        {item.children!.map((child) => (
                            <NavItem key={child.id} item={child} activeId={activeId} onSelect={onSelect} onOpenSearch={onOpenSearch} level={level + 1} collapsed={false} />
                        ))}
                    </div>
                </div>
            ) : null}
        </div>
    );
}

function NavGroup({ group, activeId, onNavigate, onOpenSearch, collapsed }: { group: WorkspaceNavGroup; activeId: string; onNavigate: () => void; onOpenSearch: () => void; collapsed: boolean }) {
    const [isOpen, setIsOpen] = useState(true);
    const hasActive = group.items.some((item) => item.id === activeId || (item.id === "settings" && activeId.startsWith("settings:")));

    // 激活项所在分组自动展开，保证当前位置可见。
    useEffect(() => {
        if (hasActive) setIsOpen(true);
    }, [hasActive]);

    const content = (
        <div className="flex flex-col gap-2">
            {group.items.map((item) => (
                <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} collapsed={collapsed} />
            ))}
        </div>
    );

    // 无标题分组（核心导航入口）常驻展示，不做折叠。
    if (!group.heading || collapsed) {
        return <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading || ""}>{content}</div>;
    }

    return (
        <div className="app-workspace-nav-group flex shrink-0 flex-col" data-nav-group-heading={group.heading}>
            <button type="button" onClick={() => setIsOpen((open) => !open)} aria-expanded={isOpen} className="app-workspace-nav-group-toggle select-none">
                <span className="app-workspace-nav-group-label">{group.heading}</span>
                <ChevronRight className={cn("size-3.5 shrink-0 text-foreground/35 transition-transform duration-200", isOpen && "rotate-90")} strokeWidth={2} />
            </button>
            <div className={cn("grid transition-[grid-template-rows,opacity] duration-300 ease-in-out", isOpen ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0")}>
                <div className="min-h-0 overflow-hidden pt-0.5">{content}</div>
            </div>
        </div>
    );
}

/**
 * 侧栏底部的账号入口：未接入时是注册/登录按钮，接入后直接展示余额。
 */
function RelayAccountEntry({ connected, collapsed, onOpen }: { connected: boolean; collapsed: boolean; onOpen: () => void }) {
    const quota = useQuery({
        queryKey: ["relay-quota", connected],
        queryFn: () => fetchRelayQuota(),
        enabled: connected,
        staleTime: 60_000,
        retry: false,
    });
    if (!connected) {
        return (
            <Button
                type="primary"
                block
                className="h-9"
                icon={collapsed ? <UserRound className="size-4" /> : undefined}
                onClick={onOpen}
                aria-label="注册或登录 SiFlux 服务"
            >
                {collapsed ? null : "注册 / 登录"}
            </Button>
        );
    }
    const known = Boolean(quota.data && quota.data.granted > 0);
    const amount = known && quota.data ? `$${quota.data.remaining.toFixed(2)}` : quota.isLoading ? "…" : "余额未知";
    const stale = Boolean(quota.data?.stale);
    return (
        <button
            type="button"
            onClick={onOpen}
            className="flex w-full items-center justify-between gap-2 rounded-[var(--r-md)] border border-border/60 bg-surface/40 px-3 py-2 text-left transition-colors hover:border-primary/40 hover:bg-surface/70"
            title="查看账户与余额"
        >
            {collapsed ? (
                <UserRound className="mx-auto size-4 text-foreground/70" />
            ) : (
                <>
                    <span className="flex min-w-0 flex-col">
                        <span className="flex items-center gap-1.5 text-[var(--fs-micro)] text-foreground/50"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />已连接 · 余额</span>
                        <span className="truncate text-sm font-semibold">{amount}</span>
                        {stale ? <span className="text-[var(--fs-micro)] text-foreground/40">未同步</span> : null}
                    </span>
                    <ChevronRight className="size-3.5 shrink-0 text-foreground/40" />
                </>
            )}
        </button>
    );
}

export function WorkspaceSidebarNav({ onNavigate, onOpenSearch }: { onNavigate: () => void; onOpenSearch: () => void }) {
    const theme = useThemeStore((state) => state.theme);
    const setTheme = useThemeStore((state) => state.setTheme);
    const { pathname } = useLocation();
    const collapsed = false;
    const relayConnected = useConfigStore((state) => relayChannelConnected(state.config.channels));
    const [relayOpen, setRelayOpen] = useState(false);
    const { groups, footer } = useMemo(buildNav, []);
    const openRelay = () => setRelayOpen(true);

    const rawSlug = pathname === "/" ? "home" : pathname.split("/").filter(Boolean)[0] || "image";
    const activeId = pathname.startsWith("/generate/image") ? "image" : rawSlug === "project" || rawSlug === "projects" ? "canvas" : rawSlug;

    const scrollRef = useRef<HTMLDivElement>(null);
    const [scrollState, setScrollState] = useState({ hasTopFade: false, hasBottomFade: false });
    const handleScroll = () => {
        const element = scrollRef.current;
        if (!element) return;
        const { scrollTop, scrollHeight, clientHeight } = element;
        setScrollState({
            hasTopFade: scrollTop > 0,
            hasBottomFade: scrollTop + clientHeight < scrollHeight - 1,
        });
    };
    useEffect(() => {
        handleScroll();
    }, [groups]);

    return (
        <div className={cn("app-workspace-sidebar-nav flex h-full min-w-0 w-full flex-col", collapsed && "is-collapsed")}>
            <LayoutGroup id="workspace-sidebar-nav">
            <div
                ref={scrollRef}
                onScroll={handleScroll}
                className={cn("app-workspace-sidebar-scroll-area flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-3 pb-3 pt-7", collapsed && "is-collapsed", scrollState.hasTopFade && "has-top-fade", scrollState.hasBottomFade && "has-bottom-fade")}
            >
                {groups.map((group, index) => (
                    <NavGroup key={index} group={group} activeId={activeId} onNavigate={onNavigate} onOpenSearch={onOpenSearch} collapsed={collapsed} />
                ))}
            </div>
            </LayoutGroup>

            <div className="app-workspace-sidebar-footer shrink-0 px-3 py-3">
                {footer.length ? (
                    <div className="flex flex-col gap-0.5">
                        {footer.map((item) => (
                            <NavItem key={item.id} item={item} activeId={activeId} onSelect={onNavigate} onOpenSearch={onOpenSearch} collapsed={collapsed} />
                        ))}
                    </div>
                ) : null}
                <div className={cn("app-workspace-sidebar-contact-row mb-1.5", collapsed && "is-collapsed")}>
                    <RelayAccountEntry connected={relayConnected} collapsed={collapsed} onOpen={openRelay} />
                </div>
                <div className={cn("app-workspace-sidebar-utility-row flex items-center justify-between gap-2", collapsed && "justify-center", "is-collapsed")}>
                    <AppUpdateEntry collapsed={collapsed} />
                    <AnimatedThemeToggler theme={theme} onThemeChange={setTheme} aria-label={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} title={theme === "dark" ? "切换到浅色模式" : "切换到深色模式"} className="grid size-8 shrink-0 place-items-center rounded-[var(--r-md)] text-foreground/55 transition-colors hover:bg-surface-hover hover:text-foreground">
                        {theme === "dark" ? <Sun className="size-4" /> : <Moon className="size-4" />}
                    </AnimatedThemeToggler>
                </div>
            </div>
            <RelaySignupModal
                open={relayOpen}
                onClose={() => setRelayOpen(false)}
                connected={relayConnected}
                onConnected={(result) => {
                    void completeRelayConnection(result.channelId).catch((error: unknown) => {
                        message.warning(error instanceof Error ? error.message : "已接入账号，但刷新模型列表失败，请到设置里点「拉取模型」");
                    });
                }}
            />
        </div>
    );
}
