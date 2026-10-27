import { app } from "electron";
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { defaultAppConfig } from "../../shared/defaultConfig";
import type {
  AppConfig,
  ConfigProfileResult,
  ConfigProfilesSnapshot,
  DeepPartial,
} from "../../shared/types";
import {
  applyConfigPatch,
  cleanName,
  cloneConfig,
  normalizeConfig,
  normalizeProfileConfig,
  parseJson,
  sanitizeConfig,
  serializeState,
  stateFromConfig,
  stateFromText,
  withRunFlag,
  type ConfigProfile,
  type ConfigState,
} from "./configModel";
import { WriteQueue, fileTimestamp, readTextIfExists, writeFileAtomic } from "./storage/atomicFile";

export class ConfigStore {
  private filePath: string | undefined;
  private state: ConfigState | undefined;
  private loading: Promise<ConfigState> | undefined;
  private readonly writes = new WriteQueue();
  private lastWrittenText: string | undefined;
  /** Only a config.json known to be valid may be copied over the backup. */
  private diskFileIsGood = false;

  private getFilePath(): string {
    this.filePath ??= path.join(app.getPath("userData"), "config.json");
    return this.filePath;
  }

  private getBackupPath(): string {
    return `${this.getFilePath()}.bak`;
  }

  private getLegacyFilePath(): string {
    return path.join(app.getPath("appData"), "Electron", "config.json");
  }

  async get(): Promise<AppConfig> {
    const state = await this.getState();
    return this.activeProfile(state).config;
  }

  async getProfiles(): Promise<ConfigProfilesSnapshot> {
    return this.snapshot(await this.getState());
  }

  async createProfile(name: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    const current = this.activeProfile(state);
    const now = new Date().toISOString();
    const profile: ConfigProfile = {
      id: randomUUID(),
      name: cleanName(name, `${current.name} 副本`),
      config: cloneConfig(current.config),
      createdAt: now,
      updatedAt: now,
    };

    state.profiles.push(profile);
    state.activeProfileId = profile.id;
    await this.saveState(state);
    return this.result(state);
  }

  async renameProfile(id: string, name: string): Promise<ConfigProfilesSnapshot> {
    const state = await this.getState();
    const profile = state.profiles.find((item) => item.id === id);
    if (!profile) {
      throw new Error("Config profile not found.");
    }

    profile.name = cleanName(name, profile.name);
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
    return this.snapshot(state);
  }

  async switchProfile(id: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    if (!state.profiles.some((profile) => profile.id === id)) {
      throw new Error("Config profile not found.");
    }

    const enabled = this.activeProfile(state).config.runtime.enabled;
    state.activeProfileId = id;
    this.carryRunFlag(state, enabled);
    await this.saveState(state);
    return this.result(state);
  }

  async deleteProfile(id: string): Promise<ConfigProfileResult> {
    const state = await this.getState();
    if (state.profiles.length <= 1) {
      throw new Error("At least one config profile is required.");
    }

    const nextProfiles = state.profiles.filter((profile) => profile.id !== id);
    if (nextProfiles.length === state.profiles.length) {
      throw new Error("Config profile not found.");
    }

    const enabled = this.activeProfile(state).config.runtime.enabled;
    state.profiles = nextProfiles;
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0].id;
    }
    this.carryRunFlag(state, enabled);
    await this.saveState(state);
    return this.result(state);
  }

  async update(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = applyConfigPatch(profile.config, patch);
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
    return profile.config;
  }

  async save(config: AppConfig): Promise<void> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = normalizeConfig(sanitizeConfig(config, profile.config));
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
  }

  hasPendingWrites(): boolean {
    return this.writes.hasPending();
  }

  /** Resolves once every queued write has settled. */
  flush(): Promise<void> {
    return this.writes.flush();
  }

  private getState(): Promise<ConfigState> {
    if (this.state) {
      return Promise.resolve(this.state);
    }

    this.loading ??= this.load().finally(() => {
      this.loading = undefined;
    });
    return this.loading;
  }

  private async load(): Promise<ConfigState> {
    const filePath = this.getFilePath();
    const raw = await readTextIfExists(filePath);
    if (raw === undefined) {
      return this.adoptLoadedState(stateFromConfig(await this.readLegacyConfig()));
    }

    const state = stateFromText(raw);
    if (state) {
      this.diskFileIsGood = true;
      return this.adoptLoadedState(state, raw);
    }

    return this.adoptLoadedState(await this.recoverFromUnreadableFile(filePath));
  }

  /** Persists a loaded state only when its serialized form differs from what is on disk. */
  private async adoptLoadedState(state: ConfigState, raw?: string): Promise<ConfigState> {
    this.state = state;
    if (raw !== undefined && raw.replace(/^﻿/, "") === serializeState(state)) {
      this.lastWrittenText = raw;
      return state;
    }

    try {
      await this.saveState(state);
    } catch (error) {
      console.warn("Failed to write config.json after loading it.", error);
    }
    return state;
  }

  private async recoverFromUnreadableFile(filePath: string): Promise<ConfigState> {
    const corruptPath = `${filePath}.corrupt-${fileTimestamp()}`;
    await fs.copyFile(filePath, corruptPath);
    console.warn(`config.json is not a valid config; kept a copy at ${corruptPath}.`);

    const backup = await readTextIfExists(this.getBackupPath()).catch(() => undefined);
    const restored = backup === undefined ? undefined : stateFromText(backup);
    if (restored) {
      console.warn(`Restored config from ${this.getBackupPath()}.`);
      return restored;
    }

    return stateFromConfig(defaultAppConfig);
  }

  /** The run flag is global even though it is stored per profile. */
  private carryRunFlag(state: ConfigState, enabled: boolean): void {
    const profile = this.activeProfile(state);
    profile.config = withRunFlag(profile.config, enabled);
  }

  private activeProfile(state: ConfigState): ConfigProfile {
    return (
      state.profiles.find((profile) => profile.id === state.activeProfileId) ??
      state.profiles[0]
    );
  }

  private result(state: ConfigState): ConfigProfileResult {
    return {
      config: this.activeProfile(state).config,
      profiles: this.snapshot(state),
    };
  }

  private snapshot(state: ConfigState): ConfigProfilesSnapshot {
    return {
      activeProfileId: state.activeProfileId,
      profiles: state.profiles.map((profile) => ({
        id: profile.id,
        name: profile.name,
        active: profile.id === state.activeProfileId,
        createdAt: profile.createdAt,
        updatedAt: profile.updatedAt,
      })),
    };
  }

  /** Queues a write of the latest state; writes run one at a time and identical ones are skipped. */
  private saveState(state: ConfigState): Promise<void> {
    this.state = state;
    return this.writes.run(() => this.writeLatestState());
  }

  private async writeLatestState(): Promise<void> {
    if (!this.state) {
      return;
    }

    const text = serializeState(this.state);
    if (text === this.lastWrittenText) {
      return;
    }

    await writeFileAtomic(this.getFilePath(), text, {
      backupPath: this.diskFileIsGood ? this.getBackupPath() : undefined,
    });
    this.lastWrittenText = text;
    this.diskFileIsGood = true;
  }

  private async readLegacyConfig(): Promise<AppConfig> {
    const legacyPath = this.getLegacyFilePath();
    if (legacyPath === this.getFilePath()) {
      return defaultAppConfig;
    }

    try {
      const raw = await fs.readFile(legacyPath, "utf8");
      return normalizeProfileConfig(parseJson(raw));
    } catch {
      return defaultAppConfig;
    }
  }
}
