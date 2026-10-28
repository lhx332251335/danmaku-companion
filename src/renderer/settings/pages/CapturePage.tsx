import { Activity, ArrowRight, Camera, History, Shield, Shrink } from "lucide-react";
import { LIMITS } from "../../../shared/limits";
import type { HistoryMode, RuntimeStatus, ScreenImageFormat } from "../../../shared/types";
import { parseListInput } from "../../settingsModel";
import {
  Button,
  Callout,
  Card,
  Chip,
  Field,
  LinkButton,
  ListField,
  MacTag,
  Meter,
  NumberField,
  RadioCards,
  Segmented,
  SliderField,
  StatusPill,
  Switch,
  TodoTag,
  type RadioCardOption,
} from "../components";
import { UNIMPLEMENTED_HINTS } from "../constants";
import {
  cachePercent,
  compactionLabel,
  formatClock,
  formatCount,
  formatMegabytes,
  latestCompactionLog,
  rangeHint,
} from "../format";
import type { PageProps } from "./types";
import "../../styles/capture.css";

const MIB = 1024 * 1024;
/** Compaction drops history until the request is back at this share of each limit. */
const LOW_WATER_RATIO = 0.5;

const FORMAT_OPTIONS = [
  { value: "jpeg", label: "JPEG" },
  { value: "png", label: "PNG" },
] as const satisfies readonly { value: ScreenImageFormat; label: string }[];

/** kept / dropped / new blocks: what happens to a full window of four rounds. */
function Blocks({ dropped }: { dropped: number }) {
  return (
    <span className="hm-blocks" aria-hidden="true">
      {[0, 1, 2, 3].map((index) => (
        <i key={index} className={index < dropped ? "is-drop" : undefined} />
      ))}
      <span className="hm-arrow">→</span>
      <i className="is-new" />
    </span>
  );
}

const HISTORY_MODE_OPTIONS: readonly RadioCardOption<HistoryMode>[] = [
  {
    value: "reset-on-limit",
    title: "满额重置",
    description: "写满后清空重来，之后的轮次重新命中缓存。",
    illustration: <Blocks dropped={4} />,
  },
  {
    value: "batch-sliding",
    title: "分批滑动",
    chip: <Chip tone="ok" size="sm">缓存友好</Chip>,
    description: "一次丢弃最早的一半，保留上下文，每半个窗口才失去一次缓存。",
    illustration: <Blocks dropped={2} />,
  },
  {
    value: "sliding",
    title: "逐轮滑动",
    chip: <Chip tone="warn" size="sm">每轮失去缓存</Chip>,
    description: "每轮丢弃最早一轮，请求开头每次都变；保留历史截图时不建议。",
    illustration: <Blocks dropped={1} />,
  },
];

/**
 * 截图与历史 (#capture): 截图, 历史与缓存 (history modes, limits, 上下文摘要), 隐私与存储,
 * aside 实时用量.
 */
export function CapturePage({ controller, navigate }: PageProps) {
  const { draft, edit } = controller;
  const runtime = draft.runtime;
  const isPng = runtime.captureImageFormat === "png";

  return (
    <div className="split capture-page">
      <div className="stack">
        <Card title="截图" icon={<Camera />}>
          <div className="row2">
            <Field
              label="截图最长边"
              hint={rangeHint(LIMITS.captureMaxEdgePixels, "px")}
              help="长边缩到这个尺寸再发送，越大越清晰也越慢。"
            >
              <NumberField
                value={runtime.captureMaxEdgePixels}
                range={LIMITS.captureMaxEdgePixels}
                step={10}
                integer
                unit="px"
                onCommit={(captureMaxEdgePixels) => edit("runtime", { captureMaxEdgePixels })}
              />
            </Field>
            <Field label="格式" group help="JPEG 体积小；PNG 无损但大很多。">
              <Segmented
                full
                value={runtime.captureImageFormat}
                options={FORMAT_OPTIONS}
                onChange={(captureImageFormat) => edit("runtime", { captureImageFormat })}
              />
            </Field>
          </div>
          <Field
            label="JPEG 质量"
            hint={rangeHint(LIMITS.captureJpegQuality)}
            disabled={isPng}
            help={isPng ? "PNG 是无损格式，不使用这个设置。" : "越高越清晰，图片也越大。"}
          >
            <SliderField
              value={runtime.captureJpegQuality}
              range={LIMITS.captureJpegQuality}
              step={0.01}
              disabled={isPng}
              onCommit={(captureJpegQuality) => edit("runtime", { captureJpegQuality })}
            />
          </Field>
          {isPng && runtime.historyIncludeImages ? (
            <Callout
              tone="warn"
              title="保留历史截图时建议改用 JPEG。"
              action={
                <Button size="sm" onClick={() => edit("runtime", { captureImageFormat: "jpeg" })}>
                  改用 JPEG
                </Button>
              }
            >
              PNG 截图通常是 JPEG 的 10 倍以上大小，而模型看到的 token 数相同；每一轮都要上传完整请求。
            </Callout>
          ) : null}
          {controller.isMac ? (
            <div className="capture-perm">
              <div className="capture-perm-text">
                <span className="capture-perm-title">
                  录屏权限 <MacTag />
                </span>
                <span className="help">macOS 需要在系统设置里允许本应用录制屏幕</span>
              </div>
              <Button
                size="sm"
                icon={<Shield />}
                onClick={() => void controller.openScreenRecordingSettings()}
              >
                打开系统设置
              </Button>
            </div>
          ) : null}
        </Card>

        <Card title="历史与缓存" icon={<History />} iconTone="violet">
          <Field
            className="is-inline"
            label="历史轮数"
            help={`每次请求带上最近几轮对话，0 为不带。${rangeHint(LIMITS.historyRounds, "轮")}。`}
          >
            <NumberField
              value={runtime.historyRounds}
              range={LIMITS.historyRounds}
              integer
              unit="轮"
              onCommit={(historyRounds) => edit("runtime", { historyRounds })}
            />
          </Field>
          <Field
            label="历史模式"
            group
            hint="历史满了以后怎么办"
            help="服务端只复用请求开头没变的部分（前缀缓存），模式决定开头多久变一次。"
          >
            <RadioCards
              value={runtime.historyMode}
              options={HISTORY_MODE_OPTIONS}
              onChange={(historyMode) => edit("runtime", { historyMode })}
            />
          </Field>

          <div className="capture-group">
            <Switch
              checked={runtime.historyIncludeImages}
              onChange={(historyIncludeImages) => edit("runtime", { historyIncludeImages })}
              label="保留历史截图"
              description="历史里的截图每轮都会重新上传，模型能对比之前的画面。"
            />
            <div className="sub-block">
              <div className="row2">
                <Field
                  label="历史截图上限"
                  hint={rangeHint(LIMITS.historyMaxImages, "张")}
                  help="超过就丢弃最早的一批截图。"
                >
                  <NumberField
                    value={runtime.historyMaxImages}
                    range={LIMITS.historyMaxImages}
                    integer
                    unit="张"
                    onCommit={(historyMaxImages) => edit("runtime", { historyMaxImages })}
                  />
                </Field>
                <Field
                  label="请求体上限"
                  hint={rangeHint(LIMITS.requestBodyLimitMB, "MB")}
                  help="整个请求的大小，含当前截图。"
                >
                  <NumberField
                    value={runtime.requestBodyLimitMB}
                    range={LIMITS.requestBodyLimitMB}
                    unit="MB"
                    onCommit={(requestBodyLimitMB) => edit("runtime", { requestBodyLimitMB })}
                  />
                </Field>
              </div>
              <Callout tone="info">
                <p>
                  两个上限都没超时什么都不变。超出任意一个，就一次丢弃最早的截图，直到两者都回到一半（文字保留），
                  <b>只有这一轮需要重新预填充</b>，之后的轮次又能命中缓存。
                </p>
                <p>
                  服务器返回 413 时，会按它报告的上限自动压缩并重试一次。每一轮都会上传完整请求，上限越大越占上行带宽。
                </p>
              </Callout>
            </div>
          </div>

          <div className="capture-group">
            <Switch
              checked={runtime.historySummaryEnabled}
              onChange={(historySummaryEnabled) => edit("runtime", { historySummaryEnabled })}
              label="上下文摘要"
              description="窗口重置或减半的前一轮，额外发一次后台请求，总结你一直在做什么，并放进系统提示词。它复用已缓存的前缀，摘要只在窗口变化时才加入，不会多一次缓存未命中。"
            />
            <Field
              className="is-inline"
              label="摘要上限"
              disabled={!runtime.historySummaryEnabled}
              help={
                <>
                  {rangeHint(LIMITS.historySummaryMaxChars, "字")}。摘要请求的模板在{" "}
                  <LinkButton
                    icon={<ArrowRight />}
                    onClick={() => {
                      // The prompt page opens the tab named after the slash.
                      window.location.hash = "prompt/summary";
                    }}
                  >
                    提示词模板 › 摘要提示词
                  </LinkButton>
                </>
              }
            >
              <NumberField
                value={runtime.historySummaryMaxChars}
                range={LIMITS.historySummaryMaxChars}
                step={50}
                integer
                unit="字"
                disabled={!runtime.historySummaryEnabled}
                onCommit={(historySummaryMaxChars) => edit("runtime", { historySummaryMaxChars })}
              />
            </Field>
            {runtime.historySummaryEnabled && runtime.historyMode === "sliding" ? (
              <Callout tone="warn" title="逐轮滑动不会生成摘要。">
                摘要只在满额重置或分批滑动的窗口变化前触发；逐轮滑动的窗口从不重置或减半。
              </Callout>
            ) : null}
          </div>
        </Card>

        <Card title="隐私与存储" icon={<Shield />} iconTone="ok">
          <Field
            label="隐私黑名单"
            tag={<TodoTag hint={UNIMPLEMENTED_HINTS.blacklist} />}
            disabled
            help={`${UNIMPLEMENTED_HINTS.blacklist}。`}
          >
            <ListField
              values={runtime.privacyBlacklist}
              parse={parseListInput}
              disabled
              placeholder="例如 1Password, 微信（逗号分隔）"
              title={UNIMPLEMENTED_HINTS.blacklist}
              onCommit={(privacyBlacklist) => edit("runtime", { privacyBlacklist })}
            />
          </Field>
          <Switch
            checked={runtime.persistScreenshots}
            onChange={(persistScreenshots) => edit("runtime", { persistScreenshots })}
            disabled
            label="保存截图到磁盘"
            tag={<TodoTag hint={UNIMPLEMENTED_HINTS.persistScreenshots} />}
            description="目前截图从不写入磁盘。"
          />
          <Field
            className="is-inline"
            label="日志保留"
            help={`超过后删除最早的生成日志。${rangeHint(LIMITS.generationLogLimit, "条")}。`}
          >
            <NumberField
              value={runtime.generationLogLimit}
              range={LIMITS.generationLogLimit}
              step={10}
              integer
              unit="条"
              onCommit={(generationLogLimit) => edit("runtime", { generationLogLimit })}
            />
          </Field>
        </Card>
      </div>

      <aside className="aside" aria-label="实时用量">
        <UsageCard controller={controller} navigate={navigate} />
      </aside>
    </div>
  );
}

/** Live request size, history screenshots and cache share of the last round (saved config). */
function UsageCard({ controller, navigate }: PageProps) {
  const status: RuntimeStatus = controller.status;
  const runtime = controller.config.runtime;
  const configuredLimit = runtime.requestBodyLimitMB * MIB;
  const limit = status.requestLimitBytes ?? configuredLimit;
  const learned = status.requestLimitBytes !== undefined && status.requestLimitBytes < configuredLimit;
  const bytes = status.requestBytes;

  const maxImages = runtime.historyMaxImages;
  const images = status.historyImages;
  const keepAfter = Math.floor(maxImages * LOW_WATER_RATIO);

  const percent = cachePercent(status.cachedInputTokens, status.promptTokens);
  const compaction = latestCompactionLog(controller.logs);

  return (
    <Card
      title="实时用量"
      icon={<Activity />}
      iconTone="ok"
      aside={
        status.cycles > 0 ? (
          <StatusPill tone="live" pulse={status.state === "running"}>
            第 {status.cycles} 轮
          </StatusPill>
        ) : null
      }
      bodyClassName="usage"
    >
      <div className="usage-item">
        <div className="usage-k">
          <span>请求体</span>
          {learned ? (
            <Chip tone="warn" size="sm" title="服务器返回 413 后，按它报告的上限下调了有效上限">
              已按 413 下调
            </Chip>
          ) : null}
          <b className="num">
            {formatMegabytes(bytes, 2)} <em>/ {formatMegabytes(limit)} MB</em>
          </b>
        </div>
        <Meter
          label="请求体"
          value={bytes ?? 0}
          max={limit}
          mark={LOW_WATER_RATIO}
          tone={learned ? "warn" : "accent"}
          valueText={
            bytes ? `${formatMegabytes(bytes, 2)} / ${formatMegabytes(limit)} MB` : "还没有请求"
          }
        />
        <div className="usage-n">
          <span>有效上限 {formatMegabytes(limit)} MB</span>
          <span>超限后压到 {formatMegabytes(limit * LOW_WATER_RATIO)} MB</span>
        </div>
      </div>

      <div className="usage-item">
        <div className="usage-k">
          <span>历史截图</span>
          <b className="num">
            {runtime.historyIncludeImages && images !== undefined ? images : "—"} <em>/ {maxImages} 张</em>
          </b>
        </div>
        <Meter
          label="历史截图"
          value={runtime.historyIncludeImages ? (images ?? 0) : 0}
          max={Math.max(1, maxImages)}
          mark={LOW_WATER_RATIO}
          tone="violet"
          valueText={
            runtime.historyIncludeImages ? `${images ?? 0} / ${maxImages} 张` : "未保留历史截图"
          }
        />
        <div className="usage-n">
          {runtime.historyIncludeImages ? (
            <>
              <span>本轮发送 {images ?? "—"} 张</span>
              <span>超限后保留 {keepAfter} 张</span>
            </>
          ) : (
            <span>未开启保留历史截图</span>
          )}
        </div>
      </div>

      <div className="usage-item">
        <div className="usage-k">
          <span>缓存命中</span>
          <b className="num">{percent !== undefined ? `${percent}%` : "—"}</b>
        </div>
        <Meter
          label="缓存命中"
          value={percent ?? 0}
          max={100}
          tone="ok"
          valueText={percent !== undefined ? `${percent}%` : "未知"}
        />
        <div className="usage-n num">
          <span>
            {status.promptTokens
              ? `${formatCount(status.cachedInputTokens ?? 0)} / ${formatCount(status.promptTokens)} tokens`
              : "服务器没有报告 token 用量"}
          </span>
        </div>
      </div>

      <div className="divider" />

      <div className="usage-compaction">
        <Shrink aria-hidden="true" />
        <div>
          <b>最近一次压缩</b>
          <span className={compaction ? "num" : undefined}>
            {compaction
              ? `${formatClock(compaction.completedAt)} · ${compactionLabel(compaction)}`
              : "还没有压缩过历史"}
          </span>
        </div>
      </div>
      <LinkButton className="usage-link" icon={<ArrowRight />} onClick={() => navigate("logs")}>
        在生成日志中查看
      </LinkButton>
    </Card>
  );
}
