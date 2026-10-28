import {
  Braces,
  Camera,
  Cpu,
  LayoutDashboard,
  Palette,
  ScrollText,
  Timer,
  UserRound,
  type LucideIcon,
} from "lucide-react";

export type PageId =
  | "overview"
  | "logs"
  | "model"
  | "danmaku"
  | "character"
  | "prompt"
  | "rhythm"
  | "capture";

/** Pages that edit settings; each has a dirty flag in the nav. */
export type SettingsPageId = Exclude<PageId, "overview" | "logs">;

export interface PageMeta {
  id: PageId;
  title: string;
  description: string;
  icon: LucideIcon;
  group: "live" | "settings";
}

export const PAGES: readonly PageMeta[] = [
  {
    id: "overview",
    title: "总览",
    description: "运行状态、缓存与请求体的实时情况",
    icon: LayoutDashboard,
    group: "live",
  },
  {
    id: "logs",
    title: "生成日志",
    description: "每一轮请求的结果、用量与原始输出，只保存在本机",
    icon: ScrollText,
    group: "live",
  },
  {
    id: "model",
    title: "模型接口",
    description: "OpenAI 兼容接口：LM Studio、llama.cpp、vLLM 或云端服务",
    icon: Cpu,
    group: "settings",
  },
  {
    id: "danmaku",
    title: "弹幕外观",
    description: "字号、颜色、速度和区域；右侧预览即时反映修改",
    icon: Palette,
    group: "settings",
  },
  {
    id: "character",
    title: "角色与称呼",
    description: "弹幕以谁的口吻说话、怎样称呼你",
    icon: UserRound,
    group: "settings",
  },
  {
    id: "prompt",
    title: "提示词模板",
    description: "发送前会把 {{占位符}} 替换为当前设置",
    icon: Braces,
    group: "settings",
  },
  {
    id: "rhythm",
    title: "运行节奏",
    description: "多久截一次图、每轮几条、弹幕怎样错开出现",
    icon: Timer,
    group: "settings",
  },
  {
    id: "capture",
    title: "截图与历史",
    description: "截图大小、历史上下文、提示缓存与请求体上限",
    icon: Camera,
    group: "settings",
  },
];

export const PAGE_IDS: readonly PageId[] = PAGES.map((page) => page.id);

export const DEFAULT_PAGE: PageId = "overview";

export function pageMeta(id: PageId): PageMeta {
  return PAGES.find((page) => page.id === id) ?? PAGES[0];
}

/** "#capture" → "capture"; anything unknown → the overview. */
export function pageFromHash(hash: string): PageId {
  const id = hash.replace(/^#\/?/, "").split(/[?&/]/)[0];
  return (PAGE_IDS as readonly string[]).includes(id) ? (id as PageId) : DEFAULT_PAGE;
}

/** Placeholders the prompt templates understand, in the order the prompt page lists them. */
export const PROMPT_PLACEHOLDERS = [
  "{{companion.name}}",
  "{{companion.persona}}",
  "{{companion.tone}}",
  "{{companion.language}}",
  "{{user.name}}",
  "{{user.role}}",
  "{{activeApp}}",
  "{{requestedCount}}",
  "{{jsonShape}}",
] as const;

/** Only the summary template understands this one. */
export const SUMMARY_PLACEHOLDER = "{{summaryMaxChars}}";

/** Settings that exist in the config but do nothing yet; shown with a 未实现 tag. */
export const UNIMPLEMENTED_HINTS = {
  activeApp: "尚未实现：目前总是填入 unknown",
  blacklist: "尚未实现：截图前不会检查前台应用，名单里的应用照样会被截图并发送",
  persistScreenshots: "尚未实现：截图从不写入磁盘",
} as const;

export const UNIMPLEMENTED_PLACEHOLDERS: Partial<Record<string, string>> = {
  "{{activeApp}}": UNIMPLEMENTED_HINTS.activeApp,
};

/** The screen recording permission button only exists on macOS. */
export const isMac = typeof navigator !== "undefined" && /Mac/.test(navigator.userAgent);

/** Log rows rendered at a time; "显示更早的 N 条" adds another page. */
export const LOG_PAGE_SIZE = 100;
