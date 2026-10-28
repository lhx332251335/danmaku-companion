import {
  ArrowRight,
  Braces,
  Camera,
  Check,
  ChevronRight,
  CircleAlert,
  Copy,
  Database,
  History,
  ImageDown,
  RefreshCw,
  Scissors,
  ScrollText,
  SearchX,
  Shrink,
  Trash2,
  Upload,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { GenerationLogEntry } from "../../../shared/types";
import { Button, Callout, Chip, DanmakuPill, EmptyState, LinkButton, Segmented } from "../components";
import { LOG_PAGE_SIZE, type PageId } from "../constants";
import {
  cachePercent,
  compactionLabel,
  formatBytes,
  formatClock,
  formatCount,
  formatDuration,
  formatMonthDay,
  historyModeLabels,
  historyRecoveryLabels,
  isFailedLog,
  isSummaryLog,
  logFlags,
  logPill,
  logReasonLabels,
  paletteColor,
  screenLabel,
  type LogFlag,
  type Tone,
} from "../format";
import type { PageProps } from "./types";
import "../../styles/logs.css";

type LogFilter = "all" | "failed" | "summary";

/**
 * 生成日志 (#logs): toolbar (全部/失败/摘要 filter, 保留条数, 刷新, 清空日志), one native
 * <details> row per entry with status, time, reason, preview, flags and counts; the detail
 * (comments, callouts, request/tokens/screenshot meta, raw output) renders only while open.
 */
export function LogsPage({ controller, navigate }: PageProps) {
  const { logs, logsLoading, config } = controller;
  const [filter, setFilter] = useState<LogFilter>("all");
  const [visibleCount, setVisibleCount] = useState(LOG_PAGE_SIZE);

  const counts = useMemo(() => {
    let failed = 0;
    let summary = 0;
    for (const log of logs) {
      if (isFailedLog(log)) failed += 1;
      if (isSummaryLog(log)) summary += 1;
    }
    return { all: logs.length, failed, summary };
  }, [logs]);

  const filtered = useMemo(() => {
    if (filter === "failed") return logs.filter(isFailedLog);
    if (filter === "summary") return logs.filter(isSummaryLog);
    return logs;
  }, [logs, filter]);

  useEffect(() => {
    setVisibleCount(LOG_PAGE_SIZE);
  }, [filter]);

  const palette = config.danmaku.palette;
  const hiddenCount = Math.max(0, filtered.length - visibleCount);
  const empty = logs.length === 0;

  return (
    <div className="logs-page">
      <div className="logs-toolbar">
        <Segmented<LogFilter>
          aria-label="筛选日志"
          value={filter}
          onChange={setFilter}
          disabled={empty}
          options={[
            { value: "all", label: "全部", count: formatCount(counts.all) },
            { value: "failed", label: "失败", count: formatCount(counts.failed) },
            { value: "summary", label: "摘要", count: formatCount(counts.summary) },
          ]}
        />
        <span className="logs-toolbar-grow" />
        <span className="logs-limit num">最多保留 {formatCount(config.runtime.generationLogLimit)} 条</span>
        <Button
          size="sm"
          icon={<RefreshCw />}
          busy={logsLoading}
          onClick={() => void controller.refreshLogs()}
        >
          刷新
        </Button>
        <Button
          size="sm"
          variant="danger"
          icon={<Trash2 />}
          disabled={empty || logsLoading}
          onClick={() => void controller.clearLogs()}
        >
          清空日志
        </Button>
      </div>

      {empty ? (
        <EmptyState icon={<ScrollText />} title="还没有生成记录">
          启动后，每一轮请求的弹幕、用量、耗时与原始输出都会记在这里。
        </EmptyState>
      ) : filtered.length === 0 ? (
        <EmptyState icon={<SearchX />} title={filter === "failed" ? "没有失败的记录" : "没有上下文摘要"} compact>
          {filter === "failed"
            ? "最近保留的日志里每一轮都成功了，或者被中断。"
            : "开启「上下文摘要」后，历史重置或减半前的摘要请求会记在这里。"}
        </EmptyState>
      ) : (
        <div className="logs-list">
          {filtered.slice(0, visibleCount).map((log) => (
            <LogRow key={log.id} log={log} palette={palette} navigate={navigate} />
          ))}
          {hiddenCount > 0 ? (
            <Button
              className="logs-more"
              block
              onClick={() => setVisibleCount((count) => count + LOG_PAGE_SIZE)}
            >
              显示更早的 {Math.min(hiddenCount, LOG_PAGE_SIZE)} 条（还有 {hiddenCount} 条）
            </Button>
          ) : null}
        </div>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ row */

interface LogRowProps {
  log: GenerationLogEntry;
  palette: string[];
  navigate: (page: PageId) => void;
}

const flagIcons: Partial<Record<LogFlag["key"], ReactNode>> = {
  truncated: <Scissors />,
  compaction: <Shrink />,
  resized: <ImageDown />,
  recovery: <History />,
};

function flagTone(flag: LogFlag, log: GenerationLogEntry): Tone {
  if (flag.key === "cache") {
    const percent = cachePercent(log.cachedInputTokens, log.promptTokens) ?? 0;
    return percent >= 50 ? "ok" : "neutral";
  }
  if (flag.key === "compaction") return "accent";
  return flag.tone;
}

function quoted(text: string): string {
  return `“${text}”`;
}

/** The one-line preview of a row. */
function RowPreview({ log }: { log: GenerationLogEntry }) {
  const error = log.error ?? log.screen.error;
  if (log.status === "error") {
    return (
      <span className="log-preview">
        <CircleAlert className="log-preview-ico" aria-hidden="true" />
        <span className="log-q is-error">{error ?? "请求失败"}</span>
      </span>
    );
  }
  if (log.status === "aborted") {
    return (
      <span className="log-preview">
        <span className="log-q">{error ?? "本轮请求已中断"}</span>
      </span>
    );
  }
  if (isSummaryLog(log)) {
    return (
      <span className="log-preview">
        <span className="log-q">{log.summary?.trim() || "（摘要为空）"}</span>
      </span>
    );
  }
  const count = log.comments.length;
  return (
    <span className="log-preview">
      <span className={count === 0 ? "log-q is-muted" : "log-q"}>
        {count === 0
          ? "没有生成弹幕"
          : count === 1
            ? quoted(log.comments[0])
            : `${quoted(log.comments[0])} 等 ${count} 条`}
      </span>
    </span>
  );
}

/** Log entries never change after they are written, so the id (and palette) skip re-renders. */
const LogRow = memo(
  function LogRow({ log, palette, navigate }: LogRowProps) {
    const [open, setOpen] = useState(false);
    const pill = logPill(log);
    const flags = logFlags(log);
    const summary = isSummaryLog(log);
    const reasonClass = log.reason === "manual" ? "log-why is-manual" : "log-why";

    return (
      <details
        className={`log-row is-${log.status}`}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span className={`log-pill tone-${pill.tone}`}>{pill.label}</span>
          <span className="log-time num">
            {formatClock(log.completedAt)}
            <small>{formatMonthDay(log.completedAt)}</small>
          </span>
          <span className={reasonClass}>{logReasonLabels[log.reason] ?? "自动"}</span>
          <RowPreview log={log} />
          <span className="log-tags">
            {flags.map((flag) => (
              <Chip
                key={flag.key}
                size="sm"
                tone={flagTone(flag, log)}
                icon={flagIcons[flag.key]}
                title={flag.description}
              >
                {flag.label}
              </Chip>
            ))}
          </span>
          <span className="log-facts num">
            {summary ? (
              <b>—</b>
            ) : (
              <>
                <b>
                  {log.generatedCount ?? 0}/{log.requestedCount ?? "—"}
                </b>{" "}
                条
              </>
            )}
            <br />
            {summary ? "上下文摘要" : screenLabel(log)}
          </span>
          <span className="log-dur num">
            <b>{formatDuration(log.durationMs)}</b>
          </span>
          <ChevronRight className="log-chev" aria-hidden="true" />
        </summary>
        {open ? <LogDetail log={log} palette={palette} navigate={navigate} /> : null}
      </details>
    );
  },
  (previous, next) => previous.log.id === next.log.id && previous.palette === next.palette,
);

/* ------------------------------------------------------------------ detail */

function dash(value: ReactNode | undefined | null): ReactNode {
  return value === undefined || value === null || value === "" ? "—" : value;
}

function dateTime(value: string | undefined): string {
  const day = formatMonthDay(value);
  return day === "—" ? "—" : `${day} ${formatClock(value)}`;
}

function cacheText(log: GenerationLogEntry): string {
  const { cachedInputTokens: cached, promptTokens: prompt } = log;
  if (cached === undefined) {
    return prompt === undefined ? "—" : `? / ${formatCount(prompt)}`;
  }
  if (!prompt) return formatCount(cached);
  return `${formatCount(cached)} / ${formatCount(prompt)}（${cachePercent(cached, prompt)}%）`;
}

function historyText(log: GenerationLogEntry): string {
  const rounds = `${log.historyRoundsUsed ?? 0} 轮`;
  return log.historyMode ? `${rounds} · ${historyModeLabels[log.historyMode] ?? log.historyMode}` : rounds;
}

function formatText(log: GenerationLogEntry): string {
  return (
    [
      log.screen.format?.toUpperCase(),
      log.screen.jpegQuality !== undefined ? `q${Math.round(log.screen.jpegQuality * 100)}` : undefined,
    ]
      .filter(Boolean)
      .join(" · ") || "—"
  );
}

function MetaGroup({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <section className="log-meta">
      <h4>
        <span className="decor" aria-hidden="true">
          {icon}
        </span>
        {title}
      </h4>
      <dl>{children}</dl>
    </section>
  );
}

function Item({ label, children, sub }: { label: string; children: ReactNode; sub?: ReactNode }) {
  return (
    <>
      <dt>{label}</dt>
      <dd>
        {children}
        {sub ? <span className="log-meta-sub">{sub}</span> : null}
      </dd>
    </>
  );
}

function LogDetail({ log, palette, navigate }: LogRowProps) {
  const summary = isSummaryLog(log);
  const truncated = log.finishReason === "length";
  const screen = log.screen;

  return (
    <div className="log-detail">
      {summary ? (
        log.summary ? (
          <p className="log-summary-text">{log.summary}</p>
        ) : null
      ) : log.comments.length > 0 ? (
        <div className="log-comments" aria-label="生成的弹幕">
          {log.comments.map((comment, index) => (
            <DanmakuPill key={`${log.id}-${index}`} text={comment} color={paletteColor(palette, index)} />
          ))}
        </div>
      ) : log.status === "success" ? (
        <p className="log-none">没有生成弹幕</p>
      ) : null}

      {log.error ? (
        <Callout
          tone={log.status === "aborted" ? "warn" : "bad"}
          role="note"
          title={log.status === "aborted" ? "已中断：" : "请求失败："}
        >
          <span className="log-callout-text">{log.error}</span>
          {log.historyRecovery ? (
            <span className="log-callout-sub">
              {`这类失败下一轮还会重复，所以已${historyRecoveryLabels[log.historyRecovery].replace("失败后", "")}；超时、429 和 5xx 不会缩减历史。`}
            </span>
          ) : null}
        </Callout>
      ) : null}
      {screen.error ? (
        <Callout tone="bad" role="note" title="截图失败：">
          <span className="log-callout-text">{screen.error}</span>
        </Callout>
      ) : null}
      {truncated ? (
        <Callout
          tone="warn"
          role="note"
          icon={<Scissors />}
          title={`输出 ${formatCount(log.completionTokens)} tokens，达到最大输出被截断。`}
          action={
            <LinkButton icon={<ArrowRight />} onClick={() => navigate("model")}>
              调大最大输出
            </LinkButton>
          }
        >
          {summary
            ? "摘要可能不完整，可在“模型接口”调大最大输出。"
            : `只解析出 ${log.generatedCount ?? log.comments.length}/${log.requestedCount ?? "—"} 条，可在“模型接口”调大最大输出。`}
        </Callout>
      ) : null}

      <div className="log-meta-groups">
        <MetaGroup icon={<Upload />} title="请求">
          <Item label="模型">{dash(log.model)}</Item>
          <Item label="请求体">
            {log.requestBytes !== undefined
              ? `${formatBytes(log.requestBytes)} / ${formatBytes(log.bodyLimitBytes)}`
              : "—"}
          </Item>
          <Item label="历史">{historyText(log)}</Item>
          <Item label="历史截图">
            {log.historyImagesIncluded ? `保留 · 本次 ${log.historyImagesSent ?? 0} 张` : "不保留"}
          </Item>
          <Item label="历史压缩">{compactionLabel(log)}</Item>
          <Item label="投放窗口">
            {log.releaseWindowSeconds !== undefined ? `${log.releaseWindowSeconds} s` : "—"}
          </Item>
        </MetaGroup>
        <MetaGroup icon={<Database />} title="Tokens 与耗时">
          <Item label="缓存 / 输入">{cacheText(log)}</Item>
          <Item label="输出 tokens" sub={truncated ? "达到最大输出被截断" : undefined}>
            {formatCount(log.completionTokens)}
          </Item>
          <Item label="预填充">
            {log.promptMs !== undefined ? formatDuration(log.promptMs) : "—"}
          </Item>
          <Item label="总耗时">{formatDuration(log.durationMs)}</Item>
          <Item label="开始时间">{dateTime(log.startedAt)}</Item>
        </MetaGroup>
        <MetaGroup icon={<Camera />} title="截图">
          <Item label="来源">{dash(screen.sourceName)}</Item>
          <Item label="尺寸">{screenLabel(log)}</Item>
          <Item label="格式">{formatText(log)}</Item>
          <Item label="图片大小">{formatBytes(screen.imageBytes)}</Item>
          <Item label="传输大小" sub={screen.resizedToFit ? "已缩小以适应上限" : undefined}>
            {formatBytes(screen.dataUrlBytes)}
          </Item>
        </MetaGroup>
      </div>

      {!summary && log.status !== "success" && log.comments.length === 0 ? (
        <p className="log-none">没有生成弹幕</p>
      ) : null}

      {log.rawOutput?.trim() ? <RawOutput text={log.rawOutput} /> : null}
    </div>
  );
}

/* ------------------------------------------------------------------ raw output */

function RawOutput({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const timer = useRef<number | undefined>(undefined);
  const chars = [...text].length;
  const reasoning = /<think>/i.test(text);

  useEffect(() => () => window.clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => setCopied(false), 1600);
    } catch {
      setCopied(false);
    }
  }

  return (
    <details className="log-raw">
      <summary>
        <Braces className="log-raw-ico" aria-hidden="true" />
        原始输出
        <span className="log-raw-count num">
          {reasoning ? "含推理内容 · " : ""}
          {formatCount(chars)} 字符
        </span>
        <ChevronRight className="log-raw-chev" aria-hidden="true" />
      </summary>
      <div className="log-raw-body">
        <Button
          size="sm"
          variant="subtle"
          className="log-raw-copy"
          icon={copied ? <Check /> : <Copy />}
          onClick={() => void copy()}
        >
          {copied ? "已复制" : "复制"}
        </Button>
        <pre tabIndex={0} aria-label="原始输出">
          {text}
        </pre>
      </div>
    </details>
  );
}
