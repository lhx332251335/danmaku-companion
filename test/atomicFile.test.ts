import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  WriteQueue,
  fileTimestamp,
  readTextIfExists,
  renameWithRetry,
  writeFileAtomic,
} from "../src/electron/main/storage/atomicFile";

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "danmaku-atomic-"));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

function errnoError(code: string): NodeJS.ErrnoException {
  return Object.assign(new Error(code), { code });
}

describe("writeFileAtomic", () => {
  it("creates the directory, replaces the file and leaves no temp file", async () => {
    const file = path.join(dir, "nested", "config.json");
    await writeFileAtomic(file, "one");
    await writeFileAtomic(file, "two");
    expect(await fs.readFile(file, "utf8")).toBe("two");
    expect(await fs.readdir(path.dirname(file))).toEqual(["config.json"]);
  });

  it("copies the replaced file to the backup path", async () => {
    const file = path.join(dir, "config.json");
    await writeFileAtomic(file, "one", { backupPath: `${file}.bak` });
    await expect(fs.stat(`${file}.bak`)).rejects.toThrow();
    await writeFileAtomic(file, "two", { backupPath: `${file}.bak` });
    expect(await fs.readFile(`${file}.bak`, "utf8")).toBe("one");
  });

  it("keeps the original file and removes the temp file when the rename fails", async () => {
    const file = path.join(dir, "config.json");
    await writeFileAtomic(file, "good");
    const rename = vi.fn(async () => {
      throw errnoError("EXDEV");
    });
    await expect(writeFileAtomic(file, "new", { rename })).rejects.toThrow("EXDEV");
    expect(await fs.readFile(file, "utf8")).toBe("good");
    expect(await fs.readdir(dir)).toEqual(["config.json"]);
  });
});

describe("renameWithRetry", () => {
  it("retries while Windows reports the target as locked", async () => {
    const rename = vi
      .fn<(from: string, to: string) => Promise<void>>()
      .mockRejectedValueOnce(errnoError("EPERM"))
      .mockRejectedValueOnce(errnoError("EBUSY"))
      .mockResolvedValueOnce(undefined);
    await renameWithRetry("a", "b", { rename, retryDelaysMs: [0, 0, 0] });
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("gives up after the last retry", async () => {
    const rename = vi.fn(async () => {
      throw errnoError("EACCES");
    });
    await expect(renameWithRetry("a", "b", { rename, retryDelaysMs: [0, 0] })).rejects.toThrow("EACCES");
    expect(rename).toHaveBeenCalledTimes(3);
  });

  it("does not retry other errors", async () => {
    const rename = vi.fn(async () => {
      throw errnoError("ENOENT");
    });
    await expect(renameWithRetry("a", "b", { rename, retryDelaysMs: [0, 0] })).rejects.toThrow("ENOENT");
    expect(rename).toHaveBeenCalledTimes(1);
  });
});

describe("readTextIfExists", () => {
  it("returns undefined only for a missing file", async () => {
    expect(await readTextIfExists(path.join(dir, "missing.json"))).toBeUndefined();
    await expect(readTextIfExists(dir)).rejects.toMatchObject({ code: "EISDIR" });
  });
});

describe("fileTimestamp", () => {
  it("contains no characters Windows forbids in file names", () => {
    expect(fileTimestamp(new Date("2026-01-02T03:04:05.678Z"))).toBe("2026-01-02T03-04-05-678Z");
  });
});

describe("WriteQueue", () => {
  it("runs tasks one at a time in order and keeps going after a failure", async () => {
    const queue = new WriteQueue();
    const events: string[] = [];
    let release: () => void = () => undefined;
    const first = queue.run(
      () =>
        new Promise<void>((resolve) => {
          events.push("first:start");
          release = () => {
            events.push("first:end");
            resolve();
          };
        }),
    );
    const second = queue.run(async () => {
      events.push("second");
      throw new Error("boom");
    });
    const third = queue.run(async () => {
      events.push("third");
      return 3;
    });

    await Promise.resolve();
    expect(queue.hasPending()).toBe(true);
    release();
    await first;
    await expect(second).rejects.toThrow("boom");
    expect(await third).toBe(3);
    await queue.flush();
    expect(queue.hasPending()).toBe(false);
    expect(events).toEqual(["first:start", "first:end", "second", "third"]);
  });
});
