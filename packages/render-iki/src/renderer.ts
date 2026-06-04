/**
 * Local dogfood adapter consuming the UNPUBLISHED sibling @iki/* via
 * tsconfig/tsup aliases against ../iki/.../dist.  This package is private,
 * kept out of root build/typecheck/dev aggregators (scripts are
 * build:local/typecheck:local/dev:local), and requires the iki repo cloned at
 * ../iki and built.
 */

import type {
  Character,
  GazeCoordinates,
  Message,
  Renderer,
} from "@charivo/core";
import type { MouseCoordinates, MouseTrackable } from "@charivo/render";
import { IkiPlayer } from "@iki/engine";
import { IkiFormatError, loadIkiModel, StandardParameter } from "@iki/format";

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Amplify RMS→mouth-open so quiet speech still opens the mouth. */
const MOUTH_GAIN = 1.8;

/** Head angle range in degrees for gaze mapping (±1 → ±this). */
const HEAD_ANGLE_RANGE_DEG = 30;

/** Breathing oscillation frequency in Hz. */
const BREATH_HZ = 0.25;

/** Minimum milliseconds between blink starts. */
const BLINK_MIN_MS = 2000;

/** Maximum milliseconds between blink starts. */
const BLINK_MAX_MS = 6000;

/** Total duration of one blink (down + up), in milliseconds. */
const BLINK_DURATION_MS = 120;

// ─────────────────────────────────────────────────────────────────────────────

export interface IkiRendererOptions {
  canvas?: HTMLCanvasElement;
}

export class IkiRenderer implements Renderer, MouseTrackable {
  private canvas?: HTMLCanvasElement;
  private player?: IkiPlayer;
  private lipSyncEnabled = false;
  private idleRafId?: number;
  private idleStartMs = 0;
  private nextBlinkAtMs = 0;
  private blinkUntilMs = 0;
  private paramIds = new Set<string>();

  constructor(options?: IkiRendererOptions) {
    this.canvas = options?.canvas;
  }

  async initialize(): Promise<void> {
    if (!this.canvas) {
      throw new Error("Canvas element is required for Iki rendering");
    }
    this.player = new IkiPlayer(this.canvas);
    // Do NOT call start() or begin idle loop here — wait for loadModel().
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.player) {
      throw new Error("Iki renderer is not initialized");
    }

    const res = await fetch(modelPath);
    if (!res.ok) {
      throw new Error(`Failed to fetch iki model: ${res.status}`);
    }
    const json = await res.text();

    let model;
    try {
      model = loadIkiModel(json);
    } catch (err) {
      throw err instanceof IkiFormatError
        ? new Error(`Invalid .iki model: ${err.message}`)
        : err;
    }

    this.player.load(model);

    // Rebuild the set of available parameter IDs from the loaded model.
    this.paramIds = new Set(this.player.getParameters().map((p) => p.id));

    this.player.start();
    this.startIdleLoop();
  }

  private startIdleLoop(): void {
    // Idempotent — do nothing if the loop is already running.
    if (this.idleRafId !== undefined) return;

    const now = performance.now();
    this.idleStartMs = now;
    this.nextBlinkAtMs = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);

    const tick = (): void => {
      this.idleRafId = requestAnimationFrame(tick);
      this.applyIdle();
    };
    this.idleRafId = requestAnimationFrame(tick);
  }

  private applyIdle(): void {
    if (!this.player) return;

    const now = performance.now();

    // Breathing — a gentle sinusoidal cycle mapped to [0, 1].
    if (this.paramIds.has(StandardParameter.Breath)) {
      const value =
        (Math.sin(((now - this.idleStartMs) / 1000) * BREATH_HZ * 2 * Math.PI) +
          1) /
        2;
      this.player.setParameter(StandardParameter.Breath, value);
    }

    // Blinking — trigger when nextBlinkAtMs is reached, drive a down-up curve.
    const hasLeftEye = this.paramIds.has(StandardParameter.EyeOpenLeft);
    const hasRightEye = this.paramIds.has(StandardParameter.EyeOpenRight);
    if (hasLeftEye || hasRightEye) {
      if (now >= this.nextBlinkAtMs && now >= this.blinkUntilMs) {
        // Start a new blink.
        this.blinkUntilMs = now + BLINK_DURATION_MS;
      }

      let eyeOpen: number;
      if (now < this.blinkUntilMs) {
        // Quick down-up curve over [0, BLINK_DURATION_MS]: 0→closed at mid, 1 at ends.
        const t =
          (now - (this.blinkUntilMs - BLINK_DURATION_MS)) / BLINK_DURATION_MS;
        eyeOpen = Math.abs(2 * t - 1); // 1 at t=0, 0 at t=0.5, 1 at t=1
      } else {
        eyeOpen = 1;
        // Reschedule only after blink completes and was the active one.
        if (this.nextBlinkAtMs < this.blinkUntilMs) {
          this.nextBlinkAtMs = now + randomBetween(BLINK_MIN_MS, BLINK_MAX_MS);
        }
      }

      if (hasLeftEye) {
        this.player.setParameter(StandardParameter.EyeOpenLeft, eyeOpen);
      }
      if (hasRightEye) {
        this.player.setParameter(StandardParameter.EyeOpenRight, eyeOpen);
      }
    }
  }

  setRealtimeLipSync(enabled: boolean): void {
    this.lipSyncEnabled = enabled;
    if (!enabled && this.paramIds.has(StandardParameter.MouthOpen)) {
      this.player?.setParameter(StandardParameter.MouthOpen, 0);
    }
  }

  updateRealtimeLipSyncRms(rms: number): void {
    if (!this.lipSyncEnabled || !this.paramIds.has(StandardParameter.MouthOpen))
      return;
    this.player?.setParameter(
      StandardParameter.MouthOpen,
      clamp01(rms * MOUTH_GAIN),
    );
  }

  lookAt(coords: GazeCoordinates): void {
    this.applyGaze(clamp(coords.x, -1, 1), clamp(coords.y, -1, 1));
  }

  private applyGaze(x: number, y: number): void {
    if (!this.player) return;

    if (this.paramIds.has(StandardParameter.AngleX)) {
      this.player.setParameter(
        StandardParameter.AngleX,
        x * HEAD_ANGLE_RANGE_DEG,
      );
    }
    if (this.paramIds.has(StandardParameter.AngleY)) {
      this.player.setParameter(
        StandardParameter.AngleY,
        y * HEAD_ANGLE_RANGE_DEG,
      );
    }
    if (this.paramIds.has(StandardParameter.EyeballX)) {
      this.player.setParameter(StandardParameter.EyeballX, x);
    }
    if (this.paramIds.has(StandardParameter.EyeballY)) {
      this.player.setParameter(StandardParameter.EyeballY, y);
    }
  }

  updateViewWithMouse(coords: MouseCoordinates): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // Normalize to [-1, 1] with Y inverted (gaze y is up-positive).
    const x =
      (coords.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const y =
      -(coords.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    this.applyGaze(clamp(x, -1, 1), clamp(y, -1, 1));
  }

  // Required by the MouseTrackable duck-type contract; not a stub to flesh out —
  // Iki has no tap-motion concept.
  handleMouseTap(_coords: MouseCoordinates): void {}

  async render(_message: Message, _character?: Character): Promise<void> {
    // Stateless — all per-frame rendering is driven by the idle RAF loop.
  }

  async destroy(): Promise<void> {
    if (this.idleRafId !== undefined) {
      cancelAnimationFrame(this.idleRafId);
      this.idleRafId = undefined;
    }
    this.player?.destroy();
    this.player = undefined;
    this.paramIds.clear();
  }

  /*
   * playExpression / playMotionByGroup / getAvailableExpressions /
   * getAvailableMotionGroups are intentionally absent: the Iki format has no
   * expression or motion-group concept.  Leaving them undefined causes
   * RenderManager to skip them gracefully.
   */
}

export function createIkiRenderer(options?: IkiRendererOptions): IkiRenderer {
  return new IkiRenderer(options);
}

// ── Local helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}

function randomBetween(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
