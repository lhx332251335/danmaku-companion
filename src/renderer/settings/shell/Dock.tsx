import { Eraser, LoaderCircle, Pause, Play, Sparkles } from "lucide-react";
import type { CSSProperties } from "react";
import type { GenerationLogEntry, RuntimeStatus } from "../../../shared/types";
import { Button } from "../components/Button";
import {
  cachePercent,
  formatClock,
  formatCountdown,
  formatMegabytes,
  formatSecondsValue,
  statusLabels,
} from "../format";
import { useCountdown } from "../useCountdown";
import type { SettingsController } from "../useSettingsController";

interface DockProps {
  controller: SettingsController;
}

/**
 * The dark player bar on every page: start/pause, state + round, the countdown to the next
 * capture (striped coral during the start delay), live stats, 生成一次, the 「弹」 overlay
 * toggle and 清屏.
 */
export function Dock({ controller }: DockProps) {
  const { status, workingAction, overlayVisible } = controller;
  const running = status.state === "running";
  const busy = workingAction !== null;
  const playLabel = workingAction === "start" ? "处理中" : running ? "暂停" : "启动";
  const cache = cachePercent(status.cachedInputTokens, status.promptTokens);
  // Global shortcuts registered by main (windowManager.registerShortcuts).
  const mod = controller.isMac ? "⌘⌥" : "Ctrl+Alt+";

  return (
    <footer className="dock" aria-label="运行控制">
      <button
        type="button"
        className="play"
        aria-label={playLabel}
        title={`${running ? "暂停" : "启动"}（${mod}D）`}
        disabled={busy}
        aria-busy={workingAction === "start" || undefined}
        onClick={() => void controller.toggleRunning()}
      >
        {workingAction === "start" ? (
          <LoaderCircle className="spin" aria-hidden="true" />
        ) : running ? (
          <Pause className="play-glyph" aria-hidden="true" />
        ) : (
          <Play className="play-glyph" aria-hidden="true" />
        )}
      </button>

      <div className="dock-state">
        <div className={`st is-${status.state}`} role="status">
          <span className="dot" aria-hidden="true" />
          {statusLabels[status.state]}
        </div>
        <div className="sub num">第 {status.cycles} 轮</div>
      </div>

      <DockCountdown
        status={status}
        generating={workingAction === "generate"}
        latestRound={controller.logs.find((log) => log.reason !== "summary")}
        startDelaySeconds={controller.draft.runtime.startDelaySeconds}
      />

      <div className="dock-stats" aria-label="上一轮用量" role="group">
        <div className="s">
          <small>耗时</small>
          <b className="num">
            {status.providerLatencyMs !== undefined ? `${formatSecondsValue(status.providerLatencyMs)} s` : "—"}
          </b>
        </div>
        <div className="s">
          <small>缓存命中</small>
          <b className="num">{cache !== undefined ? `${cache}%` : "—"}</b>
        </div>
        <div className="s is-optional">
          <small>请求体</small>
          <b className="num">
            {status.requestBytes ? (
              <>
                {formatMegabytes(status.requestBytes)}{" "}
                <em>/ {status.requestLimitBytes ? `${formatMegabytes(status.requestLimitBytes)} MB` : "MB"}</em>
              </>
            ) : (
              "—"
            )}
          </b>
        </div>
      </div>
      <div className="dock-sep" aria-hidden="true" />

      <div className="dock-actions">
        <Button
          variant="dock"
          icon={<Sparkles />}
          busy={workingAction === "generate"}
          busyLabel="生成中"
          disabled={busy}
          title={`保存当前修改并立即生成一轮（${mod}Space）`}
          onClick={() => void controller.generateOnce()}
        >
          生成一次
        </Button>
        <button
          type="button"
          className="dan"
          aria-label="显示弹幕层"
          aria-pressed={overlayVisible}
          title={overlayVisible ? "隐藏弹幕层" : "显示弹幕层"}
          onClick={() => void controller.toggleOverlay()}
        >
          <span className="glyph" aria-hidden="true">
            弹
          </span>
        </button>
        <Button
          variant="dock"
          iconOnly
          icon={<Eraser />}
          label="清空屏幕上的弹幕"
          title="清屏"
          onClick={() => void controller.clearOverlay()}
        />
      </div>
    </footer>
  );
}

interface DockCountdownProps {
  status: RuntimeStatus;
  generating: boolean;
  latestRound: GenerationLogEntry | undefined;
  startDelaySeconds: number;
}

/** Only this part re-renders while the countdown ticks. */
function DockCountdown({ status, generating, latestRound, startDelaySeconds }: DockCountdownProps) {
  const countdown = useCountdown(status);
  const lastLine = status.lastGeneratedAt
    ? `上次生成 ${formatClock(status.lastGeneratedAt)}${
        latestRound?.generatedCount !== undefined ? ` · ${latestRound.generatedCount} 条` : ""
      }`
    : "还没有生成过";
  const firstShot =
    startDelaySeconds > 0 ? `启动后 ${startDelaySeconds} 秒首次截图` : "启动后立即截图";

  let label: string;
  let sub: string;
  let trackClass = "track";
  let fill: number | undefined;
  let value: { value: string; unit: string; spoken: string } | undefined;

  if (countdown.phase === "countdown" || countdown.phase === "delay") {
    const delay = countdown.phase === "delay";
    label = delay ? "首次截图" : "下次截图";
    sub = delay ? "启动延迟，先切换到要看的画面" : lastLine;
    value = formatCountdown(countdown.remainingSeconds ?? 0);
    fill = countdown.elapsedFraction ?? 0;
    if (delay) trackClass += " is-delay";
  } else if (countdown.phase === "generating" || generating) {
    label = "正在生成…";
    sub = lastLine;
    trackClass += " is-busy";
  } else {
    // The state itself is shown next to the play button; this line says what Start will do.
    label = status.state === "idle" ? "未启动" : "下次截图";
    sub = status.lastGeneratedAt ? `${lastLine} · ${firstShot}` : firstShot;
    trackClass += " is-empty";
  }

  const progressProps =
    fill !== undefined && countdown.totalMs
      ? {
          "aria-valuemin": 0,
          "aria-valuemax": Math.round(countdown.totalMs / 1000),
          "aria-valuenow": Math.round(((countdown.totalMs ?? 0) - (countdown.remainingMs ?? 0)) / 1000),
          "aria-valuetext": `${value?.spoken ?? ""}后截图`,
        }
      : { "aria-valuetext": label };

  return (
    <div className="dock-track">
      <div className="row">
        <b>{label}</b>
        <span className="row-sub num" title={sub}>
          {sub}
        </span>
        <span className="cd num" aria-hidden="true">
          {value ? (
            <>
              {value.value}
              {value.unit ? <small>{value.unit}</small> : null}
            </>
          ) : (
            "—"
          )}
        </span>
      </div>
      <div
        className={trackClass}
        role="progressbar"
        aria-label={label === "首次截图" ? "距首次截图" : "距下次截图"}
        {...progressProps}
      >
        <i style={{ width: fill !== undefined ? `${fill * 100}%` : undefined } as CSSProperties} />
      </div>
    </div>
  );
}
