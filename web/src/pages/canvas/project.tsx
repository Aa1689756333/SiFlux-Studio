
import { localAssetToInsertPayload } from "@/components/canvas/asset-picker-modal";
import { isCanvasNodeGenerating } from "@/lib/canvas/canvas-node-task-state";
import { CanvasAssistantSidebar } from "./canvas-assistant-sidebar";
import { highlightAssistantNodes } from "./canvas-assistant-highlight";
import { resolveCanvasRightPanel, useCanvasAssistant, useCanvasAssistantDockable } from "./use-canvas-assistant";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import type { Dispatch, SetStateAction } from "react";
import { Link, useNavigate, useParams, useSearchParams } from "react-router";
import { appHref } from "@/lib/app-routing";
import { isLocalWorkspaceMode } from "@/services/workspace-mode";
import { queryGenerationTask } from "@/services/api/task-center";
import { useConfigStore, useEffectiveConfig } from "@/stores/use-config-store";

import { getActiveUserScope, scopedLocalStorage } from "@/lib/user-scope";
import { assertUserScope, captureUserScope, type CapturedUserScope } from "@/lib/user-scope-guard";

import { resourceFileUrl, resourceIdFromStorageKey } from "@/services/api/resources";

import { isCanvasImageSourceNode } from "@/lib/canvas/canvas-image-source";
import { canOpenCanvasNodePromptPanel, isCanvasMediaResultNode } from "@/lib/canvas/canvas-node-semantics";
import copyToClipboard from "copy-to-clipboard";
import { nanoid } from "nanoid";
import { canvasAppearanceBaseTheme, canvasAppearanceForTheme, DEFAULT_CANVAS_BACKGROUND_MODE, normalizeCanvasAppearance, resolveCanvasAppearance, writeCanvasAppearanceDefault, type CanvasAppearance } from "@/lib/canvas/canvas-appearance";
import { canvasThemes, type CanvasBackgroundMode } from "@/lib/canvas-theme";
import { persistCanvasMediaPerformanceMode, readCanvasMediaPerformanceMode } from "@/lib/canvas/canvas-performance-mode";

import { useAssetStore } from "@/stores/use-asset-store";
import { usePersonalAssetLibrary } from "@/hooks/use-personal-asset-library";
import { flushCanvasStorePersistence, useCanvasStore } from "@/stores/canvas/use-canvas-store";

import { useCanvasThemeStore, useCanvasThemeScope } from "@/stores/canvas/use-canvas-theme-store";
import { useUserStore } from "@/stores/use-user-store";
import { App, Button } from "antd";
import { ArrowLeftRight } from "lucide-react";

import { CanvasDeleteConfirmation } from "@/components/canvas/canvas-delete-confirmation";
import { CanvasConfigComposer } from "@/components/canvas/canvas-config-composer";
import { CanvasConfigNodePanel } from "@/components/canvas/canvas-config-node-panel";
import { CanvasActiveTaskPanel } from "@/components/canvas/canvas-active-task-panel";
import { CanvasAssetTray } from "@/components/canvas/canvas-asset-tray";

import { CanvasNodeToolbar } from "@/components/canvas/canvas-node-toolbar";

import { CanvasFileDropOverlay } from "@/components/canvas/canvas-file-drop-overlay";
import { InfiniteCanvas } from "@/components/canvas/infinite-canvas";
import { Minimap } from "@/components/canvas/canvas-mini-map";
import { CanvasNodePromptPanel } from "@/components/canvas/canvas-node-prompt-panel";
import { CanvasToolbar } from "@/components/canvas/canvas-toolbar";
import { useCanvasCreateCommands } from "@/components/canvas/use-canvas-create-commands";
import { CanvasZoomControls } from "@/components/canvas/canvas-zoom-controls";

import { CanvasCreateMenu } from "@/components/canvas/canvas-create-menu";
import { useFocusMode } from "@/hooks/use-focus-mode";
import { connectCanvasTextMention } from "@/lib/canvas/canvas-text-mention";
import { writeCanvasNodePrompt } from "@/lib/canvas/canvas-node-prompt";
import { applyCanvasConnectionPromptSync, buildCanvasAgentMentionReferences, buildCanvasNodeMentionReferenceMap, buildCanvasResourceReferences, getContextResourceNodes, reorderCanvasResourceConnections, replaceCanvasReferenceMentions, type CanvasResourceReference } from "@/lib/canvas/canvas-resource-references";
import { CanvasConnectionCreateMenu, CanvasNodePanelOverlay } from "@/components/canvas/canvas-workspace-overlays";
import { AppModal } from "@/components/ui/product/app-modal";
import { CanvasNodeAnglePanel } from "@/components/canvas/canvas-node-angle-dialog";
import { CanvasNodeLightingPanel } from "@/components/canvas/canvas-node-lighting-dialog";
import { CanvasOverlayLayerContainer, CanvasOverlayLayerProvider } from "@/components/canvas/canvas-overlay-layer";
import { CanvasLeaferGraphicsLayer } from "@/components/canvas/canvas-leafer-graphics-layer";

import { getInputSummary } from "@/lib/canvas/canvas-project-domain";

import { canvasWorkspaceProjectId, listCanvasWorkspaceProjectCanvases } from "@/lib/canvas/canvas-workspace-project";
import { deleteWorkspaceCanvasProjects } from "@/services/workspace-project-repository";

import { stampCanvasNodeChanges } from "@/lib/canvas/canvas-node-timestamps";
import { batchSourceRestriction } from "@/lib/canvas/canvas-batch-connection";

import { CanvasSyncStatus } from "./canvas-sync-status";
import { CanvasVersionHistory, useCanvasVersionHistory } from "./canvas-version-history";
import { CanvasVersionPreview } from "./canvas-version-preview";
import { CanvasTopBar } from "./canvas-project-top-bar";
import { CanvasFocusModeBar } from "@/components/canvas/canvas-focus-mode-bar";
import { CanvasProjectContextMenu } from "./canvas-project-context-menu";
import { CanvasProjectEditorDialogs } from "./canvas-project-editor-dialogs";
import { CanvasProjectSelectionToolbar } from "./canvas-project-selection-toolbar";
import { CanvasProjectWorldLayers } from "./canvas-project-world-layers";
import { CanvasNodeActionContext, type CanvasNodeActionContextValue } from "@/components/canvas/canvas-node-action-context";
import { bringCanvasNodeToFront, type CanvasNodeStackOrder } from "@/lib/canvas/canvas-node-stack-order";
import { CanvasNodeGraphContext, type CanvasNodeGraphContextValue } from "@/components/canvas/canvas-node-graph-context";
import { CanvasRefreshShell } from "./canvas-refresh-shell";

import { refreshLocalCanvasProjectIfChanged } from "@/services/local-workspace-repository";
import { CanvasUploadModal } from "@/components/canvas/canvas-upload-modal";
import { syncLocalCanvasSnapshot } from "@/services/local-workspace-sync";
import { useCanvasConnectionController } from "./use-canvas-connection-controller";
import { useCanvasActiveTasks } from "./use-canvas-active-tasks";

import { useCanvasHistory } from "./use-canvas-history";
import { useCanvasKeyboard } from "./use-canvas-keyboard";
import { useCanvasMediaTools } from "./use-canvas-media-tools";
import { useCanvasNodeEditor } from "./use-canvas-node-editor";
import { useCanvasNodeOperations } from "./use-canvas-node-operations";
import { useCanvasProjectLifecycle } from "./use-canvas-project-lifecycle";
import { useCanvasRenderModel } from "./use-canvas-render-model";
import { useCanvasSelectionController } from "./use-canvas-selection-controller";

import { useCanvasUpload } from "./use-canvas-upload";

import { useCanvasViewportController } from "./use-canvas-viewport-controller";
import { copyImageToSystemClipboard } from "./canvas-project-clipboard";
import { canvasNodeRetryPlan } from "./canvas-generation-orchestration";

import { useCanvasAssistantProposal } from "./use-canvas-assistant-proposal";
import { useCanvasConnectedNodeVisibility } from "./use-canvas-connected-node-visibility";
import { useCanvasGenerationOrchestration } from "./use-canvas-generation-orchestration";
import { useCanvasMentionNormalize } from "./use-canvas-mention-normalize";
import { useCanvasNodeContent } from "./use-canvas-node-content";
import { useCanvasPointerSelectionChrome, useCanvasNodeToolbarHover } from "./use-canvas-pointer-chrome";
import { useCanvasProjectDialogs } from "./use-canvas-project-dialogs";

import { CanvasNodeType, type CanvasAssistantSession, type CanvasConnection, type CanvasNodeData, type CanvasMediaPerformanceMode, type CanvasToolMode, type CanvasWorkspaceMode, type ContextMenuState, type Position, type ViewportTransform } from "@/types/canvas";

const EMPTY_RESOURCE_REFERENCES: CanvasResourceReference[] = [];

function isCanvasTextEditingTarget(target: EventTarget | null) {
    return target instanceof Element && Boolean(target.closest("input, textarea, select, [contenteditable]:not([contenteditable='false'])"));
}

export default function CanvasPage() {
    useCanvasThemeScope();
    const [mounted, setMounted] = useState(false);

    useEffect(() => {
        setMounted(true);
    }, []);

    if (!mounted) return <CanvasRefreshShell />;

    return <InfiniteCanvasPage />;
}

function InfiniteCanvasPage() {
    // 命令式确认必须走 App.useApp().modal；静态 Modal.confirm 拿不到主题和 App 上下文。
    const { message, modal } = App.useApp();
    const params = useParams<{ id: string }>();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const projectId = params.id || "";
    const readOnly = searchParams.get("readonly") === "1" || searchParams.get("mode") === "readonly";
    const canvasStorageScope = getActiveUserScope();
    const canvasCapturedScope = captureUserScope();
    const containerRef = useRef<HTMLDivElement>(null);
    const didInitialCenterRef = useRef(false);

    const effectiveConfig = useEffectiveConfig();
    const isAiConfigReady = useConfigStore((state) => state.isAiConfigReady);
    const assets = usePersonalAssetLibrary();
    const assetsHydrated = useAssetStore((state) => state.hydrated);
    const cleanupAssetImages = useAssetStore((state) => state.cleanupImages);
    const colorTheme = useCanvasThemeStore((state) => state.theme);
    const setTheme = useCanvasThemeStore((state) => state.setTheme);
    const theme = canvasThemes[colorTheme];
    const storageMode = useUserStore((state) => state.storageMode);
    const user = useUserStore((state) => state.user);
    const localOnly = isLocalWorkspaceMode() || storageMode === "local" || user?.username === "local" || import.meta.env.VITE_CANVAS_LOCAL_MODE !== "false";
    const importCanvasProject = useCanvasStore((state) => state.importProject);
    const storedCanvasProjects = useCanvasStore((state) => state.projects);
    const workspaceCanvases = useMemo(
        () => listCanvasWorkspaceProjectCanvases(storedCanvasProjects, projectId),
        [projectId, storedCanvasProjects],
    );
    const workspaceProject = workspaceCanvases[0] || null;
    const canvasProjects = useMemo(
        () => workspaceCanvases.map((project, index) => ({
            id: project.id,
            title: project.canvasTitle?.trim() || `画布 ${index + 1}`,
        })),
        [workspaceCanvases],
    );
    const nodesRef = useRef<CanvasNodeData[]>([]);
    const [nodes, setNodesState] = useState<CanvasNodeData[]>([]);
    const setNodes = useCallback<Dispatch<SetStateAction<CanvasNodeData[]>>>((value) => {
        if (typeof value === "function") {
            setNodesState((current) => {
                const next = stampCanvasNodeChanges(current, value(current));
                nodesRef.current = next;
                return next;
            });
            return;
        }
        const next = stampCanvasNodeChanges(nodesRef.current, value);
        nodesRef.current = next;
        setNodesState(next);
    }, []);
    useEffect(() => {
        if (!projectId || !isLocalWorkspaceMode()) return;
        let disposed = false;
        const check = () => {
            if (disposed) return;
            // 应用到本地后由本地工作区同步层通知编辑器（subscribeCanvasRefresh），
            // 这里不再重复写节点状态，避免两套投影互相覆盖。
            void refreshLocalCanvasProjectIfChanged(projectId);
        };
        // 助手回合结束与外部改动画布都要立刻可见：助手回合回调会直接调 check，
        // 这里的定时器只作为外部客户端改动的兜底。
        const timer = window.setInterval(check, 4000);
        return () => { disposed = true; window.clearInterval(timer); };
    }, [projectId, setNodes]);
    useEffect(() => {
        if (!projectId || !isLocalWorkspaceMode() || window.location.protocol !== "http:") return;
        const source = new EventSource(`/api/canvas-projects/${encodeURIComponent(projectId)}/events`);
        const sync = () => void refreshLocalCanvasProjectIfChanged(projectId).then((project) => {
            if (project) { setNodes(project.nodes || []); setConnections(project.connections || []); }
        });
        source.addEventListener("canvas.updated", sync);
        return () => { source.removeEventListener("canvas.updated", sync); source.close(); };
    }, [projectId, setNodes]);
    const [nodeStackOrder, setNodeStackOrder] = useState<CanvasNodeStackOrder>([]);
    const bringNodeToFront = useCallback((nodeId: string) => {
        setNodeStackOrder((current) => bringCanvasNodeToFront(current, nodeId));
    }, []);
    const [connections, setConnections] = useState<CanvasConnection[]>([]);
    const [chatSessions, setChatSessions] = useState<CanvasAssistantSession[]>([]);
    const [activeChatId, setActiveChatId] = useState<string | null>(null);
    const [viewport, setViewport] = useState<ViewportTransform>({ x: 0, y: 0, k: 1 });
    const [size, setSize] = useState({ width: 1200, height: 720 });
    const [selectedNodeIds, setSelectedNodeIds] = useState<Set<string>>(new Set());
    const [selectedConnectionId, setSelectedConnectionId] = useState<string | null>(null);
    // 选中项保存的是节点 id，切到另一个画布后这些 id 并不属于新画布：
    // 不清空会同时污染选中高亮和创作助手请求的归属校验（后端按画布校验选中对象）。
    useEffect(() => {
        setSelectedNodeIds(new Set());
        setSelectedConnectionId(null);
    }, [projectId]);
    const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
    const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
    const [isMiniMapOpen, setIsMiniMapOpen] = useState(() => scopedLocalStorage.getItem("canvas:minimap") === "1");
    const [canvasAppearance, setCanvasAppearance] = useState<CanvasAppearance>(() => canvasAppearanceForTheme(colorTheme));
    const [backgroundMode, setBackgroundMode] = useState<CanvasBackgroundMode>(DEFAULT_CANVAS_BACKGROUND_MODE);
    const [showImageInfo, setShowImageInfo] = useState(false);
    const [snapToGrid, setSnapToGrid] = useState(() => scopedLocalStorage.getItem("canvas:snap-to-grid") === "1");
    const [showConnections, setShowConnections] = useState(() => scopedLocalStorage.getItem("canvas:show-connections") !== "0");
    const [canvasTool, setCanvasTool] = useState<CanvasToolMode>("box-select");
    const [mediaPerformanceMode, setMediaPerformanceMode] = useState<CanvasMediaPerformanceMode>(readCanvasMediaPerformanceMode);
    const [projectLoaded, setProjectLoaded] = useState(false);
    const workspaceMode: CanvasWorkspaceMode = "professional";
    const {
        clearConfirmOpen,
        setClearConfirmOpen,
        generationHistoryOpen,
        setGenerationHistoryOpen,
        nodeSearchOpen,
        setNodeSearchOpen,
        textEditorNodeId,
        setTextEditorNodeId,
        infoNodeId,
        setInfoNodeId,
        previewNodeId,
        setPreviewNodeId,
        versionCompareRootId,
        setVersionCompareRootId,
        clearDeletedNodeIds,
        resetForClearCanvas,
    } = useCanvasProjectDialogs();
    const [toolbarNodeId, setToolbarNodeId] = useState<string | null>(null);
    const [nodeImageSettingsOpen, setNodeImageSettingsOpen] = useState(false);
    const [dialogNodeId, setDialogNodeId] = useState<string | null>(null);
    const [titleEditing, setTitleEditing] = useState(false);
    const [titleDraft, setTitleDraft] = useState("");
    const [shortcutRequestNonce, setShortcutRequestNonce] = useState(0);

    const { tasks: activeTasks } = useCanvasActiveTasks(projectId, projectLoaded);
    const { focusMode, enterFocusMode, exitFocusMode, toggleFocusMode } = useFocusMode();
    const [focusDockRevealed, setFocusDockRevealed] = useState(false);

    useEffect(() => {
        persistCanvasMediaPerformanceMode(mediaPerformanceMode);
    }, [mediaPerformanceMode]);

    useEffect(() => {
        didInitialCenterRef.current = false;
        setNodeStackOrder([]);
    }, [projectId]);

    useEffect(() => {
        const nodeIds = new Set(nodes.map((node) => node.id));
        setNodeStackOrder((current) => {
            const next = current.filter((nodeId) => nodeIds.has(nodeId));
            return next.length === current.length ? current : next;
        });
    }, [nodes]);

    const connectionsRef = useRef(connections);
    const chatSessionsRef = useRef(chatSessions);
    const activeChatIdRef = useRef(activeChatId);
    const selectedNodeIdsRef = useRef(selectedNodeIds);
    const viewportRef = useRef(viewport);

    const resolvedCanvasAppearance = useMemo(() => resolveCanvasAppearance(canvasAppearance, colorTheme), [canvasAppearance, colorTheme]);
    const applyCanvasAppearance = useCallback(
        (next: CanvasAppearance) => {
            const fallback = canvasAppearanceBaseTheme(next, colorTheme);
            const normalized = normalizeCanvasAppearance(next, fallback);
            setCanvasAppearance(normalized);
            setTheme(canvasAppearanceBaseTheme(normalized, fallback));
        },
        [colorTheme, setTheme],
    );
    const saveCanvasAppearanceDefault = useCallback(
        (next: CanvasAppearance) => {
            writeCanvasAppearanceDefault({ appearance: next, backgroundMode });
            message.success("已保存为当前账号在本机的新建画布默认外观");
        },
        [backgroundMode, message],
    );

    const { adoptExternalSnapshot, getHistoryCleanupContext, historyPausedRef, historyState, redoCanvas, resetHistory, undoCanvas } = useCanvasHistory({
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        canvasAppearance,
        backgroundMode,
        showImageInfo,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        applyCanvasAppearance,
        setBackgroundMode,
        setShowImageInfo,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
    });

    const cleanupCanvasFiles = useCallback(
        (extra?: unknown) => {
            cleanupAssetImages({ extra, ...getHistoryCleanupContext() });
        },
        [cleanupAssetImages, getHistoryCleanupContext],
    );

    const { loadError, retryLoad, addedSkills, clearCanvasFiles, createAndOpenCanvas, currentProject, deleteCurrentProject, renameCurrentProject, reloadLatestCanvasProject, restoreCanvasProjectVersion, saveCanvasProject, forceSaveCanvasProject, updateProject } = useCanvasProjectLifecycle({
        projectId,
        projectLoaded,
        nodes,
        connections,
        chatSessions,
        activeChatId,
        canvasAppearance,
        backgroundMode,
        showImageInfo,
        viewport,
        nodesRef,
        connectionsRef,
        chatSessionsRef,
        activeChatIdRef,
        viewportRef,
        historyPausedRef,
        setNodes,
        setConnections,
        setChatSessions,
        setActiveChatId,
        setCanvasAppearance,
        setBackgroundMode,
        setShowImageInfo,
        setViewport,
        setProjectLoaded,
        resetHistory,
        adoptExternalSnapshot,
        cleanupAssetImages,
        cleanupCanvasFiles,
    });

    const duplicateCurrentProject = useCallback(async () => {
        if (!currentProject) return;
        const now = new Date().toISOString();
        const id = importCanvasProject({
            ...currentProject,
            title: `${currentProject.title || "未命名画布"} 副本`,
            revision: 0,
            remoteContentHash: undefined,
            createdAt: now,
            updatedAt: now,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions: chatSessionsRef.current,
            activeChatId: activeChatIdRef.current,
            viewport: viewportRef.current,
        });
        await flushCanvasStorePersistence();
        navigate(`/canvas/${id}`);
    }, [currentProject, importCanvasProject, navigate]);

    const openCanvasInNewWindow = useCallback((canvasId: string) => {
        window.open(appHref(`/canvas/${canvasId}`), "_blank", "noopener,noreferrer");
    }, []);

    const renameCanvasFromMenu = useCallback(async (canvasId: string, canvasTitle: string) => {
        updateProject(canvasId, { canvasTitle });
        await flushCanvasStorePersistence();
        message.success("画布已重命名");
    }, [message, updateProject]);

    const duplicateCanvasFromMenu = useCallback(async (canvasId: string) => {
        const source = useCanvasStore.getState().openProject(canvasId);
        if (!source) {
            message.error("画布不存在或已被删除");
            return;
        }
        const sourceSnapshot = canvasId === projectId ? {
            ...source,
            nodes: nodesRef.current,
            connections: connectionsRef.current,
            chatSessions: chatSessionsRef.current,
            activeChatId: activeChatIdRef.current,
            viewport: viewportRef.current,
        } : source;
        const fallbackTitle = canvasProjects.find((canvas) => canvas.id === canvasId)?.title || "画布";
        const now = new Date().toISOString();
        importCanvasProject({
            ...sourceSnapshot,
            canvasTitle: `${sourceSnapshot.canvasTitle?.trim() || fallbackTitle} 副本`,
            revision: 0,
            remoteContentHash: undefined,
            createdAt: now,
            updatedAt: now,
        }, canvasWorkspaceProjectId(sourceSnapshot));
        await flushCanvasStorePersistence();
        message.success("画布副本已创建");
    }, [canvasProjects, importCanvasProject, message, projectId]);

    const [deletingCanvas, setDeletingCanvas] = useState<{ id: string; scope: CapturedUserScope } | null>(null);
    const deleteCanvasFromMenu = useCallback((id: string) => setDeletingCanvas({ id, scope: captureUserScope() }), []);

    const versions = useCanvasVersionHistory(projectId, restoreCanvasProjectVersion, currentProject);
    // 画布右侧只有一个栏位：助手和版本记录互斥，谁被打开另一个就让位。
    const assistant = useCanvasAssistant({
        canvasId: projectId,
        onCanvasChanged: (canvasId, changedNodeIds) => {
            if (canvasId !== projectId) return;
            void refreshLocalCanvasProjectIfChanged(canvasId).then(() => highlightAssistantNodes(containerRef.current, changedNodeIds));
        },
    });
    const canvasMainRef = useRef<HTMLElement>(null);
    const assistantDockable = useCanvasAssistantDockable(canvasMainRef);
    const rightPanel = resolveCanvasRightPanel(assistant.open, versions.open);
    const openVersions = () => { assistant.setOpen(false); setVersionCompareRootId(null); versions.show(); };
    const toggleVersions = () => {
        if (!versions.open) assistant.setOpen(false);
        setVersionCompareRootId(null);
        versions.toggle();
    };
    const toggleAssistant = useCallback(() => {
        const next = !assistant.open;
        if (next) versions.close();
        assistant.setOpen(next);
    }, [assistant, versions]);
    const openAssistant = useCallback(() => {
        exitFocusMode();
        versions.close();
        assistant.setOpen(true);
    }, [assistant, exitFocusMode, versions]);
    // 修复素材关联仍遵守当前画布版本，不能替用户确认覆盖云端的新内容。
    const confirmForceSaveCanvas = useCallback(() => {
        modal.confirm({
            title: "修复素材关联并保存？",
            content: "核对画布媒体与素材库的关联，补齐缺失素材后保存。若云端已有新版本，会保留本地草稿并提示加载最新版。",
            okText: "修复并保存",
            cancelText: "取消",
            onOk: () => forceSaveCanvasProject(),
        });
    }, [forceSaveCanvasProject, modal]);

    const linkedProjectId = currentProject?.projectId || "";
    // 助手只接受属于当前画布的选中项：切画布那一帧仍可能残留旧 id，这里做硬约束，
    // 不让跨画布的 id 进入请求（后端会按画布校验并拒绝整个回合）。
    const assistantSelectedNodeIds = useMemo(() => {
        const available = new Set(nodes.map((node) => node.id));
        return Array.from(selectedNodeIds).filter((id) => available.has(id));
    }, [nodes, selectedNodeIds]);
    // 助手的 @ 菜单覆盖整张画布，而不是只覆盖能当生成输入的资源节点。
    const assistantMentionReferences = useMemo(() => buildCanvasAgentMentionReferences(nodes), [nodes]);
    // 扩展节点（对比/图表/调色）要读自己的上游才能渲染，经 Context 下发；
    // 取上游复用 canvas-resource-references 的实现，别在这里另写一份。必须 memo——
    // 每帧新对象会让所有节点跟着重渲染，错题本里多条崩溃都出在画布高频更新。
    const nodeGraphContext = useMemo<CanvasNodeGraphContextValue>(() => ({ getUpstreamNodes: (nodeId: string) => getContextResourceNodes(nodeId, nodes, connections) }), [connections, nodes]);

    // 沉浸专注进入时收起小地图、重置 Dock 唤出态；仅响应「进入」瞬间。
    const prevFocusModeRef = useRef(focusMode);
    useEffect(() => {
        const enteredFocus = focusMode && !prevFocusModeRef.current;
        prevFocusModeRef.current = focusMode;
        if (!enteredFocus) return;
        setIsMiniMapOpen(false);
        setFocusDockRevealed(false);
    }, [focusMode]);

    useEffect(() => {
        if (!dialogNodeId) setNodeImageSettingsOpen(false);
    }, [dialogNodeId]);

    useLayoutEffect(() => {
        nodesRef.current = nodes;
        connectionsRef.current = connections;
        chatSessionsRef.current = chatSessions;
        activeChatIdRef.current = activeChatId;
        selectedNodeIdsRef.current = selectedNodeIds;
        viewportRef.current = viewport;
    }, [activeChatId, chatSessions, nodes, connections, selectedNodeIds, viewport]);

    // 停靠栏挤压画布时补偿一半位移：用户正在看的那块内容留在原处，视野不跳。
    const dockedAssistantWidth = rightPanel === "assistant" && assistantDockable ? assistant.width : 0;
    const previousDockedAssistantWidth = useRef(dockedAssistantWidth);
    useEffect(() => {
        const delta = dockedAssistantWidth - previousDockedAssistantWidth.current;
        previousDockedAssistantWidth.current = dockedAssistantWidth;
        if (!delta) return;
        const next = { ...viewportRef.current, x: viewportRef.current.x - delta / 2 };
        viewportRef.current = next;
        setViewport(next);
    }, [dockedAssistantWidth]);

    useEffect(() => {
        if (!projectLoaded) return;
        const el = containerRef.current;
        if (!el) return;

        const updateSize = () => {
            const rect = el.getBoundingClientRect();
            setSize((current) => (current.width === rect.width && current.height === rect.height ? current : { width: rect.width, height: rect.height }));
            if (!didInitialCenterRef.current) {
                didInitialCenterRef.current = true;
                const current = viewportRef.current;
                if (current.x === 0 && current.y === 0 && current.k === 1) {
                    const centered = { x: rect.width / 2, y: rect.height / 2, k: 1 };
                    viewportRef.current = centered;
                    setViewport(centered);
                }
            }
        };

        updateSize();
        const resizeObserver = new ResizeObserver(updateSize);
        resizeObserver.observe(el);
        return () => resizeObserver.disconnect();
    }, [projectLoaded]);

    const {
        fitCanvasContent,
        fitCanvasSelection,
        focusCanvasImageNode,
        focusCanvasNode,
        getCanvasCenter,
        handleCanvasDoubleClick,
        handleViewportChange,
        handleViewportPreviewChange,
        previewViewport,
        screenToCanvas,
        setZoomScale,
        zoomCanvasIn,
        zoomCanvasOut,
        zoomToActualSize,
    } = useCanvasViewportController({
        containerRef,
        size,
        viewportRef,
        nodesRef,
        selectedNodeIdsRef,
        setViewport,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        setToolbarNodeId,
    });

    // Pan only the viewport (never the node) when a newly connected target
    // crosses the visible canvas safe area, including under the Agent dock.
    const keepConnectedNodeVisible = useCanvasConnectedNodeVisibility({
        size,
        containerRef,
        viewportRef,
        nodesRef,
        connectionsRef,
        setViewport,
    });

    const {
        applyGenerationTaskResult,
        bindGenerationTask,
        finishGenerationRequest,
        openNodeTaskDetails,
        runningNodeId,
        setRunningNodeId,
        setTaskDetail,
        startGenerationRequest,
        taskDetail,
        taskDetailLoading,
        taskDetailError,
        taskDetailLogs,
        handleGenerateNode,
        handleRetryNode,
        cancelCanvasTask,
        insertGenerationHistoryTask,
        reconcileImageBatchRootNode,
        retryImageBatchChildren,
        generateImageFromTextNode,
    } = useCanvasGenerationOrchestration({
        projectId,
        linkedProjectId,
        domainProjectId: currentProject?.projectId,
        projectLoaded,
        localOnly,
        addedSkills,
        assets,
        nodes,
        nodesRef,
        connectionsRef,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setGenerationHistoryOpen,
        getCanvasCenter,
    });

    const { runAssistantProposal, assistantProposalFeedback, runningProposalIds } = useCanvasAssistantProposal({
        projectId,
        addedSkills,
        nodesRef,
        connectionsRef,
        handledProposals: assistant.handledProposals,
        markProposalHandled: assistant.markProposalHandled,
        handleGenerateNode,
    });

    const {
        assetPickerOpen,
        uploadModalOpen,
        closeUploadModal,
        handleImportUrl,
        closeAssetPicker,
        createAssetPayloadNodes,
        fileDropActive,
        handleAssetsInsert,
        handleDrop,
        handleFileDragEnter,
        handleFileDragLeave,
        handleFileDragOver,
        handleImageInputChange,
        handleUploadFiles,
        handleUploadRequest,
        handleUploadReferenceRequest,
        imageInputRef,
        openAssetsAtPosition,
        pasteAssistantImage,
        pasteSystemClipboard,
        replaceNodeMedia,
        createFileNode,
        startUploadStatus,
    } = useCanvasUpload({
        canvasId: projectId,
        domainProjectId: linkedProjectId,
        nodesRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
    });
    const replaceCanvasNodeMedia = useCallback((node: CanvasNodeData) => handleUploadRequest(node.id), [handleUploadRequest]);

    const {
        annotationNodeId, setAnnotationNodeId,
        angleNodeId, setAngleNodeId,
        lightingNodeId, setLightingNodeId,
        createImageReversePromptNodes,
        generateAngleNode,
        generateLightingNode,
        openPortraitTextureEditor,
        saveAnnotatedImageNode,
        cropNodeId, setCropNodeId, cropImageNode,
        maskEditNodeId, setMaskEditNodeId, maskEditImageNode,
        upscaleNodeId, setUpscaleNodeId, upscaleImageNode, splitImageNode,
    } = useCanvasMediaTools({
        projectId, domainProjectId: linkedProjectId, nodesRef, connectionsRef,
        setNodes, setConnections, setSelectedNodeIds, setSelectedConnectionId, setDialogNodeId,
        setContextMenu, setHoveredNodeId, setToolbarNodeId, setRunningNodeId,
        startGenerationRequest, finishGenerationRequest, bindGenerationTask,
    });

    const handleNodesDeleted = useCallback(
        (removedIds: Set<string>, nextNodes: CanvasNodeData[], removedNodes: CanvasNodeData[]) => {
            const clearDeletedId = (current: string | null) => (current && removedIds.has(current) ? null : current);
            setHoveredNodeId(clearDeletedId);
            setToolbarNodeId(clearDeletedId);
            setDialogNodeId(clearDeletedId);
            clearDeletedNodeIds(removedIds);
            setCropNodeId(clearDeletedId);
            setMaskEditNodeId(clearDeletedId);
            setAnnotationNodeId(clearDeletedId);
            setAngleNodeId(clearDeletedId);
            setLightingNodeId(clearDeletedId);
            setUpscaleNodeId(clearDeletedId);
            setRunningNodeId(clearDeletedId);
            cleanupCanvasFiles({ projectId, nodes: nextNodes, chatSessions });
            // Node operations update the local store synchronously, but the
            // Go repository is the source read by MCP/SSE. Persist the exact
            // post-delete snapshot immediately so a later refresh cannot
            // restore the removed node from a stale backend revision.
            if (isLocalWorkspaceMode()) {
                void syncLocalCanvasSnapshot(projectId, { nodes: nextNodes, connections: connectionsRef.current })
                    .catch((error) => console.error("删除节点后的本地后端同步失败", error));
            }
        },
        [
            chatSessions,
            cleanupCanvasFiles,
            clearDeletedNodeIds,
            projectId,
            setAngleNodeId,
            setAnnotationNodeId,
            setCropNodeId,
            setLightingNodeId,
            setMaskEditNodeId,
            setRunningNodeId,
            setUpscaleNodeId,
        ],
    );

    const {
        alignSelectedNodes,
        autoArrangeCanvasNodes,
        arrangeSelectedNodes,
        spreadSelectedNodes,
        copyNodesToClipboard,
        copySelectedNodes,
        createFolder,
        createNode,
        createReferenceGroup,
        deleteConnection,
        deleteNodes,
        duplicateNode,
        hasCopiedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        releaseCopiedNodesPastePriority,
        setPrimaryVersion,
        shouldPreferCopiedNodes,
        toggleNodeLocked,
    } = useCanvasNodeOperations({
        projectId,
        nodesRef,
        connectionsRef,
        selectedNodeIdsRef,
        getCanvasCenter,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        onNodesDeleted: handleNodesDeleted,
    });

    // Capability cards can request a starter node while opening a fresh local
    // canvas. Consume the query once so refreshes do not duplicate it.
    useEffect(() => {
        if (!projectLoaded) return;
        const requestedType = searchParams.get("add");
        const nodeType = requestedType === "image" ? CanvasNodeType.Image : null;
        if (!nodeType) return;
        let frame = 0;
        let focusFrame = 0;
        const insertWhenCanvasIsLaidOut = () => {
            const rect = containerRef.current?.getBoundingClientRect();
            if (!rect || rect.width <= 0 || rect.height <= 0) {
                frame = requestAnimationFrame(insertWhenCanvasIsLaidOut);
                return;
            }
            const shouldCreate = !nodesRef.current.some((node) => node.type === nodeType);
            if (shouldCreate) {
                createNode(nodeType);
                // Starter cards can be wider than a narrow viewport. Fit the
                // newly selected card after the node commit so it stays fully
                // visible instead of being clipped against the top-left edge.
                focusFrame = requestAnimationFrame(() => fitCanvasSelection());
            }
            const next = new URLSearchParams(searchParams);
            next.delete("add");
            setSearchParams(next, { replace: true });
        };
        frame = requestAnimationFrame(insertWhenCanvasIsLaidOut);
        return () => {
            cancelAnimationFrame(frame);
            cancelAnimationFrame(focusFrame);
        };
    }, [containerRef, createNode, fitCanvasSelection, nodesRef, projectLoaded, searchParams, setSearchParams]);

    const handleReplaceNodeReference = useCallback(
        (targetNodeId: string, oldReference: { id: string; nodeId?: string; label?: string; title?: string }, sourceNodeId: string) => {
            const sourceNode = nodesRef.current.find((n) => n.id === sourceNodeId);
            if (!sourceNode || sourceNode.id === oldReference.nodeId) return;

            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;

            const configNodeId = previousConnections.find((c) => c.fromNodeId === targetNodeId && previousNodes.find((n) => n.id === c.toNodeId)?.type === CanvasNodeType.Config)?.toNodeId;
            const receiverId = configNodeId || targetNodeId;

            let rewired = false;
            const nextConnections = previousConnections.map((c) => {
                if (!rewired && c.fromNodeId === oldReference.nodeId && (c.toNodeId === targetNodeId || c.toNodeId === configNodeId)) {
                    rewired = true;
                    return { ...c, fromNodeId: sourceNodeId };
                }
                return c;
            });

            if (!rewired) {
                nextConnections.push({
                    id: nanoid(),
                    fromNodeId: sourceNodeId,
                    toNodeId: receiverId,
                });
            }

            const nextReferencesMap = buildCanvasNodeMentionReferenceMap(previousNodes, nextConnections, previousNodes);
            const targetNextReferences = nextReferencesMap.get(targetNodeId) || [];
            const newRef = targetNextReferences.find((r) => r.nodeId === sourceNodeId);

            const targetNode = previousNodes.find((n) => n.id === targetNodeId);
            let nextNodes = previousNodes;
            if (targetNode && newRef) {
                const currentPrompt = targetNode.metadata?.composerContent ?? targetNode.metadata?.prompt ?? "";
                const replacementToken = `@${newRef.label}`;
                const updatedPrompt = replaceCanvasReferenceMentions(currentPrompt, oldReference, replacementToken, sourceNode.title ? sourceNode.title : newRef.label);

                nextNodes = previousNodes.map((n) => (n.id === targetNodeId ? writeCanvasNodePrompt(n, updatedPrompt) : n));
            }

            nodesRef.current = nextNodes;
            connectionsRef.current = nextConnections;
            setNodes(nextNodes);
            setConnections(nextConnections);
            message.success(`已将参考图「${oldReference.label || "参考图"}」替换为「${sourceNode.title || "新图片"}」，提示词已同步更新`);
        },
        [connectionsRef, message, nodesRef, setConnections, setNodes],
    );

    const handleReplaceNodeReferenceFiles = useCallback(
        (_targetNodeId: string, oldReference: { id: string; nodeId?: string; label?: string; title?: string }, files: File[]) => {
            const file = files.find((f) => f.type.startsWith("image/"));
            if (!file || !oldReference.nodeId) return;
            void replaceNodeMedia(oldReference.nodeId, file).then((success: boolean) => {
                if (success) {
                    message.success("参考图片已替换");
                }
            });
        },
        [message, replaceNodeMedia],
    );

    const {
        cancelPendingConnectionCreate,
        closeConnectionCreateMenu,
        connectionTargetAnchorRatio,
        connectionTargetNodeId,
        connectionApproach,
        connectionReplaceHover,
        connectingParams,
        createConnectedNode,
        getConnectionCreateDisabledReason,
        handleConnectStart,
        handleConnectDrop,
        handleBatchConnectionTargetClick,
        batchConnectionPreview,
        beginBatchConnectionMode,
        startBatchConnection,
        mouseWorld,
        pendingConnectionCreate,
        setConnecting,
    } = useCanvasConnectionController({
        config: effectiveConfig,
        nodesRef,
        connectionsRef,
        viewportRef,
        screenToCanvas,
        setNodes,
        setConnections,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setDialogNodeId,
        onConnectedNodeCreated: keepConnectedNodeVisible,
        onReplaceReference: handleReplaceNodeReference,
    });

    const batchSourceNodeIds = useMemo(() => nodes.filter((node) => selectedNodeIds.has(node.id) && !batchSourceRestriction(node)).map((node) => node.id), [nodes, selectedNodeIds]);

    const {
        handleCanvasSelectionStart,
        handleNodeInteractionStart,
        handleNodeDragEnd,
        handleCanvasDeselect,
    } = useCanvasPointerSelectionChrome({
        nodesRef,
        setContextMenu,
        setHoveredNodeId,
        setToolbarNodeId,
        setDialogNodeId,
    });

    const handleSelectedNodeClick = useCallback(
        (node: CanvasNodeData) => {
            // Selection is transient, but the LibTV-style paint order survives
            // deselection so a clicked lower node stays above its neighbours.
            if (node.type !== CanvasNodeType.Frame) bringNodeToFront(node.id);
            if (node.type === CanvasNodeType.Text) {
                setDialogNodeId(node.id);
            } else if (node.type === CanvasNodeType.Frame) {
                setDialogNodeId((current) => (current === node.id ? current : null));
            } else if (node.type === CanvasNodeType.Image) {
                // Media generators own the composer; results from any origin own the media toolbar.
                if (canOpenCanvasNodePromptPanel(node)) {
                    setToolbarNodeId(null);
                    setDialogNodeId(node.id);
                } else {
                    setDialogNodeId(null);
                    setToolbarNodeId(node.id);
                }
            } else {
                // 选择参考媒体时保留当前工作流配置面板，避免点击图片后配置“返回/消失”。
                // 没有工作流配置面板时，媒体节点仍按原逻辑打开自己的面板。
                setDialogNodeId((current) => {
                    const currentNode = current ? nodesRef.current.find((item) => item.id === current) : undefined;
                    return currentNode?.type === CanvasNodeType.Config ? current : node.id;
                });
            }
        },
        [bringNodeToFront, nodesRef],
    );

    const handleNodeBringToFront = useCallback(
        (nodeId: string) => {
            const node = nodesRef.current.find((item) => item.id === nodeId);
            if (node && node.type !== CanvasNodeType.Frame) bringNodeToFront(nodeId);
        },
        [bringNodeToFront, nodesRef],
    );

    const { alignmentGuides, cancelSelectionBox, deselectCanvas, dragPreview, frameDropTargetId, handleCanvasMouseDown, handleNodeMouseDown, isNodeDragging, nodeDraggingRef, selectionBoundsElementRef, selectionBox } = useCanvasSelectionController({
        containerRef,
        nodesRef,
        viewportRef,
        selectedNodeIdsRef,
        historyPausedRef,
        screenToCanvas,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        cancelPendingConnectionCreate,
        onCanvasSelectionStart: handleCanvasSelectionStart,
        onNodeInteractionStart: handleNodeInteractionStart,
        onNodeBringToFront: handleNodeBringToFront,
        onNodeClick: handleSelectedNodeClick,
        onNodeDragEnd: handleNodeDragEnd,
        onBatchConnectionTarget: handleBatchConnectionTargetClick,
        onDeselect: handleCanvasDeselect,
        snapToGrid,
    });

    const {
        keepNodeToolbar,
        hideNodeToolbar,
        handleCanvasNodeHoverStart,
        handleCanvasNodeHoverEnd,
    } = useCanvasNodeToolbarHover({
        nodeDraggingRef,
        nodeImageSettingsOpen,
        setHoveredNodeId,
        setToolbarNodeId,
    });

    const {
        collapsingBatchIds,
        downloadNodeImage,
        handleConfigNodeChange,
        handleFolderStyleChange,
        handleFolderThemeChange,
        handleFontSizeChange,
        handleNodeContentChange,
        handleNodePromptChange,
        handleNodeResize,
        handleNodeTitleChange,
        openingBatchIds,
        saveNodeAsset,
        setBatchPrimary,
        toggleBatchExpanded,
        toggleFrameCollapsed,
        toggleNodeFreeResize,
    } = useCanvasNodeEditor({
        canvasId: projectId,
        canvasTitle: currentProject?.title || "未命名画布",
        domainProjectId: linkedProjectId,
        nodesRef,
        setNodes,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setDialogNodeId,
        setToolbarNodeId,
        setHoveredNodeId,
    });

    const handleRemoveNodeReference = useCallback(
        (targetNodeId: string, reference: CanvasResourceReference) => {
            const referenceNodeId = reference.nodeId;
            if (!referenceNodeId) return;
            // 生成节点可能通过配置节点接收参考，只移除参考来源边，保留目标到配置节点的主链。
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const configNodeId = previousConnections.find((connection) => {
                if (connection.fromNodeId !== targetNodeId) return false;
                return previousNodes.find((node) => node.id === connection.toNodeId)?.type === CanvasNodeType.Config;
            })?.toNodeId;
            const removedConnectionIds = new Set(previousConnections.filter((connection) => connection.fromNodeId === referenceNodeId && (connection.toNodeId === targetNodeId || connection.toNodeId === configNodeId)).map((connection) => connection.id));
            if (!removedConnectionIds.size) return;
            const nextConnections = previousConnections.filter((connection) => !removedConnectionIds.has(connection.id));
            const nextNodes = applyCanvasConnectionPromptSync(previousNodes, previousConnections, previousNodes, nextConnections);
            if (nextNodes !== previousNodes) {
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
            }
            connectionsRef.current = nextConnections;
            setConnections(nextConnections);
            setSelectedConnectionId((current) => (current && removedConnectionIds.has(current) ? null : current));
        },
        [connectionsRef, nodesRef, setConnections, setNodes, setSelectedConnectionId],
    );

    const handleReorderNodeReferences = useCallback(
        (targetNodeId: string, orderedNodeIds: string[]) => {
            const previousNodes = nodesRef.current;
            const previousConnections = connectionsRef.current;
            const nextConnections = reorderCanvasResourceConnections(targetNodeId, orderedNodeIds, previousNodes, previousConnections);
            if (nextConnections === previousConnections) return;
            const nextNodes = applyCanvasConnectionPromptSync(previousNodes, previousConnections, previousNodes, nextConnections);
            if (nextNodes !== previousNodes) {
                nodesRef.current = nextNodes;
                setNodes(nextNodes);
            }
            connectionsRef.current = nextConnections;
            setConnections(nextConnections);
        },
        [connectionsRef, nodesRef, setConnections, setNodes],
    );

    const {
        activeNodeId,
        angleNode,
        batchChildCountById,
        batchMotionById,
        canvasImageNodes,
        configInputsById,
        connectionLayerBounds,
        contextMenuNode,
        displayConnections,
        frameChildrenById,
        infoNode,
        lightingNode,
        maskEditNode,
        mentionReferencesByNodeId,
        nodeById,
        previewNode,
        reduceMediaEffects,
        relatedHighlight,
        resourceReferenceByNodeId,
        selectedNodeBounds,
        skillMentionReferences,
        toolbarNode,
        upscaleNode,
        versionCompareNodes,
        visibleNodes,
    } = useCanvasRenderModel({
        nodes,
        connections,
        assets,
        viewport,
        viewportSize: size,
        mediaPerformanceMode,
        selectedNodeIds,
        hoveredNodeId,
        dragPreview,
        collapsingBatchIds,
        addedSkills,
        infoNodeId,
        maskEditNodeId,
        annotationNodeId,
        angleNodeId,
        lightingNodeId,
        upscaleNodeId,
        previewNodeId,
        contextMenu,
        versionCompareRootId,
        dialogNodeId,
    });
    const renderedConnections = showConnections ? displayConnections : [];
    useCanvasMentionNormalize(mentionReferencesByNodeId, setNodes);
    const dialogNodeCandidate = dialogNodeId ? nodeById.get(dialogNodeId) || null : null;
    const dialogNode = canOpenCanvasNodePromptPanel(dialogNodeCandidate) ? dialogNodeCandidate : null;
    // dragPreview is published on the same pointer-down frame as isNodeDragging.
    // Treat either signal as moving so floating editors disappear before the
    // first preview transform is painted and never affect drag layout.
    const isCanvasNodeMoving = isNodeDragging || Boolean(dragPreview?.nodeIds.size);
    const textEditorNode = textEditorNodeId ? nodeById.get(textEditorNodeId) || null : null;

    const openTextNodeEditor = useCallback((node: CanvasNodeData) => {
        if (node.type !== CanvasNodeType.Text) return;
        setSelectedNodeIds(new Set([node.id]));
        setSelectedConnectionId(null);
        setContextMenu(null);
        setDialogNodeId(null);
        setToolbarNodeId(null);
        setTextEditorNodeId(node.id);
    }, []);

    const duplicateNodeFromContent = useCallback((node: CanvasNodeData) => duplicateNode(node.id), [duplicateNode]);
    const deleteNodeFromContent = useCallback((node: CanvasNodeData) => deleteNodes(new Set([node.id])), [deleteNodes]);
    const { updateNodeFromContent, updateMediaNodeFromContent, updateNodeMetadataFromContent } = useCanvasNodeContent({
        nodesRef,
        setNodesState,
    });
    const canvasNodeActions = useMemo<CanvasNodeActionContextValue>(
        () => ({
            upload: replaceCanvasNodeMedia,
            download: downloadNodeImage,
            duplicate: duplicateNodeFromContent,
            deleteNode: deleteNodeFromContent,
            updateMetadata: updateNodeMetadataFromContent,
            updateNode: updateNodeFromContent,
            updateMediaNode: updateMediaNodeFromContent,
        }),
        [deleteNodeFromContent, downloadNodeImage, duplicateNodeFromContent, replaceCanvasNodeMedia, updateMediaNodeFromContent, updateNodeFromContent, updateNodeMetadataFromContent],
    );

    const clearCanvas = useCallback(() => {
        setNodes([]);
        setConnections([]);
        resetForClearCanvas();
        setCropNodeId(null);
        setMaskEditNodeId(null);
        setAnnotationNodeId(null);
        setAngleNodeId(null);
        setLightingNodeId(null);
        setUpscaleNodeId(null);
        setRunningNodeId(null);
        deselectCanvas();
        clearCanvasFiles();
    }, [clearCanvasFiles, deselectCanvas, resetForClearCanvas, setAngleNodeId, setAnnotationNodeId, setCropNodeId, setLightingNodeId, setMaskEditNodeId, setUpscaleNodeId, setRunningNodeId]);

    useCanvasKeyboard({
        enabled: projectLoaded && !versions.preview && !readOnly,
        onToggleAssistant: focusMode ? undefined : toggleAssistant,
        nodesRef,
        selectedNodeIdsRef,
        selectedConnectionId,
        setSelectedNodeIds,
        setSelectedConnectionId,
        setContextMenu,
        setShortcutRequestNonce,
        setInfoNodeId,
        setCropNodeId,
        setMaskEditNodeId,
        setAnnotationNodeId,
        saveCanvasProject,
        zoomToActualSize,
        fitCanvasContent,
        fitCanvasSelection,
        undoCanvas,
        redoCanvas,
        cancelSelectionBox,
        copySelectedNodes,
        pasteCopiedNodes,
        restoreCopiedNodesFromText,
        shouldPreferCopiedNodes,
        pasteSystemClipboard,
        deleteNodes,
        deleteConnection,
        deselectCanvas,
        zoomCanvasIn,
        zoomCanvasOut,
        autoArrangeCanvasNodes,
        focusMode,
        exitFocusMode,
        toggleFocusMode,
        onOpenSearch: () => setNodeSearchOpen(true),
        beginBatchConnection: () => beginBatchConnectionMode(Array.from(selectedNodeIdsRef.current)),
    });

    const startTitleEditing = useCallback(() => {
        setTitleDraft(workspaceProject?.title || "未命名画布");
        setTitleEditing(true);
    }, [workspaceProject?.title]);

    const finishTitleEditing = useCallback(() => {
        const nextTitle = titleDraft.trim();
        if (nextTitle) renameCurrentProject(nextTitle);
        setTitleEditing(false);
    }, [renameCurrentProject, titleDraft]);

    const pasteAtPosition = useCallback(
        (position: Position) => {
            if (shouldPreferCopiedNodes() && pasteCopiedNodes(position)) return;
            void (async () => {
                try {
                    // 标记写入成功时仍优先系统图片，兼容截图和从外部应用复制的媒体。
                    const handled = await pasteSystemClipboard(position);
                    if (!handled) pasteCopiedNodes(position);
                } catch {
                    if (!pasteCopiedNodes(position)) message.warning("无法读取剪贴板内容");
                }
            })();
        },
        [message, pasteCopiedNodes, pasteSystemClipboard, shouldPreferCopiedNodes],
    );

    const copyingNodeContentRef = useRef(false);
    const copyNodeContentToClipboard = useCallback(
        async (node: CanvasNodeData | null) => {
            if (copyingNodeContentRef.current) return;
            copyingNodeContentRef.current = true;
            releaseCopiedNodesPastePriority();
            const content = node?.metadata?.content?.trim();
            const resourceId = resourceIdFromStorageKey(node?.metadata?.storageKey);
            const copySource = content || (node?.type === CanvasNodeType.Image && resourceId ? resourceFileUrl(resourceId) : "");
            if (!node || !copySource) {
                copyingNodeContentRef.current = false;
                message.warning("没有可复制的内容");
                return;
            }

            try {
                if (node.type === CanvasNodeType.Image) {
                    try {
                        await copyImageToSystemClipboard(copySource, node.metadata?.storageKey);
                        message.success("图片已复制到剪贴板");
                        return;
                    } catch (imageErr) {
                        const fallbackUrl = new URL(copySource, window.location.href).toString();
                        if (navigator.clipboard?.writeText) {
                            await navigator.clipboard.writeText(fallbackUrl).catch(() => undefined);
                            message.info("由于浏览器未获得焦点，已为您复制图片地址");
                            return;
                        }
                        if (await copyToClipboard(fallbackUrl)) {
                            message.info("由于浏览器未获得焦点，已为您复制图片地址");
                            return;
                        }
                        throw imageErr;
                    }
                }

                if (navigator.clipboard?.writeText) await navigator.clipboard.writeText(copySource);
                else if (!(await copyToClipboard(copySource))) throw new Error("当前浏览器不支持写入剪贴板");
                message.success(node.type === CanvasNodeType.Text ? "文本已复制" : "内容链接已复制");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "复制失败，请检查浏览器剪贴板权限");
            } finally {
                copyingNodeContentRef.current = false;
            }
        },
        [message, releaseCopiedNodesPastePriority],
    );

    const handleCanvasContextMenu = useCallback(
        (event: ReactMouseEvent) => {
            const target = event.target instanceof Element ? event.target : null;
            if (target?.closest("[data-node-id],[data-connection-id]")) return;

            event.preventDefault();
            event.stopPropagation();
            if (target?.closest("[data-canvas-no-zoom],.ant-modal,.ant-popover,.ant-dropdown")) {
                setContextMenu(null);
                return;
            }

            closeConnectionCreateMenu();
            setContextMenu({ type: "canvas", x: event.clientX, y: event.clientY, position: screenToCanvas(event.clientX, event.clientY) });
        },
        [closeConnectionCreateMenu, screenToCanvas],
    );

    const handleNodeContextMenu = useCallback(
        (event: ReactMouseEvent, id: string) => {
            if (isCanvasTextEditingTarget(event.target)) return;
            event.preventDefault();
            event.stopPropagation();
            setSelectedNodeIds((current) => {
                if (current.has(id) && current.size > 1) return current;
                return new Set([id]);
            });
            setSelectedConnectionId(null);
            closeConnectionCreateMenu();
            setToolbarNodeId(null);
            setDialogNodeId(null);
            setContextMenu({ type: "node", x: event.clientX, y: event.clientY, nodeId: id });
        },
        [closeConnectionCreateMenu],
    );

    const renderCanvasNodePanel = useCallback(
        (panelNode: CanvasNodeData) => {
            return panelNode.type === CanvasNodeType.Config ? (
                <CanvasConfigComposer
                    value={panelNode.metadata?.composerContent ?? panelNode.metadata?.prompt ?? ""}
                    inputs={configInputsById.get(panelNode.id) || []}
                    skillReferences={skillMentionReferences}
                    generationMode={panelNode.metadata?.generationMode}
                    metadata={panelNode.metadata}
                    workspaceMode={workspaceMode}
                    onChange={(composerContent) => handleConfigNodeChange(panelNode.id, { composerContent })}
                    onClose={() => setDialogNodeId(null)}
                />
            ) : (
                <CanvasNodePromptPanel
                    projectId={projectId}
                    node={panelNode}
                    isRunning={isCanvasNodeGenerating(panelNode, runningNodeId)}
                    mentionReferences={[
                        ...(mentionReferencesByNodeId.get(panelNode.id) || EMPTY_RESOURCE_REFERENCES),
                        ...buildCanvasResourceReferences(nodesRef.current, connectionsRef.current).filter((reference) => reference.kind === "text" && reference.nodeId !== panelNode.id && !(mentionReferencesByNodeId.get(panelNode.id) || []).some((active) => active.nodeId === reference.nodeId)),
                    ]}
                    onAddReference={(nodeId, reference) => {
                        if (reference.active || reference.assetId || reference.kind === "skill") return reference;
                        if (reference.kind !== "text" || !reference.nodeId || reference.nodeId === nodeId) return undefined;
                        try {
                            const linked = connectCanvasTextMention(nodesRef.current, connectionsRef.current, nodeId, reference.nodeId, nanoid());
                            nodesRef.current = linked.nodes;
                            connectionsRef.current = linked.connections;
                            setNodes(linked.nodes);
                            setConnections(linked.connections);
                            return linked.reference;
                        } catch (cause) {
                            message.warning(cause instanceof Error ? cause.message : "文本引用失败");
                            return undefined;
                        }
                    }}
                    onPromptChange={handleNodePromptChange}
                    onConfigChange={handleConfigNodeChange}
                    onGenerate={handleGenerateNode}
                    onRemoveReference={handleRemoveNodeReference}
                    onReorderReferences={handleReorderNodeReferences}
                    onReplaceReference={handleReplaceNodeReference}
                    onReplaceReferenceFiles={handleReplaceNodeReferenceFiles}
                    onClose={() => setDialogNodeId(null)}
                    onNodeMouseDown={handleNodeMouseDown}
                    workspaceMode={workspaceMode}
                    onImageSettingsOpenChange={(open) => {
                        setNodeImageSettingsOpen(open);
                        if (open) setToolbarNodeId(null);
                    }}
                />
            );
        },
        [
            configInputsById,
            handleConfigNodeChange,
            handleGenerateNode,
            handleNodePromptChange,
            handleRemoveNodeReference,
            handleReorderNodeReferences,
            handleReplaceNodeReference,
            handleReplaceNodeReferenceFiles,
            mentionReferencesByNodeId,
            message,
            projectId,
            runningNodeId,
            skillMentionReferences,
            workspaceMode,
        ],
    );

    const renderCanvasNodeContent = useCallback(
        (contentNode: CanvasNodeData) => {
            return (
                <CanvasConfigNodePanel
                    node={contentNode}
                    isRunning={isCanvasNodeGenerating(contentNode, runningNodeId)}
                    inputSummary={getInputSummary(configInputsById.get(contentNode.id) || [])}
                    onConfigChange={handleConfigNodeChange}
                    onComposerToggle={() => setDialogNodeId((current) => (current === contentNode.id ? null : contentNode.id))}
                    onGenerate={(nodeId) => {
                        const target = nodesRef.current.find((item) => item.id === nodeId);
                        void handleGenerateNode(nodeId, target?.metadata?.generationMode || "image", target?.metadata?.composerContent ?? target?.metadata?.prompt ?? "");
                    }}
                    workspaceMode={workspaceMode}
                />
            );
        },
        [
            configInputsById, handleConfigNodeChange, handleGenerateNode, runningNodeId, workspaceMode,
        ],
    );

    const retryCanvasNode = useCallback(
        (node: CanvasNodeData) => {
            const plan = canvasNodeRetryPlan(node, nodesRef.current);
            if (plan.kind === "image-batch-empty") {
                message.info("当前批次没有需要重试的失败图片");
                return;
            }
            if (plan.kind === "image-batch-root") {
                message.info(`正在重试 ${plan.children.length} 个失败图片`);
                retryImageBatchChildren(node.id, plan.children);
                return;
            }
            if (plan.kind === "image-batch-child") {
                void handleRetryNode(node).finally(() => reconcileImageBatchRootNode(plan.rootId));
                return;
            }
            void handleRetryNode(node);
        },
        [handleRetryNode, message, nodesRef, reconcileImageBatchRootNode, retryImageBatchChildren],
    );

    // 改动卡片的「在画布上查看」：选中这些节点并把视野带过去，再点亮一下。
    const locateAssistantNodes = useCallback(
        (nodeIds: string[]) => {
            const available = new Set(nodesRef.current.map((node) => node.id));
            const targets = nodeIds.filter((id) => available.has(id));
            if (!targets.length) {
                message.info("这些节点已经不在画布上了");
                return;
            }
            const selection = new Set(targets);
            selectedNodeIdsRef.current = selection;
            setSelectedNodeIds(selection);
            setSelectedConnectionId(null);
            fitCanvasSelection();
            highlightAssistantNodes(containerRef.current, targets);
        },
        [fitCanvasSelection, message, nodesRef, selectedNodeIdsRef, setSelectedConnectionId, setSelectedNodeIds],
    );

    const openCanvasNodeTaskDetails = useCallback(
        (node: CanvasNodeData) => {
            void openNodeTaskDetails(node);
        },
        [openNodeTaskDetails],
    );
    const activeTasksRef = useRef(activeTasks);
    activeTasksRef.current = activeTasks;
    const handleCancelNodeTask = useCallback(
        async (node: CanvasNodeData) => {
            const taskId = node.metadata?.taskId;
            if (!taskId) return;
            const scope = captureUserScope();
            try {
                const task = activeTasksRef.current.find((item) => item.id === taskId) ?? (await queryGenerationTask(taskId));
                assertUserScope(scope);
                cancelCanvasTask(task);
            } catch (error) {
                message.error(error instanceof Error ? error.message : "读取任务失败");
            }
        },
        [cancelCanvasTask, message],
    );
    // 结果已在服务端生成、只是上次取回落空时，继续取回原任务，不重新生成。
    const reloadCanvasNodeResource = useCallback(
        async (node: CanvasNodeData) => {
            const taskId = node.metadata?.taskId;
            if (!taskId) return;
            const scope = captureUserScope();
            try {
                const task = await queryGenerationTask(taskId);
                assertUserScope(scope);
                if (task.status !== "succeeded") {
                    message.info("原任务仍在处理中，请稍后再取回结果");
                    return;
                }
                await applyGenerationTaskResult(node.id, task);
                assertUserScope(scope);
                message.success("生成结果已取回并放回画布");
            } catch (error) {
                message.error(error instanceof Error ? error.message : "暂时无法取回结果，请稍后再试");
            }
        },
        [applyGenerationTaskResult, message],
    );
    const handleConnectionSelect = useCallback(
        (connectionId: string) => {
            setSelectedConnectionId(connectionId);
            selectedNodeIdsRef.current = new Set();
            setSelectedNodeIds(new Set());
            setContextMenu(null);
        },
        [selectedNodeIdsRef, setContextMenu, setSelectedConnectionId, setSelectedNodeIds],
    );
    const handleConnectionContextMenu = useCallback(
        (event: ReactMouseEvent<SVGPathElement>, connectionId: string) => {
            setSelectedConnectionId(connectionId);
            selectedNodeIdsRef.current = new Set();
            setSelectedNodeIds(new Set());
            closeConnectionCreateMenu();
            setContextMenu({ type: "connection", x: event.clientX, y: event.clientY, connectionId });
        },
        [closeConnectionCreateMenu, selectedNodeIdsRef, setContextMenu, setSelectedConnectionId, setSelectedNodeIds],
    );
    const handleCancelImageCrop = useCallback(() => setCropNodeId(null), [setCropNodeId]);
    const handleConfirmImageCrop = useCallback((node: CanvasNodeData, crop: Parameters<typeof cropImageNode>[1]) => cropImageNode(node, crop), [cropImageNode]);
    const handleCancelMaskEdit = useCallback(() => setMaskEditNodeId(null), [setMaskEditNodeId]);
    const handleConfirmMaskEdit = useCallback((node: CanvasNodeData, payload: Parameters<typeof maskEditImageNode>[1]) => maskEditImageNode(node, payload), [maskEditImageNode]);
    const handleCancelAnnotation = useCallback(() => setAnnotationNodeId(null), [setAnnotationNodeId]);
    const handleConfirmAnnotation = useCallback(
        async (node: CanvasNodeData, dataUrl: string) => {
            await saveAnnotatedImageNode(node, dataUrl);
            setAnnotationNodeId(null);
        },
        [saveAnnotatedImageNode, setAnnotationNodeId],
    );
    const handleFrameToggle = useCallback((nodeId: string) => toggleFrameCollapsed(nodeId), [toggleFrameCollapsed]);
    const openCanvasNodeVersions = useCallback((node: CanvasNodeData) => setVersionCompareRootId(node.metadata?.versionOfNodeId || node.id), []);
    const viewCanvasNodeImage = useCallback((node: CanvasNodeData) => setPreviewNodeId(node.id), []);
    const freeformCreateCommands = useCanvasCreateCommands({
        workspaceMode,
        isProjectLinked: false,
        handlers: {
            onAddText: () => createNode(CanvasNodeType.Text),
            onAddImage: () => createNode(CanvasNodeType.Image),
            onAddFrame: () => createNode(CanvasNodeType.Frame),
            onUpload: () => handleUploadRequest(),
            onOpenMyAssets: () => openAssetsAtPosition(),
            onOpenGenerationHistory: () => setGenerationHistoryOpen(true),
            onAskAssistant: openAssistant,
        },
    });
    const emptyCanvasState = nodes.length === 0 ? (
        <div data-canvas-no-zoom className="absolute inset-0 flex flex-col items-center justify-center gap-4 px-6">
            <h1 className="text-lg font-semibold">生图与 Agent 画布</h1>
            <p className="text-sm opacity-60">添加图片或生图节点，也可以让 Agent 帮你创作。</p>
            <CanvasCreateMenu commands={freeformCreateCommands} />
            <Button onClick={openAssistant}>打开 Agent</Button>
        </div>
    ) : null;
    if (!projectLoaded && loadError)
        return (
            <main className="flex h-full flex-col items-center justify-center gap-4">
                <p role="alert">{loadError}</p>
                <Button onClick={retryLoad}>重新加载</Button>
                <Link to="/canvas">返回画布库</Link>
            </main>
        );
    if (!projectLoaded) return <CanvasRefreshShell />;

    return (
        <>
            {deletingCanvas ? <CanvasDeleteConfirmation scope={deletingCanvas.scope} title="删除画布？"
                description={`将删除「${canvasProjects.find((canvas) => canvas.id === deletingCanvas.id)?.title || "该画布"}」，里面的节点和连线也会一起移除。`}
                onCancel={() => setDeletingCanvas(null)} onConfirm={async (assertCurrent) => {
                    if (deletingCanvas.id === projectId) await deleteCurrentProject();
                    else await deleteWorkspaceCanvasProjects([deletingCanvas.id]);
                    assertCurrent();
                    message.success("画布已删除");
                }} /> : null}
            <a
                href="#canvas-main"
                onClick={(event) => {
                    event.preventDefault();
                    canvasMainRef.current?.focus();
                }}
                className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-[var(--z-toast)] focus:rounded-md focus:border focus:bg-background focus:px-4 focus:py-2 focus:text-sm focus:font-medium focus:shadow-lg"
            >
                跳转到画布主内容
            </a>
            <main ref={canvasMainRef} id="canvas-main" data-canvas-readonly={readOnly ? "true" : "false"} tabIndex={-1} className="flex h-full min-h-0 overflow-hidden outline-none" style={{ background: resolvedCanvasAppearance.background, color: theme.node.text }}>
                <CanvasOverlayLayerProvider>
                    <div className="canvas-editor-shell relative flex min-w-0 flex-1" data-canvas-editor-panel-open={dialogNode || textEditorNodeId ? "true" : "false"} data-canvas-toolbar-node={toolbarNode?.id || undefined}>
                    <section data-canvas-editor inert={Boolean(versions.preview)} style={{ visibility: versions.preview ? "hidden" : undefined, opacity: versions.preview ? 0 : undefined }} className="relative min-w-0 flex-1 flex flex-col min-h-0 overflow-hidden">
                        {!focusMode ? (
                            <CanvasTopBar
                                syncStatus={<CanvasSyncStatus projectId={projectId} onLoadLatest={reloadLatestCanvasProject} onOpenVersions={openVersions} />}
                                readOnly={readOnly}
                                onDuplicateProject={duplicateCurrentProject}
                                versionsOpen={versions.open}
                                onToggleVersions={toggleVersions}
                                assistantOpen={rightPanel === "assistant"}
                                onToggleAssistant={toggleAssistant}
                                // 画布首屏对空标题统一显示“未命名画布”；
                                // 项目库的默认名可能是旧文案，因此只在画布顶栏做显示层映射。
                                title={!workspaceProject?.title || workspaceProject.title === "未命名项目" || workspaceProject.title === "未命名画布" ? "未命名画布" : workspaceProject.title}
                                titleDraft={titleDraft}
                                isTitleEditing={titleEditing}
                                onTitleDraftChange={setTitleDraft}
                                onStartTitleEditing={startTitleEditing}
                                onFinishTitleEditing={finishTitleEditing}
                                onCancelTitleEditing={() => setTitleEditing(false)}
                                canUndo={historyState.canUndo}
                                canRedo={historyState.canRedo}
                                onCreateCanvas={createAndOpenCanvas}
                                projectCanvases={canvasProjects}
                                currentCanvasId={projectId}
                                onSwitchCanvas={(id) => navigate(`/canvas/${id}`)}
                                onOpenCanvasInNewWindow={openCanvasInNewWindow}
                                onRenameCanvas={renameCanvasFromMenu}
                                onDuplicateCanvas={duplicateCanvasFromMenu}
                                onDeleteCanvas={deleteCanvasFromMenu}
                                onDeleteProject={() => deleteCanvasFromMenu(projectId)}
                                onSave={() => void saveCanvasProject()}
                                onForceSave={confirmForceSaveCanvas}
                                localOnly={localOnly}
                                onImportImage={() => handleUploadRequest()}
                                onUndo={undoCanvas}
                                onRedo={redoCanvas}
                                mediaPerformanceMode={mediaPerformanceMode}
                                onMediaPerformanceModeChange={setMediaPerformanceMode}
                                onOpenSearch={() => setNodeSearchOpen(true)}
                                onEnterFocusMode={enterFocusMode}
                            />
                        ) : null}

                        <div className="relative flex min-h-0 min-w-0 flex-1">
                            <div className="relative min-w-0 flex-1 overflow-hidden">
                                <InfiniteCanvas
                                    interactive={!versions.preview && !readOnly}
                                    containerRef={containerRef}
                                    viewport={viewport}
                                    appearance={canvasAppearance}
                                    backgroundMode={backgroundMode}
                                    graphicsLayer={
                                        <CanvasLeaferGraphicsLayer
                                            containerRef={containerRef}
                                            viewport={viewport}
                                            theme={theme}
                                            connectingParams={connectingParams}
                                            batchConnectionPreview={batchConnectionPreview}
                                            mouseWorld={mouseWorld}
                                            connectionTargetNodeId={connectionTargetNodeId}
                                            connectionTargetAnchorRatio={connectionTargetAnchorRatio}
                                            nodeById={nodeById}
                                            selectionBox={selectionBox}
                                            selectedNodeBounds={selectedNodeBounds}
                                            alignmentGuides={alignmentGuides}
                                        />
                                    }
                                    onViewportChange={handleViewportChange}
                                    onViewportPreviewChange={handleViewportPreviewChange}
                                    onCanvasMouseDown={handleCanvasMouseDown}
                                    boxSelectEnabled={canvasTool === "box-select"}
                                    onCanvasDoubleClick={handleCanvasDoubleClick}
                                    onCanvasDeselect={deselectCanvas}
                                    onContextMenu={handleCanvasContextMenu}
                                    onDrop={handleDrop}
                                    onFileDragEnter={handleFileDragEnter}
                                    onFileDragLeave={handleFileDragLeave}
                                    onFileDragOver={handleFileDragOver}
                                >
                                    <CanvasNodeActionContext.Provider value={canvasNodeActions}>
                                        <CanvasNodeGraphContext.Provider value={nodeGraphContext}>
                                            <CanvasProjectWorldLayers
                                                containerRef={containerRef}
                                                connectionApproach={connectionApproach}
                                                projectId={projectId}
                                                viewportScale={viewport.k}
                                                connectionLayerBounds={connectionLayerBounds}
                                                displayConnections={renderedConnections}
                                                selectedConnectionId={selectedConnectionId}
                                                relatedConnectionIds={relatedHighlight.connectionIds}
                                                connectingParams={connectingParams}
                                                mouseWorld={mouseWorld}
                                                connectionTargetNodeId={connectionTargetNodeId}
                                                nodeById={nodeById}
                                                visibleNodes={visibleNodes}
                                                nodeStackOrder={nodeStackOrder}
                                                frameChildrenById={frameChildrenById}
                                                dragPreview={dragPreview}
                                                selectedNodeIds={selectedNodeIds}
                                                frameDropTargetId={frameDropTargetId}
                                                relatedNodeIds={relatedHighlight.nodeIds}
                                                activeNodeId={activeNodeId}
                                                selectionBox={selectionBox}
                                                batchChildCountById={batchChildCountById}
                                                collapsingBatchIds={collapsingBatchIds}
                                                openingBatchIds={openingBatchIds}
                                                batchMotionById={batchMotionById}
                                                showImageInfo={showImageInfo}
                                                reduceMediaEffects={reduceMediaEffects}
                                                resourceReferenceByNodeId={resourceReferenceByNodeId}
                                                mentionReferencesByNodeId={mentionReferencesByNodeId}
                                                selectedNodeBounds={selectedNodeBounds}
                                                batchSourceNodeIds={batchSourceNodeIds}
                                                batchConnectionPreview={batchConnectionPreview}
                                                selectionBoundsElementRef={selectionBoundsElementRef}
                                                renderCanvasNodeContent={renderCanvasNodeContent}
                                                onConnectionSelect={handleConnectionSelect}
                                                onConnectionContextMenu={handleConnectionContextMenu}
                                                onNodeMouseDown={handleNodeMouseDown}
                                                onNodeHoverStart={handleCanvasNodeHoverStart}
                                                onNodeHoverEnd={handleCanvasNodeHoverEnd}
                                                onConnectStart={handleConnectStart}
                                                onNodeResize={handleNodeResize}
                                                onToggleFrame={handleFrameToggle}
                                                onFolderStyleChange={handleFolderStyleChange}
                                                onFolderThemeChange={handleFolderThemeChange}
                                                onNodeTitleChange={handleNodeTitleChange}
                                                onNodeContextMenu={handleNodeContextMenu}
                                                onNodeContentChange={handleNodeContentChange}
                                                onToggleBatch={toggleBatchExpanded}
                                                onSetBatchPrimary={setBatchPrimary}
                                                onRetry={retryCanvasNode}
                                                onReloadResource={reloadCanvasNodeResource}
                                                onOpenTaskDetails={openCanvasNodeTaskDetails}
                                                onCancelTask={handleCancelNodeTask}
                                                onOpenVersions={openCanvasNodeVersions}
                                                onViewImage={viewCanvasNodeImage}
                                                onReplaceMedia={replaceCanvasNodeMedia}
                                                onOpenTextEditor={openTextNodeEditor}
                                                onStartBatchConnection={startBatchConnection}
                                                imageCropNodeId={cropNodeId}
                                                onCancelImageCrop={handleCancelImageCrop}
                                                onConfirmImageCrop={handleConfirmImageCrop}
                                                annotationNodeId={annotationNodeId}
                                                onCancelAnnotation={handleCancelAnnotation}
                                                onConfirmAnnotation={handleConfirmAnnotation}
                                                maskEditConfig={maskEditNode ? { ...effectiveConfig, model: maskEditNode.metadata?.model || effectiveConfig.model, imageModel: maskEditNode.metadata?.model || effectiveConfig.imageModel, size: maskEditNode.metadata?.size || effectiveConfig.size, quality: maskEditNode.metadata?.quality || effectiveConfig.quality, count: String(maskEditNode.metadata?.count || effectiveConfig.count) } : effectiveConfig}
                                                onCancelMaskEdit={handleCancelMaskEdit}
                                                onConfirmMaskEdit={handleConfirmMaskEdit}
                                            />
                                        </CanvasNodeGraphContext.Provider>
                                    </CanvasNodeActionContext.Provider>
                                </InfiniteCanvas>

                                <CanvasActiveTaskPanel tasks={activeTasks} onCancelTask={cancelCanvasTask} topInset={focusMode ? "var(--space-3)" : "var(--canvas-topbar-offset)"} />

                                {focusMode ? (
                                    <CanvasFocusModeBar
                                        syncStatus={<CanvasSyncStatus projectId={projectId} onLoadLatest={reloadLatestCanvasProject} onOpenVersions={openVersions} />}
                                        versionsOpen={versions.open}
                                        onToggleVersions={toggleVersions}
                                        dockRevealed={focusDockRevealed}
                                        zoomPercent={viewport.k}
                                        onToggleDock={() => setFocusDockRevealed((value) => !value)}
                                        onExit={exitFocusMode}
                                        onZoomIn={zoomCanvasIn}
                                        onZoomOut={zoomCanvasOut}
                                        onFit={fitCanvasContent}
                                    />
                                ) : null}

                                <CanvasFileDropOverlay active={fileDropActive} theme={theme} />

                                {!readOnly ? emptyCanvasState : null}

                                {!readOnly && (!focusMode || focusDockRevealed) ? (
                                    <CanvasToolbar
                                        selectedCount={selectedNodeIds.size}
                                        libtvChrome={searchParams.get("libtvChrome") === "1"}
                                        workspaceMode={workspaceMode}
                                        canvasTool={canvasTool}
                                        onToolChange={setCanvasTool}
                                        isProjectLinked={false}
                                        canUndo={historyState.canUndo}
                                        canRedo={historyState.canRedo}
                                        appearance={canvasAppearance}
                                        backgroundMode={backgroundMode}
                                        showImageInfo={showImageInfo}
                                        onAddImage={() => createNode(CanvasNodeType.Image)}
                                        onAddText={() => createNode(CanvasNodeType.Text)}
                                        onAddFrame={() => createNode(CanvasNodeType.Frame)}
                                        onUndo={undoCanvas}
                                        onRedo={redoCanvas}
                                        onUpload={() => handleUploadRequest()}
                                        onDelete={() => deleteNodes(new Set(selectedNodeIds))}
                                        onClear={() => setClearConfirmOpen(true)}
                                        onDeselect={deselectCanvas}
                                        onAppearanceChange={applyCanvasAppearance}
                                        onSaveAppearanceDefault={saveCanvasAppearanceDefault}
                                        onBackgroundModeChange={setBackgroundMode}
                                        snapToGrid={snapToGrid}
                                        onSnapToGridChange={(enabled) => {
                                            setSnapToGrid(enabled);
                                            scopedLocalStorage.setItem("canvas:snap-to-grid", enabled ? "1" : "0");
                                        }}
                                        showConnections={showConnections}
                                        onShowConnectionsChange={(visible) => {
                                            setShowConnections(visible);
                                            scopedLocalStorage.setItem("canvas:show-connections", visible ? "1" : "0");
                                        }}
                                        onShowImageInfoChange={setShowImageInfo}
                                        onOpenMyAssets={() => {
                                            openAssetsAtPosition();
                                        }}
                                        onOpenGenerationHistory={() => setGenerationHistoryOpen(true)}
                                        shortcutRequestNonce={shortcutRequestNonce}
                                    />
                                ) : null}
                            </div>

                        </div>

                        {angleNode?.metadata?.content ? (
                            <CanvasNodePanelOverlay
                                node={angleNode}
                                viewport={viewport}
                                containerRef={containerRef}
                                panelWidth={640}
                                panelHeight={540}
                                allowOverflow
                                dragOffset={dragPreview?.nodeIds.has(angleNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                                isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(angleNode.id))}
                            >
                                <CanvasNodeAnglePanel
                                    dataUrl={angleNode.metadata.content}
                                    onClose={() => setAngleNodeId(null)}
                                    onConfirm={(params) => {
                                        void generateAngleNode(angleNode, params);
                                    }}
                                />
                            </CanvasNodePanelOverlay>
                        ) : null}

                        {lightingNode?.metadata?.content ? (
                            <AppModal flush open centered title={null} closable={false} footer={null} width={720} onCancel={() => setLightingNodeId(null)}>
                                <CanvasNodeLightingPanel
                                    dataUrl={lightingNode.metadata.content}
                                    onClose={() => setLightingNodeId(null)}
                                    onConfirm={(options, prompt) => {
                                        generateLightingNode(lightingNode, options, prompt);
                                    }}
                                />
                            </AppModal>
                        ) : null}

                        {dialogNode &&
                        !maskEditNodeId &&
                        !isCanvasImageSourceNode(dialogNode) &&
                        !dialogNode.metadata?.fileUpload &&
                        !selectionBox &&
                        !isCanvasNodeMoving ? (
                            <CanvasNodePanelOverlay
                                node={dialogNode}
                                viewport={viewport}
                                containerRef={containerRef}
                                panelHeight={dialogNode.type === CanvasNodeType.Text ? 148 : undefined}
                                allowOverflow={dialogNode.type !== CanvasNodeType.Config}
                                // Media composers follow the LibTV layout: keep the prompt
                                // panel attached below the node instead of flipping above it
                                // when the node is near the bottom of the canvas.
                                keepBelowNode={dialogNode.type === CanvasNodeType.Image}
                                dragOffset={dragPreview?.nodeIds.has(dialogNode.id) ? { x: dragPreview.x, y: dragPreview.y } : null}
                                isDragging={isNodeDragging && Boolean(dragPreview?.nodeIds.has(dialogNode.id))}
                            >
                                {renderCanvasNodePanel(dialogNode)}
                            </CanvasNodePanelOverlay>
                        ) : null}

                        {pendingConnectionCreate ? (
                            <CanvasConnectionCreateMenu
                                pending={pendingConnectionCreate}
                                viewport={viewport}
                                viewportSize={size}
                                containerRef={containerRef}
                                getDisabledReason={(type) => getConnectionCreateDisabledReason(type, pendingConnectionCreate)}
                                onCreate={(type) => void createConnectedNode(type, pendingConnectionCreate)}
                                onClose={cancelPendingConnectionCreate}
                            />
                        ) : null}

                        {connectionReplaceHover ? (
                            <div
                                className="pointer-events-none fixed z-[var(--z-dialog-popover)] flex select-none items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[11px] font-medium text-white/90 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all"
                                style={{
                                    left: connectionReplaceHover.clientX + 14,
                                    top: connectionReplaceHover.clientY + 14,
                                    transform: "translateY(-50%)",
                                }}
                            >
                                <ArrowLeftRight className="size-3 text-blue-400" />
                                <span>松开替换</span>
                                <span className="rounded bg-white/15 px-1.5 py-0.5 text-[10px] font-semibold text-blue-200">@{connectionReplaceHover.referenceLabel}</span>
                            </div>
                        ) : null}

                        {selectedNodeBounds && !selectionBox && !isCanvasNodeMoving ? (
                            <CanvasProjectSelectionToolbar
                                anchorRef={selectionBoundsElementRef}
                                containerRef={containerRef}
                                count={selectedNodeBounds.count}
                                onAlign={alignSelectedNodes}
                                onArrange={arrangeSelectedNodes}
                                onCreateReferenceGroup={createReferenceGroup}
                                onBatchConnect={() => beginBatchConnectionMode(Array.from(selectedNodeIds))}
                                onAskAssistant={openAssistant}
                            />
                        ) : null}

                        <CanvasNodeToolbar
                            node={isCanvasNodeMoving || nodeImageSettingsOpen || annotationNodeId || maskEditNodeId || angleNodeId || (dialogNode && !isCanvasMediaResultNode(dialogNode)) || textEditorNodeId ? null : toolbarNode}
                            workspaceMode={workspaceMode}
                            viewport={viewport}
                            containerRef={containerRef}
                            onKeep={keepNodeToolbar}
                            onLeave={hideNodeToolbar}
                            onInfo={(node) => setInfoNodeId(node.id)}
                            onEditText={openTextNodeEditor}
                            onDecreaseFont={(node) => handleFontSizeChange(node.id, Math.max(10, (node.metadata?.fontSize || 14) - 2))}
                            onIncreaseFont={(node) => handleFontSizeChange(node.id, Math.min(32, (node.metadata?.fontSize || 14) + 2))}
                            onToggleDialog={(node) => setDialogNodeId((current) => (current === node.id ? null : node.id))}
                            onDuplicate={(node) => duplicateNode(node.id)}
                            onGenerateImage={generateImageFromTextNode}
                            onUpload={(node) => handleUploadRequest(node.id)}
                            onDownload={downloadNodeImage}
                            onSaveAsset={(node) => void saveNodeAsset(node)}
                            onAnnotate={(node) => setAnnotationNodeId(node.id)}
                            onPortraitTexture={openPortraitTextureEditor}
                            onMaskEdit={(node) => {
                                setDialogNodeId(null);
                                setMaskEditNodeId(node.id);
                            }}
                            onCrop={(node) => setCropNodeId(node.id)}
                            onSplit={(node, params) => void splitImageNode(node, params)}
                            onUpscale={(node) => setUpscaleNodeId(node.id)}
                            onAngle={(node) => {
                                setDialogNodeId(null);
                                setAngleNodeId((current) => (current === node.id ? null : node.id));
                            }}
                            onLighting={(node) => {
                                setDialogNodeId(null);
                                setLightingNodeId((current) => (current === node.id ? null : node.id));
                            }}
                            onViewImage={(node) => setPreviewNodeId(node.id)}
                            onReversePrompt={createImageReversePromptNodes}
                            onRetry={retryCanvasNode}
                            onToggleFreeResize={(node) => toggleNodeFreeResize(node.id)}
                            onToggleLocked={(node) => toggleNodeLocked(node.id)}
                            onDelete={(node) => deleteNodes(new Set([node.id]))}
                        />

{isMiniMapOpen && !focusMode ? <Minimap nodes={nodes} viewport={viewport} viewportSize={size} canvasContainerRef={containerRef} onViewportPreviewChange={previewViewport} onViewportChange={handleViewportChange} /> : null}

                        {!focusMode ? (
                            <CanvasOverlayLayerContainer
                                overlayId="asset-tray"
                                fallbackZIndex="var(--z-panel)"
                                className={`canvas-libtv-overlay-toolbar absolute bottom-[calc(var(--canvas-inset-y)+var(--space-16))] left-[var(--canvas-inset-x)] flex items-end gap-2 lg:bottom-[var(--canvas-inset-y)] ${searchParams.get("fixture") === "libtv-readonly-dense" ? "canvas-libtv-readonly-dock" : ""}`}
                                onMouseDown={(event) => event.stopPropagation()}
                                onPointerDown={(event) => event.stopPropagation()}
                                onWheel={(event) => event.stopPropagation()}
                            >
                                <CanvasAssetTray
                                    libraryAssets={assets.filter((asset): asset is Extract<typeof asset, { kind: "image" }> => asset.kind === "image")}
                                    canvasImages={canvasImageNodes}
                                    showLibrary={!currentProject?.projectId}
                                    activeNodeId={selectedNodeIds.size === 1 ? Array.from(selectedNodeIds)[0] : null}
                                    onInsertAsset={(asset) => void handleAssetsInsert([localAssetToInsertPayload(asset)], canvasCapturedScope)}
                                    onFocusCanvasImage={focusCanvasImageNode}
                                />
                                <CanvasZoomControls
                                    scale={viewport.k}
                                    libtvChrome={searchParams.get("libtvChrome") === "1"}
                                    containerRef={containerRef}
                                    onScaleChange={setZoomScale}
                                    onFitContent={fitCanvasContent}
                                    onAutoArrange={autoArrangeCanvasNodes}
                                    snapToGrid={snapToGrid}
                                    onSnapToGridChange={(enabled) => {
                                        setSnapToGrid(enabled);
                                        scopedLocalStorage.setItem("canvas:snap-to-grid", enabled ? "1" : "0");
                                    }}
                                    showConnections={showConnections}
                                    onToggleConnections={() => setShowConnections((value) => {
                                        const next = !value;
                                        scopedLocalStorage.setItem("canvas:show-connections", next ? "1" : "0");
                                        return next;
                                    })}
                                    isMiniMapOpen={isMiniMapOpen}
                                    onToggleMiniMap={() => setIsMiniMapOpen((value) => {
                                        const next = !value;
                                        scopedLocalStorage.setItem("canvas:minimap", next ? "1" : "0");
                                        return next;
                                    })}
                                />
                            </CanvasOverlayLayerContainer>
                        ) : null}

                        <CanvasProjectContextMenu
                            menu={contextMenu}
                            node={contextMenuNode}
                            workspaceMode={workspaceMode}
                            isProjectLinked={Boolean(currentProject?.projectId)}
                            canUndo={historyState.canUndo}
                            canRedo={historyState.canRedo}
                            canPaste={hasCopiedNodes || Boolean(navigator.clipboard)}
                            selectedCount={selectedNodeIds.size}
                            screenToCanvas={screenToCanvas}
                            onClose={() => setContextMenu(null)}
                            onAddNode={(type, position) => createNode(type, position)}
                            onAddFolder={createFolder}
                            onUpload={(nodeId, position) => handleUploadRequest(nodeId, position)}
                            onOpenAssets={openAssetsAtPosition}
                            onOpenGenerationHistory={() => setGenerationHistoryOpen(true)}
                            onUndo={undoCanvas}
                            onRedo={redoCanvas}
                            onPaste={pasteAtPosition}
                            onCopyNode={(nodeId) => copyNodesToClipboard(new Set([nodeId]))}
                            onDuplicate={duplicateNode}
                            onDeleteNode={(nodeId) => deleteNodes(new Set([nodeId]))}
                            onDeleteConnection={deleteConnection}
                            onSaveAsset={(node) => {
                                void saveNodeAsset(node);
                            }}
                            onViewMedia={(node) => setPreviewNodeId(node.id)}
                            onEditText={openTextNodeEditor}
                            onGenerateImage={generateImageFromTextNode}
                            onCopyContent={(node) => {
                                void copyNodeContentToClipboard(node);
                            }}
                            onSetAssetCategory={(nodeId, assetCategory) => handleConfigNodeChange(nodeId, { assetCategory })}
                            onToggleFrame={(node) => handleFrameToggle(node.id)}
                            onSpreadSelection={spreadSelectedNodes}
                            onCopySelection={copySelectedNodes}
                            onDeleteSelection={() => deleteNodes(selectedNodeIds)}
                        />

                        <CanvasUploadModal open={uploadModalOpen} onClose={closeUploadModal} onUpload={handleUploadFiles} onImportUrl={handleImportUrl} />
                        <input ref={imageInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleImageInputChange} />

                        <CanvasProjectEditorDialogs
                            projectId={projectId}
                            theme={theme}
                            config={effectiveConfig}
                            nodes={nodes}
                            search={{
                                open: nodeSearchOpen,
                                onClose: () => setNodeSearchOpen(false),
                                onFocus: (nodeId) => {
                                    const target = nodeById.get(nodeId);
                                    const parent = target?.parentId ? nodeById.get(target.parentId) : null;
                                    if (parent?.metadata?.frame?.collapsed) toggleFrameCollapsed(parent.id);
                                    const batchRoot = target?.metadata?.batchRootId ? nodeById.get(target.metadata.batchRootId) : null;
                                    if (batchRoot && !batchRoot.metadata?.imageBatchExpanded) toggleBatchExpanded(batchRoot.id);
                                    const selection = new Set([nodeId]);
                                    selectedNodeIdsRef.current = selection;
                                    setSelectedNodeIds(selection);
                                    setSelectedConnectionId(null);
                                    focusCanvasNode(nodeId);
                                },
                            }}
                            generationHistory={{
                                open: generationHistoryOpen,
                                onClose: () => setGenerationHistoryOpen(false),
                                onSelect: (task) => void insertGenerationHistoryTask(task),
                            }}
                            info={{
                                node: infoNode,
                                onClose: () => setInfoNodeId(null),
                                onMetadataChange: handleConfigNodeChange,
                            }}
                            text={{
                                node: textEditorNode,
                                onClose: () => setTextEditorNodeId(null),
                                onSave: (nodeId, title, content, richText) => {
                                    setNodes((current) => current.map((node) => (node.id === nodeId ? { ...node, title, metadata: { ...node.metadata, content, richText } } : node)));
                                },
                            }}
                            versionCompare={{
                                open: Boolean(versionCompareRootId),
                                versions: versionCompareNodes,
                                onClose: () => setVersionCompareRootId(null),
                                onSetPrimary: setPrimaryVersion,
                                onFocus: (nodeId) => {
                                    setVersionCompareRootId(null);
                                    focusCanvasNode(nodeId);
                                },
                            }}
                            media={{
                                upscaleNode,
                                onCloseUpscale: () => setUpscaleNodeId(null),
                                onUpscale: (node, params) => void upscaleImageNode(node, params),
                            }}
                            status={{
                                task: taskDetail,
                                taskLogs: taskDetailLogs,
                                taskLoading: taskDetailLoading,
                                taskError: taskDetailError,
                                onCloseTask: () => setTaskDetail(null),
                                onCancelTask: cancelCanvasTask,
                                previewNode,
                                onClosePreview: () => setPreviewNodeId(null),
                                clearConfirmOpen,
                                onCancelClear: () => setClearConfirmOpen(false),
                                onConfirmClear: clearCanvas,
                            }}
                            assets={{
                                pickerOpen: assetPickerOpen,
                                multiple: true,
                                onInsertLibrary: async (payloads, expectedScope) => {
                                    await handleAssetsInsert(payloads, expectedScope);
                                },
                                onClosePicker: closeAssetPicker,
                            }}
                        />
                    </section>
                    {versions.preview ? <CanvasVersionPreview key={versions.preview.key} preview={versions.preview} busy={versions.restoring || versions.confirming} onReturn={versions.returnToCurrent} onShowVersions={versions.show} /> : null}
                    </div>
                </CanvasOverlayLayerProvider>
                {rightPanel === "assistant" && !focusMode && !versions.preview ? (
                    <CanvasAssistantSidebar
                        proposalFeedback={assistantProposalFeedback}
                        runningProposalIds={runningProposalIds}
                        assistant={assistant}
                        canvasTitle={!workspaceProject?.title || workspaceProject.title === "未命名项目" || workspaceProject.title === "未命名画布" ? "未命名画布" : workspaceProject.title}
                        dockable={assistantDockable}
                        readOnly={readOnly}
                        selectedNodeIds={assistantSelectedNodeIds}
                        references={assistantMentionReferences}
                        onLocateNodes={locateAssistantNodes}
                        onRunProposal={runAssistantProposal}
                        onOpenModelSettings={() => navigate("/settings?section=channels")}
                    />
                ) : null}
                <CanvasVersionHistory history={versions} />
            </main>
        </>
    );
}
