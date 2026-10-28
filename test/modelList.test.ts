import { describe, expect, it } from "vitest";
import { legacyModelOptions, mergeModelOptions, nativeModelOptions } from "../src/electron/main/providers/modelList";

describe("model list parsing", () => {
  it("parses LM Studio native and OpenAI-style lists and merges them", () => {
    const native = nativeModelOptions({
      models: [
        { key: "qwen-vl", display_name: "Qwen VL", type: "vlm", capabilities: { vision: true }, loaded_instances: [{ id: "qwen-vl:1" }] },
        { key: "text-only", type: "llm" },
      ],
    });
    expect(native).toEqual([
      { id: "qwen-vl:1", name: "Qwen VL", state: "loaded", type: "vlm", vision: true },
      { id: "text-only", name: undefined, state: "not-loaded", type: "llm", vision: false },
    ]);

    const legacy = legacyModelOptions({ data: [{ id: "text-only", state: "loaded" }, { id: "" }, { id: "text-only" }] });
    expect(legacy).toHaveLength(1);

    const merged = mergeModelOptions([native, legacy]);
    expect(merged.find((model) => model.id === "text-only")?.state).toBe("loaded");
  });

  it("reads capability flags sent as an object", () => {
    const models = legacyModelOptions({
      data: [
        { id: "vl", capabilities: { vision: true } },
        { id: "text", capabilities: { vision: false } },
        { id: "listed", capabilities: ["vision"] },
      ],
    });
    expect(models.map((model) => [model.id, model.vision])).toEqual([
      ["vl", true],
      ["text", false],
      ["listed", true],
    ]);
  });

  it.each([
    ["a null body", null],
    ["a non-array list", { data: { id: "a" }, models: { key: "a" } }],
    ["null items", { data: [null], models: [null] }],
  ])("treats %s as an empty list", (_name, body) => {
    expect(legacyModelOptions(body as never)).toEqual([]);
    expect(nativeModelOptions(body as never)).toEqual([]);
  });
});
