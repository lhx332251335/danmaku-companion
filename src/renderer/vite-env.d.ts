/// <reference types="vite/client" />

import type { DanmakuBridge } from "../shared/types";

declare global {
  interface Window {
    danmaku: DanmakuBridge;
  }
}
