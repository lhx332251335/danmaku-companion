import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfileSummary,
  ConfigProfilesSnapshot,
  ConnectionTestResult,
  DanmakuBridge,
  GenerationLogEntry,
  ModelListResult,
  ModelOption,
  RuntimeStatus,
} from "../../shared/types";
import { api } from "../api";
import { describeError, isDraftDirty, rebaseDraft, toConfigPatch } from "../settingsModel";
import { isMac, type SettingsPageId } from "./constants";
import { dirtyPages } from "./dirty";

export type DraftSection = "model" | "character" | "user" | "prompt" | "danmaku" | "runtime";
/** The run/generate/test button that is busy; they share one slot, like before. */
export type WorkingAction = "generate" | "start" | "test" | null;
export type ProfileAction = "create" | "rename" | "switch" | "delete" | null;

export interface SettingsController {
  /* ---------------- config & draft ---------------- */
  /** The saved config of the active profile. */
  config: AppConfig;
  /** What the form shows: the saved config plus unsaved edits. Edit it with `edit`. */
  draft: AppConfig;
  /** The draft differs from the saved config (the run flag is ignored). */
  dirty: boolean;
  /** Per settings page: it holds unsaved edits (nav dots). */
  dirtyPages: Record<SettingsPageId, boolean>;
  saving: boolean;
  /** Merges `patch` into one draft section; nothing is saved until `save`. */
  edit<K extends DraftSection>(section: K, patch: Partial<AppConfig[K]>): void;
  /** Saves the draft (no-op when clean). Errors go to `actionError`. Bound to Ctrl+S. */
  save(): Promise<void>;
  /** Drops the unsaved edits (还原). */
  revert(): void;

  /* ---------------- profiles ---------------- */
  profiles: ConfigProfilesSnapshot | null;
  activeProfile: ConfigProfileSummary | undefined;
  profileWorking: ProfileAction;
  /** Saving or a profile action is running: profile controls are disabled. */
  profileBusy: boolean;
  /** Saves the draft first, then switches. Resolves true when it succeeded. */
  switchProfile(id: string): Promise<boolean>;
  /** Renames the active profile (empty or unchanged names are ignored). */
  renameProfile(name: string): Promise<boolean>;
  /** Saves the draft first, then copies the active profile under `name` and switches to it. */
  createProfile(name: string): Promise<boolean>;
  /** Asks for confirmation, then deletes the active profile (never the last one). */
  deleteProfile(): Promise<boolean>;

  /* ---------------- runtime ---------------- */
  status: RuntimeStatus;
  workingAction: WorkingAction;
  /** Start when stopped, pause when running. Start saves the draft first. */
  toggleRunning(): Promise<void>;
  /** Saves the draft first, then runs one generation now. */
  generateOnce(): Promise<void>;

  /* ---------------- overlay ---------------- */
  overlayVisible: boolean;
  toggleOverlay(): Promise<void>;
  clearOverlay(): Promise<void>;

  /* ---------------- model ---------------- */
  modelList: ModelListResult | null;
  modelListLoading: boolean;
  /** Models from the last list call ([] before one finished or when it failed). */
  modelOptions: ModelOption[];
  /** The list entry matching draft.model.model, if the list has it. */
  selectedModel: ModelOption | undefined;
  /** "3 个模型 · loaded · 视觉", the error message, or "-" before the first list. */
  modelListNote: string;
  modelListFailed: boolean;
  /** Saves the draft first (the list depends on the base URL and key), then lists models. */
  refreshModels(): Promise<void>;
  connection: ConnectionTestResult | null;
  /** Saves the draft first, tests the connection, then refreshes the model list. */
  testConnection(): Promise<void>;
  dismissConnection(): void;

  /* ---------------- logs ---------------- */
  /** Generation logs, newest first. Reloaded after every status broadcast. */
  logs: GenerationLogEntry[];
  logsLoading: boolean;
  refreshLogs(): Promise<void>;
  /** Asks for confirmation, then deletes all logs. */
  clearLogs(): Promise<void>;

  /* ---------------- platform & errors ---------------- */
  isMac: boolean;
  /** macOS only: opens the Screen Recording pane of System Settings. */
  openScreenRecordingSettings(): Promise<void>;
  /** Message of the last failed action, shown as a dismissible banner. */
  actionError: string | null;
  dismissActionError(): void;
  /** Runs any async action with the same error handling (clears, then sets actionError). */
  run(action: () => Promise<unknown>): Promise<void>;
}

export interface SettingsControllerState {
  /** The bridge or the first load failed; nothing else can work. */
  loadError: string | null;
  /** Null until the config has loaded. */
  controller: SettingsController | null;
}

function activeProfileOf(profiles: ConfigProfilesSnapshot | null): ConfigProfileSummary | undefined {
  return profiles?.profiles.find((profile) => profile.active);
}

export function useSettingsController(): SettingsControllerState {
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [draft, setDraft] = useState<AppConfig | null>(null);
  const [profiles, setProfiles] = useState<ConfigProfilesSnapshot | null>(null);
  const [status, setStatus] = useState<RuntimeStatus>({ state: "idle", cycles: 0 });
  const [saving, setSaving] = useState(false);
  const [workingAction, setWorkingAction] = useState<WorkingAction>(null);
  const [profileWorking, setProfileWorking] = useState<ProfileAction>(null);
  const [connection, setConnection] = useState<ConnectionTestResult | null>(null);
  const [modelList, setModelList] = useState<ModelListResult | null>(null);
  const [modelListLoading, setModelListLoading] = useState(false);
  const [logs, setLogs] = useState<GenerationLogEntry[]>([]);
  const [logsLoading, setLogsLoading] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const configRef = useRef<AppConfig | null>(null);

  const dirty = useMemo(
    () => Boolean(config && draft && isDraftDirty(config, draft)),
    [config, draft],
  );
  const pagesDirty = useMemo(
    () => (config && draft ? dirtyPages(config, draft) : null),
    [config, draft],
  );

  /* ---------------- helpers (moved from the old SettingsApp) ---------------- */

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

  /** Like runAction, but tells the caller whether it worked. */
  async function attempt(action: () => Promise<unknown>): Promise<boolean> {
    setActionError(null);
    try {
      await action();
      return true;
    } catch (error) {
      reportError(error);
      return false;
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

  /**
   * Main broadcasts the status after it appends a log entry. A status alone cannot tell whether
   * an entry was added (an aborted run looks like the pause before it), so always reload.
   */
  function handleStatusBroadcast(next: RuntimeStatus) {
    setStatus(next);
    runInBackground(loadGenerationLogs(false));
  }

  async function saveDraft() {
    if (!draft || !dirty) return;

    const sent = draft;
    setSaving(true);
    try {
      adoptConfig(await api().updateConfig(toConfigPatch(sent)), sent);
      setProfiles(await api().getConfigProfiles());
    } finally {
      setSaving(false);
    }
  }

  function applyProfileResult(result: ConfigProfileResult) {
    resetConfig(result.config);
    setProfiles(result.profiles);
    setConnection(null);
    setModelList(null);
    runInBackground(loadModelList(false));
    runInBackground(loadGenerationLogs(false));
  }

  async function createProfile(name: string) {
    setProfileWorking("create");
    try {
      await saveDraft();
      applyProfileResult(await api().createConfigProfile(name));
    } finally {
      setProfileWorking(null);
    }
  }

  async function renameProfile(name: string) {
    const active = activeProfileOf(profiles);
    if (!active || !name.trim() || name.trim() === active.name) return;

    setProfileWorking("rename");
    try {
      setProfiles(await api().renameConfigProfile(active.id, name));
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
    const active = activeProfileOf(profiles);
    if (!active || (profiles?.profiles.length ?? 0) <= 1) return;
    if (!window.confirm(`删除配置“${active.name}”？`)) return;

    setProfileWorking("delete");
    try {
      applyProfileResult(await api().deleteConfigProfile(active.id));
    } finally {
      setProfileWorking(null);
    }
  }

  async function generateOnce() {
    setWorkingAction("generate");
    try {
      await saveDraft();
      setStatus(await api().generateOnce());
    } finally {
      setWorkingAction(null);
    }
  }

  async function toggleRuntime() {
    setWorkingAction("start");
    try {
      if (status.state === "running") {
        setStatus(await api().stop());
      } else {
        await saveDraft();
        setStatus(await api().start());
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
      setLogs(await api().getGenerationLogs());
    } finally {
      if (showLoading) {
        setLogsLoading(false);
      }
    }
  }

  async function clearGenerationLogs() {
    if (!window.confirm("清空全部生成日志？此操作无法撤销。")) return;

    setLogsLoading(true);
    try {
      await api().clearGenerationLogs();
      setLogs([]);
    } finally {
      setLogsLoading(false);
    }
  }

  async function toggleOverlay() {
    const next = !overlayVisible;
    await api().setOverlayVisible(next);
    setOverlayVisible(next);
  }

  /* ---------------- first load and subscriptions ---------------- */

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
        setProfiles(loadedProfiles);
        setStatus(loadedStatus);
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
    // Mount once: the bridge listeners only call state setters and helpers that read refs.
  }, []);

  /* ---------------- Ctrl+S / Cmd+S ---------------- */

  const saveShortcutRef = useRef<() => void>(() => undefined);
  saveShortcutRef.current = () => {
    if (dirty && !saving) {
      void runAction(saveDraft);
    }
  };

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (
        (event.ctrlKey || event.metaKey) &&
        !event.altKey &&
        !event.shiftKey &&
        !event.isComposing &&
        event.key.toLowerCase() === "s"
      ) {
        event.preventDefault();
        saveShortcutRef.current();
      }
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  if (!config || !draft || !pagesDirty) {
    return { loadError, controller: null };
  }

  /* ---------------- derived ---------------- */

  const modelOptions = modelList?.models ?? [];
  const selectedModel = modelOptions.find((model) => model.id === draft.model.model);
  const selectedModelStatus = selectedModel
    ? [selectedModel.state, selectedModel.vision ? "视觉" : undefined].filter(Boolean).join(" · ")
    : "";
  const modelListNote =
    modelList?.ok === false
      ? modelList.message
      : modelList
        ? [`${modelList.models.length} 个模型`, selectedModelStatus || undefined]
            .filter(Boolean)
            .join(" · ")
        : "-";

  const controller: SettingsController = {
    config,
    draft,
    dirty,
    dirtyPages: pagesDirty,
    saving,
    edit: editSection,
    save: () => runAction(saveDraft),
    revert: () => setDraft(configRef.current ?? config),

    profiles,
    activeProfile: activeProfileOf(profiles),
    profileWorking,
    profileBusy: saving || profileWorking !== null,
    switchProfile: (id) => attempt(() => switchProfile(id)),
    renameProfile: (name) => attempt(() => renameProfile(name)),
    createProfile: (name) => attempt(() => createProfile(name)),
    deleteProfile: () => attempt(deleteProfile),

    status,
    workingAction,
    toggleRunning: () => runAction(toggleRuntime),
    generateOnce: () => runAction(generateOnce),

    overlayVisible,
    toggleOverlay: () => runAction(toggleOverlay),
    clearOverlay: () => runAction(() => api().clearOverlay()),

    modelList,
    modelListLoading,
    modelOptions,
    selectedModel,
    modelListNote,
    modelListFailed: modelList?.ok === false,
    refreshModels: () => runAction(() => loadModelList(true)),
    connection,
    testConnection: () => runAction(testConnection),
    dismissConnection: () => setConnection(null),

    logs,
    logsLoading,
    refreshLogs: () => runAction(() => loadGenerationLogs(true)),
    clearLogs: () => runAction(clearGenerationLogs),

    isMac,
    openScreenRecordingSettings: () => runAction(() => api().openScreenRecordingSettings()),
    actionError,
    dismissActionError: () => setActionError(null),
    run: runAction,
  };

  return { loadError, controller };
}
