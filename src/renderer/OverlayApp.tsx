import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { defaultAppConfig } from "../shared/defaultConfig";
import type { AppConfig, DanmakuItem } from "../shared/types";
import { api } from "./api";
import { createTextMeasurer, danmakuTextClass, type TextMeasurer } from "./danmakuStyle";
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

interface DanmakuLineProps {
  item: PlannedDanmaku;
  shadow: boolean;
  onDone: (id: string) => void;
}

/** Name of the scroll keyframes in styles/overlay.css; the fade-in ends earlier. */
const MOVE_ANIMATION = "danmaku-move";

const DanmakuLine = memo(function DanmakuLine({ item, shadow, onDone }: DanmakuLineProps) {
  return (
    <div
      className={`${danmakuTextClass(item.color, shadow)} danmaku-line`}
      onAnimationEnd={(event) => {
        if (event.animationName === MOVE_ANIMATION) {
          onDone(item.id);
        }
      }}
      style={
        {
          top: `${item.top}px`,
          color: item.color,
          "--dur": `${Math.round(item.durationMs)}ms`,
          "--delay": `${Math.round(item.delayMs)}ms`,
        } as React.CSSProperties
      }
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

  return (
    <main className="overlay-root" style={style as React.CSSProperties}>
      {items.map((item) => (
        <DanmakuLine item={item} key={item.id} onDone={removeItem} shadow={danmaku.shadow} />
      ))}
    </main>
  );
}
