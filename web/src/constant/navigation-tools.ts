import { Bot, Images, LibraryBig, PanelsTopLeft, Settings } from "lucide-react";

export const navigationTools = [
    { slug: "image", label: "生图", icon: Images, section: "创作" },
    { slug: "agent", label: "Agent", icon: Bot, section: "创作" },
    { slug: "canvas", label: "画布", icon: PanelsTopLeft, section: "工作区" },
    { slug: "assets", label: "图片素材", icon: Images, section: "工作区" },
    { slug: "settings", label: "设置", icon: Settings, section: "工作区" },
    { slug: "skills", label: "Agent 技能", icon: LibraryBig, section: "Agent 配置" },
] as const;

export type NavigationToolSlug = (typeof navigationTools)[number]["slug"];