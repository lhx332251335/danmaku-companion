import { useEffect, useMemo, useState } from "react";
import type { AppConfig, DanmakuItem } from "../shared/types";
import { api } from "./api";

interface RenderedItem extends DanmakuItem {
  top: number;
  delayMs: number;
}

function topForZone(zone: AppConfig["danmaku"]["zone"], index: number): number {
  const bands = {
    top: [8, 32],
    middle: [34, 62],
    bottom: [64, 88],
    full: [8, 88],
  } satisfies Record<AppConfig["danmaku"]["zone"], [number, number]>;
  const [min, max] = bands[zone];
  const spread = max - min;
  return min + ((index * 11 + Math.random() * 8) % spread);
}

export function OverlayApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [items, setItems] = useState<RenderedItem[]>([]);

  useEffect(() => {
    document.documentElement.classList.add("overlay-view");
    document.body.classList.add("overlay-view");

    return () => {
      document.documentElement.classList.remove("overlay-view");
      document.body.classList.remove("overlay-view");
    };
  }, []);

  useEffect(() => {
    void api().getConfig().then(setConfig);

    if (new URLSearchParams(window.location.search).has("demo")) {
      setItems([
        {
          id: "overlay-demo",
          text: "预览弹幕已经就位",
          createdAt: new Date().toISOString(),
          source: "system",
          top: 24,
          delayMs: 0,
        },
      ]);
    }

    const removeItems = api().onDanmakuItems((incoming) => {
      setItems((current) => {
        const rendered = incoming.map((item, index) => ({
          ...item,
          top: topForZone(config?.danmaku.zone ?? "full", current.length + index),
          delayMs: index * 350,
        }));
        return [...current, ...rendered].slice(-80);
      });
    });
    const removeClear = api().onOverlayClear(() => setItems([]));
    const removeConfigUpdated = api().onConfigUpdated(setConfig);

    return () => {
      removeItems();
      removeClear();
      removeConfigUpdated();
    };
  }, [config?.danmaku.zone]);

  const style = useMemo(
    () => ({
      "--danmaku-font-size": `${config?.danmaku.fontSize ?? 22}px`,
      "--danmaku-opacity": config?.danmaku.opacity ?? 0.92,
      "--danmaku-speed": `${config?.danmaku.speedSeconds ?? 10}s`,
    }),
    [config],
  );

  useEffect(() => {
    const timers = items.map((item) =>
      window.setTimeout(
        () => {
          setItems((current) => current.filter((candidate) => candidate.id !== item.id));
        },
        ((item.speedSeconds ?? config?.danmaku.speedSeconds ?? 10) + 1) * 1000 +
          item.delayMs,
      ),
    );
    return () => timers.forEach(window.clearTimeout);
  }, [items, config?.danmaku.speedSeconds]);

  return (
    <main className="overlay-root" style={style as React.CSSProperties}>
      {items.map((item) => (
        <div
          className={`danmaku-line ${config?.danmaku.shadow ? "with-shadow" : ""}`}
          key={item.id}
          style={{
            top: `${item.top}%`,
            color: item.color,
            opacity: config?.danmaku.opacity ?? 0.92,
            animationDuration: `${item.speedSeconds ?? config?.danmaku.speedSeconds ?? 10}s`,
            animationDelay: `${item.delayMs}ms`,
          }}
        >
          {item.text}
        </div>
      ))}
    </main>
  );
}
