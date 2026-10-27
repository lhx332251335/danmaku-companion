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
});
