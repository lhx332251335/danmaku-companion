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
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfilesSnapshot,
  ConnectionTestResult,
  GenerationLogEntry,
  ModelListResult,
  RuntimeStatus,
} from "../shared/types";
import { api } from "./api";

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

function parsePalette(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 8);
}

const logStatusLabels: Record<GenerationLogEntry["status"], string> = {
  success: "成功",
  error: "失败",
  aborted: "中断",
};

function formatLogTime(value: string): string {
  return new Date(value).toLocaleString([], {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatDuration(ms: number): string {
  if (ms >= 1000) {
    return `${(ms / 1000).toFixed(1)}s`;
  }

  return `${ms}ms`;
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

  useEffect(() => {
    void Promise.all([
      api().getConfig(),
      api().getRuntimeStatus(),
      api().getConfigProfiles(),
    ]).then(
      ([loadedConfig, loadedStatus, loadedProfiles]) => {
        setConfig(loadedConfig);
        setDraft(loadedConfig);
        setProfiles(loadedProfiles);
        setProfileName(activeProfileName(loadedProfiles));
        setStatus(loadedStatus);
        void loadModelList(false);
        void loadGenerationLogs(false);
      },
    );

    return api().onRuntimeStatus((nextStatus) => {
      setStatus(nextStatus);
      void loadGenerationLogs(false);
    });
  }, []);

  const dirty = useMemo(
    () => JSON.stringify(config) !== JSON.stringify(draft),
    [config, draft],
  );

  if (!draft) {
    return <main className="app-shell loading">Loading...</main>;
  }

  async function saveDraft(nextDraft = draft) {
    if (!nextDraft) return config;
    setSaving(true);
    try {
      const updated = await api().updateConfig(nextDraft);
      const nextProfiles = await api().getConfigProfiles();
      setConfig(updated);
      setDraft(updated);
      setProfiles(nextProfiles);
      setProfileName(activeProfileName(nextProfiles));
      return updated;
    } finally {
      setSaving(false);
    }
  }

  function applyProfileResult(result: ConfigProfileResult) {
    setConfig(result.config);
    setDraft(result.config);
    setProfiles(result.profiles);
    setProfileName(activeProfileName(result.profiles));
    setConnection(null);
    setModelList(null);
    void loadModelList(false);
    void loadGenerationLogs(false);
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
      const nextProfiles = await api().renameConfigProfile(
        activeProfile.id,
        profileName,
      );
      setProfiles(nextProfiles);
      setProfileName(activeProfileName(nextProfiles));
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
      const nextStatus = await api().generateOnce();
      setStatus(nextStatus);
      await loadGenerationLogs(false);
    } finally {
      setWorkingAction(null);
    }
  }

  async function toggleRuntime() {
    setWorkingAction("start");
    try {
      const nextStatus =
        status.state === "running"
          ? await api().stop()
          : (await saveDraft(), await api().start());
      setStatus(nextStatus);
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

  async function openScreenRecordingSettings() {
    await api().openScreenRecordingSettings();
  }

  const paletteText = draft.danmaku.palette.join(", ");
  const modelOptions = modelList?.models ?? [];
  const selectedModel = modelOptions.find((model) => model.id === draft.model.model);
  const selectedModelValue = selectedModel ? selectedModel.id : "";
  const selectedModelStatus = selectedModel
    ? [selectedModel.state, selectedModel.vision ? "vision" : undefined]
        .filter(Boolean)
        .join(" · ")
    : "";
  const modelListNote =
    modelList?.ok === false
      ? modelList.message
      : modelList
        ? [
            `${modelList.models.length} models`,
            selectedModelStatus || undefined,
          ].filter(Boolean).join(" · ")
        : "-";
  const activeProfile = profiles?.profiles.find((profile) => profile.active);
  const profileBusy = saving || profileWorking !== null;

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="eyebrow">Local-first Danmaku Engine</div>
          <h1>Danmaku Companion</h1>
        </div>
        <div className="topbar-actions">
          <button className="icon-button" title="Toggle overlay" onClick={toggleOverlay}>
            {overlayVisible ? <Eye size={18} /> : <EyeOff size={18} />}
          </button>
          <button className="secondary-button" disabled={!dirty || saving} onClick={() => void saveDraft()}>
            <Save size={17} />
            {dirty ? "保存" : "已保存"}
          </button>
          <button
            className="secondary-button"
            disabled={workingAction !== null}
            onClick={() => void generateOnce()}
          >
            <Sparkles size={17} />
            {workingAction === "generate" ? "生成中" : "生成一次"}
          </button>
          <button
            className="primary-button"
            disabled={workingAction !== null}
            onClick={toggleRuntime}
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
        <div>Cycles: {status.cycles}</div>
        <div>Latency: {status.providerLatencyMs ? `${status.providerLatencyMs} ms` : "-"}</div>
        <div>Cached: {status.cachedInputTokens ?? "-"}</div>
        <div>Last: {status.lastGeneratedAt ? new Date(status.lastGeneratedAt).toLocaleTimeString() : "-"}</div>
      </section>

      {status.lastError ? <div className="error-banner">{status.lastError}</div> : null}
      {connection ? (
        <div className={connection.ok ? "success-banner" : "error-banner"}>
          {connection.message} Endpoint: {connection.endpoint}
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
              onChange={(event) => void switchProfile(event.target.value)}
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
            className="secondary-button"
            disabled={
              !activeProfile ||
              profileBusy ||
              !profileName.trim() ||
              profileName.trim() === activeProfile.name
            }
            onClick={() => void renameProfile()}
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
            className="secondary-button"
            disabled={profileBusy}
            onClick={() => void createProfile()}
          >
            <CopyPlus size={17} />
            复制新建
          </button>
          <button
            className="secondary-button danger-button"
            disabled={profileBusy || (profiles?.profiles.length ?? 0) <= 1}
            onClick={() => void deleteProfile()}
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
            Base URL
            <input
              value={draft.model.baseUrl}
              onChange={(event) =>
                setDraft({ ...draft, model: { ...draft.model, baseUrl: event.target.value } })
              }
            />
          </label>
          <div className="two-column">
            <label>
              API Key
              <input
                type="password"
                value={draft.model.apiKey}
                onChange={(event) =>
                  setDraft({ ...draft, model: { ...draft.model, apiKey: event.target.value } })
                }
              />
            </label>
            <div className="field-block">
              <div className="field-heading">
                <span>Model</span>
                <button
                  type="button"
                  className="mini-icon-button"
                  title="Refresh models"
                  disabled={modelListLoading}
                  onClick={() => void loadModelList()}
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
                      setDraft({
                        ...draft,
                        model: { ...draft.model, model: event.target.value },
                      });
                    }
                  }}
                >
                  <option value="">Select from {modelOptions.length} models...</option>
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.id}>
                      {[
                        model.id,
                        model.name && model.name !== model.id ? model.name : undefined,
                        model.state,
                        model.vision ? "vision" : undefined,
                      ].filter(Boolean).join(" · ")}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  value={draft.model.model}
                  onChange={(event) =>
                    setDraft({ ...draft, model: { ...draft.model, model: event.target.value } })
                  }
                />
              )}
              <div className={modelList?.ok === false ? "field-note error-note" : "field-note"}>
                {modelListNote}
              </div>
            </div>
          </div>
          <div className="three-column">
            <label>
              Temperature
              <input
                type="number"
                min="0"
                max="2"
                step="0.1"
                value={draft.model.temperature}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    model: { ...draft.model, temperature: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Max Tokens
              <input
                type="number"
                min="80"
                max="1200"
                value={draft.model.maxTokens}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    model: { ...draft.model, maxTokens: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Timeout
              <input
                type="number"
                min="5000"
                step="1000"
                value={draft.model.timeoutMs}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    model: { ...draft.model, timeoutMs: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.model.sendTemperature}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  model: { ...draft.model, sendTemperature: event.target.checked },
                })
              }
            />
            Send temperature
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.model.visionEnabled}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  model: { ...draft.model, visionEnabled: event.target.checked },
                })
              }
            />
            Vision payload
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              disabled={workingAction !== null}
              onClick={() => void testConnection()}
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
            <label>
              Font
              <input
                type="number"
                min="14"
                max="48"
                value={draft.danmaku.fontSize}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: { ...draft.danmaku, fontSize: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Opacity
              <input
                type="number"
                min="0.2"
                max="1"
                step="0.05"
                value={draft.danmaku.opacity}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: { ...draft.danmaku, opacity: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Speed
              <input
                type="number"
                min="4"
                max="30"
                value={draft.danmaku.speedSeconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: { ...draft.danmaku, speedSeconds: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <div className="three-column">
            <label>
              Zone
              <select
                value={draft.danmaku.zone}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: {
                      ...draft.danmaku,
                      zone: event.target.value as AppConfig["danmaku"]["zone"],
                    },
                  })
                }
              >
                <option value="full">Full</option>
                <option value="top">Top</option>
                <option value="middle">Middle</option>
                <option value="bottom">Bottom</option>
              </select>
            </label>
            <label>
              Max chars
              <input
                type="number"
                min="10"
                max="200"
                value={draft.danmaku.maxCommentLength}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: {
                      ...draft.danmaku,
                      maxCommentLength: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Density
              <input
                type="number"
                min="0.1"
                max="1"
                step="0.1"
                value={draft.danmaku.density}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    danmaku: { ...draft.danmaku, density: Number(event.target.value) },
                  })
                }
              />
            </label>
          </div>
          <label>
            Palette
            <input
              value={paletteText}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  danmaku: { ...draft.danmaku, palette: parsePalette(event.target.value) },
                })
              }
            />
          </label>
          <div className="swatches">
            {draft.danmaku.palette.map((color) => (
              <span key={color} className="swatch" style={{ background: color }} />
            ))}
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.danmaku.shadow}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  danmaku: { ...draft.danmaku, shadow: event.target.checked },
                })
              }
            />
            Text shadow
          </label>
        </form>

        <form className="panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <Sparkles size={18} />
            <h2>角色</h2>
          </div>
          <div className="two-column">
            <label>
              Companion name
              <input
                value={draft.character.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    character: { ...draft.character, name: event.target.value },
                  })
                }
              />
            </label>
            <label>
              Language
              <input
                value={draft.character.language}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    character: { ...draft.character, language: event.target.value },
                  })
                }
              />
            </label>
          </div>
          <div className="two-column">
            <label>
              User name
              <input
                value={draft.user.name}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    user: { ...draft.user, name: event.target.value },
                  })
                }
              />
            </label>
            <label>
              User role
              <input
                value={draft.user.role}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    user: { ...draft.user, role: event.target.value },
                  })
                }
              />
            </label>
          </div>
          <label>
            Persona
            <textarea
              rows={4}
              value={draft.character.persona}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  character: { ...draft.character, persona: event.target.value },
                })
              }
            />
          </label>
          <label>
            Tone
            <input
              value={draft.character.tone}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  character: { ...draft.character, tone: event.target.value },
                })
              }
            />
          </label>
        </form>

        <form className="panel wide-panel" onSubmit={(event) => event.preventDefault()}>
          <div className="panel-heading">
            <MessageSquareText size={18} />
            <h2>Prompt 模板</h2>
          </div>
          <div className="placeholder-row">
            {promptPlaceholders.map((placeholder) => (
              <code key={placeholder}>{placeholder}</code>
            ))}
          </div>
          <div className="two-column">
            <label>
              System prompt
              <textarea
                rows={9}
                value={draft.prompt.systemTemplate}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    prompt: { ...draft.prompt, systemTemplate: event.target.value },
                  })
                }
              />
            </label>
            <label>
              User prompt
              <textarea
                rows={9}
                value={draft.prompt.userTemplate}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    prompt: { ...draft.prompt, userTemplate: event.target.value },
                  })
                }
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
            <label>
              Min interval
              <input
                type="number"
                min="5"
                max="1800"
                value={draft.runtime.intervalMinSeconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      intervalMinSeconds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Max interval
              <input
                type="number"
                min="5"
                max="1800"
                value={draft.runtime.intervalMaxSeconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      intervalMaxSeconds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Release min
              <input
                type="number"
                min="0"
                max="60"
                value={draft.runtime.releaseWindowMinSeconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      releaseWindowMinSeconds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Release max
              <input
                type="number"
                min="0"
                max="60"
                value={draft.runtime.releaseWindowMaxSeconds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      releaseWindowMaxSeconds: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Screenshot max
              <input
                type="number"
                min="480"
                max="2160"
                value={draft.runtime.captureMaxEdgePixels}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      captureMaxEdgePixels: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              History rounds
              <input
                type="number"
                min="0"
                max="50"
                value={draft.runtime.historyRounds}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: { ...draft.runtime, historyRounds: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              History mode
              <select
                value={draft.runtime.historyMode}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      historyMode: event.target.value as AppConfig["runtime"]["historyMode"],
                    },
                  })
                }
              >
                <option value="reset-on-limit">Reset at limit</option>
                <option value="sliding">Sliding</option>
              </select>
            </label>
            <label>
              Items per cycle
              <input
                type="number"
                min="1"
                max="12"
                value={draft.runtime.itemsPerCycle}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: { ...draft.runtime, itemsPerCycle: Number(event.target.value) },
                  })
                }
              />
            </label>
            <label>
              Log entries
              <input
                type="number"
                min="10"
                max="2000"
                value={draft.runtime.generationLogLimit}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      generationLogLimit: Number(event.target.value),
                    },
                  })
                }
              />
            </label>
            <label>
              Blacklist
              <input
                value={draft.runtime.privacyBlacklist.join(", ")}
                onChange={(event) =>
                  setDraft({
                    ...draft,
                    runtime: {
                      ...draft.runtime,
                      privacyBlacklist: event.target.value
                        .split(",")
                        .map((item) => item.trim())
                        .filter(Boolean),
                    },
                  })
                }
              />
            </label>
          </div>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.runtime.historyIncludeImages}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  runtime: { ...draft.runtime, historyIncludeImages: event.target.checked },
                })
              }
            />
            History images
          </label>
          <label className="toggle-row">
            <input
              type="checkbox"
              checked={draft.runtime.persistScreenshots}
              onChange={(event) =>
                setDraft({
                  ...draft,
                  runtime: { ...draft.runtime, persistScreenshots: event.target.checked },
                })
              }
            />
            Persist screenshots
          </label>
          <div className="button-row">
            <button
              className="secondary-button"
              onClick={() => void openScreenRecordingSettings()}
            >
              <Shield size={17} />
              录屏权限
            </button>
            <button className="secondary-button" onClick={() => void api().clearOverlay()}>
              <RefreshCw size={17} />
              清空弹幕
            </button>
            <button
              className="primary-button"
              disabled={!dirty || saving}
              onClick={() => void saveDraft()}
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
                className="secondary-button"
                disabled={logsLoading}
                onClick={() => void loadGenerationLogs()}
              >
                {logsLoading ? (
                  <LoaderCircle className="spin" size={17} />
                ) : (
                  <RefreshCw size={17} />
                )}
                刷新
              </button>
              <button
                className="secondary-button"
                disabled={logsLoading || generationLogs.length === 0}
                onClick={() => void clearGenerationLogs()}
              >
                <Trash2 size={17} />
                清空日志
              </button>
            </div>
          </div>

          {generationLogs.length === 0 ? (
            <div className="empty-state">还没有生成记录</div>
          ) : (
            <div className="log-list">
              {generationLogs.map((log) => (
                <details key={log.id} className={`log-entry log-status-${log.status}`}>
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
                  <div className="log-detail">
                    <div className="log-meta-grid">
                      <div>
                        <b>模型</b>
                        <span>{log.model ?? "-"}</span>
                      </div>
                      <div>
                        <b>投放窗口</b>
                        <span>
                          {log.releaseWindowSeconds !== undefined
                            ? `${log.releaseWindowSeconds}s`
                            : "-"}
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
                        <b>历史图片</b>
                        <span>{log.historyImagesIncluded ? "保留" : "不保留"}</span>
                      </div>
                      <div>
                        <b>缓存 tokens</b>
                        <span>{log.cachedInputTokens ?? "-"}</span>
                      </div>
                      <div>
                        <b>截图来源</b>
                        <span>{log.screen.sourceName ?? "-"}</span>
                      </div>
                      <div>
                        <b>开始时间</b>
                        <span>{formatLogTime(log.startedAt)}</span>
                      </div>
                    </div>
                    {log.error ? <div className="log-message-error">{log.error}</div> : null}
                    {log.screen.error ? (
                      <div className="log-message-error">{log.screen.error}</div>
                    ) : null}
                    <div className="comment-log-list">
                      {log.comments.length === 0 ? (
                        <span className="muted-text">没有生成弹幕</span>
                      ) : (
                        log.comments.map((comment, index) => (
                          <span key={`${log.id}-${index}`}>{comment}</span>
                        ))
                      )}
                    </div>
                    {log.rawOutput?.trim() ? (
                      <details className="raw-output-panel">
                        <summary>原始输出</summary>
                        <pre>{log.rawOutput}</pre>
                      </details>
                    ) : null}
                  </div>
                </details>
              ))}
            </div>
          )}
        </section>
      </section>
    </main>
  );
}
