import { desktopCapturer, nativeImage, screen, systemPreferences } from "electron";
import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type {
  ScreenCaptureProbeResult,
  ScreenImageFormat,
  ScreenSnapshot,
} from "../../../shared/types";
import { LIMITS, clampOr } from "../../../shared/limits";
import { desktopThumbnailSize, fitWithinMaxEdge } from "./captureSize";

const DEFAULT_CAPTURE_MAX_EDGE_PIXELS = 960;
const DEFAULT_CAPTURE_IMAGE_FORMAT: ScreenImageFormat = "jpeg";
const DEFAULT_CAPTURE_JPEG_QUALITY = 0.82;
const execFileAsync = promisify(execFile);

interface CaptureEncodingOptions {
  format?: ScreenImageFormat;
  jpegQuality?: number;
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

function normalizeJpegQuality(value: number | undefined): number {
  return clampOr(value, LIMITS.captureJpegQuality, DEFAULT_CAPTURE_JPEG_QUALITY);
}

function encodeImage(
  image: Electron.NativeImage,
  options: CaptureEncodingOptions,
): Pick<
  ScreenSnapshot,
  "dataUrl" | "format" | "mediaType" | "imageBytes" | "dataUrlBytes" | "jpegQuality"
> {
  const format = options.format ?? DEFAULT_CAPTURE_IMAGE_FORMAT;
  const jpegQuality = normalizeJpegQuality(options.jpegQuality);
  const mediaType = format === "png" ? "image/png" : "image/jpeg";
  const buffer =
    format === "png"
      ? image.toPNG()
      : image.toJPEG(Math.round(jpegQuality * 100));
  const dataUrl = `data:${mediaType};base64,${buffer.toString("base64")}`;

  return {
    dataUrl,
    format,
    mediaType,
    imageBytes: buffer.byteLength,
    dataUrlBytes: Buffer.byteLength(dataUrl, "utf8"),
    jpegQuality: format === "jpeg" ? jpegQuality : undefined,
  };
}

async function captureWithMacScreencapture(
  maxEdgePixels: number,
  options: CaptureEncodingOptions,
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
    const thumbnailSize = fitWithinMaxEdge(imageSize, maxEdgePixels);
    const thumbnail =
      thumbnailSize.width === imageSize.width && thumbnailSize.height === imageSize.height
        ? image
        : image.resize(thumbnailSize);

    return {
      ...encodeImage(thumbnail, options),
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
  options: CaptureEncodingOptions,
): Promise<ScreenSnapshot> {
  const primary = screen.getPrimaryDisplay();
  const sources = await desktopCapturer.getSources({
    types: ["screen"],
    thumbnailSize: desktopThumbnailSize(primary.size, primary.scaleFactor, maxEdgePixels),
  });

  const primarySource = sources.find((item) => item.display_id === String(primary.id));
  const source = primarySource ?? sources[0];
  if (!primarySource && sources.length > 1) {
    console.warn(
      `No capture source matches primary display ${primary.id}; using "${source.name}".`,
    );
  }

  if (!source || source.thumbnail.isEmpty()) {
    throw screenPermissionError(getScreenAccessStatus());
  }

  const { width, height } = source.thumbnail.getSize();
  return {
    ...encodeImage(source.thumbnail, options),
    width,
    height,
    capturedAt: new Date().toISOString(),
    sourceName: source.name,
  };
}

const SHRINK_MIN_EDGE_PIXELS = 320;
const SHRINK_SCALE_STEP = 0.75;
const SHRINK_MAX_JPEG_QUALITY = 0.8;

/**
 * Re-encode a screenshot as a smaller JPEG until its data URL fits in maxDataUrlBytes. Used when
 * the current screenshot alone exceeds the request budget (e.g. a large PNG against a server with
 * a small body limit). Returns undefined if it cannot fit above the minimum size.
 */
export function shrinkSnapshotToFit(
  snapshot: ScreenSnapshot,
  maxDataUrlBytes: number,
): ScreenSnapshot | undefined {
  const original = nativeImage.createFromDataURL(snapshot.dataUrl);
  if (original.isEmpty()) {
    return undefined;
  }

  const originalSize = original.getSize();
  let scale = 1;
  let quality = Math.min(snapshot.jpegQuality ?? SHRINK_MAX_JPEG_QUALITY, SHRINK_MAX_JPEG_QUALITY);

  while (Math.max(originalSize.width, originalSize.height) * scale >= SHRINK_MIN_EDGE_PIXELS) {
    const size = {
      width: Math.max(1, Math.round(originalSize.width * scale)),
      height: Math.max(1, Math.round(originalSize.height * scale)),
    };
    const image = scale === 1 ? original : original.resize({ ...size, quality: "good" });
    const encoded = encodeImage(image, { format: "jpeg", jpegQuality: quality });
    if (encoded.dataUrlBytes <= maxDataUrlBytes) {
      return { ...snapshot, ...encoded, ...size };
    }

    scale *= SHRINK_SCALE_STEP;
    quality = Math.max(LIMITS.captureJpegQuality.min, quality - 0.1);
  }

  return undefined;
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
  options: CaptureEncodingOptions = {},
): Promise<ScreenSnapshot> {
  let macScreencaptureError: unknown;
  if (process.platform === "darwin") {
    try {
      return await captureWithMacScreencapture(maxEdgePixels, options);
    } catch (error) {
      macScreencaptureError = error;
      console.warn("macOS screencapture failed; trying desktopCapturer.", error);
    }
  }

  try {
    return await captureWithDesktopCapturer(maxEdgePixels, options);
  } catch (error) {
    if (macScreencaptureError) {
      throw new Error(
        `${messageFromError(macScreencaptureError)}; desktopCapturer fallback failed: ${messageFromError(error)}`,
      );
    }
    throw error;
  }
}
