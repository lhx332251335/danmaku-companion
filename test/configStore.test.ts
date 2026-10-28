import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { defaultAppConfig } from "../src/shared/defaultConfig";

const paths = vi.hoisted(() => ({ userData: "", appData: "" }));

vi.mock("electron", () => ({
  app: {
    getPath: (name: string) => (name === "userData" ? paths.userData : paths.appData),
  },
}));

import { ConfigStore } from "../src/electron/main/configStore";

let root: string;
let configFile: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "danmaku-config-"));
  paths.userData = path.join(root, "userData");
  paths.appData = path.join(root, "appData");
  configFile = path.join(paths.userData, "config.json");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function readJson(file: string): Promise<{ activeProfileId: string; profiles: { config: typeof defaultAppConfig }[] }> {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function exists(file: string): Promise<boolean> {
  return fs.stat(file).then(
    () => true,
    () => false,
  );
}

async function userDataFiles(): Promise<string[]> {
  return (await fs.readdir(paths.userData)).sort();
}

describe("ConfigStore loading", () => {
  it("creates config.json with defaults on first run", async () => {
    const config = await new ConfigStore().get();
    expect(config).toEqual(defaultAppConfig);
    expect((await readJson(configFile)).profiles[0].config).toEqual(defaultAppConfig);
    expect(await userDataFiles()).toEqual(["config.json"]);
  });

  it("migrates the legacy config only when config.json does not exist", async () => {
    const legacyFile = path.join(paths.appData, "Electron", "config.json");
    await fs.mkdir(path.dirname(legacyFile), { recursive: true });
    await fs.writeFile(legacyFile, JSON.stringify({ model: { model: "legacy" } }));
    expect((await new ConfigStore().get()).model.model).toBe("legacy");

    await fs.writeFile(legacyFile, JSON.stringify({ model: { model: "newer legacy" } }));
    expect((await new ConfigStore().get()).model.model).toBe("legacy");
  });

  it("loads once when called concurrently", async () => {
    const store = new ConfigStore();
    const [first, second] = await Promise.all([store.getProfiles(), store.getProfiles()]);
    expect(second.activeProfileId).toBe(first.activeProfileId);
    expect((await readJson(configFile)).activeProfileId).toBe(first.activeProfileId);
  });

  it("does not rewrite an unchanged config file", async () => {
    await new ConfigStore().update({ model: { apiKey: "key" } });
    await fs.rm(`${configFile}.bak`);
    const before = await fs.readFile(configFile, "utf8");

    expect((await new ConfigStore().get()).model.apiKey).toBe("key");
    expect(await fs.readFile(configFile, "utf8")).toBe(before);
    expect(await exists(`${configFile}.bak`)).toBe(false);
  });

  it("rewrites a valid file that needed normalizing and backs up the original", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    const original = JSON.stringify({ model: { apiKey: "key", timeoutMs: 1 } });
    await fs.writeFile(configFile, original);

    const config = await new ConfigStore().get();
    expect(config.model.apiKey).toBe("key");
    expect(config.model.timeoutMs).toBe(5000);
    expect(await fs.readFile(`${configFile}.bak`, "utf8")).toBe(original);
    expect((await readJson(configFile)).profiles[0].config.model.timeoutMs).toBe(5000);
  });

  it("keeps a copy of a corrupt config and restores the backup", async () => {
    const writer = new ConfigStore();
    await writer.update({ model: { apiKey: "first" } });
    await writer.update({ model: { apiKey: "second" } });
    await fs.writeFile(configFile, '{ "activeProfileId": "x", "profi');

    const config = await new ConfigStore().get();
    expect(config.model.apiKey).toBe("first");

    const files = await userDataFiles();
    const corrupt = files.find((name) => name.startsWith("config.json.corrupt-"));
    expect(corrupt).toBeDefined();
    expect(await fs.readFile(path.join(paths.userData, corrupt!), "utf8")).toBe('{ "activeProfileId": "x", "profi');
    expect((await readJson(configFile)).profiles[0].config.model.apiKey).toBe("first");
    expect((await readJson(`${configFile}.bak`)).profiles[0].config.model.apiKey).toBe("first");
  });

  it("falls back to defaults when a corrupt config has no backup, keeping the bad file", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    await fs.writeFile(configFile, "");

    expect(await new ConfigStore().get()).toEqual(defaultAppConfig);
    expect((await userDataFiles()).some((name) => name.startsWith("config.json.corrupt-"))).toBe(true);
  });

  it("does not overwrite config.json when it cannot be read", async () => {
    await fs.mkdir(configFile, { recursive: true });
    const store = new ConfigStore();
    await expect(store.get()).rejects.toMatchObject({ code: "EISDIR" });
    expect((await fs.stat(configFile)).isDirectory()).toBe(true);
    expect(await userDataFiles()).toEqual(["config.json"]);

    await fs.rm(configFile, { recursive: true });
    expect(await store.get()).toEqual(defaultAppConfig);
  });
});

describe("ConfigStore writes", () => {
  it("serializes concurrent updates and leaves no temp file", async () => {
    const store = new ConfigStore();
    await store.get();
    await Promise.all(
      Array.from({ length: 25 }, (_item, index) => store.update({ user: { name: `user ${index}` } })),
    );
    await store.flush();

    expect((await readJson(configFile)).profiles[0].config.user.name).toBe("user 24");
    expect(await userDataFiles()).toEqual(["config.json", "config.json.bak"]);
    expect(store.hasPendingWrites()).toBe(false);
  });

  it("reports pending writes until they are flushed", async () => {
    const store = new ConfigStore();
    await store.get();
    const update = store.update({ user: { name: "pending" } });
    await Promise.resolve();
    expect(store.hasPendingWrites()).toBe(true);
    await store.flush();
    expect(store.hasPendingWrites()).toBe(false);
    await update;
  });

  it("keeps the previous good config in the backup", async () => {
    const store = new ConfigStore();
    await store.update({ model: { apiKey: "one" } });
    await store.update({ model: { apiKey: "two" } });
    expect((await readJson(`${configFile}.bak`)).profiles[0].config.model.apiKey).toBe("one");
  });

  it("rejects bad patches without breaking the stored config", async () => {
    const store = new ConfigStore();
    await store.update({ model: { apiKey: "key" }, runtime: { historyRounds: 7 } });
    const config = await store.update({
      runtime: null,
      model: { apiKey: 5, timeoutMs: 3 },
      danmaku: { zone: "nowhere" },
    } as never);

    expect(config.runtime.historyRounds).toBe(7);
    expect(config.model.apiKey).toBe("key");
    expect(config.model.timeoutMs).toBe(5000);
    expect(config.danmaku.zone).toBe("full");
    expect(await new ConfigStore().get()).toEqual(config);
  });

  it("keeps the run flag global across profile switches and deletes", async () => {
    const store = new ConfigStore();
    const first = (await store.getProfiles()).activeProfileId;
    await store.update({ runtime: { enabled: true } });
    const created = await store.createProfile("B");
    expect(created.config.runtime.enabled).toBe(true);

    await store.update({ runtime: { enabled: false } });
    const switched = await store.switchProfile(first);
    expect(switched.config.runtime.enabled).toBe(false);

    await store.update({ runtime: { enabled: true } });
    const remaining = await store.deleteProfile(first);
    expect(remaining.config.runtime.enabled).toBe(true);
    expect((await readJson(configFile)).profiles[0].config.runtime.enabled).toBe(true);
  });

  it("deletes only one profile when a hand-edited file repeats an id", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    const profiles = [
      { id: "same", name: "A", config: {} },
      { id: "same", name: "B", config: {} },
    ];
    await fs.writeFile(configFile, JSON.stringify({ activeProfileId: "same", profiles }));

    const store = new ConfigStore();
    const result = await store.deleteProfile("same");
    expect(result.profiles.profiles.map((profile) => profile.name)).toEqual(["B"]);
    expect((await store.get()).model).toEqual(defaultAppConfig.model);
  });
});
