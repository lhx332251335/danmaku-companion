import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultAppConfig } from "../shared/defaultConfig";
import type { AppConfig, DanmakuItem } from "../shared/types";
import { api } from "./api";
import { createExpiryTimers } from "./overlay/expiryTimers";
import {
  planDanmaku,
  resolveOverlayStyle,
  type LaneOccupant,
  type PlannedDanmaku,
} from "./overlay/lanes";

const MAX_ITEMS = 80;
/** Fallback removal after the animation should have ended, e.g. while the window is hidden. */
const REMOVAL_GRACE_MS = 1000;

type TextMeasurer = (text: string, fontSize: number) => number;

function createTextMeasurer(): TextMeasurer {
  const context = document.createElement("canvas").getContext("2d");
  const fontFamily = getComputedStyle(document.documentElement).fontFamily;
  return (text, fontSize) => {
    if (!context) {
      return text.length * fontSize;
    }
    context.font = `800 ${fontSize}px ${fontFamily}`;
    return Math.ceil(context.measureText(text).width);
  };
}

interface DanmakuLineProps {
  item: PlannedDanmaku;
  className: string;
  onDone: (id: string) => void;
}

const DanmakuLine = memo(function DanmakuLine({ item, className, onDone }: DanmakuLineProps) {
  return (
    <div
      className={className}
      onAnimationEnd={() => onDone(item.id)}
      style={{
        top: `${item.top}px`,
        color: item.color,
        animationDuration: `${Math.round(item.durationMs)}ms`,
        animationDelay: `${Math.round(item.delayMs)}ms`,
      }}
    >
      {item.text}
    </div>
  );
});

export function OverlayApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [items, setItems] = useState<PlannedDanmaku[]>([]);
  const [expiryTimers] = useState(() => createExpiryTimers());
  const configRef = useRef<AppConfig | null>(null);
  const occupantsRef = useRef<LaneOccupant[]>([]);
  const measureRef = useRef<TextMeasurer | null>(null);

  const removeItem = useCallback(
    (id: string) => {
      expiryTimers.cancel(id);
      setItems((current) => current.filter((item) => item.id !== id));
    },
    [expiryTimers],
  );

  useEffect(() => {
    document.documentElement.classList.add("overlay-view");
    document.body.classList.add("overlay-view");

    return () => {
      document.documentElement.classList.remove("overlay-view");
      document.body.classList.remove("overlay-view");
    };
  }, []);

  useEffect(() => {
    let disposed = false;

    const applyConfig = (next: AppConfig) => {
      configRef.current = next;
      setConfig(next);
    };

    const showItems = (incoming: DanmakuItem[]) => {
      if (incoming.length === 0) {
        return;
      }
      const style = resolveOverlayStyle(configRef.current?.danmaku);
      const measure = (measureRef.current ??= createTextMeasurer());
      const plan = planDanmaku(occupantsRef.current, incoming, {
        now: performance.now(),
        viewport: { width: window.innerWidth, height: window.innerHeight },
        style,
        measureWidth: (text) => measure(text, style.fontSize),
      });
      occupantsRef.current = plan.occupants;
      plan.items.forEach((item) =>
        expiryTimers.schedule(item.id, item.delayMs + item.durationMs + REMOVAL_GRACE_MS, () =>
          removeItem(item.id),
        ),
      );
      setItems((current) => [...current, ...plan.items].slice(-MAX_ITEMS));
    };

    const clearItems = () => {
      expiryTimers.clear();
      occupantsRef.current = [];
      setItems([]);
    };

    void api()
      .getConfig()
      .then((loaded) => {
        if (!disposed && !configRef.current) {
          applyConfig(loaded);
        }
      });

    if (new URLSearchParams(window.location.search).has("demo")) {
      showItems([
        {
          id: "overlay-demo",
          text: "预览弹幕已经就位",
          createdAt: new Date().toISOString(),
          source: "system",
        },
      ]);
    }

    const removeItems = api().onDanmakuItems(showItems);
    const removeClear = api().onOverlayClear(clearItems);
    const removeConfigUpdated = api().onConfigUpdated(applyConfig);

    return () => {
      disposed = true;
      removeItems();
      removeClear();
      removeConfigUpdated();
      clearItems();
    };
  }, [expiryTimers, removeItem]);

  const danmaku = (config ?? defaultAppConfig).danmaku;
  const fontSize = resolveOverlayStyle(danmaku).fontSize;
  const style = useMemo(
    () => ({
      "--danmaku-font-size": `${fontSize}px`,
      "--danmaku-opacity": danmaku.opacity,
    }),
    [fontSize, danmaku.opacity],
  );
  const lineClass = danmaku.shadow ? "danmaku-line with-shadow" : "danmaku-line";

  return (
    <main className="overlay-root" style={style as React.CSSProperties}>
      {items.map((item) => (
        <DanmakuLine className={lineClass} item={item} key={item.id} onDone={removeItem} />
      ))}
    </main>
  );
}
