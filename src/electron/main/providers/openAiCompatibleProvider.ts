import type {
  AppConfig,
  ConnectionTestResult,
  ContextSummaryResult,
  DanmakuGenerationResult,
  DanmakuInput,
  ModelListResult,
  ModelOption,
} from "../../../shared/types";
import { buildHeaders, endpoint, lmStudioModelEndpoints } from "./endpoints";
import { ModelHttpError, RequestTooLargeError, formatMiB, httpErrorMessage } from "./errors";
import { fetchJson, fetchText, parseJsonBody } from "./http";
import { buildRequestBody, buildSummaryRequestBody, summaryMaxTokens } from "./messageBuilder";
import { legacyModelOptions, mergeModelOptions, nativeModelOptions } from "./modelList";
import type { ModelProvider } from "./modelProvider";
import { normalizedMaxTokens, normalizedTimeoutMs } from "./modelSettings";
import {
  extractUsage,
  historyComments,
  readCompletion,
  readSummary,
  sanitize,
  type ChatCompletionResponse,
} from "./responseParser";

const MODEL_LIST_TIMEOUT_MS = 12_000;
const LM_STUDIO_PROBE_TIMEOUT_MS = 4_000;

interface ModelListCandidate {
  endpoint: string;
  timeoutMs: number;
  parse: (data: never) => ModelOption[];
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function listTimeoutMs(config: AppConfig): number {
  return Math.min(normalizedTimeoutMs(config), MODEL_LIST_TIMEOUT_MS);
}

export class OpenAICompatibleProvider implements ModelProvider {
  async generateDanmaku(input: DanmakuInput, config: AppConfig): Promise<DanmakuGenerationResult> {
    const { body: requestBody, userText } = buildRequestBody(input, config);
    const { data, requestBytes } = await postChatCompletion(requestBody, input, config);
    const completion = readCompletion(data, normalizedMaxTokens(config));
    const usage = extractUsage(data);
    return {
      items: sanitize(completion.comments, config, input.maxItems, historyComments(input.history)),
      userText,
      assistantText: completion.text,
      rawOutput: completion.rawText,
      finishReason: completion.finishReason,
      cachedInputTokens: usage.cachedTokens,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      promptMs: usage.promptMs,
      requestBytes,
    };
  }

  /** Summarize the history in `input` (see buildSummaryRequestBody) in up to maxChars characters. */
  async generateSummary(
    input: DanmakuInput,
    config: AppConfig,
    maxChars: number,
  ): Promise<ContextSummaryResult> {
    let history = input.history ?? [];
    let posted: Awaited<ReturnType<typeof postChatCompletion>>;
    try {
      posted = await postChatCompletion(buildSummaryRequestBody(input, config, maxChars), input, config);
    } catch (error) {
      const hasImages = history.some((round) => round.snapshot);
      if (!(error instanceof RequestTooLargeError) || !hasImages || input.abortSignal?.aborted) {
        throw error;
      }
      // The summary only needs the conversation: send it without the history screenshots.
      history = history.map((round) =>
        round.snapshot ? { ...round, snapshot: undefined, imageOmitted: true } : round,
      );
      posted = await postChatCompletion(
        buildSummaryRequestBody({ ...input, history }, config, maxChars),
        input,
        config,
      );
    }
    const { data, requestBytes } = posted;
    const summary = readSummary(data, summaryMaxTokens(maxChars), maxChars);
    const usage = extractUsage(data);
    return {
      text: summary.text,
      rawOutput: summary.rawText,
      finishReason: summary.finishReason,
      cachedInputTokens: usage.cachedTokens,
      promptTokens: usage.promptTokens,
      completionTokens: usage.completionTokens,
      promptMs: usage.promptMs,
      requestBytes,
      historyImagesSent: config.model.visionEnabled
        ? history.filter((round) => round.snapshot).length
        : 0,
    };
  }
}

/** POSTs a chat-completions body, enforcing input.maxBodyBytes and mapping 413s and HTTP errors. */
async function postChatCompletion(
  requestBody: Record<string, unknown>,
  input: Pick<DanmakuInput, "maxBodyBytes" | "abortSignal">,
  config: AppConfig,
): Promise<{ data: ChatCompletionResponse; requestBytes: number }> {
  const requestEndpoint = endpoint(config.model.baseUrl, "chat/completions");
  const serializedBody = JSON.stringify(requestBody);
  const requestBytes = Buffer.byteLength(serializedBody, "utf8");

  if (input.maxBodyBytes !== undefined && requestBytes > input.maxBodyBytes) {
    throw new RequestTooLargeError({
      message: `Request body ${formatMiB(requestBytes)} exceeds the ${formatMiB(input.maxBodyBytes)} limit.`,
      requestBytes,
      limitBytes: input.maxBodyBytes,
      fromServer: false,
    });
  }

  const response = await fetchText(
    requestEndpoint,
    {
      method: "POST",
      headers: buildHeaders(config.model.apiKey, {
        "Content-Type": "application/json",
      }),
      body: serializedBody,
    },
    normalizedTimeoutMs(config),
    input.abortSignal,
  );

  if (!response.ok) {
    const message = `模型请求失败 ${httpErrorMessage(response.status, response.statusText, response.body, requestEndpoint)}`;
    if (response.status === 413) {
      throw new RequestTooLargeError({
        message: `${message} [request body ${formatMiB(requestBytes)}]`,
        requestBytes,
        serverBody: response.body.slice(0, 2000),
        fromServer: true,
      });
    }
    throw new ModelHttpError(message, response.status);
  }

  return { data: parseJsonBody<ChatCompletionResponse>(response, requestEndpoint), requestBytes };
}

export async function testOpenAICompatibleConnection(
  config: AppConfig,
): Promise<ConnectionTestResult> {
  let requestEndpoint = config.model.baseUrl;

  try {
    requestEndpoint = endpoint(config.model.baseUrl, "models");
    const data = await fetchJson<{ data?: Array<{ id?: string }> } | null>(
      requestEndpoint,
      { headers: buildHeaders(config.model.apiKey) },
      listTimeoutMs(config),
    );
    const models = Array.isArray(data?.data)
      ? data.data.map((item) => item?.id).filter((id): id is string => typeof id === "string" && id.length > 0)
      : undefined;
    return {
      ok: true,
      endpoint: requestEndpoint,
      message: models?.length ? `Connected. ${models.length} model(s) found.` : "Connected.",
      models,
    };
  } catch (error) {
    return {
      ok: false,
      endpoint: requestEndpoint,
      message: errorMessage(error),
    };
  }
}

function modelListCandidates(config: AppConfig): ModelListCandidate[] {
  const timeoutMs = listTimeoutMs(config);
  const probeTimeoutMs = Math.min(timeoutMs, LM_STUDIO_PROBE_TIMEOUT_MS);
  const lmStudio = lmStudioModelEndpoints(config.model.baseUrl);
  const probes: ModelListCandidate[] = lmStudio
    ? [
        { endpoint: lmStudio.native, timeoutMs: probeTimeoutMs, parse: nativeModelOptions },
        { endpoint: lmStudio.legacy, timeoutMs: probeTimeoutMs, parse: legacyModelOptions },
      ]
    : [];
  return [
    ...probes,
    {
      endpoint: endpoint(config.model.baseUrl, "models"),
      timeoutMs,
      parse: legacyModelOptions,
    },
  ];
}

export async function listOpenAICompatibleModels(config: AppConfig): Promise<ModelListResult> {
  let candidates: ModelListCandidate[];
  try {
    candidates = modelListCandidates(config);
  } catch (error) {
    return { ok: false, endpoint: config.model.baseUrl, message: errorMessage(error), models: [] };
  }

  const headers = buildHeaders(config.model.apiKey);
  // In parallel: a hanging LM Studio probe costs its own short timeout, not the whole refresh.
  const outcomes = await Promise.allSettled(
    candidates.map(async (candidate) =>
      candidate.parse((await fetchJson<unknown>(candidate.endpoint, { headers }, candidate.timeoutMs)) as never),
    ),
  );
  const errors: string[] = [];
  const successfulEndpoints: string[] = [];
  const modelGroups: ModelOption[][] = [];

  outcomes.forEach((outcome, index) => {
    const candidateEndpoint = candidates[index].endpoint;
    if (outcome.status === "rejected") {
      errors.push(errorMessage(outcome.reason));
    } else if (outcome.value.length === 0) {
      errors.push(`没有返回模型（${candidateEndpoint}）`);
    } else {
      successfulEndpoints.push(candidateEndpoint);
      modelGroups.push(outcome.value);
    }
  });

  const models = mergeModelOptions(modelGroups);
  if (models.length > 0) {
    return {
      ok: true,
      endpoint: successfulEndpoints.join(", "),
      message: `${models.length} model(s) found from ${successfulEndpoints.length} endpoint(s).`,
      models,
    };
  }

  return {
    ok: false,
    endpoint: candidates.map((candidate) => candidate.endpoint).join(", "),
    message: errors.join(" | "),
    models: [],
  };
}
