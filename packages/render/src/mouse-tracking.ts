export type MouseTrackingMode = "canvas" | "document";

export interface MouseCoordinates {
  clientX: number;
  clientY: number;
}

/**
 * A point of the loaded model, as fractions of the model's own canvas: `x` 0
 * at its left edge and 1 at its right, `y` 0 at its top and 1 at its bottom —
 * the way it reads off a picture of the model, whatever the renderer.
 */
export interface GazeOrigin {
  x: number;
  y: number;
}

export interface MouseTrackable {
  updateViewWithMouse(coords: MouseCoordinates): void;
  handleMouseTap(coords: MouseCoordinates): void;
  /**
   * Measure the cursor-follow gaze from `origin` instead of the canvas's
   * centre: a pointer on that point of the model then looks straight ahead.
   * For a full body, whose canvas centre is the waist, that is the point
   * between the eyes; without it a pointer on the face reads as above the
   * centre and the character looks up. No argument restores the centre.
   *
   * It is the renderer's to place: only the renderer knows where its model
   * sits on the canvas, at any size or framing. It holds until changed, across
   * `loadModel` too, so set it again for a model whose face is elsewhere.
   * Taps and `lookAt` are unaffected. A non-finite `x` or `y` throws.
   */
  setGazeOrigin?(origin?: GazeOrigin): void;
}

export interface MouseTrackingOptions<T extends MouseTrackable> {
  canvas: HTMLCanvasElement;
  mode?: MouseTrackingMode;
  target: T;
}

export type MouseTrackingCleanup = () => void;

export function setupMouseTracking<T extends MouseTrackable>(
  options: MouseTrackingOptions<T>,
): MouseTrackingCleanup {
  const { canvas, mode = "canvas", target } = options;

  const down = (event: Event) => {
    const pointerEvent = event as PointerEvent;
    const rect = canvas.getBoundingClientRect();
    const isOnCanvas =
      pointerEvent.clientX >= rect.left &&
      pointerEvent.clientX <= rect.right &&
      pointerEvent.clientY >= rect.top &&
      pointerEvent.clientY <= rect.bottom;

    if (isOnCanvas) {
      target.handleMouseTap({
        clientX: pointerEvent.clientX,
        clientY: pointerEvent.clientY,
      });
    }
  };

  const move = (event: Event) => {
    const pointerEvent = event as PointerEvent;
    target.updateViewWithMouse({
      clientX: pointerEvent.clientX,
      clientY: pointerEvent.clientY,
    });
  };

  const eventTarget = mode === "document" ? document : canvas;

  eventTarget.addEventListener("pointerdown", down, { passive: true });
  eventTarget.addEventListener("pointermove", move, { passive: true });

  return () => {
    eventTarget.removeEventListener("pointerdown", down);
    eventTarget.removeEventListener("pointermove", move);
  };
}
