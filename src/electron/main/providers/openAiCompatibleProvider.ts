import type {
  AppConfig,
  ConnectionTestResult,
  DanmakuGenerationResult,
  DanmakuInput,
  ModelListResult,
  ModelOption,
} from "../../../shared/types";
import { buildHeaders, endpoint, lmStudioModelEndpoints } from "./endpoints";
import { RequestTooLargeError, formatMiB } from "./errors";
import { buildRequestBody } from "./messageBuilder";
import { legacyModelOptions, mergeModelOptions, nativeModelOptions } from "./modelList";
import type { ModelProvider } from "./modelProvider";
import {
  extractUsage,
  historyComments,
  readCompletion,
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

async function fetchJson<T>(url: string, config: AppConfig, timeoutMs: number): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: buildHeaders(config.model.apiKey),
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`HTTP ${response.status}: ${body.slice(0, 240)}`);
  }

  return (await response.json()) as T;
}

export class OpenAICompatibleProvider implements ModelProvider {
  async generateDanmaku(input: DanmakuInput, config: AppConfig): Promise<DanmakuGenerationResult> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), config.model.timeoutMs);
    const externalAbort = () => controller.abort();

    if (input.abortSignal?.aborted) {
      externalAbort();
    } else {
      input.abortSignal?.addEventListener("abort", externalAbort, { once: true });
    }

    try {
      const requestEndpoint = endpoint(config.model.baseUrl, "chat/completions");
      const { body: requestBody, userText } = buildRequestBody(input, config);
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

      const response = await fetch(requestEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: buildHeaders(config.model.apiKey, {
          "Content-Type": "application/json",
        }),
        body: serializedBody,
      });

      if (!response.ok) {
        const body = await response.text();
        const message = `Model request failed at ${requestEndpoint} (${response.status}): ${body.slice(0, 240)}`;
        if (response.status === 413) {
          throw new RequestTooLargeError({
            message: `${message} [request body ${formatMiB(requestBytes)}]`,
            requestBytes,
            serverBody: body.slice(0, 2000),
            fromServer: true,
          });
        }
        throw new Error(message);
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const completion = readCompletion(data, config.model.maxTokens);
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
    } finally {
      clearTimeout(timeout);
      input.abortSignal?.removeEventListener("abort", externalAbort);
    }
  }
}

export async function testOpenAICompatibleConnection(
  config: AppConfig,
): Promise<ConnectionTestResult> {
  let requestEndpoint: string;
  try {
    requestEndpoint = endpoint(config.model.baseUrl, "models");
  } catch (error) {
    return { ok: false, endpoint: config.model.baseUrl, message: errorMessage(error) };
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.min(config.model.timeoutMs, 12000));

  try {
    const response = await fetch(requestEndpoint, {
      signal: controller.signal,
      headers: buildHeaders(config.model.apiKey),
    });

    if (!response.ok) {
      const body = await response.text();
      return {
        ok: false,
        endpoint: requestEndpoint,
        message: `HTTP ${response.status}: ${body.slice(0, 240)}`,
      };
    }

    const data = (await response.json()) as { data?: Array<{ id?: string }> };
    const models = data.data?.map((item) => item.id).filter(Boolean) as string[] | undefined;
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
      message: error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function modelListCandidates(config: AppConfig): ModelListCandidate[] {
  const listTimeoutMs = Math.min(config.model.timeoutMs, MODEL_LIST_TIMEOUT_MS);
  const probeTimeoutMs = Math.min(listTimeoutMs, LM_STUDIO_PROBE_TIMEOUT_MS);
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
      timeoutMs: listTimeoutMs,
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

  // In parallel: a hanging LM Studio probe costs its own short timeout, not the whole refresh.
  const outcomes = await Promise.allSettled(
    candidates.map(async (candidate) =>
      candidate.parse((await fetchJson<unknown>(candidate.endpoint, config, candidate.timeoutMs)) as never),
    ),
  );
  const errors: string[] = [];
  const successfulEndpoints: string[] = [];
  const modelGroups: ModelOption[][] = [];

  outcomes.forEach((outcome, index) => {
    const candidateEndpoint = candidates[index].endpoint;
    if (outcome.status === "rejected") {
      errors.push(`${candidateEndpoint}: ${errorMessage(outcome.reason)}`);
    } else if (outcome.value.length === 0) {
      errors.push(`${candidateEndpoint}: empty`);
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
