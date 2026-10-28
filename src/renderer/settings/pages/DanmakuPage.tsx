import { Eye, Layers, Moon, Palette, SlidersHorizontal, Sun, Type } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { LIMITS } from "../../../shared/limits";
import type { DanmakuStyleSettings, DanmakuZone } from "../../../shared/types";
import { createTextMeasurer, type TextMeasurer } from "../../danmakuStyle";
import { laneLayout, resolveOverlayStyle, ZONE_BANDS } from "../../overlay/lanes";
import { PALETTE_MAX_COLORS, splitPaletteInput } from "../../settingsModel";
import {
  Callout,
  Card,
  DanmakuStage,
  DanmakuText,
  Field,
  ListField,
  Meter,
  NumberField,
  Segmented,
  SliderField,
  Swatch,
  Switch,
  ZoneIcon,
  type SegmentedOption,
} from "../components";
import { isCssColor, paletteColor, parsePalette, rangeHint, zoneLabels } from "../format";
import type { PageProps } from "./types";
import "../../styles/danmaku.css";

/** The preview assumes a common desktop; the overlay uses the real display size. */
const SCREEN = { width: 1920, height: 1080 } as const;
const STAGE_HEIGHT = 236;

const SAMPLE_COMMENTS = [
  "这关的 BGM 也太燃了吧",
  "前方高能！",
  "宝箱强迫症又犯了",
  "Boss 只剩一丝血",
  "稳住，我们能赢",
] as const;
/** Where each sample starts in its loop (fraction of a crossing), so they do not line up. */
const SAMPLE_PHASES = [0.42, 0.16, 0.56, 0.3, 0.05] as const;
/** Resting positions (left edge, % of the stage) when the user prefers reduced motion. */
const SAMPLE_REST = ["6%", "44%", "2%", "26%", "52%"] as const;

const ZONE_OPTIONS: SegmentedOption<DanmakuZone>[] = (["full", "top", "middle", "bottom"] as const).map(
  (zone) => ({ value: zone, label: zoneLabels[zone], icon: <ZoneIcon zone={zone} /> }),
);

type Backdrop = "night" | "document";

const BACKDROP_OPTIONS: SegmentedOption<Backdrop>[] = [
  { value: "night", label: <span className="sr-only">深色画面</span>, icon: <Moon />, title: "深色画面" },
  { value: "document", label: <span className="sr-only">浅色画面</span>, icon: <Sun />, title: "浅色画面" },
];

let sharedMeasurer: TextMeasurer | null = null;
function measureText(text: string, fontSize: number): number {
  sharedMeasurer ??= createTextMeasurer();
  return sharedMeasurer(text, fontSize);
}

/** Width of an element, kept up to date (0 until mounted). */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    setWidth(element.clientWidth);
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(() => setWidth(element.clientWidth));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

/* ------------------------------------------------------------------ palette */

/** Entries of the typed list that are not CSS colours, and whether it exceeds the limit. */
function paletteProblems(raw: string | null): { invalid: string[]; tooMany: boolean } {
  if (raw === null) return { invalid: [], tooMany: false };
  const entries = splitPaletteInput(raw);
  const invalid = entries.filter((entry) => !isCssColor(entry));
  return { invalid, tooMany: entries.length - invalid.length > PALETTE_MAX_COLORS };
}

function PaletteCard({
  palette,
  onCommit,
}: {
  palette: string[];
  onCommit: (palette: string[]) => void;
}) {
  const [raw, setRaw] = useState<string | null>(null);
  const { invalid, tooMany } = paletteProblems(raw);
  const allInvalid = raw !== null && parsePalette(raw) === undefined && raw.trim() !== "";
  const empty = raw !== null && raw.trim() === "";

  let error: string | undefined;
  if (empty) {
    error = "至少需要一种颜色；离开输入框后恢复为上次的配色。";
  } else if (allInvalid) {
    error = `无法识别 ${invalid.join("、")}，保留上次的配色。`;
  } else if (invalid.length > 0) {
    error = `无法识别 ${invalid.join("、")}，这些不会保存。`;
  }
  const help = tooMany
    ? `最多 ${PALETTE_MAX_COLORS} 种，只保存前 ${PALETTE_MAX_COLORS} 种。`
    : "逗号分隔，支持任意 CSS 颜色（#hex、rgb(255, 0, 0)、颜色名）。无法识别的颜色不会保存。";

  return (
    <Card title="配色" icon={<Palette />} sub="每轮的弹幕依次轮流取色" bodyClassName="dm-palette-body">
      <Field
        label="颜色列表"
        hint={`最多 ${PALETTE_MAX_COLORS} 种`}
        help={error ? undefined : help}
        error={error}
      >
        <ListField
          values={palette}
          parse={parsePalette}
          onCommit={onCommit}
          onTextChange={setRaw}
          placeholder="#31c3a2, #f59e0b"
          mono
        />
      </Field>
      <ul className="dm-swatches" aria-label={`已保存到草稿的 ${palette.length} 种颜色`}>
        {palette.map((color, index) => (
          <li key={`${index}-${color}`}>
            <Swatch color={color} />
          </li>
        ))}
        {invalid.map((entry, index) => (
          <li key={`bad-${index}-${entry}`}>
            <span className="swatch dm-swatch-bad" title="无法识别，不会保存">
              <i aria-hidden="true" />
              <s>{entry}</s>
              <span className="sr-only">（无法识别，不会保存）</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/* ------------------------------------------------------------------ preview */

function ZoneMinimap({ zone, tops, laneHeight, textHeight, preferred }: {
  zone: DanmakuZone;
  tops: number[];
  laneHeight: number;
  textHeight: number;
  preferred: Set<number>;
}) {
  const [start, end] = ZONE_BANDS[zone];
  return (
    <div className="dm-zmap" aria-hidden="true">
      <span className="dm-zmap-band" style={{ top: `${start * 100}%`, height: `${(end - start) * 100}%` }} />
      {tops.map((top, lane) => (
        <span
          key={lane}
          className={preferred.has(lane) ? "dm-zmap-lane is-used" : "dm-zmap-lane"}
          style={{
            top: `${(top / SCREEN.height) * 100}%`,
            // Half the lane pitch, so neighbouring lanes stay apart even at small font sizes.
            height: `${((Math.min(textHeight, laneHeight) * 0.55) / SCREEN.height) * 100}%`,
          }}
        />
      ))}
    </div>
  );
}

function PreviewCard({ danmaku }: { danmaku: DanmakuStyleSettings }) {
  const [backdrop, setBackdrop] = useState<Backdrop>("night");
  const [stageRef, stageWidth] = useWidth<HTMLDivElement>();
  const style = resolveOverlayStyle(danmaku);
  const { fontSize, speedSeconds, zone, density } = style;
  const palette = danmaku.palette;

  // Real screen: the overlay's own lane code at 1920×1080.
  const screen = laneLayout(style, SCREEN.height);
  const preferredSet = new Set(screen.preferred);

  // Stage: the same lane code at the stage height, 1:1 font size; samples use the lanes the
  // density setting prefers (at least two when the zone has room).
  const stageLanes = (() => {
    const layout = laneLayout(style, STAGE_HEIGHT);
    const wanted = Math.min(layout.tops.length, SAMPLE_COMMENTS.length);
    let lanes = layout.preferred.slice(0, wanted);
    if (lanes.length < Math.min(2, wanted)) {
      lanes = layout.tops.map((_, lane) => lane).slice(0, Math.min(2, wanted));
    }
    return lanes.map((lane) => layout.tops[lane]);
  })();

  const width = stageWidth || 320;
  const samples = stageLanes.map((top, index) => {
    const text = SAMPLE_COMMENTS[index];
    const textWidth = measureText(text, fontSize);
    // Like the overlay: the head crosses the stage in speedSeconds; the tail needs a bit longer.
    const duration = (speedSeconds * (width + textWidth)) / width;
    return {
      text,
      color: paletteColor(palette, index),
      top,
      duration,
      delay: -duration * SAMPLE_PHASES[index],
      rest: SAMPLE_REST[index],
    };
  });

  const longest = Math.max(10, Math.round(danmaku.maxCommentLength));
  const longestShare = measureText("弹".repeat(longest), fontSize) / SCREEN.width;
  const sharePercent = Math.round(longestShare * 100);
  const tooWide = longestShare > 1;

  const [bandStart, bandEnd] = ZONE_BANDS[zone];
  const backdropName = backdrop === "night" ? "深色" : "浅色";
  const stageLabel = `弹幕预览：${backdropName}画面上的 ${samples.length} 条示例弹幕，字号 ${fontSize} px，不透明度 ${Math.round(
    danmaku.opacity * 100,
  )}%，${danmaku.shadow ? "有" : "无"}文字阴影，显示区域${zoneLabels[zone]}`;
  const restartKey = [fontSize, speedSeconds, zone, density, palette.join(","), Math.round(width / 8)].join("|");

  return (
    <Card
      title="实时预览"
      icon={<Eye />}
      bodyClassName="dm-preview-body"
      aside={
        <Segmented
          value={backdrop}
          onChange={setBackdrop}
          options={BACKDROP_OPTIONS}
          size="sm"
          aria-label="预览背景"
          className="dm-backdrop-seg"
        />
      }
    >
      <div ref={stageRef} className="dm-preview-stage">
        <DanmakuStage
          backdrop={backdrop}
          height={STAGE_HEIGHT}
          zone={{ top: bandStart, bottom: bandEnd }}
          label={stageLabel}
        >
          {samples.map((sample, index) => (
            <DanmakuText
              key={`${restartKey}-${index}`}
              text={sample.text}
              color={sample.color}
              fontSize={fontSize}
              opacity={danmaku.opacity}
              shadow={danmaku.shadow}
              fly={{
                top: `${sample.top}px`,
                duration: Number(sample.duration.toFixed(2)),
                delay: Number(sample.delay.toFixed(2)),
                x: sample.rest,
              }}
            />
          ))}
        </DanmakuStage>
      </div>

      <div className="dm-zone-row">
        <ZoneMinimap
          zone={zone}
          tops={screen.tops}
          laneHeight={screen.laneHeight}
          textHeight={Math.ceil(fontSize * 1.25)}
          preferred={preferredSet}
        />
        <p className="dm-zone-text">
          <b>
            {zoneLabels[zone]} · {screen.tops.length} 条轨道
          </b>
          <span>平时使用其中 {screen.preferred.length} 条</span>
          <span>约 {formatSeconds(speedSeconds)} 秒穿过屏幕</span>
        </p>
      </div>

      <div className="dm-width">
        <div className="dm-width-label" id="dm-width-label">
          <span>最长一条（{longest} 字）约占屏宽</span>
          <b className={tooWide ? "num is-warn" : "num"}>{sharePercent}%</b>
        </div>
        <Meter
          value={Math.min(1, longestShare)}
          max={1}
          label={`最长一条（${longest} 字）约占屏宽`}
          valueText={`${sharePercent}%`}
          tone={tooWide ? "warn" : "accent"}
        />
      </div>

      {tooWide ? (
        <p className="help dm-width-warn">比屏幕还宽：这么长的弹幕开头移出屏幕后，结尾才会出现。</p>
      ) : null}
      <p className="help">预览按 1:1 字号显示；轨道数与占比按 1920×1080 屏幕估算。</p>
    </Card>
  );
}

function formatSeconds(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

/* ------------------------------------------------------------------ page */

/** 弹幕外观 (#danmaku): 文字, 运动与分布, 配色, 弹幕层与录屏, sticky 实时预览. */
export function DanmakuPage({ controller }: PageProps) {
  const { draft, edit } = controller;
  const danmaku = draft.danmaku;
  const set = (patch: Partial<DanmakuStyleSettings>) => edit("danmaku", patch);

  return (
    <div className="split is-wide danmaku-page">
      <div className="stack">
        <Card title="文字" icon={<Type />}>
          <Field
            label="字号"
            hint={rangeHint(LIMITS.fontSize, "px")}
            help="字越大，屏幕上能容纳的轨道越少"
          >
            <SliderField
              value={danmaku.fontSize}
              range={LIMITS.fontSize}
              step={1}
              integer
              unit="px"
              onCommit={(fontSize) => set({ fontSize })}
            />
          </Field>
          <Field
            label="不透明度"
            hint={rangeHint(LIMITS.opacity, "%", 100)}
            help="100% 为完全不透明；调低后弹幕不那么挡画面"
          >
            <SliderField
              value={danmaku.opacity}
              range={LIMITS.opacity}
              step={0.01}
              scale={100}
              numberStep={1}
              unit="%"
              onCommit={(opacity) => set({ opacity })}
            />
          </Field>
          <div className="row2 dm-text-row">
            <Field
              label="单条最多字数"
              hint={rangeHint(LIMITS.maxCommentLength, "")}
              help="模型返回的更长弹幕会被截断"
            >
              <NumberField
                value={danmaku.maxCommentLength}
                range={LIMITS.maxCommentLength}
                integer
                unit="字"
                onCommit={(maxCommentLength) => set({ maxCommentLength })}
              />
            </Field>
            <Switch
              className="dm-shadow-switch"
              checked={danmaku.shadow}
              onChange={(shadow) => set({ shadow })}
              label="文字阴影"
              description="描边加阴影，亮色画面上更清楚"
            />
          </div>
        </Card>

        <Card title="运动与分布" icon={<SlidersHorizontal />} iconTone="coral">
          <Field label="显示区域" group help="弹幕只在屏幕的这一段高度里滚动">
            <Segmented
              value={danmaku.zone}
              onChange={(zone) => set({ zone })}
              options={ZONE_OPTIONS}
              full
            />
          </Field>
          <Field label="滚动时长" hint="穿过整个屏幕的秒数，越大越慢" help={`可设 ${rangeHint(LIMITS.speedSeconds, "秒")}`}>
            <SliderField
              value={danmaku.speedSeconds}
              range={LIMITS.speedSeconds}
              step={1}
              unit="秒"
              onCommit={(speedSeconds) => set({ speedSeconds })}
            />
          </Field>
          <Field
            label="密度"
            hint="平时使用的轨道比例"
            help="弹幕多时仍会借用其余轨道，尽量不重叠"
          >
            <SliderField
              value={danmaku.density}
              range={LIMITS.density}
              step={0.05}
              onCommit={(density) => set({ density })}
            />
          </Field>
        </Card>

        <PaletteCard palette={danmaku.palette} onCommit={(palette) => set({ palette })} />

        <Card title="弹幕层与录屏" icon={<Layers />} iconTone="violet">
          <Switch
            checked={danmaku.excludeOverlayFromCapture}
            onChange={(excludeOverlayFromCapture) => set({ excludeOverlayFromCapture })}
            label="截图时排除弹幕层"
            description="截图里不含弹幕，模型不会看到并评论自己的弹幕"
          />
          <Callout tone="warn">
            开启后 <b>OBS 等录屏、直播软件也录不到弹幕</b>。需要 Windows 10 2004 及以上。想把弹幕录进视频时请关闭。
          </Callout>
        </Card>
      </div>

      <div className="aside">
        <PreviewCard danmaku={danmaku} />
      </div>
    </div>
  );
}
