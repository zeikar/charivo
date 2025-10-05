export type MouseTrackingMode = "canvas" | "document";

export interface MouseCoordinates {
  clientX: number;
  clientY: number;
}

export interface MouseTrackable {
  updateViewWithMouse(coords: MouseCoordinates): void;
  handleMouseTap(coords: MouseCoordinates): void;
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
