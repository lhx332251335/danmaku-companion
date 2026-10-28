/**
 * Helpers shared by the overlay window and the settings previews, so both measure and
 * style danmaku text the same way (see styles/overlay.css, `.danmaku-text`).
 */

/** Weight of `.danmaku-text`; the lane planner measures with it. */
export const DANMAKU_FONT_WEIGHT = 800;

/** Fallback when the CSS custom property is not available (tests, very early calls). */
const FALLBACK_FONT_FAMILY =
  '"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","Microsoft YaHei","PingFang SC","Hiragino Sans GB","Segoe UI Emoji","Apple Color Emoji","Noto Color Emoji",system-ui,sans-serif';

export type TextMeasurer = (text: string, fontSize: number) => number;

/** The font stack of `.danmaku-text` (the --danmaku-font custom property on :root). */
export function danmakuFontFamily(): string {
  if (typeof document === "undefined") {
    return FALLBACK_FONT_FAMILY;
  }
  const value = getComputedStyle(document.documentElement).getPropertyValue("--danmaku-font").trim();
  return value || FALLBACK_FONT_FAMILY;
}

/** Canvas text measurer in the danmaku font; falls back to one em per character. */
export function createTextMeasurer(): TextMeasurer {
  const context =
    typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  const fontFamily = danmakuFontFamily();
  return (text, fontSize) => {
    if (!context) {
      return text.length * fontSize;
    }
    context.font = `${DANMAKU_FONT_WEIGHT} ${fontSize}px ${fontFamily}`;
    return Math.ceil(context.measureText(text).width);
  };
}

const lightCache = new Map<string, boolean>();
let colorContext: CanvasRenderingContext2D | null | undefined;

function parseRgb(normalized: string): [number, number, number] | undefined {
  const hex = /^#([0-9a-f]{6})$/i.exec(normalized);
  if (hex) {
    const n = Number.parseInt(hex[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)/i.exec(normalized);
  return rgb ? [Number(rgb[1]), Number(rgb[2]), Number(rgb[3])] : undefined;
}

function channel(value: number): number {
  const c = value / 255;
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
}

/**
 * True for very light text colours (relative luminance above 0.7, e.g. #f8fafc or yellow),
 * which vanish on white apps without an outline. Any CSS colour works; unknown → false.
 */
export function isLightColor(color: string | undefined): boolean {
  if (!color) {
    return true; // the default #f8fafc
  }
  const cached = lightCache.get(color);
  if (cached !== undefined) {
    return cached;
  }
  if (colorContext === undefined) {
    colorContext =
      typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
  }
  let light = false;
  if (colorContext) {
    colorContext.fillStyle = "#000000";
    colorContext.fillStyle = color;
    const rgb = parseRgb(String(colorContext.fillStyle));
    if (rgb) {
      const luminance = 0.2126 * channel(rgb[0]) + 0.7152 * channel(rgb[1]) + 0.0722 * channel(rgb[2]);
      light = luminance > 0.7;
    }
  }
  lightCache.set(color, light);
  return light;
}

/** Class list of one danmaku line: shared text style, shadow and the light-colour guard. */
export function danmakuTextClass(color: string | undefined, shadow: boolean): string {
  return ["danmaku-text", shadow ? "with-shadow" : "", isLightColor(color) ? "is-light" : ""]
    .filter(Boolean)
    .join(" ");
}
