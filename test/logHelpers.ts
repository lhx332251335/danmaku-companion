import type { GenerationLogEntry } from "../src/shared/types";

export function makeLogEntry(id: string): GenerationLogEntry {
  return {
    id,
    cycle: 1,
    reason: "timer",
    status: "success",
    startedAt: "2026-01-01T00:00:00.000Z",
    completedAt: "2026-01-01T00:00:01.000Z",
    durationMs: 1000,
    screen: { enabled: false, captured: false },
    comments: [`comment ${id}`],
  };
}
