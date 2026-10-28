import { describe, expect, it } from "vitest";
import {
  parseGenerationLog,
  shouldCompact,
  toJsonLines,
} from "../src/electron/main/storage/generationLogFile";
import { makeLogEntry } from "./logHelpers";

describe("parseGenerationLog", () => {
  it("reads JSON Lines written by toJsonLines", () => {
    const text = toJsonLines([makeLogEntry("a"), makeLogEntry("b")]);
    expect(text.split("\n")).toHaveLength(3);
    const parsed = parseGenerationLog(text);
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["a", "b"]);
    expect(parsed.lineCount).toBe(2);
    expect(parsed.needsRewrite).toBe(false);
  });

  it("skips a cut-off last line and asks for a rewrite", () => {
    const text = `${toJsonLines([makeLogEntry("a")])}{"id":"b","cyc`;
    const parsed = parseGenerationLog(text);
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["a"]);
    expect(parsed.lineCount).toBe(2);
    expect(parsed.needsRewrite).toBe(true);
  });

  it("skips lines that are not log entries", () => {
    const parsed = parseGenerationLog(`\uFEFF${toJsonLines([makeLogEntry("a")])}[1]\n{"id":"x"}\n`);
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["a"]);
    expect(parsed.needsRewrite).toBe(true);
  });

  it("reads the old pretty-printed JSON array", () => {
    const parsed = parseGenerationLog(JSON.stringify([makeLogEntry("a"), { bad: true }], null, 2));
    expect(parsed.entries.map((entry) => entry.id)).toEqual(["a"]);
    expect(parsed.needsRewrite).toBe(true);
  });

  it("treats an empty file as empty and a broken old array as empty", () => {
    expect(parseGenerationLog("")).toEqual({ entries: [], lineCount: 0, needsRewrite: false });
    expect(parseGenerationLog("[{").entries).toEqual([]);
  });
});

describe("shouldCompact", () => {
  it("compacts once the file holds more than 1.5x the limit", () => {
    expect(shouldCompact(15, 10)).toBe(false);
    expect(shouldCompact(16, 10)).toBe(true);
    expect(shouldCompact(300, 200)).toBe(false);
    expect(shouldCompact(301, 200)).toBe(true);
  });
});
