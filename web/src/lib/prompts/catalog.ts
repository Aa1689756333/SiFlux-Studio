import type { CanvasGenerationMode } from "@/types/canvas";

export type CanvasPromptPreset = {
    id: string;
    name: string;
    description: string;
    prompt: string;
    modes: CanvasGenerationMode[];
    source: "builtin" | "skill";
};

export const CANVAS_BUILTIN_PRESETS: CanvasPromptPreset[] = [
    {
        id: "character-sheet",
        name: "角色设定图",
        description: "正面、侧面、背面与表情参考，锁定角色一致性",
        prompt: "生成角色设定图：保持同一角色身份、五官、发型、服装和体态一致，包含正面、侧面、背面和关键表情参考，背景简洁，便于后续镜头复用。",
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "multi-angle",
        name: "多机位视角",
        description: "围绕同一主体生成连续、可衔接的机位变化",
        prompt: "围绕同一主体设计多机位画面，保持人物、服装、场景和光线一致，分别给出远景、全景、中景、近景、特写、侧面、背面和俯拍视角，镜头之间具有连续性。",
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "cinematic-light",
        name: "电影光影优化",
        description: "保留内容，优化真实光线、层次和融合感",
        prompt: "保留主体身份、动作和原始构图，优化为真实电影摄影光线：明确主光方向、环境反射、阴影层次、肤色和背景融合，降低塑料感与过度锐化，不改变画面内容。",
        modes: ["image"],
        source: "builtin",
    },
    {
        id: "story-beats",
        name: "连续画面节拍",
        description: "把一段内容拆成可生成的连续画面节拍",
        prompt: "把这段内容拆成连续画面节拍。每个画面写清主体动作、景别、构图、机位、光线、情绪和与前后画面的衔接，并保持角色、场景和道具一致。",
        modes: ["text", "image"],
        source: "builtin",
    },
];

export const IMAGE_PROMPT_REVERSE = `请根据参考图片反推一段适合用于 AI 生图的提示词。

要求：
1. 只输出提示词正文，不要解释。
2. 覆盖主体、构图、风格、光线、色彩、材质、镜头和氛围。
3. 尽量写成可直接用于生图模型的完整提示词。`;

export function workflowStarterPrompt(kind: "character_cards" | "character_three_view", title: string, workflowTitle: string) {
    if (kind === "character_cards") return `请基于「${workflowTitle}」拆分主要角色，并为每个角色生成可用于后续创作的角色图片卡片：外观、服饰、身份、性格和视觉辨识点。`;
    return `请基于上游角色卡片生成「${title}」：同一角色的正面、侧面、背面三视图，保持服饰、发型、道具和比例一致。`;
}

export function buildTextRewritePrompt(sourceText: string, instruction: string) {
    return `请根据要求修改以下文本。\n\n原文：\n${sourceText}\n\n修改要求：\n${instruction}`;
}
