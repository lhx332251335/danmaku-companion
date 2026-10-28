import type { AppConfig, RuntimeSettings } from "../../shared/types";
import type { SettingsPageId } from "./constants";

/** Runtime fields edited on 运行节奏; every other runtime field (but the run flag) is 截图与历史. */
export const RHYTHM_FIELDS = [
  "intervalMinSeconds",
  "intervalMaxSeconds",
  "intervalSeconds",
  "startDelaySeconds",
  "itemsPerCycle",
  "itemsMinPerCycle",
  "itemsMaxPerCycle",
  "maxItemsPerCycle",
  "releaseWindowMinSeconds",
  "releaseWindowMaxSeconds",
  "releaseWindowSeconds",
] as const satisfies readonly (keyof RuntimeSettings)[];

/** Main owns the run flag; it never makes the draft dirty. */
const IGNORED_RUNTIME_FIELDS: readonly string[] = ["enabled"];

function same(left: unknown, right: unknown): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

function changedFields(saved: object, edited: object): string[] {
  const left = saved as Record<string, unknown>;
  const right = edited as Record<string, unknown>;
  const keys = new Set([...Object.keys(left), ...Object.keys(right)]);
  return [...keys].filter((key) => !same(left[key], right[key]));
}

/** Which settings pages hold unsaved edits, for the dots in the nav. */
export function dirtyPages(config: AppConfig, draft: AppConfig): Record<SettingsPageId, boolean> {
  const runtime = changedFields(config.runtime, draft.runtime).filter(
    (field) => !IGNORED_RUNTIME_FIELDS.includes(field),
  );
  const rhythm: readonly string[] = RHYTHM_FIELDS;

  return {
    model: changedFields(config.model, draft.model).length > 0,
    danmaku: changedFields(config.danmaku, draft.danmaku).length > 0,
    character:
      changedFields(config.character, draft.character).length > 0 ||
      changedFields(config.user, draft.user).length > 0,
    prompt: changedFields(config.prompt, draft.prompt).length > 0,
    rhythm: runtime.some((field) => rhythm.includes(field)),
    capture: runtime.some((field) => !rhythm.includes(field)),
  };
}
