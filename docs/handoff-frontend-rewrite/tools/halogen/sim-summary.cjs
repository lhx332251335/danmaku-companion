// Live check of the context summary: reset-on-limit (or batch-sliding) window with the summary on,
// run sequentially (the summary finishes before the next round, like a long interval would).
// Usage: BASE_URL=... NODE_USE_ENV_PROXY=1 node sim-summary.cjs <mode> <rounds> <window> > out.json
const fs = require("fs");
const path = require("path");
const DIST = process.env.DIST;
const { defaultAppConfig } = require(`${DIST}/shared/defaultConfig.js`);
const { HistoryWindow } = require(`${DIST}/electron/main/runtime/historyWindow.js`);
const { ContextSummarizer } = require(`${DIST}/electron/main/runtime/contextSummarizer.js`);
const { createBudgetTrace, runBudgetedRequest } = require(`${DIST}/electron/main/runtime/budgetedRequest.js`);
const { normalizeRuntimeSettings } = require(`${DIST}/electron/main/runtime/runtimeSettings.js`);
const { OpenAICompatibleProvider } = require(`${DIST}/electron/main/providers/openAiCompatibleProvider.js`);

const here = __dirname;
function snap(buf, w, h) {
  const dataUrl = `data:image/jpeg;base64,${buf.toString("base64")}`;
  return { dataUrl, width: w, height: h, format: "jpeg", mediaType: "image/jpeg", imageBytes: buf.length, dataUrlBytes: dataUrl.length, capturedAt: new Date().toISOString(), sourceName: "sim" };
}

async function main() {
  const [mode = "reset-on-limit", roundsArg = "7", windowArg = "4"] = process.argv.slice(2);
  const config = structuredClone(defaultAppConfig);
  Object.assign(config.model, { baseUrl: process.env.BASE_URL, model: process.env.MODEL || "llama/qwen3.8-flash-next-nothink", visionEnabled: true, timeoutMs: 120000 });
  Object.assign(config.runtime, { historyRounds: Number(windowArg), historyMode: mode, historyIncludeImages: true, historySummaryEnabled: true, historySummaryMaxChars: 300 });
  const runtime = normalizeRuntimeSettings(config);
  const history = new HistoryWindow();
  const provider = new OpenAICompatibleProvider();
  const rows = [];
  let settled;
  const summarizer = new ContextSummarizer(history, {
    summarize: (r) => provider.generateSummary(r.input, r.config, r.maxChars),
    onSettled: (run) => {
      const row = { kind: "summary", ok: Boolean(run.result), ms: run.durationMs, historyRounds: run.request.input.history.length, hadPreviousSummary: Boolean(run.request.input.contextSummary), requestBytes: run.result?.requestBytes, promptTokens: run.result?.promptTokens, cachedTokens: run.result?.cachedInputTokens, promptMs: run.result?.promptMs, completionTokens: run.result?.completionTokens, finishReason: run.result?.finishReason, text: run.result?.text, error: run.error ? String(run.error.message).slice(0, 300) : undefined };
      console.error(JSON.stringify(row));
      rows.push(row);
      settled?.();
    },
  });
  for (let i = 0; i < Number(roundsArg); i++) {
    const snapshot = snap(fs.readFileSync(path.join(here, "imgs", `scene${i % 8}-960.jpg`)), 960, 540);
    const trace = createBudgetTrace();
    const t = Date.now();
    const contextSummary = history.summary;
    const result = await runBudgetedRequest({ config, history, settings: runtime, input: { character: config.character, maxItems: runtime.itemsPerCycle, contextSummary }, snapshot, trace }, { generate: (input) => provider.generateDanmaku(input, config) });
    const before = history.compactions;
    history.remember(result, trace.snapshot, runtime, trace.requestHistoryLength);
    const row = { kind: "round", round: i, ms: Date.now() - t, withSummary: Boolean(contextSummary), historyRounds: trace.requestHistoryLength, requestBytes: result.requestBytes, promptTokens: result.promptTokens, cachedTokens: result.cachedInputTokens, promptMs: result.promptMs, comments: result.items.map((x) => x.text) };
    console.error(JSON.stringify(row));
    rows.push(row);
    const done = new Promise((resolve) => (settled = resolve));
    summarizer.afterRound({ enabled: true, settings: runtime, compacted: history.compactions !== before, request: () => ({ config, maxChars: runtime.historySummaryMaxChars, input: { character: config.character, maxItems: runtime.itemsPerCycle, history: history.forRequest(runtime.historyRounds), contextSummary: history.summary, maxBodyBytes: runtime.requestBodyLimitBytes } }) });
    if (summarizer.running) await done;
  }
  console.log(JSON.stringify(rows, null, 2));
}
main().catch((e) => { console.error(e); process.exit(1); });
