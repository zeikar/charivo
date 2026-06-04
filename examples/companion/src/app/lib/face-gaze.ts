import type { GazeCoordinates } from "@charivo/core";

export interface FaceBox {
  originX: number;
  originY: number;
  width: number;
  height: number;
}

export const NEUTRAL_GAZE: GazeCoordinates = { x: 0, y: 0 };

/**
 * Convert a MediaPipe VIDEO-mode bounding box (raw-frame pixel-space) to
 * normalized gaze coordinates in [-1, 1] x [-1, 1].
 *
 * Mirrored (selfie) feed: the user's body-left lands in the LEFT half (nx<0.5), so the X sign is negated to follow the user like a mirror. user body-left -> nx<0.5 -> -(nx*2-1) > 0 -> positive gaze x (avatar looks to its right). Sign validated against the live webcam feed. When the user moves their face to their own left, the avatar's gaze goes to the avatar's right (positive x).
 */
export function boundingBoxToGaze(
  box: FaceBox,
  videoW: number,
  videoH: number,
): GazeCoordinates {
  if (videoW <= 0 || videoH <= 0) {
    return NEUTRAL_GAZE;
  }

  const cx = box.originX + box.width / 2;
  const cy = box.originY + box.height / 2;

  const nx = cx / videoW;
  const ny = cy / videoH;

  const x = -(nx * 2 - 1);
  const y = -(ny * 2 - 1);

  return {
    x: Math.max(-1, Math.min(1, x)),
    y: Math.max(-1, Math.min(1, y)),
  };
}

export interface GazeSmootherOptions {
  alpha?: number;
}

/**
 * Returns an EMA smoother closure. Seeds exactly on the first sample (first
 * call returns the first sample unchanged). Default alpha = 0.35.
 */
export function createGazeSmoother(
  options: GazeSmootherOptions = {},
): (next: GazeCoordinates) => GazeCoordinates {
  const alpha = options.alpha ?? 0.35;
  let prev: GazeCoordinates | null = null;

  return function smooth(next: GazeCoordinates): GazeCoordinates {
    if (prev === null) {
      prev = next;
      return next;
    }
    const result: GazeCoordinates = {
      x: prev.x + alpha * (next.x - prev.x),
      y: prev.y + alpha * (next.y - prev.y),
    };
    prev = result;
    return result;
  };
}
