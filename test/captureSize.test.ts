import { describe, expect, it } from "vitest";
import {
  desktopThumbnailSize,
  fitWithinShortEdge,
  physicalDisplaySize,
} from "../src/electron/main/capture/captureSize";

describe("fitWithinShortEdge", () => {
  it("scales the short edge down to the limit and keeps the aspect ratio", () => {
    expect(fitWithinShortEdge({ width: 1920, height: 1080 }, 540)).toEqual({ width: 960, height: 540 });
    expect(fitWithinShortEdge({ width: 1080, height: 1920 }, 540)).toEqual({ width: 540, height: 960 });
  });

  it("gives a wider screen a proportionally longer image at the same p", () => {
    // 3440x1440 ultrawide at 1080p keeps text as sharp as a 16:9 screen at 1080p.
    expect(fitWithinShortEdge({ width: 3440, height: 1440 }, 1080)).toEqual({ width: 2580, height: 1080 });
  });

  it("never upscales", () => {
    expect(fitWithinShortEdge({ width: 1280, height: 720 }, 1080)).toEqual({ width: 1280, height: 720 });
  });
});

describe("desktopThumbnailSize", () => {
  it("uses physical pixels on a HiDPI display so a larger max edge is honoured", () => {
    // 1920x1080 laptop at 150%: Electron reports 1280x720 DIPs.
    expect(physicalDisplaySize({ width: 1280, height: 720 }, 1.5)).toEqual({ width: 1920, height: 1080 });
    expect(desktopThumbnailSize({ width: 1280, height: 720 }, 1.5, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(desktopThumbnailSize({ width: 1280, height: 720 }, 1.5, 2160)).toEqual({ width: 1920, height: 1080 });
  });

  it("scales a 4K display at 175% from its physical size, not its DIP size", () => {
    // 3840x2160 at 175% is reported as 2194x1234 DIPs.
    expect(desktopThumbnailSize({ width: 2194, height: 1234 }, 1.75, 1080)).toEqual({ width: 1920, height: 1080 });
    expect(desktopThumbnailSize({ width: 2194, height: 1234 }, 1.75, 2160)).toEqual({ width: 3840, height: 2160 });
  });

  it("matches the old 960px long edge at 540p on a 16:9 screen", () => {
    expect(desktopThumbnailSize({ width: 1920, height: 1080 }, 1, 540)).toEqual({ width: 960, height: 540 });
  });

  it("rounds fractional DIP sizes back to the physical size", () => {
    // 1366x768 at 125% is reported as 1093x614 DIPs.
    expect(physicalDisplaySize({ width: 1093, height: 614 }, 1.25)).toEqual({ width: 1366, height: 768 });
    expect(desktopThumbnailSize({ width: 1093, height: 614 }, 1.25, 540)).toEqual({ width: 960, height: 540 });
  });

  it("treats an invalid scale factor as 1", () => {
    expect(physicalDisplaySize({ width: 1920, height: 1080 }, 0)).toEqual({ width: 1920, height: 1080 });
    expect(physicalDisplaySize({ width: 1920, height: 1080 }, Number.NaN)).toEqual({ width: 1920, height: 1080 });
  });
});
