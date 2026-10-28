import type {
  DanmakuGenerationResult,
  DanmakuHistoryRound,
  HistoryMode,
  HistoryRecovery,
  ScreenSnapshot,
} from "../../../shared/types";
import { LOW_WATER_RATIO } from "./requestBudget";

export interface HistoryWindowSettings {
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
}

/**
 * Conversation history sent with each request.
 *
 * "reset-on-limit" appends rounds until the window is full and then starts over, which keeps the
 * request prefix stable between resets. "sliding" drops the oldest round once the window is full,
 * which changes the prefix (and misses the server's prompt cache) on every round from then on.
 * "batch-sliding" drops the oldest half in one go once the window is full: one cache miss per
 * half window, while always keeping at least half a window of context.
 *
 * A context summary of the dropped rounds can be carried in the system prompt. It is only
 * replaced when the window starts over or is halved, since that already changes the prefix.
 */
export class HistoryWindow {
  private readonly rounds: DanmakuHistoryRound[] = [];
  private windowRounds = 0;
  private contextSummary: string | undefined;
  private compactionCount = 0;

  get length(): number {
    return this.rounds.length;
  }

  /** Summary of earlier rounds, for the system prompt. */
  get summary(): string | undefined {
    return this.contextSummary;
  }

  setSummary(text: string | undefined): void {
    this.contextSummary = text?.trim() || undefined;
  }

  /** Times remember() started the window over (reset-on-limit) or halved it (batch-sliding). */
  get compactions(): number {
    return this.compactionCount;
  }

  /** True when the next stored round will make remember() start over or halve the window. */
  willCompactNextRound(settings: HistoryWindowSettings): boolean {
    if (settings.historyRounds <= 0) {
      return false;
    }
    if (settings.historyMode === "reset-on-limit") {
      const nextRequestLength = Math.min(this.rounds.length, settings.historyRounds);
      return Math.max(this.windowRounds, nextRequestLength) >= settings.historyRounds;
    }
    return settings.historyMode === "batch-sliding" && this.rounds.length >= settings.historyRounds;
  }

  forRequest(historyRounds: number): DanmakuHistoryRound[] {
    if (historyRounds <= 0) {
      return [];
    }

    return this.rounds.slice(-historyRounds);
  }

  remember(
    result: Pick<DanmakuGenerationResult, "items" | "userText" | "assistantText">,
    snapshot: ScreenSnapshot | undefined,
    settings: HistoryWindowSettings,
    requestHistoryLength: number,
  ): void {
    if (settings.historyRounds <= 0) {
      this.startOver();
      return;
    }

    const countedHistoryRounds = Math.max(this.windowRounds, requestHistoryLength);
    if (
      settings.historyMode === "reset-on-limit" &&
      countedHistoryRounds >= settings.historyRounds
    ) {
      this.startOver();
      this.compactionCount += 1;
      return;
    }

    this.windowRounds = countedHistoryRounds + 1;

    if (result.items.length === 0 || !result.assistantText.trim()) {
      if (
        settings.historyMode === "reset-on-limit" &&
        this.windowRounds >= settings.historyRounds
      ) {
        this.startOver();
        this.compactionCount += 1;
      }
      return;
    }

    this.rounds.push({
      userText: result.userText,
      assistantText: result.assistantText,
      snapshot: settings.historyIncludeImages ? snapshot : undefined,
    });

    if (this.rounds.length > settings.historyRounds) {
      if (settings.historyMode === "sliding") {
        this.rounds.splice(0, this.rounds.length - settings.historyRounds);
        this.windowRounds = this.rounds.length;
      } else if (settings.historyMode === "batch-sliding") {
        const keep = Math.max(1, Math.ceil(settings.historyRounds * LOW_WATER_RATIO));
        this.rounds.splice(0, this.rounds.length - keep);
        this.windowRounds = this.rounds.length;
        this.compactionCount += 1;
      }
    }
  }

  /** Number of stored rounds that still carry a screenshot. */
  get imageCount(): number {
    return this.rounds.filter((round) => round.snapshot).length;
  }

  /**
   * Replace the screenshot of the given rounds (matched by identity, e.g. from forRequest) with an
   * omitted-screenshot marker. Their text stays in history.
   */
  dropImages(rounds: readonly DanmakuHistoryRound[]): number {
    const targets = new Set(rounds);
    let dropped = 0;
    this.rounds.forEach((round, index) => {
      if (targets.has(round) && round.snapshot) {
        this.rounds[index] = { ...round, snapshot: undefined, imageOmitted: true };
        dropped += 1;
      }
    });
    return dropped;
  }

  dropAllImages(): number {
    return this.dropImages(this.rounds);
  }

  /**
   * Make the next request smaller after the server rejected one in a way that would repeat:
   * drop the history screenshots first, and start over once there are none left.
   */
  shrinkAfterRejection(): HistoryRecovery | undefined {
    if (this.dropAllImages() > 0) {
      return "images";
    }
    if (this.rounds.length > 0) {
      this.startOver();
      return "reset";
    }
    return undefined;
  }

  /** Forget everything, including the context summary (e.g. the user cleared the overlay). */
  reset(): void {
    this.startOver();
    this.contextSummary = undefined;
  }

  /** Start a new window; the context summary stays. */
  private startOver(): void {
    this.rounds.splice(0);
    this.windowRounds = 0;
  }
}
