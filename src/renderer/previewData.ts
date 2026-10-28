/**
 * Sample data for opening the renderer in a normal browser with `?demo=running|delay|paused|
 * idle|error`. Only the preview mock in api.ts uses it; Electron never loads it.
 */
import { defaultAppConfig } from "../shared/defaultConfig";
import type {
  AppConfig,
  DanmakuItem,
  GenerationLogEntry,
  ModelOption,
  RuntimeStatus,
} from "../shared/types";

export type PreviewScenario = "running" | "delay" | "paused" | "idle" | "error";

const SCENARIOS: readonly PreviewScenario[] = ["running", "delay", "paused", "idle", "error"];
const MIB = 1024 * 1024;
const MODEL_ID = "qwen2.5-vl-7b-instruct";
const ENDPOINT = "http://127.0.0.1:1234/v1/chat/completions";

/** The ?demo= value, if it names a scenario. */
export function previewScenario(search: string): PreviewScenario | undefined {
  const value = new URLSearchParams(search).get("demo");
  return SCENARIOS.find((scenario) => scenario === value);
}

export const PREVIEW_COMMENTS = [
  "这关的 BGM 也太燃了吧",
  "左下角那个宝箱是不是还没开",
  "只剩一点血了，冲！",
  "这个跳跃时机绝了",
  "Boss 二阶段要来了",
  "存档点就在右边",
  "刚才那下好险",
  "又掉坑里了哈哈",
  "这配色好舒服",
  "前方高能预警",
  "这波操作我给满分",
  "原来还能这样打",
  "远程武器果然稳",
  "终于到最后一关了",
  "背景里那只猫好可爱",
  "代码终于跑通了？",
  "这个 bug 我见过",
  "记得先保存再测试",
  "喝口水休息一下吧",
  "今天的进度不错哦",
  "这首歌单曲循环了吧",
  "攻略视频看懂了吗",
];

export const PREVIEW_SUMMARY =
  "你在玩一款像素风平台跳跃游戏，已经通过第三关，正在挑战第一个 Boss。之前卡在跳台上掉坑三次，后来找到了右侧的存档点。" +
  "聊过的梗：“又掉坑里了”“宝箱强迫症”。我已经吐槽过 BGM 和配色，夸过两次跳跃时机，提醒过休息喝水。" +
  "中途切到浏览器查了 Boss 攻略，看了十分钟的视频，又切回游戏继续。你在 Boss 二阶段失败两次后改用远程武器，节奏明显稳了很多，" +
  "情绪从烦躁慢慢变得兴奋，看到 Boss 只剩一点血时一直在冲。接下来可以关注：Boss 战的结果、是否回去开左下角那个宝箱、第四关的新机制。" +
  "避免重复：BGM、配色、喝水提醒。";

const EARLIER_SUMMARY =
  "你先在写一个 TypeScript 项目，修好了测试里 3 个失败的用例，又调整了设置页的布局。之后打开像素风平台跳跃游戏，从第一关开始，" +
  "第二关的移动平台卡了好几次。聊过的梗：“这个 bug 我见过”“宝箱强迫症”。已经说过：代码终于跑通、进度不错、BGM 好听。";

/** Deterministic pseudo-random numbers, so every reload shows the same sample. */
function seeded(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function demoConfig(patch: (config: AppConfig) => void = () => undefined): AppConfig {
  const config = JSON.parse(JSON.stringify(defaultAppConfig)) as AppConfig;
  config.model.model = MODEL_ID;
  config.runtime.historyMode = "batch-sliding";
  config.runtime.historyIncludeImages = true;
  config.runtime.historySummaryEnabled = true;
  patch(config);
  return config;
}

export interface PreviewProfile {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  config: AppConfig;
}

export interface PreviewData {
  profiles: PreviewProfile[];
  activeProfileId: string;
  status: RuntimeStatus;
  logs: GenerationLogEntry[];
  models: ModelOption[];
}

export const PREVIEW_MODELS: ModelOption[] = [
  { id: MODEL_ID, name: "Qwen2.5 VL 7B Instruct", state: "loaded", type: "vlm", vision: true },
  { id: "qwen2.5-7b-instruct", name: "Qwen2.5 7B Instruct", state: "not-loaded", type: "llm" },
  { id: "gemma-3-4b-it", name: "Gemma 3 4B", state: "not-loaded", type: "llm" },
];

interface RoundOptions {
  cycle: number;
  completedAt: number;
  random: () => number;
  config: AppConfig;
  reason?: GenerationLogEntry["reason"];
  status?: GenerationLogEntry["status"];
  cachePercent?: number;
}

/** One realistic generation round; callers override the fields that make it special. */
export function previewRound({
  cycle,
  completedAt,
  random,
  config,
  reason = "timer",
  status = "success",
  cachePercent,
}: RoundOptions): GenerationLogEntry {
  const durationMs = Math.round(1900 + random() * 1100);
  const promptTokens = Math.round(5200 + random() * 1800);
  const share = cachePercent ?? 0.78 + random() * 0.14;
  const requested = config.runtime.itemsPerCycle;
  const comments =
    status === "success"
      ? Array.from({ length: requested }, () => PREVIEW_COMMENTS[Math.floor(random() * PREVIEW_COMMENTS.length)])
      : [];
  const imageBytes = Math.round(82_000 + random() * 30_000);
  const at = (ms: number) => new Date(ms).toISOString();

  return {
    id: `demo-${cycle}-${reason}`,
    cycle,
    reason,
    status,
    startedAt: at(completedAt - durationMs),
    completedAt: at(completedAt),
    durationMs,
    model: config.model.model,
    requestedCount: requested,
    generatedCount: comments.length,
    releaseWindowSeconds: Math.round(6 + random() * 4),
    historyRoundsUsed: Math.min(cycle - 1, config.runtime.historyRounds),
    historyMode: config.runtime.historyMode,
    historyImagesIncluded: config.runtime.historyIncludeImages,
    historyImagesSent: Math.min(cycle - 1, 6),
    cachedInputTokens: status === "success" ? Math.round(promptTokens * share) : undefined,
    promptTokens: status === "success" ? promptTokens : undefined,
    completionTokens: status === "success" ? Math.round(70 + random() * 60) : undefined,
    promptMs: status === "success" ? Math.round(260 + random() * 260) : undefined,
    finishReason: status === "success" ? "stop" : undefined,
    requestBytes: Math.round((2.6 + random() * 0.6) * MIB),
    bodyLimitBytes: config.runtime.requestBodyLimitMB * MIB,
    screen: {
      enabled: true,
      captured: true,
      width: 960,
      height: 540,
      format: "jpeg",
      imageBytes,
      dataUrlBytes: Math.round(imageBytes * 1.34),
      jpegQuality: config.runtime.captureJpegQuality,
      sourceName: "Entire screen",
      capturedAt: at(completedAt - durationMs - 40),
    },
    comments,
    rawOutput: status === "success" ? JSON.stringify({ comments }, null, 2) : undefined,
  };
}

function summaryEntry(
  cycle: number,
  completedAt: number,
  config: AppConfig,
  summary: string,
): GenerationLogEntry {
  const durationMs = 7400;
  return {
    id: `demo-${cycle}-summary`,
    cycle,
    reason: "summary",
    status: "success",
    startedAt: new Date(completedAt - durationMs).toISOString(),
    completedAt: new Date(completedAt).toISOString(),
    durationMs,
    model: config.model.model,
    historyRoundsUsed: config.runtime.historyRounds,
    historyImagesSent: 6,
    cachedInputTokens: 6412,
    promptTokens: 6590,
    completionTokens: 236,
    promptMs: 120,
    finishReason: "stop",
    requestBytes: Math.round(3.0 * MIB),
    bodyLimitBytes: config.runtime.requestBodyLimitMB * MIB,
    screen: { enabled: false, captured: false },
    comments: [],
    summary,
    rawOutput: summary,
  };
}

/** About 40 log entries over the last hour, newest first, with every kind of special row. */
function buildLogs(config: AppConfig, now: number): GenerationLogEntry[] {
  const random = seeded(37);
  const logs: GenerationLogEntry[] = [];
  const rounds = 37;
  const start = now - 58 * 60_000;
  const step = (56 * 60_000) / rounds;

  for (let cycle = 1; cycle <= rounds; cycle += 1) {
    const completedAt = Math.round(start + cycle * step - random() * 8000);
    let entry = previewRound({ cycle, completedAt, random, config });

    if (cycle === 1) {
      entry = { ...entry, cachedInputTokens: 0, historyImagesSent: 0 };
    }
    if (cycle === 6 || cycle === 21 || cycle === 33) {
      entry = { ...entry, reason: "manual" };
    }
    if (cycle === 9) {
      // The reply hit max_tokens and was cut off.
      entry = {
        ...entry,
        finishReason: "length",
        completionTokens: config.model.maxTokens,
        generatedCount: 2,
        comments: entry.comments.slice(0, 2),
        rawOutput: `{"comments": ["${entry.comments[0]}", "${entry.comments[1]}", "这一条写到一半就被`,
      };
    }
    if (cycle === 14) {
      // History screenshots exceeded their limit: half were dropped, so the cache missed once.
      entry = {
        ...entry,
        compaction: [{ trigger: "budget", reason: "images", droppedImages: 12 }],
        cachedInputTokens: 1024,
        promptTokens: 6104,
        historyImagesSent: 12,
      };
    }
    if (cycle === 17) {
      entry = { ...entry, screen: { ...entry.screen, resizedToFit: true } };
    }
    if (cycle === 24) {
      // The server rejected the size; the app learned its limit, compacted and retried.
      entry = {
        ...entry,
        compaction: [{ trigger: "413", reason: "bytes", droppedImages: 6 }],
        bodyLimitBytes: 16 * MIB,
        cachedInputTokens: 896,
        promptTokens: 5980,
        durationMs: 4870,
      };
    }
    if (cycle === 27) {
      entry = {
        ...entry,
        status: "error",
        historyRecovery: "reset",
        error: `HTTP 400：the request exceeds the available context size, try increasing it（${ENDPOINT}）`,
        cachedInputTokens: undefined,
        promptTokens: undefined,
        generatedCount: 0,
        comments: [],
        rawOutput: undefined,
      };
    }
    if (cycle === 28) {
      entry = { ...entry, cachedInputTokens: 0, historyRoundsUsed: 0, historyImagesSent: 0 };
    }
    if (cycle === 31) {
      entry = {
        ...entry,
        status: "aborted",
        durationMs: 820,
        cachedInputTokens: undefined,
        promptTokens: undefined,
        completionTokens: undefined,
        generatedCount: 0,
        comments: [],
        rawOutput: undefined,
      };
    }
    if (cycle === rounds) {
      // The latest round: the comments shown on the overview.
      entry = {
        ...entry,
        durationMs: 2410,
        promptMs: 412,
        cachedInputTokens: 5612,
        promptTokens: 6840,
        requestBytes: Math.round(3.1 * MIB),
        historyImagesSent: 6,
        comments: [PREVIEW_COMMENTS[0], PREVIEW_COMMENTS[1], PREVIEW_COMMENTS[2]],
        generatedCount: 3,
        completedAt: new Date(now - 9000).toISOString(),
        startedAt: new Date(now - 9000 - 2410).toISOString(),
      };
      entry.rawOutput = JSON.stringify({ comments: entry.comments }, null, 2);
    }
    logs.push(entry);

    if (cycle === 12) {
      logs.push(summaryEntry(cycle, completedAt + 6000, config, EARLIER_SUMMARY));
    }
    if (cycle === 32) {
      logs.push(summaryEntry(cycle, completedAt + 6000, config, PREVIEW_SUMMARY));
    }
  }

  return logs.reverse();
}

export function buildPreviewData(scenario: PreviewScenario, now = Date.now()): PreviewData {
  const at = (offsetMs: number) => new Date(now + offsetMs).toISOString();
  const main = demoConfig();
  const profiles: PreviewProfile[] = [
    { id: "demo-default", name: "默认配置", createdAt: at(-40 * 86_400_000), updatedAt: at(-3600_000), config: main },
    {
      id: "demo-stream",
      name: "直播用（录屏可见）",
      createdAt: at(-20 * 86_400_000),
      updatedAt: at(-7 * 86_400_000),
      config: demoConfig((config) => {
        config.danmaku.excludeOverlayFromCapture = false;
        config.danmaku.fontSize = 28;
      }),
    },
    {
      id: "demo-cloud",
      name: "云端 GPT-4o",
      createdAt: at(-30 * 86_400_000),
      updatedAt: at(-20 * 86_400_000),
      config: demoConfig((config) => {
        config.model.baseUrl = "https://api.openai.com/v1";
        config.model.model = "gpt-4o";
        config.model.apiKey = "sk-demo-0000000000000000";
        config.runtime.historyIncludeImages = false;
      }),
    },
  ];

  const logs = scenario === "idle" ? [] : buildLogs(main, now);
  const stats: Partial<RuntimeStatus> = {
    lastGeneratedAt: at(-9000),
    providerLatencyMs: 2410,
    cachedInputTokens: 5612,
    promptTokens: 6840,
    requestBytes: Math.round(3.1 * MIB),
    requestLimitBytes: main.runtime.requestBodyLimitMB * MIB,
    historyImages: 6,
    contextSummary: PREVIEW_SUMMARY,
    contextSummaryAt: at(-12 * 60_000),
  };

  let status: RuntimeStatus;
  switch (scenario) {
    case "running":
      status = { state: "running", cycles: 37, ...stats, nextCycleAt: at(12_000), nextCycleArmedAt: at(-9000) };
      break;
    case "delay":
      // Just started after a relaunch: the 5 s start delay runs, nothing generated yet.
      status = {
        state: "running",
        cycles: 0,
        nextCycleAt: at(3000),
        nextCycleArmedAt: at(-2000),
        nextCycleIsFirst: true,
      };
      break;
    case "paused":
      status = { state: "paused", cycles: 37, ...stats };
      break;
    case "idle":
      status = { state: "idle", cycles: 0 };
      break;
    case "error":
      status = {
        state: "error",
        cycles: 37,
        ...stats,
        requestLimitBytes: 16 * MIB,
        lastError: `HTTP 413：exceeds max_body of 16777216（${ENDPOINT}） [request body 18.4 MiB]`,
      };
      break;
  }

  return { profiles, activeProfileId: "demo-default", status, logs, models: PREVIEW_MODELS };
}

/** Comments of a fresh demo round as overlay items, coloured from the palette. */
export function previewItems(comments: string[], palette: string[]): DanmakuItem[] {
  const createdAt = new Date().toISOString();
  return comments.map((text, index) => ({
    id: `${Date.now()}-demo-${index}`,
    text,
    color: palette.length > 0 ? palette[index % palette.length] : undefined,
    createdAt,
    source: "model",
  }));
}
