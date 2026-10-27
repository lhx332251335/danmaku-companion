import type {
  AppConfig,
  ConnectionTestResult,
  DanmakuGenerationResult,
  DanmakuInput,
  ModelListResult,
  ModelOption,
} from "../../../shared/types";
import { buildHeaders, endpoint, serverRoot } from "./endpoints";
import { buildMessages } from "./messageBuilder";
import { legacyModelOptions, mergeModelOptions, nativeModelOptions } from "./modelList";
import type { ModelProvider } from "./modelProvider";
import {
  cachedInputTokens,
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
      const { messages, userText } = buildMessages(input, config);
      const requestBody: Record<string, unknown> = {
        model: config.model.model,
        messages,
        max_tokens: config.model.maxTokens,
        stream: false,
      };

      if (config.model.sendTemperature) {
        requestBody.temperature = config.model.temperature;
      }

      const response = await fetch(requestEndpoint, {
        method: "POST",
        signal: controller.signal,
        headers: buildHeaders(config.model.apiKey, {
          "Content-Type": "application/json",
        }),
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const body = await response.text();
        throw new Error(
          `Model request failed at ${requestEndpoint} (${response.status}): ${body.slice(0, 240)}`,
        );
      }

      const data = (await response.json()) as ChatCompletionResponse;
      const text = textFromContent(data.choices);
      return {
        items: sanitize(parseModelText(text), config, input.maxItems, historyComments(input.history)),
        userText,
        assistantText: text,
        cachedInputTokens: cachedInputTokens(data),
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
