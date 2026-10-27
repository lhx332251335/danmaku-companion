import type { ModelOption } from "../../../shared/types";

export interface LmStudioNativeModel {
  key?: string;
  display_name?: string;
  type?: string;
  state?: string;
  capabilities?: {
    vision?: boolean;
  };
  loaded_instances?: Array<{
    id?: string;
  }>;
}

export interface LmStudioLegacyModel {
  id?: string;
  type?: string;
  state?: string;
  capabilities?: string[];
}

export function uniqueModels(models: ModelOption[]): ModelOption[] {
  const seen = new Set<string>();
  return models.filter((model) => {
    if (!model.id || seen.has(model.id)) {
      return false;
    }

    seen.add(model.id);
    return true;
  });
}

export function mergeModelOptions(groups: ModelOption[][]): ModelOption[] {
  const merged = new Map<string, ModelOption>();

  groups.flat().forEach((model) => {
    if (!model.id) {
      return;
    }

    const current = merged.get(model.id);
    if (!current) {
      merged.set(model.id, model);
      return;
    }

    const nextState =
      current.state === "loaded" || !model.state
        ? current.state
        : model.state === "loaded" || !current.state
          ? model.state
          : current.state;

    merged.set(model.id, {
      id: model.id,
      name: current.name ?? model.name,
      state: nextState,
      type: current.type ?? model.type,
      vision: Boolean(current.vision || model.vision),
    });
  });

  return [...merged.values()];
}

export function nativeModelOptions(data: { models?: LmStudioNativeModel[] }): ModelOption[] {
  return uniqueModels(
    (data.models ?? [])
      .map((model) => ({
        id: model.loaded_instances?.[0]?.id ?? model.key ?? "",
        name: model.display_name,
        state: model.loaded_instances?.length ? "loaded" : "not-loaded",
        type: model.type,
        vision: Boolean(model.capabilities?.vision),
      }))
      .filter((model) => model.id),
  );
}

export function legacyModelOptions(data: { data?: LmStudioLegacyModel[] }): ModelOption[] {
  return uniqueModels(
    (data.data ?? [])
      .map((model) => ({
        id: model.id ?? "",
        state: model.state,
        type: model.type,
        vision: model.type === "vlm" || model.capabilities?.includes("vision"),
      }))
      .filter((model) => model.id),
  );
}
