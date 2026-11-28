import { Select } from "antd";
import { assistantModelOptions, resolveAssistantModel } from "@/lib/assistant-model";
import { filterModelsByCapability, modelDisplayName, resolveModelChannel, useConfigStore } from "@/stores/use-config-store";

type PickerCapability = "text" | "image";

/** 输入框内的模型选择：文本对话写助手模型，Agent 生图写生图模型。 */
export function CanvasAssistantModelPicker({ busy, capability = "text" }: { busy: boolean; capability?: PickerCapability }) {
    const config = useConfigStore((state) => state.config);
    const isImage = capability === "image";
    const values = isImage ? filterModelsByCapability(config.models, "image", config.channels) : assistantModelOptions(config);
    const selected = isImage ? config.imageModel : resolveAssistantModel(config);
    const options = values.map((value) => ({
        value,
        label: modelDisplayName(config, value),
        title: `${modelDisplayName(config, value)} · ${resolveModelChannel(config, value).name}`,
    }));
    return (
        <Select
            className="canvas-assistant-model"
            aria-label={isImage ? "生图模型" : "助手模型"}
            size="small"
            variant="borderless"
            style={{ width: 148 }}
            value={selected || undefined}
            placeholder={options.length ? (isImage ? "选择生图模型" : "选择助手模型") : "暂无可用模型"}
            options={options}
            disabled={busy || options.length === 0}
            placement="topLeft"
            popupMatchSelectWidth={false}
            onChange={(value) => {
                if (busy) return;
                const state = useConfigStore.getState();
                const available = isImage ? filterModelsByCapability(state.config.models, "image", state.config.channels) : assistantModelOptions(state.config);
                if (!available.includes(value)) return;
                state.updateConfig(isImage ? "imageModel" : "assistantModel", value);
            }}
        />
    );
}