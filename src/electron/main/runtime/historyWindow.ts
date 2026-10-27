import type {
  DanmakuGenerationResult,
  DanmakuHistoryRound,
  HistoryMode,
  ScreenSnapshot,
} from "../../../shared/types";

export interface HistoryWindowSettings {
  historyRounds: number;
  historyMode: HistoryMode;
  historyIncludeImages: boolean;
}

/**
 * Conversation history sent with each request.
 *
 * "reset-on-limit" appends rounds until the window is full and then starts over, which keeps the
 * request prefix stable between resets. "sliding" drops the oldest round once the window is full.
 */
export class HistoryWindow {
  private readonly rounds: DanmakuHistoryRound[] = [];
  private windowRounds = 0;

  get length(): number {
    return this.rounds.length;
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
      this.reset();
      return;
    }

    const countedHistoryRounds = Math.max(this.windowRounds, requestHistoryLength);
    if (
      settings.historyMode === "reset-on-limit" &&
      countedHistoryRounds >= settings.historyRounds
    ) {
      this.reset();
      return;
    }

    this.windowRounds = countedHistoryRounds + 1;

    if (result.items.length === 0 || !result.assistantText.trim()) {
      if (
        settings.historyMode === "reset-on-limit" &&
        this.windowRounds >= settings.historyRounds
      ) {
        this.reset();
      }
      return;
    }

    this.rounds.push({
      userText: result.userText,
      assistantText: result.assistantText,
      snapshot: settings.historyIncludeImages ? snapshot : undefined,
    });

    if (settings.historyMode === "sliding" && this.rounds.length > settings.historyRounds) {
      this.rounds.splice(0, this.rounds.length - settings.historyRounds);
      this.windowRounds = this.rounds.length;
    }
  }

  reset(): void {
    this.rounds.splice(0);
    this.windowRounds = 0;
  }
}
