import {
  Activity,
  Cable,
  CopyPlus,
  Cpu,
  Eye,
  EyeOff,
  History as HistoryIcon,
  Layers,
  LoaderCircle,
  MessageSquareText,
  Pause,
  Pencil,
  Play,
  RefreshCw,
  Save,
  Shield,
  SlidersHorizontal,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import { memo, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { LIMITS, type NumericRange } from "../shared/limits";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfilesSnapshot,
  ConnectionTestResult,
  DanmakuBridge,
  GenerationLogEntry,
  ModelListResult,
  RuntimeStatus,
} from "../shared/types";
import { api } from "./api";
import {
  describeError,
  isDraftDirty,
  parseListInput,
  parseNumberInput,
  parsePaletteInput,
  rebaseDraft,
  shouldReloadLogs,
  toConfigPatch,
} from "./settingsModel";

type DraftSection = "model" | "character" | "user" | "prompt" | "danmaku" | "runtime";

const statusLabels: Record<RuntimeStatus["state"], string> = {
  idle: "空闲",
  running: "运行中",
  paused: "已暂停",
  error: "错误",
};

const promptPlaceholders = [
  "{{companion.name}}",
  "{{companion.persona}}",
  "{{companion.tone}}",
  "{{companion.language}}",
  "{{user.name}}",
  "{{user.role}}",
  "{{activeApp}}",
  "{{requestedCount}}",
  "{{jsonShape}}",
];

const unimplementedHints = {
  activeApp: "尚未实现：目前总是填入 unknown",
  density: "尚未实现：弹幕层不读取密度，修改它没有效果",
  blacklist: "尚未实现：截图前不会检查前台应用，名单里的应用照样会被截图并发送",
  persistScreenshots: "尚未实现：截图从不写入磁盘",
};

const unimplementedPlaceholders: Record<string, string> = {
  "{{activeApp}}": unimplementedHints.activeApp,
};

const isMac = /Mac/.test(navigator.userAgent);

function isCssColor(value: string): boolean {
  return typeof CSS === "undefined" || typeof CSS.supports !== "function"
    ? true
    : CSS.supports("color", value);
}

function parsePalette(raw: string): string[] | undefined {
  return parsePaletteInput(raw, isCssColor);
}

const logStatusLabels: Record<GenerationLogEntry["status"], string> = {
  success: "成功",
  error: "失败",
  aborted: "中断",
};

const logTimeFormat = new Intl.DateTimeFormat(undefined, {
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
});

const LOG_PAGE_SIZE = 100;

function formatLogTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "-" : logTimeFormat.format(date);
}

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return `${ms}ms`;
}

function formatBytes(bytes: number | undefined): string {
  if (!bytes || bytes <= 0) {
    return "-";
  }

  if (bytes >= 1024 * 1024) {
    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}

function formatCacheUsage(cached: number | undefined, prompt: number | undefined): string {
  if (cached === undefined) {
    return prompt === undefined ? "-" : `? / ${prompt}`;
  }

  if (!prompt) {
    return String(cached);
  }

  return `${cached} / ${prompt} (${Math.round((cached / prompt) * 100)}%)`;
}

function compactionLabel(log: GenerationLogEntry): string {
  if (!log.compaction?.length) {
    return "-";
  }

  return log.compaction
    .map((entry) => {
      const trigger = entry.trigger === "413" ? "413 后" : entry.reason === "bytes" ? "超出大小" : "超出张数";
      return `${trigger}丢弃 ${entry.droppedImages} 张`;
    })
    .join("；");
}

function screenLabel(log: GenerationLogEntry): string {
  if (!log.screen.enabled) {
    return "无截图";
  }

  if (!log.screen.captured) {
    return "截图失败";
  }

  return `${log.screen.width ?? "-"}x${log.screen.height ?? "-"}`;
}

function activeProfileName(profiles: ConfigProfilesSnapshot | null): string {
  return profiles?.profiles.find((profile) => profile.active)?.name ?? "";
}

function TodoTag({ hint }: { hint: string }) {
  return (
    <span className="todo-tag" title={hint}>
      未实现
    </span>
  );
}

interface NumberFieldProps {
  label: ReactNode;
  value: number;
  range: NumericRange;
  step: number;
  integer?: boolean;
  disabled?: boolean;
  title?: string;
  onCommit: (value: number) => void;
}

/** Keeps the typed text while editing; only finite, clamped numbers reach the draft. */
function NumberField({
  label,
  value,
  range,
  step,
  integer = false,
  disabled,
  title,
  onCommit,
}: NumberFieldProps) {
  const [text, setText] = useState<string | null>(null);

  function handleChange(raw: string) {
    setText(raw);
    const parsed = parseNumberInput(raw, range, integer);
    if (parsed !== undefined && parsed !== value) {
      onCommit(parsed);
    }
  }

  return (
    <label title={title}>
      <span>{label}</span>
      <input
        type="number"
        min={range.min}
        max={range.max}
        step={step}
        value={text ?? String(value)}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setText(null)}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            setText(null);
          }
        }}
      />
    </label>
  );
}

interface ListFieldProps {
  label: ReactNode;
  values: string[];
  parse: (raw: string) => string[] | undefined;
  placeholder?: string;
  disabled?: boolean;
  title?: string;
  onCommit: (values: string[]) => void;
}

/** Comma-separated list input that keeps the raw text (including a trailing comma) while focused. */
function ListField({
  label,
  values,
  parse,
  placeholder,
  disabled,
  title,
  onCommit,
}: ListFieldProps) {
  const [text, setText] = useState<string | null>(null);

  function handleChange(raw: string) {
    setText(raw);
    const parsed = parse(raw);
    if (parsed && parsed.join("\n") !== values.join("\n")) {
      onCommit(parsed);
    }
  }

  return (
    <label title={title}>
      <span>{label}</span>
      <input
        value={text ?? values.join(", ")}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => handleChange(event.target.value)}
        onBlur={() => setText(null)}
      />
    </label>
  );
}

function GenerationLogDetail({ log }: { log: GenerationLogEntry }) {
  return (
    <div className="log-detail">
      <div className="log-meta-grid">
        <div>
          <b>模型</b>
          <span>{log.model ?? "-"}</span>
        </div>
        <div>
          <b>投放窗口</b>
          <span>
            {log.releaseWindowSeconds !== undefined ? `${log.releaseWindowSeconds}s` : "-"}
          </span>
        </div>
        <div>
          <b>历史轮数</b>
          <span>{log.historyRoundsUsed ?? 0}</span>
        </div>
        <div>
          <b>历史模式</b>
          <span>{log.historyMode ?? "-"}</span>
        </div>
        <div>
          <b>历史截图</b>
          <span>
            {log.historyImagesIncluded
              ? `保留 · 本次 ${log.historyImagesSent ?? 0} 张`
              : "不保留"}
          </span>
        </div>
        <div>
          <b>请求体</b>
          <span>
            {log.requestBytes !== undefined
              ? `${formatBytes(log.requestBytes)} / ${formatBytes(log.bodyLimitBytes)}`
              : "-"}
          </span>
        </div>
        <div>
          <b>历史压缩</b>
          <span>{compactionLabel(log)}</span>
        </div>
        <div>
          <b>缓存 / 输入 tokens</b>
          <span>{formatCacheUsage(log.cachedInputTokens, log.promptTokens)}</span>
        </div>
        <div>
          <b>输出 tokens</b>
          <span>{log.completionTokens ?? "-"}</span>
        </div>
        <div>
          <b>预填充耗时</b>
          <span>{log.promptMs !== undefined ? formatDuration(Math.round(log.promptMs)) : "-"}</span>
        </div>
        <div>
          <b>截图来源</b>
          <span>{log.screen.sourceName ?? "-"}</span>
        </div>
        <div>
          <b>截图格式</b>
          <span>
            {[
              log.screen.format?.toUpperCase(),
              log.screen.jpegQuality !== undefined
                ? `q${Math.round(log.screen.jpegQuality * 100)}`
                : undefined,
            ].filter(Boolean).join(" · ") || "-"}
          </span>
        </div>
        <div>
          <b>图片大小</b>
          <span>{formatBytes(log.screen.imageBytes)}</span>
        </div>
        <div>
          <b>传输大小</b>
          <span>
            {formatBytes(log.screen.dataUrlBytes)}
            {log.screen.resizedToFit ? "（已缩小以适应上限）" : ""}
          </span>
        </div>
        <div>
          <b>开始时间</b>
          <span>{formatLogTime(log.startedAt)}</span>
        </div>
      </div>
      {log.error ? <div className="log-message-error">{log.error}</div> : null}
      {log.screen.error ? <div className="log-message-error">{log.screen.error}</div> : null}
      <div className="comment-log-list">
        {log.comments.length === 0 ? (
          <span className="muted-text">没有生成弹幕</span>
        ) : (
          log.comments.map((comment, index) => <span key={`${log.id}-${index}`}>{comment}</span>)
        )}
      </div>
      {log.rawOutput?.trim() ? (
        <details className="raw-output-panel">
          <summary>原始输出</summary>
          <pre>{log.rawOutput}</pre>
        </details>
      ) : null}
    </div>
  );
}

/** Log entries never change after they are written, so the id is enough to skip re-rendering. */
const GenerationLogItem = memo(
  function GenerationLogItem({ log }: { log: GenerationLogEntry }) {
    const [open, setOpen] = useState(false);

    return (
      <details
        className={`log-entry log-status-${log.status}`}
        onToggle={(event) => setOpen(event.currentTarget.open)}
      >
        <summary>
          <span className="log-status">{logStatusLabels[log.status]}</span>
          <span>{formatLogTime(log.completedAt)}</span>
          <span>{formatDuration(log.durationMs)}</span>
          <span>
            {log.generatedCount ?? 0}/{log.requestedCount ?? "-"} 条
          </span>
          <span>{screenLabel(log)}</span>
          <span>{log.reason === "manual" ? "手动" : "自动"}</span>
        </summary>
        {open ? <GenerationLogDetail log={log} /> : null}
      </details>
    );
  },
  (previous, next) => previous.log.id === next.log.id,
);

const GenerationLogList = memo(function GenerationLogList({
  logs,
}: {
  logs: GenerationLogEntry[];
}) {
  const [visibleCount, setVisibleCount] = useState(LOG_PAGE_SIZE);

  if (logs.length === 0) {
    return <div className="empty-state">还没有生成记录</div>;
  }

  const hiddenCount = logs.length - visibleCount;
  return (
    <div className="log-list">
      {logs.slice(0, visibleCount).map((log) => (
        <GenerationLogItem key={log.id} log={log} />
      ))}
      {hiddenCount > 0 ? (
        <button
          type="button"
          className="secondary-button log-more-button"
          onClick={() => setVisibleCount((count) => count + LOG_PAGE_SIZE)}
        >
          显示更早的 {Math.min(hiddenCount, LOG_PAGE_SIZE)} 条（还有 {hiddenCount} 条）
        </button>
      ) : null}
    </div>
  );
});

export function SettingsApp() {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [profiles, setProfiles] = useState<ConfigProfilesSnapshot | null>(null);
  const [profileName, setProfileName] = useState("");
  const [newProfileName, setNewProfileName] = useState("");
  const [status, setStatus] = useState<RuntimeStatus>({ state: "idle", cycles: 0 });
  const [saving, setSaving] = useState(false);
  const [workingAction, setWorkingAction] = useState<
    "generate" | "start" | "test" | null
  >(null);
  const [profileWorking, setProfileWorking] = useState<
    "create" | "rename" | "switch" | "delete" | null
  >(null);
  const [connection, setConnection] = useState<ConnectionTestResult | null>(null);
  const [modelList, setModelList] = useState<ModelListResult | null>(null);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [generationLogs, setGenerationLogs] = useState<GenerationLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const configRef = useRef<AppConfig | null>(null);
  const statusRef = useRef(status);

  useEffect(() => {
    let bridge: DanmakuBridge;
    try {
      bridge = api();
    } catch (error) {
      setLoadError(describeError(error));
      return undefined;
    }

    let disposed = false;
    Promise.all([bridge.getConfig(), bridge.getRuntimeStatus(), bridge.getConfigProfiles()]).then(
      ([loadedConfig, loadedStatus, loadedProfiles]) => {
        if (disposed) return;
        if (!configRef.current) {
          resetConfig(loadedConfig);
        }
        showProfiles(loadedProfiles);
        showStatus(loadedStatus);
        runInBackground(loadModelList(false));
        runInBackground(loadGenerationLogs(false));
      },
      (error: unknown) => {
        if (!disposed) setLoadError(describeError(error));
      },
    );

    const removeStatus = bridge.onRuntimeStatus(handleStatusBroadcast);
    const removeConfig = bridge.onConfigUpdated((next) => adoptConfig(next));
    return () => {
      disposed = true;
      removeStatus();
      removeConfig();
    };
  }, []);

  const dirty = useMemo(
    () => Boolean(config && draft && isDraftDirty(config, draft)),
    [config, draft],
  );

  function reportError(error: unknown) {
    setActionError(describeError(error));
  }

  async function runAction(action: () => Promise<unknown>) {
    setActionError(null);
    try {
      await action();
    } catch (error) {
      reportError(error);
    }
  }

  function runInBackground(task: Promise<unknown>) {
    task.catch(reportError);
  }

  /** Replaces the draft, dropping unsaved edits (profile switches and the first load). */
  function resetConfig(next: AppConfig) {
    configRef.current = next;
    setConfig(next);
    setDraft(next);
  }

  /** Takes a newer saved config, keeping the fields the user edited since `previous`. */
  function adoptConfig(next: AppConfig, previous = configRef.current) {
    configRef.current = next;
    setConfig(next);
    setDraft((current) => (current && previous ? rebaseDraft(previous, next, current) : next));
  }

  function editSection<K extends DraftSection>(section: K, patch: Partial<AppConfig[K]>) {
    setDraft((current) =>
      current ? ({ ...current, [section]: { ...current[section], ...patch } } as AppConfig) : current,
    );
  }

  function showProfiles(next: ConfigProfilesSnapshot) {
    setProfiles(next);
    setProfileName(activeProfileName(next));
  }

  function showStatus(next: RuntimeStatus) {
    statusRef.current = next;
    setStatus(next);
  }

  function handleStatusBroadcast(next: RuntimeStatus) {
    const previous = statusRef.current;
    showStatus(next);
    if (shouldReloadLogs(previous, next)) {
      runInBackground(loadGenerationLogs(false));
    }
  }

  async function saveDraft() {
    if (!draft || !dirty) return;

    const sent = draft;
    setSaving(true);
    try {
      adoptConfig(await api().updateConfig(toConfigPatch(sent)), sent);
      showProfiles(await api().getConfigProfiles());
    } finally {
      setSaving(false);
    }
  }

  function applyProfileResult(result: ConfigProfileResult) {
    resetConfig(result.config);
    showProfiles(result.profiles);
    setConnection(null);
    setModelList(null);
    runInBackground(loadModelList(false));
    runInBackground(loadGenerationLogs(false));
  }

  async function createProfile() {
    setProfileWorking("create");
    try {
      await saveDraft();
      const result = await api().createConfigProfile(newProfileName);
      applyProfileResult(result);
      setNewProfileName("");
    } finally {
      setProfileWorking(null);
    }
  }

  async function renameProfile() {
    const activeProfile = profiles?.profiles.find((profile) => profile.active);
    if (!activeProfile || !profileName.trim()) return;

    setProfileWorking("rename");
    try {
      showProfiles(await api().renameConfigProfile(activeProfile.id, profileName));
    } finally {
      setProfileWorking(null);
    }
  }

  async function switchProfile(id: string) {
    if (!profiles || id === profiles.activeProfileId) return;

    setProfileWorking("switch");
    try {
      await saveDraft();
      applyProfileResult(await api().switchConfigProfile(id));
    } finally {
      setProfileWorking(null);
    }
  }

  async function deleteProfile() {
    const activeProfile = profiles?.profiles.find((profile) => profile.active);
    if (!activeProfile || (profiles?.profiles.length ?? 0) <= 1) return;
    if (!window.confirm(`删除配置“${activeProfile.name}”？`)) return;

    setProfileWorking("delete");
    try {
      applyProfileResult(await api().deleteConfigProfile(activeProfile.id));
    } finally {
      setProfileWorking(null);
    }
  }

  async function generateOnce() {
    setWorkingAction("generate");
    try {
      await saveDraft();
      showStatus(await api().generateOnce());
    } finally {
      setWorkingAction(null);
    }
  }

  async function toggleRuntime() {
    setWorkingAction("start");
    try {
      if (status.state === "running") {
        showStatus(await api().stop());
      } else {
        await saveDraft();
        showStatus(await api().start());
      }
    } finally {
      setWorkingAction(null);
    }
  }

  async function testConnection() {
    setWorkingAction("test");
    setConnection(null);
    try {
      await saveDraft();
      setConnection(await api().testModelConnection());
      await loadModelList(false);
    } finally {
      setWorkingAction(null);
    }
  }

  async function loadModelList(saveFirst = true) {
    setModelListLoading(true);
    try {
      if (saveFirst) {
        await saveDraft();
      }
      setModelList(await api().listModels());
    } finally {
      setModelListLoading(false);
    }
  }

  async function loadGenerationLogs(showLoading = true) {
    if (showLoading) {
      setLogsLoading(true);
    }
    try {
      setGenerationLogs(await api().getGenerationLogs());
    } finally {
      if (showLoading) {
        setLogsLoading(false);
      }
    }
  }

  async function clearGenerationLogs() {
    setLogsLoading(true);
    try {
      await api().clearGenerationLogs();
      setGenerationLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  async function toggleOverlay() {
    const next = !overlayVisible;
    await api().setOverlayVisible(next);
    setOverlayVisible(next);
  }

  if (loadError) {
    return (
      <main className="app-shell loading">
        <div className="error-banner load-error" role="alert">
          {loadError}
        </div>
      </main>
    );
  }

  if (!draft) {
    return <main className="app-shell loading">加载中…</main>;
  }

  const modelOptions = modelList?.models ?? [];
  const selectedModel = modelOptions.find((model) => model.id === draft.model.model);
  const selectedModelValue = selectedModel ? selectedModel.id : "";
  const selectedModelStatus = selectedModel
    ? [selectedModel.state, selectedModel.vision ? "视觉" : undefined]
        .filter(Boolean)
        .join(" · ")
    : "";
  const modelListNote =
    modelList?.ok === false
      ? modelList.message
      : modelList
        ? [
            `${modelList.models.length} 个模型`,
            selectedModelStatus || undefined,
          ].filter(Boolean).join(" · ")
        : "-";
  const activeProfile = profiles?.profiles.find((profile) => profile.active);
  const profileBusy = saving || profileWorking !== null;
  const overlayToggleLabel = overlayVisible ? "隐藏弹幕层" : "显示弹幕层";

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">本地优先的屏幕弹幕</div>
          <h1>Danmaku Companion</h1>
        </div>
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            title={overlayToggleLabel}
            aria-label="显示弹幕层"
            aria-pressed={overlayVisible}
            onClick={() => void runAction(toggleOverlay)}
          >
            {overlayVisible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={!dirty || saving}
            onClick={() => void runAction(saveDraft)}
          >
            <Save size={17} />
            {dirty ? "保存" : "已保存"}
          </button>
          <button
            type="button"
            className="secondary-button"
            disabled={workingAction !== null}
            onClick={() => void runAction(generateOnce)}
          >
            <Sparkles size={17} />
            {workingAction === "generate" ? "生成中" : "生成一次"}
          </button>
          <button
            type="button"
            className="primary-button"
            disabled={workingAction !== null}
            onClick={() => void runAction(toggleRuntime)}
          >
            {status.state === "running" ? <Pause size={17} /> : <Play size={17} />}
            {workingAction === "start"
              ? "处理中"
              : status.state === "running"
                ? "暂停"
                : "启动"}
          </button>
        </div>
      </header>

      <section className="status-strip">
        <div className={`status-pill state-${status.state}`}>
          <Activity size={16} />
          {statusLabels[status.state]}
        </div>
        <div>轮次：{status.cycles}</div>
        <div>耗时：{status.providerLatencyMs ? `${status.providerLatencyMs} ms` : "-"}</div>
        <div>缓存命中：{formatCacheUsage(status.cachedInputTokens, status.promptTokens)}</div>
        <div>
          请求体：{formatBytes(status.requestBytes)}
          {status.requestLimitBytes ? ` / ${formatBytes(status.requestLimitBytes)}` : ""}
          {status.historyImages ? ` · ${status.historyImages} 张历史截图` : ""}
        </div>
        <div>
          上次生成：
          {status.lastGeneratedAt ? new Date(status.lastGeneratedAt).toLocaleTimeString() : "-"}
        </div>
      </section>

      {actionError ? (
        <div className="error-banner dismissible-banner" role="alert">
          <span>{actionError}</span>
          <button
            type="button"
            className="banner-close"
            title="关闭"
            aria-label="关闭"
            onClick={() => setActionError(null)}
          >
            <X size={15} />
          </button>
        </div>
      ) : null}
      {status.lastError ? <div className="error-banner">{status.lastError}</div> : null}
      {connection ? (
        <div className={connection.ok ? "success-banner" : "error-banner"}>
          {connection.message} 接口：{connection.endpoint}
        </div>
      ) : null}

      <section className="profile-panel">
        <div className="panel-heading profile-heading">
          <div className="heading-title">
            <Layers size={18} />
            <h2>配置</h2>
          </div>
          <span>{profiles?.profiles.length ?? 0} 套</span>
        </div>
        <div className="profile-grid">
          <label className="compact-field">
            当前配置
            <select
              value={profiles?.activeProfileId ?? ""}
              disabled={!profiles || profileBusy}
              onChange={(event) => {
                const id = event.target.value;
                void runAction(() => switchProfile(id));
              }}
            >
              {(profiles?.profiles ?? []).map((profile) => (
                <option key={profile.id} value={profile.id}>
                  {profile.name}
                </option>
              ))}
            </select>
          </label>
          <label className="compact-field">
            配置名称
            <input
              value={profileName}
              disabled={!activeProfile || profileBusy}
              onChange={(event) => setProfileName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={
              !activeProfile ||
              profileBusy ||
              !profileName.trim() ||
              profileName.trim() === activeProfile.name
            }
            onClick={() => void runAction(renameProfile)}
          >
            <Pencil size={17} />
            重命名
          </button>
          <label className="compact-field">
            新配置
            <input
              value={newProfileName}
              disabled={profileBusy}
              placeholder="基于当前配置"
              onChange={(event) => setNewProfileName(event.target.value)}
            />
          </label>
          <button
            type="button"
            className="secondary-button"
            disabled={profileBusy}
            onClick={() => void runAction(createProfile)}
          >
            <CopyPlus size={17} />
            复制新建
          </button>
          <button
            type="button"
            className="secondary-button danger-button"
            disabled={profileBusy || (profiles?.profiles.length ?? 0) <= 1}
            onClick={() => void runAction(deleteProfile)}
          >
            <Trash2 size={17} />
            删除
          </button>
        </div>
      </section>

      <section className="workspace-grid">
        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <Cpu size={18} />
            <h2>模型接口</h2>
          </div>
          <label>
            接口地址 (Base URL)
            <input
              value={draft.model.baseUrl}
              onChange={(event) => editSection("model", { baseUrl: event.target.value })}
            />
          </label>
          <div className="two-column">
            <label>
              API 密钥
              <input
                type="password"
                value={draft.model.apiKey}
                onChange={(event) => editSection("model", { apiKey: event.target.value })}
              />
            </label>
            <div className="field-block">
              <div className="field-heading">
                <span>模型</span>
                <button
                  type="button"
                  className="mini-icon-button"
                  title="刷新模型列表"
                  aria-label="刷新模型列表"
                  disabled={modelListLoading}
                  onClick={() => void runAction(loadModelList)}
                >
                  {modelListLoading ? (
                    <LoaderCircle className="spin" size={15} />
                  ) : (
                    <RefreshCw size={15} />
                  )}
                </button>
              </div>
              {modelOptions.length > 0 ? (
                <select
                  className="model-select"
                  value={selectedModelValue}
                  onChange={(event) => {
                    if (event.target.value) {
                      editSection("model", { model: event.target.value });
                    }
                  }}
                >
                  <option value="">从 {modelOptions.length} 个模型中选择…</option>
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {[
                        model.id,
                        model.name && model.name !== model.id ? model.name : undefined,
                        model.state,
                        model.vision ? "视觉" : undefined,
                      ].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.model.model}
                  onChange={(event) => editSection("model", { model: event.target.value })}
                />
              )}
              <div className={modelList?.ok === false ? "field-note error-note" : "field-note"}>
                {modelListNote}
              </div>
            </div>
          </div>
          <div className="three-column">
            <NumberField
              label="温度"
              value={draft.model.temperature}
              range={LIMITS.temperature}
              step={0.1}
              onCommit={(temperature) => editSection("model", { temperature })}
            />
            <NumberField
              label="最大输出 (tokens)"
              value={draft.model.maxTokens}
              range={LIMITS.maxTokens}
              step={10}
              integer
              onCommit={(maxTokens) => editSection("model", { maxTokens })}
            />
            <NumberField
              label="超时 (ms)"
              value={draft.model.timeoutMs}
              range={LIMITS.timeoutMs}
              step={1000}
              integer
              onCommit={(timeoutMs) => editSection("model", { timeoutMs })}
            />
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.model.sendTemperature}
              onChange={(event) => editSection("model", { sendTemperature: event.target.checked })}
            />
            发送温度参数
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.model.visionEnabled}
              onChange={(event) => editSection("model", { visionEnabled: event.target.checked })}
            />
            发送截图 (视觉输入)
          </label>
          <div className="button-row">
            <button
              type="button"
              className="secondary-button"
              disabled={workingAction !== null}
              onClick={() => void runAction(testConnection)}
            >
              {workingAction === "test" ? (
                <LoaderCircle className="spin" size={17} />
              ) : (
                <Cable size={17} />
              )}
              测试连接
            </button>
          </div>
        </form>

        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <SlidersHorizontal size={18} />
            <h2>弹幕表现</h2>
          </div>
          <div className="three-column">
            <NumberField
              label="字号 (px)"
              value={draft.danmaku.fontSize}
              range={LIMITS.fontSize}
              step={1}
              onCommit={(fontSize) => editSection("danmaku", { fontSize })}
            />
            <NumberField
              label="不透明度 (0.2–1)"
              value={draft.danmaku.opacity}
              range={LIMITS.opacity}
              step={0.05}
              onCommit={(opacity) => editSection("danmaku", { opacity })}
            />
            <NumberField
              label="滚动时长 (秒，越大越慢)"
              value={draft.danmaku.speedSeconds}
              range={LIMITS.speedSeconds}
              step={1}
              onCommit={(speedSeconds) => editSection("danmaku", { speedSeconds })}
            />
          </div>
          <div className="three-column">
            <label>
              显示区域
              <select
                value={draft.danmaku.zone}
                onChange={(event) =>
                  editSection("danmaku", {
                    zone: event.target.value as AppConfig["danmaku"]["zone"],
                  })
                }
              >
                <option value="full">全屏</option>
                <option value="top">上部</option>
                <option value="middle">中部</option>
                <option value="bottom">下部</option>
              </select>
            </label>
            <NumberField
              label="单条最多字数"
              value={draft.danmaku.maxCommentLength}
              range={LIMITS.maxCommentLength}
              step={1}
              integer
              onCommit={(maxCommentLength) => editSection("danmaku", { maxCommentLength })}
            />
            <NumberField
              label={
                <>
                  密度 <TodoTag hint={unimplementedHints.density} />
                </>
              }
              title={unimplementedHints.density}
              value={draft.danmaku.density}
              range={LIMITS.density}
              step={0.1}
              disabled
              onCommit={(density) => editSection("danmaku", { density })}
            />
          </div>
          <ListField
            label="配色 (逗号分隔的 CSS 颜色)"
            values={draft.danmaku.palette}
            parse={parsePalette}
            placeholder="#31c3a2, #f59e0b"
            onCommit={(palette) => editSection("danmaku", { palette })}
          />
          <div className="swatches">
            {draft.danmaku.palette.map((color, index) => (
              <span key={index} className="swatch" title={color} style={{ background: color }} />
            ))}
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.danmaku.shadow}
              onChange={(event) => editSection("danmaku", { shadow: event.target.checked })}
            />
            文字阴影
          </label>
        </form>

        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <Sparkles size={18} />
            <h2>角色</h2>
          </div>
          <div className="two-column">
            <label>
              角色名
              <input
                value={draft.character.name}
                onChange={(event) => editSection("character", { name: event.target.value })}
              />
            </label>
            <label>
              语言
              <input
                value={draft.character.language}
                onChange={(event) => editSection("character", { language: event.target.value })}
              />
            </label>
          </div>
          <div className="two-column">
            <label>
              用户称呼
              <input
                value={draft.user.name}
                onChange={(event) => editSection("user", { name: event.target.value })}
              />
            </label>
            <label>
              用户身份
              <input
                value={draft.user.role}
                onChange={(event) => editSection("user", { role: event.target.value })}
              />
            </label>
          </div>
          <label>
            人设
            <textarea
              rows={4}
              value={draft.character.persona}
              onChange={(event) => editSection("character", { persona: event.target.value })}
            />
          </label>
          <label>
            语气
            <input
              value={draft.character.tone}
              onChange={(event) => editSection("character", { tone: event.target.value })}
            />
          </label>
        </form>

        <form className="panel wide-panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <MessageSquareText size={18} />
            <h2>Prompt 模板</h2>
          </div>
          <div className="placeholder-row">
            {promptPlaceholders.map((placeholder) => {
              const todo = unimplementedPlaceholders[placeholder];
              return (
                <code
                  key={placeholder}
                  className={todo ? "placeholder-todo" : undefined}
                  title={todo}
                >
                  {placeholder}
                  {todo ? "（未实现）" : null}
                </code>
              );
            })}
          </div>
          <div className="two-column">
            <label>
              系统提示词
              <textarea
                rows={9}
                value={draft.prompt.systemTemplate}
                onChange={(event) => editSection("prompt", { systemTemplate: event.target.value })}
              />
            </label>
            <label>
              用户提示词
              <textarea
                rows={9}
                value={draft.prompt.userTemplate}
                onChange={(event) => editSection("prompt", { userTemplate: event.target.value })}
              />
            </label>
          </div>
        </form>

        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <Shield size={18} />
            <h2>运行与隐私</h2>
          </div>
          <div className="three-column">
            <NumberField
              label="最短间隔 (秒)"
              value={draft.runtime.intervalMinSeconds}
              range={LIMITS.intervalSeconds}
              step={1}
              onCommit={(intervalMinSeconds) => editSection("runtime", { intervalMinSeconds })}
            />
            <NumberField
              label="最长间隔 (秒)"
              value={draft.runtime.intervalMaxSeconds}
              range={LIMITS.intervalSeconds}
              step={1}
              onCommit={(intervalMaxSeconds) => editSection("runtime", { intervalMaxSeconds })}
            />
            <NumberField
              label="投放窗口最短 (秒)"
              value={draft.runtime.releaseWindowMinSeconds}
              range={LIMITS.releaseWindowSeconds}
              step={1}
              onCommit={(releaseWindowMinSeconds) =>
                editSection("runtime", { releaseWindowMinSeconds })
              }
            />
            <NumberField
              label="投放窗口最长 (秒)"
              value={draft.runtime.releaseWindowMaxSeconds}
              range={LIMITS.releaseWindowSeconds}
              step={1}
              onCommit={(releaseWindowMaxSeconds) =>
                editSection("runtime", { releaseWindowMaxSeconds })
              }
            />
            <NumberField
              label="截图最长边 (px)"
              value={draft.runtime.captureMaxEdgePixels}
              range={LIMITS.captureMaxEdgePixels}
              step={10}
              integer
              onCommit={(captureMaxEdgePixels) => editSection("runtime", { captureMaxEdgePixels })}
            />
            <label>
              截图格式
              <select
                value={draft.runtime.captureImageFormat}
                onChange={(event) =>
                  editSection("runtime", {
                    captureImageFormat: event.target.value as AppConfig["runtime"]["captureImageFormat"],
                  })
                }
              >
                <option value="jpeg">JPEG</option>
                <option value="png">PNG</option>
              </select>
            </label>
            <NumberField
              label="JPEG 质量 (0.5–0.95)"
              value={draft.runtime.captureJpegQuality}
              range={LIMITS.captureJpegQuality}
              step={0.01}
              onCommit={(captureJpegQuality) => editSection("runtime", { captureJpegQuality })}
            />
            <NumberField
              label="历史轮数"
              value={draft.runtime.historyRounds}
              range={LIMITS.historyRounds}
              step={1}
              integer
              onCommit={(historyRounds) => editSection("runtime", { historyRounds })}
            />
            <label>
              历史模式
              <select
                value={draft.runtime.historyMode}
                onChange={(event) =>
                  editSection("runtime", {
                    historyMode: event.target.value as AppConfig["runtime"]["historyMode"],
                  })
                }
              >
                <option value="reset-on-limit">满额重置</option>
                <option value="batch-sliding">分批滑动（缓存友好）</option>
                <option value="sliding">逐轮滑动（每轮失去缓存）</option>
              </select>
            </label>
            <NumberField
              label="历史截图上限 (张)"
              value={draft.runtime.historyMaxImages}
              range={LIMITS.historyMaxImages}
              step={1}
              integer
              onCommit={(historyMaxImages) => editSection("runtime", { historyMaxImages })}
            />
            <NumberField
              label="请求体上限 (MB)"
              value={draft.runtime.requestBodyLimitMB}
              range={LIMITS.requestBodyLimitMB}
              step={1}
              onCommit={(requestBodyLimitMB) => editSection("runtime", { requestBodyLimitMB })}
            />
            <NumberField
              label="每轮弹幕 (条)"
              value={draft.runtime.itemsPerCycle}
              range={LIMITS.itemsPerCycle}
              step={1}
              integer
              onCommit={(itemsPerCycle) => editSection("runtime", { itemsPerCycle })}
            />
            <NumberField
              label="日志保留 (条)"
              value={draft.runtime.generationLogLimit}
              range={LIMITS.generationLogLimit}
              step={10}
              integer
              onCommit={(generationLogLimit) => editSection("runtime", { generationLogLimit })}
            />
            <ListField
              label={
                <>
                  隐私黑名单 <TodoTag hint={unimplementedHints.blacklist} />
                </>
              }
              title={unimplementedHints.blacklist}
              values={draft.runtime.privacyBlacklist}
              parse={parseListInput}
              disabled
              onCommit={(privacyBlacklist) => editSection("runtime", { privacyBlacklist })}
            />
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.runtime.historyIncludeImages}
              onChange={(event) =>
                editSection("runtime", { historyIncludeImages: event.target.checked })
              }
            />
            保留历史截图
          </label>
          <p className="panel-note">
            保留历史截图时，截图数超过上限或请求体超过上限，会一次性丢弃最早的一半截图（保留它们的文字），
            只有这一轮需要重新预填充，其余轮次都能命中服务端的前缀缓存。逐轮滑动每轮都会改变请求开头，缓存基本失效。
            服务器返回 413 时会按它报告的上限自动压缩并重试一次。每一轮都会上传完整请求，上限越大越占上行带宽。
            {draft.runtime.historyIncludeImages && draft.runtime.captureImageFormat === "png"
              ? " PNG 截图体积通常是 JPEG 的 10 倍以上，而模型看到的 token 数相同，保留历史截图时建议改用 JPEG。"
              : ""}
          </p>
          <label className="toggle-row" title={unimplementedHints.persistScreenshots}>
            <input
              type="checkbox"
              checked={draft.runtime.persistScreenshots}
              disabled
              onChange={(event) =>
                editSection("runtime", { persistScreenshots: event.target.checked })
              }
            />
            保存截图到磁盘
            <TodoTag hint={unimplementedHints.persistScreenshots} />
          </label>
          <div className="button-row">
            {isMac ? (
              <button
                type="button"
                className="secondary-button"
                onClick={() => void runAction(() => api().openScreenRecordingSettings())}
              >
                <Shield size={17} />
                录屏权限
              </button>
            ) : null}
            <button
              type="button"
              className="secondary-button"
              onClick={() => void runAction(() => api().clearOverlay())}
            >
              <RefreshCw size={17} />
              清空弹幕
            </button>
            <button
              type="button"
              className="primary-button"
              disabled={!dirty || saving}
              onClick={() => void runAction(saveDraft)}
            >
              <Save size={17} />
              {saving ? "保存中" : dirty ? "保存" : "已保存"}
            </button>
          </div>
        </form>

        <section className="panel wide-panel log-panel">
          <div className="panel-heading log-heading">
            <div className="heading-title">
              <HistoryIcon size={18} />
              <h2>生成日志</h2>
            </div>
            <div className="button-row">
              <button
                type="button"
                className="secondary-button"
                disabled={logsLoading}
                onClick={() => void runAction(loadGenerationLogs)}
              >
                {logsLoading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <RefreshCw size={17} />
                )}
                刷新
              </button>
              <button
                type="button"
                className="secondary-button"
                disabled={logsLoading || generationLogs.length === 0}
                onClick={() => void runAction(clearGenerationLogs)}
              >
                <Trash2 size={17} />
                清空日志
              </button>
            </div>
          </div>

          <GenerationLogList logs={generationLogs} />
        </section>
      </section>
    </main>
  );
}
