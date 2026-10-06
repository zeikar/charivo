/**
 * Dogfood adapter driving an `.iki` puppet through the Iki engine. The package
 * is private (never published to npm), but @ikijs/engine and @ikijs/format are
 * ordinary npm dependencies, so it builds and typechecks like any other
 * workspace package. Idle, motion clips, expressions, physics and hair-chain
 * motion come from the engine's own `IkiMotion`; this adapter only schedules
 * it, blends the host's gaze on top (see `motion-blend.ts`) and writes
 * lip-sync last.
 */

import type {
  AvatarControlCatalog,
  Character,
  GazeCoordinates,
  Message,
  Renderer,
} from "@charivo/core";
import type { MouseCoordinates, MouseTrackable } from "@charivo/render";
import { IkiMotion, IkiPlayer } from "@ikijs/engine";
import {
  IkiFormatError,
  loadIkiModel,
  StandardParameter,
  type IkiModel,
} from "@ikijs/format";
import {
  blendMotionWrite,
  GAZE_PARAMETER_IDS,
  type HostGaze,
} from "./motion-blend";

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Amplify RMS→mouth-open so quiet speech still opens the mouth. */
const MOUTH_GAIN = 1.8;

// ─────────────────────────────────────────────────────────────────────────────

export interface IkiRendererOptions {
  canvas?: HTMLCanvasElement;
}

export class IkiRenderer implements Renderer, MouseTrackable {
  private canvas?: HTMLCanvasElement;
  private player?: IkiPlayer;
  /** The loaded model; set together with `motion` once a load completes. */
  private model?: IkiModel;
  private motion?: IkiMotion;
  private motionRafId?: number;
  private gaze?: HostGaze;
  /** Gaze ids the IkiMotion sink wrote during the current update. */
  private readonly gazeIdsWritten = new Set<string>();
  private lipSyncEnabled = false;
  private mouthOpen = 0;

  constructor(options?: IkiRendererOptions) {
    this.canvas = options?.canvas;
  }

  async initialize(): Promise<void> {
    if (!this.canvas) {
      throw new Error("Canvas element is required for Iki rendering");
    }
    this.player = new IkiPlayer(this.canvas);
    // Do NOT call start() or begin the motion loop here — wait for loadModel().
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

    let model: IkiModel;
    try {
      model = loadIkiModel(json);
    } catch (err) {
      throw err instanceof IkiFormatError
        ? new Error(`Invalid .iki model: ${err.message}`)
        : err;
    }

    // destroy() may have run while the fetch above was in flight.
    if (!this.player) return;

    // Must be awaited: `load()` decodes the model's textures before it swaps
    // in the new ParameterStore, so building IkiMotion early would read
    // (and physics would seed from) the empty pre-load store; destroy() may
    // also have run during this await, so guard on `this.player` too.
    const result = await this.player.load(model);
    if (result.superseded || !this.player) return;
    if (result.failedTextures.length > 0) {
      console.warn("Iki: textures failed to load", result.failedTextures);
    }

    const player = this.player;
    this.model = model;
    this.motion = new IkiMotion(
      model,
      (id) => player.getParameter(id),
      (id, value) => {
        if (GAZE_PARAMETER_IDS.includes(id)) this.gazeIdsWritten.add(id);
        player.setParameter(id, blendMotionWrite(id, value, this.gaze));
      },
    );

    // Motion first: rAF callbacks fire in request order, so starting the
    // motion loop before the engine's own render loop means the pose is
    // written before that frame is drawn, not one frame late.
    this.startMotionLoop();
    player.start();
  }

  private startMotionLoop(): void {
    // Idempotent — do nothing if the loop is already running.
    if (this.motionRafId !== undefined) return;

    const tick = (now: number): void => {
      this.motionRafId = requestAnimationFrame(tick);
      this.step(now);
    };
    this.motionRafId = requestAnimationFrame(tick);
  }

  private step(now: number): void {
    const { player, motion } = this;
    if (!player || !motion) return;

    this.gazeIdsWritten.clear();
    motion.update(now);

    // IkiMotion leaves a head or gaze id unwritten when the model's `Idle`
    // clips replace the procedural sway and don't animate it, so the sink
    // never saw it: put the host gaze there directly. Physics already ran,
    // so it reads this write one frame late.
    const gaze = this.gaze;
    if (gaze) {
      for (const id of GAZE_PARAMETER_IDS) {
        if (!this.gazeIdsWritten.has(id)) {
          player.setParameter(id, blendMotionWrite(id, 0, gaze));
        }
      }
    }

    // After update(), so lip-sync beats an expression that opens the mouth.
    if (this.lipSyncEnabled) {
      player.setParameter(StandardParameter.MouthOpen, this.mouthOpen);
    }
  }

  setRealtimeLipSync(enabled: boolean): void {
    this.lipSyncEnabled = enabled;
    if (!enabled) {
      this.mouthOpen = 0;
      // Close what lip-sync left open; from the next frame on, an expression
      // that drives the mouth owns it again.
      this.player?.setParameter(StandardParameter.MouthOpen, 0);
    }
  }

  updateRealtimeLipSyncRms(rms: number): void {
    if (!this.lipSyncEnabled) return;
    this.mouthOpen = clamp01(rms * MOUTH_GAIN);
  }

  lookAt(coords: GazeCoordinates): void {
    this.gaze = { x: clamp(coords.x, -1, 1), y: clamp(coords.y, -1, 1) };
  }

  updateViewWithMouse(coords: MouseCoordinates): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    // Normalize to [-1, 1] with Y inverted (gaze y is up-positive).
    const x =
      (coords.clientX - (rect.left + rect.width / 2)) / (rect.width / 2);
    const y =
      -(coords.clientY - (rect.top + rect.height / 2)) / (rect.height / 2);
    this.gaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
  }

  // Required by the MouseTrackable duck-type contract; not a stub to flesh out —
  // Iki has no tap-motion concept.
  handleMouseTap(_coords: MouseCoordinates): void {}

  playExpression(expressionId: string): void {
    this.motion?.playExpression(expressionId);
  }

  stopExpression(): void {
    this.motion?.stopExpression();
  }

  // No `muteSound` option: Iki motion clips carry no audio.
  playMotionByGroup(group: string, index: number): void {
    this.motion?.playMotion(group, index);
  }

  getAvailableExpressions(): string[] {
    return this.model?.expressions?.map((expression) => expression.id) ?? [];
  }

  getAvailableMotionGroups(): Record<string, number> {
    return Object.fromEntries(
      Object.entries(this.model?.motions ?? {}).map(([group, clips]) => [
        group,
        clips.length,
      ]),
    );
  }

  /** The catalog with the descriptions the `.iki` file declares. */
  getAvatarControlCatalog(): AvatarControlCatalog {
    const catalog: AvatarControlCatalog = {
      expressions: this.getAvailableExpressions(),
      motions: this.getAvailableMotionGroups(),
    };
    const expressions = this.model?.expressions ?? [];
    if (expressions.length > 0) {
      catalog.expressionDescriptions = Object.fromEntries(
        expressions.map((expression) => [
          expression.id,
          expression.description,
        ]),
      );
    }
    const motionGroups = Object.entries(this.model?.motions ?? {});
    if (motionGroups.length > 0) {
      catalog.motionDescriptions = Object.fromEntries(
        motionGroups.map(([group, clips]) => [
          group,
          clips.map((clip) => clip.description),
        ]),
      );
    }
    return catalog;
  }

  async render(_message: Message, _character?: Character): Promise<void> {
    // Stateless — the engine draws on its own loop; this adapter's rAF only
    // steps IkiMotion.
  }

  async destroy(): Promise<void> {
    if (this.motionRafId !== undefined) {
      cancelAnimationFrame(this.motionRafId);
      this.motionRafId = undefined;
    }
    this.motion = undefined;
    this.model = undefined;
    this.gaze = undefined;
    this.player?.destroy();
    this.player = undefined;
  }
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
