import {
  ArrowRight,
  ChevronDown,
  Cpu,
  Database,
  Gauge,
  History,
  Image,
  ImageOff,
  LoaderCircle,
  MessagesSquare,
  ScrollText,
  Sparkles,
  Upload,
} from "lucide-react";
import {
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import type { AppConfig, GenerationLogEntry, RuntimeStatus } from "../../../shared/types";
import {
  Button,
  Card,
  Chip,
  DanmakuStage,
  DanmakuText,
  EmptyState,
  LinkButton,
  Meter,
  MiniBars,
  StatusPill,
  TileIcon,
  type IconTone,
} from "../components";
import type { PageId } from "../constants";
import {
  cachePercent,
  formatClock,
  formatCount,
  formatCountdown,
  formatMegabytes,
  formatMonthDay,
  formatSecondsValue,
  historyModeLabels,
  latestCommentLog,
  recentRounds,
  statusLabels,
} from "../format";
import {
  cacheBars,
  cacheBarsLabel,
  companionName,
  heroMood,
  heroTitleSuffix,
  latencyBars,
  latencyBarsLabel,
  latestRoundLine,
  placeholderBars,
  rhythmSentence,
  roundCount,
  shortName,
  stageLayout,
  startDelaySentence,
} from "../overviewModel";
import { useCountdown } from "../useCountdown";
import type { WorkingAction } from "../useSettingsController";
import type { PageProps } from "./types";
import "../../styles/overview.css";

const MIB = 1024 * 1024;
/** Minimum height of the 最近一轮弹幕 stage; it grows with its card. */
const STAGE_HEIGHT = 160;

/**
 * 总览 (#overview): what the companion is doing right now. A hero with the countdown ring and
 * the rhythm in one sentence, four stat tiles for the last round (latency, cache, request
 * size, history screenshots), the last round's comments replayed in the current style, and
 * the context summary that is carried in the system prompt.
 */
export function OverviewPage({ controller, navigate }: PageProps) {
  const { config, draft, status, logs, workingAction } = controller;

  return (
    <div className="ov">
      <Hero config={config} status={status} workingAction={workingAction} />
      <StatTiles config={config} status={status} logs={logs} />
      <div className="ov-grid">
        <LatestRoundCard
          logs={logs}
          danmaku={draft.danmaku}
          workingAction={workingAction}
          onGenerate={() => void controller.generateOnce()}
          navigate={navigate}
        />
        <SummaryCard config={config} status={status} navigate={navigate} />
      </div>
    </div>
  );
}

/* ================================================================== hero */

interface HeroProps {
  config: AppConfig;
  status: RuntimeStatus;
  workingAction: WorkingAction;
}

/**
 * The hero describes the running loop, so it reads the saved config (what main uses), not
 * the unsaved draft.
 */
function Hero({ config, status, workingAction }: HeroProps) {
  const titleId = useId();
  const inDelay = status.state === "running" && Boolean(status.nextCycleIsFirst && status.nextCycleAt);
  const generating =
    workingAction === "generate" || (status.state === "running" && !status.nextCycleAt);
  const mood = heroMood(status.state, inDelay);
  const name = companionName(config.character.name);
  const runtime = config.runtime;
  const vision = config.model.visionEnabled;

  let pill: ReactNode;
  if (status.state === "running") {
    const detail = inDelay ? "即将首次截图" : generating ? "正在生成" : `第 ${status.cycles} 轮`;
    pill = (
      <StatusPill tone="live" pulse>
        运行中 · {detail}
      </StatusPill>
    );
  } else if (status.state === "paused") {
    pill = <StatusPill tone="warn">已暂停 · 第 {status.cycles} 轮</StatusPill>;
  } else if (status.state === "error") {
    pill = <StatusPill tone="bad">{statusLabels.error}</StatusPill>;
  } else {
    pill = <StatusPill>{statusLabels.idle}</StatusPill>;
  }

  const sentence = inDelay
    ? startDelaySentence(runtime.startDelaySeconds, config.character.name, vision)
    : rhythmSentence(runtime, vision);

  const modelId = config.model.model.trim();
  const historyText =
    runtime.historyRounds > 0
      ? `历史 ${runtime.historyRounds} 轮 · ${historyModeLabels[runtime.historyMode]}`
      : "不带历史";

  return (
    <section className="card ov-hero" aria-labelledby={titleId} data-mood={mood}>
      <HeroRing status={status} generating={generating} />
      <div className="ov-hero-main">
        {pill}
        <h2 className="ov-hero-title" id={titleId}>
          <em className="ov-name" title={name}>
            {shortName(name, 14)}
          </em>
          <span className="ov-hero-suffix">{heroTitleSuffix[mood]}</span>
        </h2>
        <p className="ov-hero-text">{sentence}</p>
        <ul className="ov-facts" aria-label="当前配置">
          <li>
            <Chip icon={<Cpu />} title={modelId ? `模型：${modelId}` : undefined} className="ov-fact-model">
              <span className="ov-trunc">{modelId || "未设置模型"}</span>
            </Chip>
          </li>
          <li>
            {vision ? (
              <Chip icon={<Image />}>
                {runtime.captureImageFormat === "png" ? "PNG" : "JPEG"} · {runtime.captureShortEdgePixels}p
              </Chip>
            ) : (
              <Chip icon={<ImageOff />}>不发送截图</Chip>
            )}
          </li>
          <li className="ov-fact-opt">
            <Chip icon={<History />}>{historyText}</Chip>
          </li>
        </ul>
      </div>
      <HeroDeco />
    </section>
  );
}

/**
 * Soft danmaku-like pill lines drifting through the free space right of the text (a flex column
 * that only gets the room the text leaves, so they never pass behind it). Static when reduced.
 */
function HeroDeco() {
  return (
    <div className="ov-hero-deco" aria-hidden="true">
      <i className="is-coral" style={{ "--y": "26px", "--w": "120px", "--d": "16s", "--o": "-4s", "--r": "40%" } as CSSProperties} />
      <i className="is-cyan" style={{ "--y": "52px", "--w": "70px", "--d": "21s", "--o": "-9s", "--r": "62%" } as CSSProperties} />
      <i className="is-coral is-faint" style={{ "--y": "98px", "--w": "150px", "--d": "26s", "--o": "-14s", "--r": "18%" } as CSSProperties} />
      <i className="is-cyan is-faint" style={{ "--y": "124px", "--w": "56px", "--d": "18s", "--o": "-2s", "--r": "70%" } as CSSProperties} />
    </div>
  );
}

const RING_R = 46;
const RING_C = 2 * Math.PI * RING_R;

/**
 * Countdown ring: the arc is the time left until the next capture (teal), or until the first
 * capture during the start delay (coral). It is the only part of the page that ticks.
 */
function HeroRing({ status, generating }: { status: RuntimeStatus; generating: boolean }) {
  const countdown = useCountdown(status);
  const gradientId = `${useId().replace(/:/g, "")}-arc`;

  let mode: "countdown" | "delay" | "busy" | "off";
  if (countdown.phase === "countdown" || countdown.phase === "delay") {
    mode = countdown.phase;
  } else if (countdown.phase === "generating" || generating) {
    mode = "busy";
  } else {
    mode = "off";
  }

  const value = formatCountdown(countdown.remainingSeconds ?? 0);
  const total = countdown.totalMs ? formatCountdown(countdown.totalMs / 1000).spoken : undefined;
  const left = 1 - (countdown.elapsedFraction ?? 0);

  let center: ReactNode;
  let caption: string;
  let label: string;
  if (mode === "countdown" || mode === "delay") {
    center = (
      <b className="num">
        {value.value}
        {value.unit ? <small>s</small> : null}
      </b>
    );
    caption = mode === "delay" ? "首次截图" : "后截图";
    label =
      mode === "delay"
        ? `启动延迟，${value.spoken}后首次截图`
        : `下次截图倒计时 ${value.spoken}${total ? `，共 ${total}` : ""}`;
  } else if (mode === "busy") {
    center = <Sparkles className="ov-ring-ico" aria-hidden="true" />;
    caption = "生成中";
    label = "正在生成这一轮弹幕";
  } else {
    center = <b className="num">—</b>;
    caption = status.state === "paused" ? "已暂停" : status.state === "error" ? "未在运行" : "未启动";
    label = `没有安排截图：${caption}`;
  }

  return (
    <div className={`ov-ring is-${mode}`} role="img" aria-label={label}>
      <svg viewBox="0 0 108 108" aria-hidden="true">
        <defs>
          <linearGradient id={gradientId} x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" className="ov-ring-stop-a" />
            <stop offset="1" className="ov-ring-stop-b" />
          </linearGradient>
        </defs>
        <circle className="ov-ring-track" cx="54" cy="54" r={RING_R} />
        {mode === "off" ? null : (
          <circle
            className="ov-ring-arc"
            cx="54"
            cy="54"
            r={RING_R}
            style={mode === "countdown" ? { stroke: `url(#${gradientId})` } : undefined}
            strokeDasharray={
              mode === "busy" ? `${RING_C * 0.22} ${RING_C}` : `${Math.max(0, left) * RING_C} ${RING_C}`
            }
          />
        )}
      </svg>
      <div className="ov-ring-t">
        {center}
        <span>{caption}</span>
      </div>
    </div>
  );
}

/* ================================================================== stat tiles */

interface StatTilesProps {
  config: AppConfig;
  status: RuntimeStatus;
  logs: GenerationLogEntry[];
}

/** The last round's numbers, the same values as the dock, with the recent history beside them. */
function StatTiles({ config, status, logs }: StatTilesProps) {
  const titleId = useId();
  const series = useMemo(() => {
    const rounds = roundCount(logs);
    const latestSuccess = recentRounds(logs, 50)
      .reverse()
      .find((log) => log.status === "success");
    return {
      rounds,
      latency: rounds > 0 ? latencyBars(logs) : placeholderBars(),
      latencyLabel: latencyBarsLabel(logs),
      cache: rounds > 0 ? cacheBars(logs) : placeholderBars(),
      cacheLabel: cacheBarsLabel(logs),
      promptMs: latestSuccess?.promptMs,
    };
  }, [logs]);

  /* 生成耗时 */
  const latency = status.providerLatencyMs;
  // Unbreakable parts: a narrow tile wraps after the "·", never inside "412 ms". "最近" is
  // dropped in a narrow window so the line usually still fits.
  const prefill = series.promptMs !== undefined ? formatPrefill(series.promptMs) : undefined;
  const latencySub =
    series.rounds > 0 ? (
      <>
        <span className="ov-nb">
          <span className="ov-wide-only">最近 </span>
          {series.rounds} 轮
        </span>
        {prefill ? (
          <>
            {" · "}
            <span className="ov-nb">预填充 {prefill}</span>
          </>
        ) : null}
      </>
    ) : (
      "还没有完成的一轮"
    );
  const latencySubText =
    series.rounds > 0 ? `最近 ${series.rounds} 轮${prefill ? ` · 预填充 ${prefill}` : ""}` : undefined;

  /* 缓存命中 */
  const cache = cachePercent(status.cachedInputTokens, status.promptTokens);
  let cacheSub: string;
  if (status.promptTokens !== undefined) {
    cacheSub = `${status.cachedInputTokens !== undefined ? formatCount(status.cachedInputTokens) : "?"} / ${formatCount(status.promptTokens)} tokens`;
  } else {
    cacheSub = status.state === "running" ? "等待这一轮返回用量" : "还没有用量数据";
  }

  /* 请求体 */
  const configuredLimit = Math.round(config.runtime.requestBodyLimitMB * MIB);
  const limit = status.requestLimitBytes ?? configuredLimit;
  const learned = status.requestLimitBytes !== undefined && status.requestLimitBytes < configuredLimit;
  const limitText = `${formatMegabytes(limit)} MB`;
  const request = status.requestBytes;
  const requestNearLimit = request !== undefined && limit > 0 && request / limit >= 0.9;

  /* 历史截图 */
  const vision = config.model.visionEnabled;
  const keepImages = vision && config.runtime.historyIncludeImages && config.runtime.historyMaxImages > 0;
  const maxImages = config.runtime.historyMaxImages;
  const images = keepImages ? status.historyImages : undefined;
  const imagesSub = !vision
    ? "视觉输入已关闭"
    : !config.runtime.historyIncludeImages
      ? "未保留历史截图"
      : maxImages === 0
        ? "上限为 0 张，不保留"
        : "超限后丢弃最早一半";

  return (
    <section className="ov-stats" aria-labelledby={titleId}>
      <h2 className="sr-only" id={titleId}>
        最近一轮用量
      </h2>

      <StatTile icon={<Gauge />} title="生成耗时" sub={latencySub} subTitle={latencySubText}>
        <StatValue value={latency !== undefined ? formatSecondsValue(latency) : undefined} unit="s" spokenUnit="秒" />
        <MiniBars bars={series.latency} height={20} label={series.latencyLabel} className="ov-spark" />
      </StatTile>

      <StatTile icon={<Database />} tone="ok" title="缓存命中" sub={cacheSub}>
        <div className="ov-stat-row">
          <StatValue value={cache !== undefined ? String(cache) : undefined} unit="%" />
          <MiniBars bars={series.cache} max={100} height={24} label={series.cacheLabel} className="ov-cache-bars" />
        </div>
        <Meter
          value={cache ?? 0}
          max={100}
          tone="ok"
          label="缓存命中"
          valueText={cache !== undefined ? `${cache}%` : "暂无数据"}
        />
      </StatTile>

      <StatTile
        icon={<Upload />}
        tone="coral"
        title="请求体"
        sub={
          <>
            有效上限 <span className="num">{limitText}</span>
            {learned ? <span className="ov-learned">（服务器 413 后学到）</span> : null}
          </>
        }
        subTitle={`有效上限 ${limitText}${learned ? `（服务器 413 后学到，设置为 ${config.runtime.requestBodyLimitMB} MB）` : ""}`}
      >
        <StatValue
          value={request ? formatMegabytes(request) : undefined}
          unit={`/ ${limitText}`}
          spokenUnit={`MB，上限 ${limitText}`}
        />
        <Meter
          value={request ?? 0}
          max={limit}
          tone={requestNearLimit ? "warn" : "accent"}
          mark={0.5}
          label="请求体"
          valueText={
            request
              ? `${formatMegabytes(request)} / ${limitText}，超限后压缩到一半`
              : `暂无数据，上限 ${limitText}`
          }
        />
      </StatTile>

      <StatTile icon={<Image />} tone="violet" title="历史截图" sub={imagesSub} dim={!keepImages}>
        <StatValue value={images !== undefined ? String(images) : undefined} unit={`/ ${maxImages} 张`} spokenUnit={`张，上限 ${maxImages} 张`} />
        <Meter
          value={images ?? 0}
          max={Math.max(1, maxImages)}
          tone="violet"
          mark={0.5}
          label="历史截图"
          valueText={images !== undefined ? `${images} / ${maxImages} 张，超限后丢弃最早一半` : imagesSub}
        />
      </StatTile>
    </section>
  );
}

interface StatTileProps {
  icon: ReactNode;
  tone?: IconTone;
  title: string;
  sub: ReactNode;
  /** Full text of the sub line, used as a tooltip when it is cut. */
  subTitle?: string;
  /** The feature is off: the tile is quieter. */
  dim?: boolean;
  children: ReactNode;
}

function StatTile({ icon, tone = "accent", title, sub, subTitle, dim = false, children }: StatTileProps) {
  const titleId = useId();
  return (
    <div
      role="group"
      className={["card", "ov-stat", dim ? "is-dim" : ""].filter(Boolean).join(" ")}
      aria-labelledby={titleId}
    >
      <h3 className="ov-stat-k" id={titleId}>
        <TileIcon icon={icon} tone={tone} size="sm" />
        {title}
      </h3>
      {children}
      <p className="ov-stat-d" title={subTitle ?? (typeof sub === "string" ? sub : undefined)}>
        {sub}
      </p>
    </div>
  );
}

/** Prompt processing time: "412 ms", or "1.24 s" from a second on. */
function formatPrefill(ms: number): string {
  return ms < 1000 ? `${formatCount(Math.round(ms))} ms` : `${(ms / 1000).toFixed(2)} s`;
}

/** Big number with a small unit; "—" when there is no value yet. */
function StatValue({ value, unit, spokenUnit }: { value: string | undefined; unit: string; spokenUnit?: string }) {
  if (value === undefined) {
    return (
      <div className="ov-stat-v num is-empty">
        <span aria-hidden="true">—</span>
        <span className="sr-only">暂无数据</span>
      </div>
    );
  }
  return (
    <div className="ov-stat-v num">
      {value}
      <small aria-hidden={spokenUnit ? true : undefined}>{unit}</small>
      {spokenUnit ? <span className="sr-only"> {spokenUnit}</span> : null}
    </div>
  );
}

/* ================================================================== latest round */

interface LatestRoundCardProps {
  logs: GenerationLogEntry[];
  danmaku: AppConfig["danmaku"];
  workingAction: WorkingAction;
  onGenerate: () => void;
  navigate: (page: PageId) => void;
}

/** The newest successful round's comments, replayed on a mini screen in the draft style. */
function LatestRoundCard({ logs, danmaku, workingAction, onGenerate, navigate }: LatestRoundCardProps) {
  const log = useMemo(() => latestCommentLog(logs), [logs]);
  const layout = useMemo(
    () =>
      log
        ? stageLayout(log.comments, danmaku.palette, {
            fontSize: danmaku.fontSize,
            height: STAGE_HEIGHT,
            duration: danmaku.speedSeconds,
          })
        : undefined,
    [log, danmaku.palette, danmaku.fontSize, danmaku.speedSeconds],
  );

  const caption = !layout
    ? ""
    : layout.scaled
      ? `按当前颜色${danmaku.shadow ? " · 阴影" : ""}渲染 · 字号已缩小`
      : `按当前字号 · 颜色${danmaku.shadow ? " · 阴影" : ""}渲染`;
  // Restart the flight when the style changes, like the appearance preview.
  const styleKey = `${danmaku.fontSize}-${danmaku.speedSeconds}-${danmaku.palette.join(",")}`;

  return (
    <Card
      className="ov-round"
      bodyClassName="ov-round-body"
      icon={<MessagesSquare />}
      title="最近一轮弹幕"
      sub={log ? <span className="num">{latestRoundLine(log, formatClock, formatMonthDay)}</span> : "还没有成功的一轮"}
      aside={
        logs.length > 0 ? (
          <LinkButton icon={<ArrowRight />} onClick={() => navigate("logs")}>
            查看日志
          </LinkButton>
        ) : null
      }
    >
      {log && layout ? (
        <DanmakuStage
          className="ov-stage"
          height="auto"
          label={`最近一轮弹幕预览：${log.comments.join("；")}`}
          caption={<span>{caption}</span>}
        >
          {layout.lines.map((line, index) => (
            <DanmakuText
              key={`${styleKey}-${index}`}
              text={line.text}
              color={line.color}
              fontSize={layout.fontSize}
              opacity={danmaku.opacity}
              shadow={danmaku.shadow}
              className={
                [layout.turns > 1 ? `ov-turns-${layout.turns}` : "", line.extra ? "ov-dm-extra" : ""]
                  .filter(Boolean)
                  .join(" ") || undefined
              }
              fly={{
                top: `${line.topPercent.toFixed(2)}%`,
                duration: layout.period,
                delay: line.delay,
                x: line.x,
              }}
            />
          ))}
        </DanmakuStage>
      ) : (
        <EmptyState
          compact
          className="ov-empty"
          icon={<MessagesSquare />}
          title={logs.length > 0 ? "最近几轮都没有生成弹幕" : "还没有生成过弹幕"}
          action={
            <Button
              size="sm"
              icon={<Sparkles />}
              busy={workingAction === "generate"}
              busyLabel="生成中"
              disabled={workingAction !== null}
              onClick={onGenerate}
            >
              生成一次
            </Button>
          }
        >
          {logs.length > 0
            ? "成功的一轮会按当前字号、颜色和阴影在这里重播；失败原因见生成日志。"
            : "启动或生成一次后，这一轮的弹幕会按当前字号、颜色和阴影在这里重播。"}
        </EmptyState>
      )}
    </Card>
  );
}

/* ================================================================== context summary */

interface SummaryCardProps {
  config: AppConfig;
  status: RuntimeStatus;
  navigate: (page: PageId) => void;
}

const SUMMARY_EXPLAINER = "历史重置或减半前，会先在后台总结之前的内容，并放进系统提示词。";

/** The context summary carried in the system prompt, or what the feature does while it is off. */
function SummaryCard({ config, status, navigate }: SummaryCardProps) {
  const runtime = config.runtime;
  const enabled = runtime.historySummaryEnabled;
  const summary = status.contextSummary?.trim() ?? "";
  const applies = runtime.historyRounds > 0 && runtime.historyMode !== "sliding";

  const chip = !enabled ? (
    <Chip>未开启</Chip>
  ) : status.summarizing ? (
    <Chip tone="violet" icon={<LoaderCircle className="spin" />}>
      生成中
    </Chip>
  ) : (
    <Chip tone="violet">已启用</Chip>
  );

  const toCapture = (text: string) => (
    <LinkButton icon={<ArrowRight />} onClick={() => navigate("capture")}>
      {text}
    </LinkButton>
  );

  let body: ReactNode;
  let sub: ReactNode;
  if (!enabled) {
    sub = "前情提要，放进系统提示词";
    body = (
      <EmptyState
        compact
        className="ov-empty"
        icon={<ScrollText />}
        title="开启后，换历史窗口也接得上话"
        action={toCapture("在截图与历史中开启")}
      >
        重置或减半历史前，先在后台总结做过的事和聊过的梗，放进系统提示词。
      </EmptyState>
    );
  } else if (!applies) {
    sub = "当前设置下不会生成";
    body = (
      <EmptyState
        compact
        className="ov-empty"
        icon={<ScrollText />}
        title={runtime.historyRounds === 0 ? "历史轮数为 0，没有可总结的内容" : "逐轮滑动不会生成摘要"}
        action={toCapture("调整历史设置")}
      >
        摘要只在“满额重置”或“分批滑动”换历史窗口时生成。
      </EmptyState>
    );
  } else if (!summary) {
    sub = status.summarizing ? "正在后台总结" : "还没有摘要";
    body = (
      <EmptyState
        compact
        className="ov-empty"
        icon={status.summarizing ? <LoaderCircle className="spin" /> : <ScrollText />}
        title={status.summarizing ? "正在写第一份摘要…" : "历史还没满，暂时没有摘要"}
      >
        {SUMMARY_EXPLAINER}
      </EmptyState>
    );
  } else {
    const length = [...summary].length;
    sub = (
      <span className="num">
        {status.contextSummaryAt ? `${formatClock(status.contextSummaryAt)} 写入 · ` : ""}
        {length} 字
      </span>
    );
    body = <SummaryText text={summary} />;
  }

  return (
    <Card
      className="ov-summary"
      bodyClassName="ov-summary-body"
      icon={<ScrollText />}
      iconTone="violet"
      title="上下文摘要"
      sub={sub}
      aside={chip}
    >
      {body}
    </Card>
  );
}

/** Summary text clamped to four lines, with 展开全文 / 收起 when it is longer. */
function SummaryText({ text }: { text: string }) {
  const textId = useId();
  const ref = useRef<HTMLParagraphElement>(null);
  const [expanded, setExpanded] = useState(false);
  const [overflowing, setOverflowing] = useState(false);

  useLayoutEffect(() => {
    const element = ref.current;
    if (!element || expanded) return undefined;
    const check = () => setOverflowing(element.scrollHeight > element.clientHeight + 1);
    check();
    const observer = new ResizeObserver(check);
    observer.observe(element);
    return () => observer.disconnect();
  }, [expanded, text]);

  return (
    <>
      <p
        id={textId}
        ref={ref}
        className={["ov-summary-text", expanded ? "is-expanded" : ""].filter(Boolean).join(" ")}
        tabIndex={expanded ? 0 : undefined}
        aria-label={expanded ? "上下文摘要全文" : undefined}
      >
        {text}
      </p>
      <div className="ov-summary-foot">
        <p className="ov-summary-help">{SUMMARY_EXPLAINER}</p>
        {overflowing || expanded ? (
          <LinkButton
            className={["ov-expand", expanded ? "is-open" : ""].filter(Boolean).join(" ")}
            icon={<ChevronDown />}
            aria-expanded={expanded}
            aria-controls={textId}
            onClick={() => setExpanded((open) => !open)}
          >
            {expanded ? "收起" : "展开全文"}
          </LinkButton>
        ) : null}
      </div>
    </>
  );
}
