import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("../src/electron/preload/index.ts", import.meta.url), "utf8");

describe("preload", () => {
  // Both windows run with sandbox: true, where a preload can only require "electron".
  it("imports nothing but electron at runtime", () => {
    const imports = [...preloadSource.matchAll(/^import\s+(type\s+)?[\s\S]*?\sfrom\s+"([^"]+)";/gm)];
    expect(imports.length).toBeGreaterThan(0);
    const runtimeModules = imports.filter((match) => !match[1]).map((match) => match[2]);
    expect(runtimeModules).toEqual(["electron"]);
    expect(preloadSource).not.toMatch(/\brequire\s*\(/);
    expect(preloadSource).not.toMatch(/\bimport\s*\(/);
  });
});
