import { desktopCapturer, nativeImage, screen, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ScreenCaptureProbeResult,
  ScreenSnapshot,
} from "../../../shared/types";

const DEFAULT_CAPTURE_MAX_EDGE_PIXELS = 960;
const execFileAsync = promisify(execFile);

function getThumbnailSize(
  displaySize: Electron.Size,
  maxEdgePixels: number,
): { width: number; height: number } {
  const longestEdge = Math.max(displaySize.width, displaySize.height);
  const scale = Math.min(1, maxEdgePixels / longestEdge);

  return {
    width: Math.max(1, Math.round(displaySize.width * scale)),
    height: Math.max(1, Math.round(displaySize.height * scale)),
  };
}

function getScreenAccessStatus(): ReturnType<typeof systemPreferences.getMediaAccessStatus> {
  if (process.platform !== "darwin") {
    return "granted";
  }

  return systemPreferences.getMediaAccessStatus("screen");
}

function screenPermissionError(status: string): Error {
  return new Error(
    `macOS Screen Recording permission is ${status}. Open System Settings > Privacy & Security > Screen Recording, enable Danmaku Companion, then restart the app.`,
  );
}

function messageFromError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

async function captureWithMacScreencapture(
  maxEdgePixels: number,
): Promise<ScreenSnapshot> {
  const filePath = path.join(
    os.tmpdir(),
    `danmaku-companion-${process.pid}-${Date.now()}.png`,
  );

  try {
    await execFileAsync("/usr/sbin/screencapture", [
      "-x",
      "-t",
      "png",
      filePath,
    ]);
    const image = nativeImage.createFromPath(filePath);
    if (image.isEmpty()) {
      throw new Error("screencapture produced an empty image.");
    }

    const imageSize = image.getSize();
    const thumbnailSize = getThumbnailSize(imageSize, maxEdgePixels);
    const thumbnail =
      thumbnailSize.width === imageSize.width && thumbnailSize.height === imageSize.height
        ? image
        : image.resize(thumbnailSize);

    return {
      dataUrl: thumbnail.toDataURL(),
      width: thumbnailSize.width,
      height: thumbnailSize.height,
      capturedAt: new Date().toISOString(),
      sourceName: "macOS screencapture",
    };
  } catch (error) {
    throw new Error(
      `macOS screencapture failed (${getScreenAccessStatus()}): ${messageFromError(error)}`,
    );
  } finally {
    await fs.rm(filePath, { force: true }).catch(() => undefined);
  }
}

async function captureWithDesktopCapturer(
  maxEdgePixels: number,
): Promise<ScreenSnapshot> {
  const primary = screen.getPrimaryDisplay();
  const { width, height } = getThumbnailSize(primary.size, maxEdgePixels);
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: { width, height },
  });

  const source =
    sources.find((item) => item.display_id === String(primary.id)) ?? sources[0];

  if (!source || source.thumbnail.isEmpty()) {
    throw screenPermissionError(getScreenAccessStatus());
  }

  return {
    dataUrl: source.thumbnail.toDataURL(),
    width,
    height,
    capturedAt: new Date().toISOString(),
    sourceName: source.name,
  };
}

export async function probeScreenCapturePermission(): Promise<ScreenCaptureProbeResult> {
  try {
    await capturePrimaryScreen(8);
    const status = getScreenAccessStatus();

    return {
      ok: true,
      status,
      message: "Screen recording is available.",
    };
  } catch (error) {
    const status = getScreenAccessStatus();
    return {
      ok: false,
      status,
      message: error instanceof Error ? error.message : screenPermissionError(status).message,
    };
  }
}

export async function capturePrimaryScreen(
  maxEdgePixels = DEFAULT_CAPTURE_MAX_EDGE_PIXELS,
): Promise<ScreenSnapshot> {
  let macScreencaptureError: unknown;
  if (process.platform === "darwin") {
    try {
      return await captureWithMacScreencapture(maxEdgePixels);
    } catch (error) {
      macScreencaptureError = error;
      console.warn("macOS screencapture failed; trying desktopCapturer.", error);
    }
  }

  try {
    return await captureWithDesktopCapturer(maxEdgePixels);
  } catch (error) {
    if (macScreencaptureError) {
      throw new Error(
        `${messageFromError(macScreencaptureError)}; desktopCapturer fallback failed: ${messageFromError(error)}`,
      );
    }
    throw error;
  }
}
