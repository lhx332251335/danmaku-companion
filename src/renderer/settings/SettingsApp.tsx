import { useEffect, useRef, type ComponentType } from "react";
import iconUrl from "../assets/icon-128.png";
import { Callout } from "./components/Callout";
import { pageMeta, type PageId } from "./constants";
import { CapturePage } from "./pages/CapturePage";
import { CharacterPage } from "./pages/CharacterPage";
import { DanmakuPage } from "./pages/DanmakuPage";
import { LogsPage } from "./pages/LogsPage";
import { ModelPage } from "./pages/ModelPage";
import { OverviewPage } from "./pages/OverviewPage";
import { PromptPage } from "./pages/PromptPage";
import { RhythmPage } from "./pages/RhythmPage";
import type { PageProps } from "./pages/types";
import { Banners } from "./shell/Banners";
import { Dock } from "./shell/Dock";
import { PageHeader } from "./shell/PageHeader";
import { Sidebar } from "./shell/Sidebar";
import { useHashPage } from "./shell/useHashPage";
import { useSettingsController } from "./useSettingsController";
import "../styles/shell.css";

const PAGE_COMPONENTS: Record<PageId, ComponentType<PageProps>> = {
  overview: OverviewPage,
  logs: LogsPage,
  model: ModelPage,
  danmaku: DanmakuPage,
  character: CharacterPage,
  prompt: PromptPage,
  rhythm: RhythmPage,
  capture: CapturePage,
};

/** The settings window: sidebar | page (header, banners, content) with the dock below. */
export function SettingsApp() {
  const { loadError, controller } = useSettingsController();
  const [page, navigate] = useHashPage();
  const bodyRef = useRef<HTMLDivElement>(null);
  const meta = pageMeta(page);

  useEffect(() => {
    document.title = `${meta.title} · 弹幕伴侣`;
    bodyRef.current?.scrollTo({ top: 0 });
  }, [meta.title, page]);

  if (loadError) {
    return (
      <main className="app-status">
        <div className="app-status-card">
          <img src={iconUrl} alt="" width={56} height={56} />
          <Callout tone="bad" banner title="设置无法加载：">
            {loadError}
          </Callout>
        </div>
      </main>
    );
  }

  if (!controller) {
    return (
      <main className="app-status" aria-busy="true">
        <div className="app-status-card">
          <img src={iconUrl} alt="" width={56} height={56} />
          <p>加载中…</p>
        </div>
      </main>
    );
  }

  const Page = PAGE_COMPONENTS[page];

  return (
    <div className="app">
      <Sidebar controller={controller} page={page} />
      <main className="main" aria-labelledby="page-title">
        <PageHeader meta={meta} controller={controller} />
        <div className="page-body" ref={bodyRef} data-page={page}>
          <Banners controller={controller} page={page} navigate={navigate} />
          <Page key={page} controller={controller} navigate={navigate} />
        </div>
      </main>
      <Dock controller={controller} />
    </div>
  );
}
