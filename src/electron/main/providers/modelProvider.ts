import type {
  AppConfig,
  DanmakuGenerationResult,
  DanmakuInput,
} from "../../../shared/types";

export interface ModelProvider {
  generateDanmaku(input: DanmakuInput, config: AppConfig): Promise<DanmakuGenerationResult>;
}
