import { Button, Input, InputNumber, Segmented, Select, Slider } from "antd";
import { Tooltip } from "@/components/ui/base/tooltip";
import { useEffect, useState, type CSSProperties, type ReactNode } from "react";
import { ChevronDown, Dice5, Image as ImageIcon, LoaderCircle, MessageSquare, Play, Sparkles, Workflow as WorkflowIcon } from "lucide-react";

import { Switch } from "@/components/ui/base/switch";
import {
    useEffectiveConfig,
    type RunningHubWorkflow,
    type RunningHubWorkflowKind,
} from "@/stores/use-config-store";
import { canvasThemes } from "@/lib/canvas-theme";
import {
    workflowFieldChoiceValues,
    workflowFieldCurrentValue,
    workflowFieldKey,
    workflowFieldNumberBounds,
    workflowFieldRandomKey,
    workflowFieldSubmissionValue,
    workflowFieldValueError,
    workflowFieldsFromJson,
    workflowParameterFields,
    type WorkflowFieldLike,
} from "@/lib/model-capabilities";
import type { ModelRequirements } from "@/lib/model-selection";
import { resolveCanvasWorkflowProvider } from "@/lib/canvas/canvas-workflow";
import { buildGenerationConfig } from "@/lib/canvas/canvas-project-generation";
import { useActiveTheme } from "@/stores/canvas/use-canvas-theme-store";
import { workflowProviderPluginEnabled } from "@/lib/plugins/builtin/workflows";
import { usePluginStore } from "@/stores/use-plugin-store";
import type { CanvasNodeData, CanvasNodeMetadata, CanvasWorkspaceMode } from "@/types/canvas";

type CanvasConfigNodePanelProps = {
    node: CanvasNodeData;
    isRunning: boolean;
    inputSummary: { textCount: number; imageCount: number };
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    onGenerate: (nodeId: string) => void;
    onComposerToggle: () => void;
    workspaceMode?: CanvasWorkspaceMode;
};

type WorkflowSelectOption = {
    label: ReactNode;
    value?: string;
    workflowId?: string;
    kind?: RunningHubWorkflowKind;
    title?: string;
    options?: WorkflowSelectOption[];
};

function runningHubWorkflowKind(workflow: RunningHubWorkflow): RunningHubWorkflowKind {
    return workflow.kind === "app" ? "app" : "workflow";
}

function runningHubWorkflowEntryKey(workflow: RunningHubWorkflow): string {
    return `${runningHubWorkflowKind(workflow)}:${workflow.workflowId.trim()}`;
}

export function CanvasConfigNodePanel({ node, isRunning, inputSummary, onConfigChange, onGenerate, onComposerToggle, workspaceMode = "professional" }: CanvasConfigNodePanelProps) {
    const globalConfig = useEffectiveConfig();
    const runtimeStatuses = usePluginStore((state) => state.runtimeStatuses);
    const theme = canvasThemes[useActiveTheme()];
    const simpleMode = workspaceMode === "simple";
    const workflowProvider = resolveCanvasWorkflowProvider(node.metadata);
    const requirements: ModelRequirements = { capability: "image", input: { textCount: inputSummary.textCount, imageCount: inputSummary.imageCount, characterCount: 0 } };
    const config = buildGenerationConfig(globalConfig, node, "image", requirements);
    const selectedRunningHubWorkflow = globalConfig.runningHub.workflows.find(
        (item) => item.workflowId.trim() === node.metadata?.runningHubWorkflowId?.trim() && (!node.metadata?.runningHubWorkflowKind || runningHubWorkflowKind(item) === node.metadata.runningHubWorkflowKind),
    );
    const selectedWorkflowFields: WorkflowFieldLike[] = workflowProvider === "runninghub" ? (selectedRunningHubWorkflow?.fields?.length ? selectedRunningHubWorkflow.fields : workflowFieldsFromJson(selectedRunningHubWorkflow?.workflowJson)) : [];
    const dynamicWorkflowFields = workflowParameterFields(selectedWorkflowFields);
    useEffect(() => {
        if (workflowProvider === "runninghub" && !node.metadata?.runningHubWorkflowId?.trim()) {
            // 进入工作流模式时优先选中全局默认条目，不覆盖用户已选中的工作流。
            const workflow =
                globalConfig.runningHub.workflows.find((item) => item.workflowId.trim() === globalConfig.runningHub.workflowId.trim() && runningHubWorkflowKind(item) === globalConfig.runningHub.selectedKind) ||
                globalConfig.runningHub.workflows[0];
            if (workflow) {
                onConfigChange(node.id, { generationMode: "image", runningHubWorkflowId: workflow.workflowId, runningHubWorkflowKind: runningHubWorkflowKind(workflow), workflowParameters: {} });
            }
        }
    }, [globalConfig.runningHub.selectedKind, globalConfig.runningHub.workflowId, globalConfig.runningHub.workflows, node.id, node.metadata?.runningHubWorkflowId, onConfigChange, workflowProvider]);
    const runningHubEntries = globalConfig.runningHub.workflows.map((item) => ({
        label: item.title || item.workflowId,
        value: runningHubWorkflowEntryKey(item),
        workflowId: item.workflowId,
        title: `${item.title || item.workflowId} · 图片`,
        kind: runningHubWorkflowKind(item),
    }));
    const runningHubApps = runningHubEntries.filter((item) => item.kind === "app");
    const runningHubWorkflows = runningHubEntries.filter((item) => item.kind === "workflow");
    const runningHubOptions: WorkflowSelectOption[] = [
        ...(runningHubApps.length ? [{ label: <WorkflowOptionGroupLabel label="AI 应用" count={runningHubApps.length} />, options: runningHubApps }] : []),
        ...(runningHubWorkflows.length ? [{ label: <WorkflowOptionGroupLabel label="工作流" count={runningHubWorkflows.length} />, options: runningHubWorkflows }] : []),
    ];
    const chipStyle = { background: theme.node.fill, color: theme.node.text };
    const hasAnyInput = Boolean(inputSummary.textCount || inputSummary.imageCount);
    const hasComposerContent = Boolean((node.metadata?.composerContent ?? node.metadata?.prompt ?? "").trim());
    const workflowParameterError = firstWorkflowParameterError(dynamicWorkflowFields, node.metadata?.workflowParameters || {});
    const capabilityError =
        workflowParameterError ||
        (workflowProvider === "runninghub"
            ? !workflowProviderPluginEnabled(runtimeStatuses, "runninghub")
                ? "RunningHub 工作流插件未启用"
                : !globalConfig.runningHub.enabled
                  ? "请先在设置中启用 RunningHub"
                  : !node.metadata?.runningHubWorkflowId
                    ? "请选择图片工作流或 App"
                    : !selectedRunningHubWorkflow
                      ? "当前画布引用的 RunningHub 条目已不存在，请重新选择"
                      : undefined
            : undefined);
    const canGenerate = (hasComposerContent || hasAnyInput) && !capabilityError;

    return (
        <div className="canvas-config-node-panel thin-scrollbar flex h-full w-full cursor-move flex-col gap-3.5 overflow-y-auto px-4 pb-4 pt-8 text-sm" style={{ color: theme.node.text }} onWheel={(event) => event.stopPropagation()}>
            <div className="flex min-h-9 items-center justify-between gap-3">
                <div className="shrink-0 text-sm font-semibold">{simpleMode ? "快速生成" : workflowProvider === "model" ? "生成配置" : "工作流生成"}</div>
                {simpleMode ? <span className="rounded-md px-2 py-1 text-[var(--fs-tiny)]" style={{ background: theme.node.fill, color: theme.node.muted }}>自动配置</span> : null}
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
                <InputChip label="提示词" value={`${inputSummary.textCount} 个`} style={chipStyle} />
                <InputChip label="参考图" value={`${inputSummary.imageCount} 张`} style={chipStyle} />
            </div>

            <button
                type="button"
                className="canvas-config-prompt-button group flex min-h-11 w-full cursor-pointer items-center gap-2.5 rounded-lg px-3 text-left"
                style={{ background: theme.node.fill, color: theme.node.text }}
                onMouseDown={(event) => event.stopPropagation()}
                onClick={onComposerToggle}
            >
                <span className="grid size-7 shrink-0 place-items-center rounded-md" style={{ background: theme.node.panel }}>
                    {simpleMode ? <MessageSquare className="size-3.5" /> : <Sparkles className="size-3.5" />}
                </span>
                <span className="min-w-0 flex-1">
                    <span className="block text-[var(--fs-label)] font-semibold">{simpleMode ? "编辑生成内容" : "组装提示词"}</span>
                    <span className="block truncate text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                        {hasComposerContent ? "已填写，可继续编辑或引用素材" : "输入提示词，或用 @ 引用连接素材"}
                    </span>
                </span>
                <ChevronDown className="size-3.5 -rotate-90 opacity-45 transition-transform group-hover:translate-x-0.5" />
            </button>

            {simpleMode ? (
                <div className="rounded-lg px-3 py-2.5 text-[var(--fs-label)]" style={{ background: theme.node.fill, color: theme.node.muted }}>
                    将使用当前默认模型与生成参数
                </div>
            ) : (
                <div className="flex min-w-0 flex-col gap-3">
                    <div className="flex items-center gap-3" data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        <span className="shrink-0 text-[var(--fs-tiny)] font-medium" style={{ color: theme.node.muted }}>
                            生成来源
                        </span>
                        <Segmented
                            block
                            size="small"
                            className="canvas-config-provider min-w-0 flex-1"
                            value={workflowProvider}
                            options={[{ label: "模型", value: "model" }, ...(workflowProviderPluginEnabled(runtimeStatuses, "runninghub") ? [{ label: "RunningHub", value: "runninghub" }] : [])]}
                            onChange={(value) => {
                                const nextProvider = value as "model" | "runninghub";
                                if (nextProvider === "model") {
                                    onConfigChange(node.id, { workflowProvider: "model", workflowTitle: undefined, runningHubWorkflowId: undefined, runningHubWorkflowKind: undefined, workflowParameters: {} });
                                    return;
                                }
                                onConfigChange(node.id, { workflowProvider: "runninghub", workflowTitle: "RunningHub 工作流", workflowParameters: {} });
                            }}
                        />
                    </div>
                    <div data-canvas-no-zoom className="grid min-w-0 cursor-default items-center gap-3" onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
                        {workflowProvider === "runninghub" ? (
                            <Select<string, WorkflowSelectOption>
                                className="canvas-compact-control !h-9 w-full"
                                value={selectedRunningHubWorkflow ? runningHubWorkflowEntryKey(selectedRunningHubWorkflow) : undefined}
                                title={selectedRunningHubWorkflow ? `${selectedRunningHubWorkflow.kind === "app" ? "App" : "工作流"} · ${selectedRunningHubWorkflow.title || selectedRunningHubWorkflow.workflowId}` : undefined}
                                placeholder="选择图片工作流或 App"
                                showSearch
                                options={runningHubOptions}
                                optionFilterProp="label"
                                optionLabelProp="label"
                                labelRender={(selected) => {
                                    const workflow = runningHubEntries.find((item) => item.value === selected.value);
                                    return <WorkflowSelectedLabel kind={workflow?.kind || "workflow"} label={workflow?.label || String(selected.label || "")} />;
                                }}
                                notFoundContent="暂无图片工作流"
                                popupMatchSelectWidth={false}
                                virtual={false}
                                listHeight={320}
                                styles={{ popup: { root: { minWidth: 320, maxWidth: "min(420px, calc(100vw - 32px))" } } }}
                                optionRender={(option) => {
                                    if (option.data.options) return option.label;
                                    return <WorkflowOptionLabel kind={option.data.kind === "app" ? "app" : "workflow"} label={String(option.data.label || "")} title={String(option.data.title || option.data.label || "")} />;
                                }}
                                onChange={(value) => {
                                    const workflow = runningHubEntries.find((item) => item.value === value);
                                    onConfigChange(node.id, { runningHubWorkflowId: workflow?.workflowId, runningHubWorkflowKind: workflow?.kind, workflowParameters: {} });
                                }}
                            />
                        ) : (
                            <div
                                className="flex h-9 min-w-0 items-center gap-2 rounded-lg border px-2 text-[var(--fs-label)]"
                                style={{ background: theme.node.fill, borderColor: theme.node.stroke, color: theme.node.text }}
                                title="已连接的图片会按当前模型能力自动作为参考图传入"
                            >
                                <ImageIcon className="size-3.5 shrink-0 opacity-75" />
                                <span className="shrink-0 font-medium">{config.model || "默认图片模型"}</span>
                                <span className="min-w-0 truncate opacity-60">
                                    {config.size} · {config.quality} · {config.count} 张
                                </span>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {dynamicWorkflowFields.length ? <WorkflowParameterControls fields={dynamicWorkflowFields} node={node} theme={theme} onConfigChange={onConfigChange} /> : null}

            {capabilityError ? (
                <div className="rounded-lg px-3 py-2 text-[var(--fs-tiny)]" style={{ background: theme.accent.danger + "18", color: theme.accent.danger }}>
                    {capabilityError}
                </div>
            ) : null}

            <Button type="primary" className="mt-auto !h-9 !w-full !cursor-pointer !rounded-lg" disabled={isRunning || !canGenerate} onMouseDown={(event) => event.stopPropagation()} onClick={() => onGenerate(node.id)}>
                <span className="inline-flex items-center gap-1.5">
                    {isRunning ? (
                        <>
                            <LoaderCircle className="size-4 animate-spin" />
                            <span>生成中</span>
                        </>
                    ) : (
                        <>
                            <Play className="size-4" />
                            <span>开始生成</span>
                        </>
                    )}
                </span>
            </Button>
        </div>
    );
}

export function WorkflowParameterControls({
    fields,
    node,
    theme,
    onConfigChange,
    defaultExpanded = true,
}: {
    fields: WorkflowFieldLike[];
    node: CanvasNodeData;
    theme: (typeof canvasThemes)[keyof typeof canvasThemes];
    onConfigChange: (nodeId: string, patch: Partial<CanvasNodeMetadata>) => void;
    defaultExpanded?: boolean;
}) {
    const [expanded, setExpanded] = useState(defaultExpanded);
    const values = node.metadata?.workflowParameters || {};
    const update = (field: WorkflowFieldLike, value: unknown) => {
        const key = workflowFieldKey(field);
        onConfigChange(node.id, { workflowParameters: { ...values, [key]: value } });
    };
    const updateRandom = (field: WorkflowFieldLike, randomEnabled: boolean) => {
        const key = workflowFieldRandomKey(field);
        onConfigChange(node.id, { workflowParameters: { ...values, [key]: randomEnabled } });
    };
    return (
        <div className="flex min-w-0 flex-col gap-2 rounded-lg px-2 py-2" style={{ background: theme.node.fill }} data-canvas-no-zoom onMouseDown={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()}>
            <div className="flex h-7 min-w-0 items-center justify-between gap-2">
                <div className="flex min-w-0 items-center gap-1.5 text-[var(--fs-tiny)]" style={{ color: theme.node.muted }}>
                    <span className="font-semibold">工作流参数</span>
                    <span>{fields.length} 项</span>
                </div>
                <Tooltip title={expanded ? "折叠工作流参数" : "展开工作流参数"}>
                    <Button
                        type="text"
                        size="small"
                        className="!size-7 !shrink-0 !p-0"
                        icon={<ChevronDown className={`size-3.5 transition-transform ${expanded ? "" : "-rotate-90"}`} />}
                        aria-expanded={expanded}
                        aria-label={expanded ? "折叠工作流参数" : "展开工作流参数"}
                        onMouseDown={(event) => event.stopPropagation()}
                        onClick={() => setExpanded((current) => !current)}
                    />
                </Tooltip>
            </div>
            {expanded
                ? fields.map((field) => {
                      const key = workflowFieldKey(field);
                      const randomKey = workflowFieldRandomKey(field);
                      const value = workflowFieldSubmissionValue(field, workflowFieldCurrentValue(field, values) ?? "");
                      const randomEnabled = typeof values[randomKey] === "boolean" ? values[randomKey] === true : field.randomEnabled === true;
                      const rawFieldType = String(field.fieldType || "").toUpperCase();
                      const fieldType = ["FLOAT", "INT", "INTEGER"].includes(rawFieldType) ? "NUMBER" : rawFieldType;
                      const options = workflowFieldChoiceValues(field);
                      const selectOptions = options.length ? options : fieldType === "SELECT" && value !== "" ? [value] : [];
                      const bounds = workflowFieldNumberBounds(field);
                      const numeric = fieldType === "NUMBER" || fieldType === "SLIDER" || typeof value === "number" || bounds.min !== undefined || bounds.max !== undefined || bounds.step !== undefined;
                      const numericValue = value === "" || !Number.isFinite(Number(value)) ? undefined : Number(value);
                      const valueError = randomEnabled ? "" : workflowFieldValueError(field, value);
                      const control =
                          fieldType === "SELECT" || selectOptions.length ? (
                              <Select
                                  status={valueError ? "error" : undefined}
                                  size="small"
                                  className="w-full"
                                  value={value === "" ? undefined : (value as string | number)}
                                  options={selectOptions.map((option) => ({ label: workflowParameterOptionLabel(option), value: workflowParameterOptionValue(option) }))}
                                  onChange={(next) => update(field, next)}
                              />
                          ) : fieldType === "BOOLEAN" || typeof value === "boolean" ? (
                              <Switch size="sm" checked={value === true || value === "true"} onChange={(checked) => update(field, checked)} />
                          ) : fieldType === "SLIDER" && bounds.min !== undefined && bounds.max !== undefined ? (
                              <div className="grid min-w-0 grid-cols-[minmax(0,1fr)_64px] items-center gap-2">
                                  <Slider disabled={randomEnabled} className="m-0" min={bounds.min} max={bounds.max} step={bounds.step || 0.01} value={numericValue ?? bounds.min} tooltip={{ open: false }} onChange={(next) => update(field, next)} />
                                  <InputNumber
                                      disabled={randomEnabled}
                                      status={valueError ? "error" : undefined}
                                      size="small"
                                      className="w-full"
                                      value={numericValue}
                                      min={bounds.min}
                                      max={bounds.max}
                                      step={bounds.step}
                                      onChange={(next) => update(field, next)}
                                  />
                              </div>
                          ) : numeric ? (
                              <InputNumber
                                  disabled={randomEnabled}
                                  status={valueError ? "error" : undefined}
                                  size="small"
                                  className="w-full"
                                  value={numericValue}
                                  min={bounds.min}
                                  max={bounds.max}
                                  step={bounds.step}
                                  onChange={(next) => update(field, next)}
                              />
                          ) : (
                              <Input status={valueError ? "error" : undefined} size="small" value={String(value ?? "")} onChange={(event) => update(field, event.target.value)} />
                          );
                      return (
                          <label
                              key={key}
                              className="grid min-w-0 grid-cols-[minmax(72px,0.8fr)_minmax(0,1.2fr)] items-center gap-2 text-[var(--fs-label)]"
                              title={valueError || `${field.nodeId}.${field.fieldName}${bounds.min !== undefined || bounds.max !== undefined ? ` · ${bounds.min ?? ""}-${bounds.max ?? ""}${bounds.step !== undefined ? ` / step ${bounds.step}` : ""}` : ""}`}
                          >
                              <span className="min-w-0 truncate" style={{ color: theme.node.muted }}>
                                  {field.label || field.fieldName}
                              </span>
                              <div className={field.randomEnabled ? "grid min-w-0 grid-cols-[minmax(0,1fr)_28px] items-center gap-1" : "min-w-0"}>
                                  {control}
                                  {field.randomEnabled ? (
                                      <Tooltip title={randomEnabled ? "每次生成使用随机值，点击改为固定值" : "当前使用固定值，点击恢复随机"}>
                                          <Button
                                              type="text"
                                              size="small"
                                              className="!size-7 !p-0"
                                              style={{ background: randomEnabled ? theme.accent.primarySoft : "transparent", color: randomEnabled ? theme.accent.primary : theme.node.muted }}
                                              icon={<Dice5 className="size-3.5" />}
                                              aria-pressed={randomEnabled}
                                              onClick={(event) => {
                                                  event.preventDefault();
                                                  updateRandom(field, !randomEnabled);
                                              }}
                                          />
                                      </Tooltip>
                                  ) : null}
                              </div>
                          </label>
                      );
                  })
                : null}
        </div>
    );
}

export function firstWorkflowParameterError(fields: WorkflowFieldLike[], values: Record<string, unknown>) {
    for (const field of fields) {
        const randomKey = workflowFieldRandomKey(field);
        const randomEnabled = typeof values[randomKey] === "boolean" ? values[randomKey] === true : field.randomEnabled === true;
        if (randomEnabled) continue;
        const value = workflowFieldCurrentValue(field, values) ?? "";
        const error = workflowFieldValueError(field, value);
        if (error) return `${field.label || field.fieldName}：${error}`;
    }
    return "";
}

function workflowParameterOptionValue(value: unknown): string | number {
    if (value && typeof value === "object" && !Array.isArray(value)) {
        const item = value as Record<string, unknown>;
        for (const key of ["value", "id", "key", "name", "label"]) {
            if (item[key] !== undefined && item[key] !== null) return typeof item[key] === "number" ? item[key] : String(item[key]);
        }
    }
    return typeof value === "number" ? value : String(value ?? "");
}

function workflowParameterOptionLabel(value: unknown) {
    return String(workflowParameterOptionValue(value));
}

function InputChip({ label, value, style }: { label: string; value: string; style: CSSProperties }) {
    return (
        <div className="inline-flex h-7 items-center gap-1 rounded-md px-2.5 text-[var(--fs-label)]" style={style}>
            <span>{label}</span>
            <span className="font-medium">{value}</span>
        </div>
    );
}

function WorkflowOptionGroupLabel({ label, count }: { label: string; count: number }) {
    return (
        <span className="canvas-workflow-group-label">
            <span>{label}</span>
            <b>{count}</b>
        </span>
    );
}

function WorkflowOptionLabel({ kind, label, title }: { kind: "app" | "workflow"; label: string; title: string }) {
    return (
        <div className="canvas-workflow-option" title={title}>
            {kind === "app" ? <Sparkles /> : <WorkflowIcon />}
            <span>{label}</span>
            <i aria-hidden="true" />
        </div>
    );
}

function WorkflowSelectedLabel({ kind, label }: { kind: "app" | "workflow"; label: string }) {
    return (
        <span className="canvas-workflow-selected-label">
            {kind === "app" ? <Sparkles /> : <WorkflowIcon />}
            <span>{label}</span>
        </span>
    );
}
