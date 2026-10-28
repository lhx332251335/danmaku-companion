export interface PixelSize {
  width: number;
  height: number;
}

/** Scale a size down (never up) so its longest edge is at most maxEdgePixels. */
export function fitWithinMaxEdge(size: PixelSize, maxEdgePixels: number): PixelSize {
  const longestEdge = Math.max(size.width, size.height);
  const scale = Math.min(1, maxEdgePixels / longestEdge);

  return {
    width: Math.max(1, Math.round(size.width * scale)),
    height: Math.max(1, Math.round(size.height * scale)),
  };
}

/**
 * Physical pixel size of a display. Electron reports display sizes in DIPs, so a 1920x1080
 * screen at 150% scaling is 1280x720; desktopCapturer thumbnails are sized in physical pixels.
 */
export function physicalDisplaySize(dipSize: PixelSize, scaleFactor: number): PixelSize {
  const scale = Number.isFinite(scaleFactor) && scaleFactor > 0 ? scaleFactor : 1;
  return {
    width: Math.max(1, Math.round(dipSize.width * scale)),
    height: Math.max(1, Math.round(dipSize.height * scale)),
  };
}

/** Thumbnail size to request from desktopCapturer so the capture honours maxEdgePixels. */
export function desktopThumbnailSize(
  dipSize: PixelSize,
  scaleFactor: number,
  maxEdgePixels: number,
): PixelSize {
  return fitWithinMaxEdge(physicalDisplaySize(dipSize, scaleFactor), maxEdgePixels);
}
