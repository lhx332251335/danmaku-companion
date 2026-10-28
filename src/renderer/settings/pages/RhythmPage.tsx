import {
  Activity,
  Camera,
  MessagesSquare,
  Play,
  SlidersHorizontal,
  Sparkles,
  Timer,
} from "lucide-react";
import type { CSSProperties } from "react";
import { LIMITS } from "../../../shared/limits";
import type { GenerationLogEntry } from "../../../shared/types";
import { Card, RangePair, NumberField, Stepper } from "../components";
import { formatSpan, latestCommentLog, medianLatency, rangeHint, shorten } from "../format";
import type { PageProps } from "./types";
import "../../styles/rhythm.css";

const SAMPLE_COMMENTS = ["这关的 BGM…", "宝箱还没开？", "冲！"];
const SAMPLE_TONES = ["tone-ok", "tone-warn", "tone-accent"];
/** Where the sample pills sit along the release band (fraction) and their height level. */
const SAMPLE_SLOTS = [
  { left: 0, level: 1, minPx: 0 },
  { left: 0.3, level: 0, minPx: 0 },
  // Same height as the first pill: never closer than the first pill's widest text.
  { left: 0.76, level: 1, minPx: 122 },
];

/**
 * 运行节奏 (#rhythm): timeline 一轮是怎样进行的, then 截图间隔, 启动延迟, 每轮弹幕, 投放窗口.
 */
export function RhythmPage({ controller }: PageProps) {
  const { draft, edit, logs } = controller;
  const runtime = draft.runtime;

  return (
    <div className="stack rhythm-page">
      <RoundTimeline runtime={runtime} logs={logs} />

      <div className="rhythm-grid">
        <Card id="rhythm-interval" title="截图间隔" icon={<Timer />}>
          <RangePair
            aria-label="截图间隔"
            min={runtime.intervalMinSeconds}
            max={runtime.intervalMaxSeconds}
            range={LIMITS.intervalSeconds}
            integer
            unit="秒"
            onCommit={({ min, max }) =>
              edit("runtime", { intervalMinSeconds: min, intervalMaxSeconds: max })
            }
          />
          <p className="help">
            每轮结束后，在这个范围里随机等待再截下一张。{rangeHint(LIMITS.intervalSeconds, "秒")}。
          </p>
        </Card>

        <Card id="rhythm-delay" title="启动延迟" icon={<Play />} iconTone="coral">
          <NumberField
            className="rhythm-single"
            aria-labelledby="rhythm-delay-title"
            aria-describedby="rhythm-delay-help"
            value={runtime.startDelaySeconds}
            range={LIMITS.startDelaySeconds}
            integer
            unit="秒"
            onCommit={(startDelaySeconds) => edit("runtime", { startDelaySeconds })}
          />
          <p className="help" id="rhythm-delay-help">
            点击启动后先等一会儿再首次截图，免得截到这个设置窗口。
            {rangeHint(LIMITS.startDelaySeconds, "秒")}。
          </p>
        </Card>

        <Card id="rhythm-items" title="每轮弹幕" icon={<MessagesSquare />}>
          <Stepper
            aria-labelledby="rhythm-items-title"
            aria-describedby="rhythm-items-help"
            value={runtime.itemsPerCycle}
            range={LIMITS.itemsPerCycle}
            unit="条"
            onCommit={(itemsPerCycle) => edit("runtime", { itemsPerCycle })}
          />
          <p className="help" id="rhythm-items-help">
            每次请求让模型返回的条数。{rangeHint(LIMITS.itemsPerCycle, "条")}。
          </p>
        </Card>

        <Card id="rhythm-release" title="投放窗口" icon={<SlidersHorizontal />}>
          <RangePair
            aria-label="投放窗口"
            min={runtime.releaseWindowMinSeconds}
            max={runtime.releaseWindowMaxSeconds}
            range={LIMITS.releaseWindowSeconds}
            integer
            unit="秒"
            onCommit={({ min, max }) =>
              edit("runtime", { releaseWindowMinSeconds: min, releaseWindowMaxSeconds: max })
            }
          />
          <p className="help">
            同一轮的弹幕在这段时间里随机错开出现，不会一次全部涌出；0 为同时出现。
            {rangeHint(LIMITS.releaseWindowSeconds, "秒")}。
          </p>
        </Card>
      </div>
    </div>
  );
}

interface TimelineProps {
  runtime: PageProps["controller"]["draft"]["runtime"];
  logs: GenerationLogEntry[];
}

/** Illustrative (not to scale) diagram of one round, drawn from the draft settings. */
function RoundTimeline({ runtime, logs }: TimelineProps) {
  const delay = runtime.startDelaySeconds;
  const interval = formatSpan(runtime.intervalMinSeconds, runtime.intervalMaxSeconds);
  const releaseLow = Math.min(runtime.releaseWindowMinSeconds, runtime.releaseWindowMaxSeconds);
  const releaseHigh = Math.max(runtime.releaseWindowMinSeconds, runtime.releaseWindowMaxSeconds);
  const items = runtime.itemsPerCycle;
  const latency = medianLatency(logs);
  const latencyText = latency !== undefined ? `约 ${(latency / 1000).toFixed(1)} 秒` : undefined;

  const releaseText =
    releaseHigh <= 0
      ? `${items} 条弹幕同时飘出`
      : items === 1
        ? `前 ${formatSpan(releaseLow, releaseHigh)}内飘出 1 条弹幕`
        : `其中前 ${formatSpan(releaseLow, releaseHigh)}陆续飘出 ${items} 条弹幕`;

  // Band width along the wait bar: release window vs the longest wait, kept readable.
  const intervalHigh = Math.max(runtime.intervalMinSeconds, runtime.intervalMaxSeconds, 1);
  const bandFraction =
    releaseHigh <= 0 ? 0 : Math.min(0.62, Math.max(0.24, releaseHigh / intervalHigh));

  const recent = latestCommentLog(logs)?.comments ?? [];
  const samples = SAMPLE_SLOTS.slice(0, Math.min(3, Math.max(1, items))).map((slot, index) => ({
    ...slot,
    // Without a release window all comments appear at once: stack them at the start.
    left: releaseHigh <= 0 ? 0 : slot.left,
    level: releaseHigh <= 0 ? index : slot.level,
    text: shorten(recent[index] ?? SAMPLE_COMMENTS[index]),
    tone: SAMPLE_TONES[index],
  }));

  const description = [
    delay > 0 ? `点击启动后先等待 ${delay} 秒再截图（避开本窗口）` : "点击启动后立即截图",
    latencyText ? `模型生成${latencyText}` : "然后等模型生成",
    `返回后${releaseHigh <= 0 ? `${items} 条弹幕同时飘出` : `在 ${formatSpan(releaseLow, releaseHigh)}内陆续飘出 ${items} 条弹幕`}`,
    `同时等待 ${interval}后进入下一轮`,
  ].join("，");

  return (
    <Card
      id="rhythm-timeline"
      title="一轮是怎样进行的"
      icon={<Activity />}
      sub="按当前设置绘制 · 示意图，不按比例"
      bare
    >
      <figure className="tl" role="img" aria-label={`${description}。`}>
        <div
          className={["tl-grid", delay > 0 ? "" : "no-delay", releaseHigh <= 0 && items > 2 ? "is-tall" : ""]
            .filter(Boolean)
            .join(" ")}
          aria-hidden="true"
        >
          <div className="tl-row">
            <span className="tl-node tone-coral">
              <Play />
            </span>
            <span className="tl-bar is-delay" />
            <span className="tl-node tone-accent">
              <Camera />
            </span>
            <span className="tl-bar is-gen" />
            <span className="tl-node">
              <Sparkles />
            </span>
            <span className="tl-bar is-wait">
              <span
                className="tl-release"
                style={{ "--band": `${bandFraction * 100}%` } as CSSProperties}
              >
                {bandFraction > 0 ? <span className="tl-band" /> : null}
                {samples.map((sample) => (
                  <span
                    key={sample.tone}
                    className={`tl-pill ${sample.tone}`}
                    style={
                      {
                        "--x": sample.left,
                        "--min-x": `${releaseHigh <= 0 ? 0 : sample.minPx}px`,
                        "--level": sample.level,
                      } as CSSProperties
                    }
                  >
                    {sample.text}
                  </span>
                ))}
              </span>
            </span>
            <span className="tl-node tone-accent">
              <Camera />
            </span>
          </div>
          <div className="tl-labels">
            <div className="edge">启动</div>
            <div>
              <b>{delay > 0 ? `启动延迟 ${delay} 秒` : "不等待"}</b>
              {delay > 0 ? "避开本窗口" : "立即截图"}
            </div>
            <div className="edge">截图</div>
            <div>
              <b>生成</b>
              {latencyText ?? null}
            </div>
            <div className="edge">返回</div>
            <div>
              <b>等待 {interval}</b>
              {releaseText}
            </div>
            <div className="edge">下一轮</div>
          </div>
        </div>
      </figure>
    </Card>
  );
}
