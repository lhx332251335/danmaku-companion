import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { makeLogEntry } from "./logHelpers";

const paths = vi.hoisted(() => ({ userData: "" }));

vi.mock("electron", () => ({
  app: { getPath: () => paths.userData },
}));

import { GenerationLogStore } from "../src/electron/main/generationLogStore";

let root: string;
let logFile: string;
let legacyFile: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "danmaku-log-"));
  paths.userData = path.join(root, "userData");
  logFile = path.join(paths.userData, "generation-log.jsonl");
  legacyFile = path.join(paths.userData, "generation-log.json");
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function fileLines(): Promise<string[]> {
  const text = await fs.readFile(logFile, "utf8");
  return text.split("\n").filter(Boolean);
}

async function ids(store: GenerationLogStore, limit?: number): Promise<string[]> {
  return (await store.get(limit)).map((entry) => entry.id);
}

describe("GenerationLogStore", () => {
  it("appends one compact JSON line per entry and returns newest first", async () => {
    const store = new GenerationLogStore();
    await store.append(makeLogEntry("a"), 200);
    await store.append(makeLogEntry("b"), 200);

    const lines = await fileLines();
    expect(lines.map((line) => JSON.parse(line).id)).toEqual(["a", "b"]);
    expect(lines[0]).not.toContain("\n  ");
    expect(await ids(store)).toEqual(["b", "a"]);
    expect(await ids(new GenerationLogStore())).toEqual(["b", "a"]);
  });

  it("keeps the newest entries and compacts the file once it passes 1.5x the limit", async () => {
    const store = new GenerationLogStore();
    for (let index = 1; index <= 15; index += 1) {
      await store.append(makeLogEntry(String(index)), 10);
    }
    expect(await fileLines()).toHaveLength(15);
    expect(await ids(store)).toHaveLength(10);
    expect(await ids(new GenerationLogStore(), 10)).toEqual(
      ["15", "14", "13", "12", "11", "10", "9", "8", "7", "6"],
    );

    await store.append(makeLogEntry("16"), 10);
    expect((await fileLines()).map((line) => JSON.parse(line).id)).toEqual(
      ["7", "8", "9", "10", "11", "12", "13", "14", "15", "16"],
    );
  });

  it("migrates the old JSON array file", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    await fs.writeFile(legacyFile, JSON.stringify([makeLogEntry("old")], null, 2));

    const store = new GenerationLogStore();
    expect(await ids(store)).toEqual(["old"]);
    await store.append(makeLogEntry("new"), 200);
    expect((await fileLines()).map((line) => JSON.parse(line).id)).toEqual(["old", "new"]);
    await expect(fs.stat(legacyFile)).rejects.toThrow();
  });

  it("keeps an unreadable old log aside instead of deleting it", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    const truncated = JSON.stringify([makeLogEntry("old")], null, 2).slice(0, 40);
    await fs.writeFile(legacyFile, truncated);

    const store = new GenerationLogStore();
    expect(await ids(store)).toEqual([]);
    await store.append(makeLogEntry("new"), 200);

    const kept = (await fs.readdir(paths.userData)).filter((name) => name.startsWith("generation-log.json.corrupt-"));
    expect(kept).toHaveLength(1);
    expect(await fs.readFile(path.join(paths.userData, kept[0]), "utf8")).toBe(truncated);
  });

  it("skips a cut-off last line and rewrites a clean file on the next append", async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    await fs.writeFile(logFile, `${JSON.stringify(makeLogEntry("a"))}\n{"id":"b","cy`);

    const store = new GenerationLogStore();
    expect(await ids(store)).toEqual(["a"]);
    await store.append(makeLogEntry("c"), 200);
    expect((await fileLines()).map((line) => JSON.parse(line).id)).toEqual(["a", "c"]);
  });

  it("rewrites the whole file after a failed append", async () => {
    const store = new GenerationLogStore();
    await store.append(makeLogEntry("a"), 200);
    await fs.rm(logFile);
    await fs.mkdir(logFile);
    await expect(store.append(makeLogEntry("b"), 200)).rejects.toThrow();

    await fs.rm(logFile, { recursive: true });
    await store.append(makeLogEntry("c"), 200);
    expect((await fileLines()).map((line) => JSON.parse(line).id)).toEqual(["a", "b", "c"]);
  });

  it("orders queued appends and clears without duplicating or resurrecting entries", async () => {
    const store = new GenerationLogStore();
    await store.append(makeLogEntry("a"), 200);
    const pending = [
      store.append(makeLogEntry("b"), 200),
      store.clear(),
      store.append(makeLogEntry("c"), 200),
      store.append(makeLogEntry("d"), 200),
    ];
    await Promise.all(pending);
    await store.flush();

    expect((await fileLines()).map((line) => JSON.parse(line).id)).toEqual(["c", "d"]);
    expect(await ids(store)).toEqual(["d", "c"]);
    expect(store.hasPendingWrites()).toBe(false);
    expect((await fs.readdir(paths.userData)).sort()).toEqual(["generation-log.jsonl"]);
  });
});
