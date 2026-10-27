import { readFileSync } from "node:fs";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const preloadSource = readFileSync(new URL("../src/electron/preload/index.ts", import.meta.url), "utf8");

/** Modules the compiled CommonJS output requires at runtime (type-only imports are erased). */
function runtimeRequires(source: string): string[] {
  const { outputText } = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  });
  // Every require( call, whatever its quoting, so nothing slips past as a non-literal argument.
  return [...outputText.matchAll(/\brequire\(([^)]*)\)/g)].map((match) =>
    match[1].trim().replace(/^["'`]|["'`]$/g, ""),
  );
}

describe("preload", () => {
  // Both windows run with sandbox: true, where a preload can only require "electron".
  it("requires nothing but electron once compiled", () => {
    expect(runtimeRequires(preloadSource)).toEqual(["electron"]);
  });

  it("would notice side-effect imports, re-exports and dynamic imports", () => {
    const source = [
      'import type { AppConfig } from "../../shared/types";',
      'import "./polyfill";',
      'export { helper } from "./helper";',
      'export const load = () => import("./lazy");',
      "export const loadQuoted = () => import('./single');",
      "export type Config = AppConfig;",
    ].join("\n");
    expect(runtimeRequires(source)).toEqual(["./polyfill", "./helper", "./lazy", "./single"]);
  });
});
