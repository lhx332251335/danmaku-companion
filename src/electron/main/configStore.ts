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
  cleanName,
  cloneConfig,
  deepMerge,
  normalizeConfig,
  normalizeProfileConfig,
  parseJson,
  serializableState,
  stateFromConfig,
  stateFromParsed,
  type ConfigProfile,
  type ConfigState,
} from "./configModel";

export class ConfigStore {
  private filePath: string | undefined;
  private state: ConfigState | undefined;

  private getFilePath(): string {
    this.filePath ??= path.join(app.getPath("userData"), "config.json");
    return this.filePath;
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

    state.activeProfileId = id;
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

    state.profiles = nextProfiles;
    if (state.activeProfileId === id) {
      state.activeProfileId = state.profiles[0].id;
    }
    await this.saveState(state);
    return this.result(state);
  }

  async update(patch: DeepPartial<AppConfig>): Promise<AppConfig> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = normalizeConfig(deepMerge<AppConfig>(profile.config, patch));
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
    return profile.config;
  }

  async save(config: AppConfig): Promise<void> {
    const state = await this.getState();
    const profile = this.activeProfile(state);
    profile.config = normalizeConfig(config);
    profile.updatedAt = new Date().toISOString();
    await this.saveState(state);
  }

  private async getState(): Promise<ConfigState> {
    if (this.state) {
      return this.state;
    }

    try {
      const raw = await fs.readFile(this.getFilePath(), "utf8");
      this.state = stateFromParsed(parseJson(raw));
    } catch {
      this.state = stateFromConfig(await this.readLegacyConfig());
    }

    await this.saveState(this.state);
    return this.state;
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

  private async saveState(state: ConfigState): Promise<void> {
    this.state = state;
    const filePath = this.getFilePath();
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(
      filePath,
      `${JSON.stringify(serializableState(state), null, 2)}\n`,
      "utf8",
    );
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
