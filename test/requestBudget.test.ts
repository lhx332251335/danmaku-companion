import { describe, expect, it } from "vitest";
import { buildMessages } from "../src/electron/main/providers/messageBuilder";
import {
  LOW_WATER_RATIO,
  estimateRequestBytes,
  jsonStringBytes,
  learnedBodyLimit,
  parseBodyLimitFromError,
  planCompaction,
  utf8ByteLength,
  type RequestShape,
} from "../src/electron/main/runtime/requestBudget";
import type { DanmakuHistoryRound } from "../src/shared/types";
import { makeConfig, makeSnapshot } from "./helpers";

const character = { name: "Mika", persona: "p", tone: "t", language: "zh-CN" };

function rounds(count: number, imageBytes: number): DanmakuHistoryRound[] {
  return Array.from({ length: count }, (_, index) => ({
    userText: "",
    assistantText: JSON.stringify({ comments: [`第${index}轮弹幕`, "233"] }),
    snapshot: imageBytes > 0 ? makeSnapshot(imageBytes) : undefined,
  }));
}

function shapeFor(snapshotBytes: number, visionEnabled = true): RequestShape {
  const config = makeConfig();
  const { messages } = buildMessages({ character, maxItems: 3, history: [] }, config);
  return {
    systemText: messages[0].content as string,
    userText: "",
    snapshot: snapshotBytes > 0 ? makeSnapshot(snapshotBytes) : undefined,
    model: config.model.model,
    visionEnabled,
  };
}

function actualBodyBytes(history: DanmakuHistoryRound[], shape: RequestShape): number {
  const config = makeConfig({ model: { visionEnabled: shape.visionEnabled } });
  const { messages } = buildMessages(
    { character, maxItems: 3, history, snapshot: shape.snapshot },
    config,
  );
  const body = JSON.stringify({
    model: config.model.model,
    messages,
    max_tokens: config.model.maxTokens,
    stream: false,
    temperature: config.model.temperature,
  });
  return utf8ByteLength(body);
}

describe("byte helpers", () => {
  it("counts UTF-8 bytes like Buffer.byteLength", () => {
    for (const text of ["abc", "弹幕", "😀x", "é", "a\ud800b"]) {
      expect(utf8ByteLength(text)).toBe(Buffer.byteLength(text, "utf8"));
    }
    expect(jsonStringBytes('a"b')).toBe(Buffer.byteLength(JSON.stringify('a"b')));
  });
});

describe("estimateRequestBytes", () => {
  it("is an upper bound within 1% + 2 KB of the real body", () => {
    for (const [count, imageBytes] of [
      [0, 0],
      [3, 0],
      [5, 40_000],
      [12, 250_000],
    ] as const) {
      const history = rounds(count, imageBytes);
      const shape = shapeFor(60_000);
      const estimate = estimateRequestBytes(history, shape);
      const actual = actualBodyBytes(history, shape);
      expect(estimate).toBeGreaterThanOrEqual(actual);
      expect(estimate - actual).toBeLessThan(actual * 0.01 + 2048 * (count + 1));
    }
  });

  it("stays an upper bound for rounds whose image was dropped", () => {
    const history = rounds(4, 50_000).map((round, index) =>
      index < 2 ? { ...round, snapshot: undefined, imageOmitted: true } : round,
    );
    const shape = shapeFor(50_000);
    expect(estimateRequestBytes(history, shape)).toBeGreaterThanOrEqual(actualBodyBytes(history, shape));
  });

  it("ignores history images when vision is disabled", () => {
    const history = rounds(4, 50_000);
    expect(estimateRequestBytes(history, shapeFor(0, false))).toBeLessThan(10_000);
  });
});

describe("planCompaction", () => {
  const budget = { maxBodyBytes: 48 * 1024 * 1024, maxHistoryImages: 10 };

  it("changes nothing while both limits hold", () => {
    const plan = planCompaction(rounds(10, 100_000), shapeFor(100_000), budget);
    expect(plan.dropImageIndexes).toEqual([]);
    expect(plan.reason).toBeUndefined();
    expect(plan.historyImages).toBe(10);
  });

  it("drops the oldest images down to the low-water mark when the image cap is exceeded", () => {
    const plan = planCompaction(rounds(11, 100_000), shapeFor(100_000), budget);
    expect(plan.reason).toBe("images");
    expect(plan.dropImageIndexes).toEqual([0, 1, 2, 3, 4, 5]);
    expect(plan.historyImages).toBe(Math.floor(10 * LOW_WATER_RATIO));
  });

  it("drops by size when the body limit is exceeded and lands under half the limit", () => {
    const image = 5 * 1024 * 1024;
    const plan = planCompaction(rounds(10, image), shapeFor(image), budget);
    expect(plan.reason).toBe("bytes");
    expect(plan.estimatedBodyBytes).toBeLessThanOrEqual(budget.maxBodyBytes * LOW_WATER_RATIO);
    expect(plan.dropImageIndexes[0]).toBe(0);
    expect(plan.overBudget).toBe(false);
  });

  it("reports overBudget when the current screenshot alone is too large", () => {
    const plan = planCompaction(rounds(2, 1000), shapeFor(2_000_000), { maxBodyBytes: 1_000_000, maxHistoryImages: 10 });
    expect(plan.dropImageIndexes).toEqual([0, 1]);
    expect(plan.overBudget).toBe(true);
  });

  it("skips rounds that already have no screenshot", () => {
    const history = rounds(12, 100_000);
    history[0] = { ...history[0], snapshot: undefined, imageOmitted: true };
    const plan = planCompaction(history, shapeFor(100_000), budget);
    expect(plan.reason).toBe("images");
    expect(plan.dropImageIndexes).not.toContain(0);
    expect(plan.historyImages).toBe(5);
  });

  it("keeps the prefix stable between batches (append-only rounds produce empty plans)", () => {
    const history = rounds(5, 100_000);
    const plans = [];
    for (let round = 0; round < 5; round += 1) {
      plans.push(planCompaction(history, shapeFor(100_000), budget).dropImageIndexes.length);
      history.push(rounds(1, 100_000)[0]);
    }
    expect(plans).toEqual([0, 0, 0, 0, 0]);
    history.push(rounds(1, 100_000)[0]);
    expect(planCompaction(history, shapeFor(100_000), budget).dropImageIndexes.length).toBeGreaterThan(0);
  });
});

describe("413 learning", () => {
  const llmApiBody = "Request Entity Too Large\n\nexceeds max_body of 67108864\n\n(generated by llm_api)";

  it("reads the limit from llm_api and nginx-style messages", () => {
    expect(parseBodyLimitFromError(llmApiBody)).toBe(67108864);
    expect(parseBodyLimitFromError("body limit is 1048576 bytes")).toBe(1048576);
    expect(parseBodyLimitFromError("<html>413 Request Entity Too Large</html>")).toBeUndefined();
  });

  it("learns just under the reported limit, or half the rejected body", () => {
    expect(learnedBodyLimit(73_518_731, llmApiBody)).toBe(Math.floor(67108864 * 0.95));
    expect(learnedBodyLimit(10_000_000, "<html>413</html>")).toBe(5_000_000);
  });
});
