import { describe, expect, it } from "vitest";
import {
  desktopThumbnailSize,
  fitWithinMaxEdge,
  physicalDisplaySize,
} from "../src/electron/main/capture/captureSize";

describe("fitWithinMaxEdge", () => {
  it("scales the longest edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithinMaxEdge({ width: 1920, height: 1080 }, 960)).toEqual({ width: 960, height: 540 });
    expect(fitWithinMaxEdge({ width: 1080, height: 1920 }, 960)).toEqual({ width: 540, height: 960 });
  });

  it("never upscales", () => {
    expect(fitWithinMaxEdge({ width: 1280, height: 720 }, 1920)).toEqual({ width: 1280, height: 720 });
  });
});

describe("desktopThumbnailSize", () => {
  it("uses physical pixels on a HiDPI display so a larger max edge is honoured", () => {
    // 1920x1080 laptop at 150%: Electron reports 1280x720 DIPs.
    expect(physicalDisplaySize({ width: 1280, height: 720 }, 1.5)).toEqual({ width: 1920, height: 1080 });
    expect(desktopThumbnailSize({ width: 1280, height: 720 }, 1.5, 1920)).toEqual({ width: 1920, height: 1080 });
    expect(desktopThumbnailSize({ width: 1280, height: 720 }, 1.5, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it("caps a 4K display at 150% at the max edge instead of its DIP width", () => {
    expect(desktopThumbnailSize({ width: 2560, height: 1440 }, 1.5, 2160)).toEqual({ width: 2160, height: 1215 });
  });

  it("matches the old behaviour at 100% scaling", () => {
    expect(desktopThumbnailSize({ width: 1920, height: 1080 }, 1, 960)).toEqual({ width: 960, height: 540 });
  });

  it("rounds fractional DIP sizes back to the physical size", () => {
    // 1366x768 at 125% is reported as 1093x614 DIPs.
    expect(physicalDisplaySize({ width: 1093, height: 614 }, 1.25)).toEqual({ width: 1366, height: 768 });
    expect(desktopThumbnailSize({ width: 1093, height: 614 }, 1.25, 960)).toEqual({ width: 960, height: 540 });
  });

  it("treats an invalid scale factor as 1", () => {
    expect(physicalDisplaySize({ width: 1920, height: 1080 }, 0)).toEqual({ width: 1920, height: 1080 });
    expect(physicalDisplaySize({ width: 1920, height: 1080 }, Number.NaN)).toEqual({ width: 1920, height: 1080 });
  });
});
