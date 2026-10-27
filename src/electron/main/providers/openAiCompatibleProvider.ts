import type {
  AppConfig,
  ConnectionTestResult,
  DanmakuGenerationResult,
  DanmakuInput,
  ModelListResult,
  ModelOption,
} from "../../../shared/types";
import { buildHeaders, endpoint, serverRoot } from "./endpoints";
import { RequestTooLargeError, formatMiB } from "./errors";
import { buildRequestBody } from "./messageBuilder";
import { legacyModelOptions, mergeModelOptions, nativeModelOptions } from "./modelList";
import type { ModelProvider } from "./modelProvider";
import {
  extractUsage,
  historyComments,
  parseModelText,
  sanitize,
  textFromContent,
  type ChatCompletionResponse,
} from "./responseParser";

async function fetchJson<T>(url: string, config: AppConfig): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(Math.min(config.model.timeoutMs, 12000)),
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
      const text = textFromContent(data.choices);
      const usage = extractUsage(data);
      return {
        items: sanitize(parseModelText(text), config, input.maxItems, historyComments(input.history)),
        userText,
        assistantText: text,
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
  const requestEndpoint = endpoint(config.model.baseUrl, "models");
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

export async function listOpenAICompatibleModels(config: AppConfig): Promise<ModelListResult> {
  const candidates = [
    {
      endpoint: `${serverRoot(config.model.baseUrl)}/api/v1/models`,
      parse: nativeModelOptions,
    },
    {
      endpoint: `${serverRoot(config.model.baseUrl)}/api/v0/models`,
      parse: legacyModelOptions,
    },
    {
      endpoint: endpoint(config.model.baseUrl, "models"),
      parse: legacyModelOptions,
    },
  ];
  const errors: string[] = [];
  const successfulEndpoints: string[] = [];
  const modelGroups: ModelOption[][] = [];

  for (const candidate of candidates) {
    try {
      const data = await fetchJson<unknown>(candidate.endpoint, config);
      const models = candidate.parse(data as never);
      if (models.length > 0) {
        successfulEndpoints.push(candidate.endpoint);
        modelGroups.push(models);
      } else {
        errors.push(`${candidate.endpoint}: empty`);
      }
    } catch (error) {
      errors.push(
        `${candidate.endpoint}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

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
