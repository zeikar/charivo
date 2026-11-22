/**
 * Drives an `.iki` puppet through the Iki engine. Idle, motion clips,
 * expressions, physics and hair-chain motion come from the engine's own
 * `IkiMotion`; this adapter only schedules it, hands it the host's gaze as its
 * gaze target and writes lip-sync last.
 */

import type {
  AvatarControlCatalog,
  Character,
  GazeCoordinates,
  Message,
  Renderer,
} from "@charivo/core";
import type {
  GazeOrigin,
  MouseCoordinates,
  MouseTrackable,
} from "@charivo/render";
import { IkiMotion, IkiPlayer, type IkiView } from "@ikijs/engine";
import {
  IDLE_MOTION_GROUP,
  IkiFormatError,
  loadIkiModel,
  StandardParameter,
  type IkiModel,
} from "@ikijs/format";

import type { IkiRenderer, IkiRendererOptions } from "./renderer";

// ── Tuning constants ─────────────────────────────────────────────────────────

/** Amplify RMS→mouth-open so quiet speech still opens the mouth. */
const MOUTH_GAIN = 1.8;

// ─────────────────────────────────────────────────────────────────────────────

export class IkiRendererImpl implements Renderer, MouseTrackable, IkiRenderer {
  private canvas?: HTMLCanvasElement;
  private player?: IkiPlayer;
  /** Kept so a view set before initialize() reaches the player it creates. */
  private view?: IkiView;
  /** The loaded model; set together with `motion` once a load completes. */
  private model?: IkiModel;
  private motion?: IkiMotion;
  /** Counts loadModel() calls, so one a later call overtook can tell. */
  private loadCount = 0;
  private motionRafId?: number;
  /** Host gaze, each axis -1..1, y up; unset until the first lookAt / mouse. */
  private gaze?: GazeCoordinates;
  /** Where the mouse gaze is measured from; unset = canvas centre. */
  private gazeOrigin?: GazeOrigin;
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
    if (this.view) this.player.setView(this.view);
    // Do NOT call start() or begin the motion loop here — wait for loadModel().
  }

  async loadModel(modelPath: string): Promise<void> {
    if (!this.player) {
      throw new Error("Iki renderer is not initialized");
    }
    const load = ++this.loadCount;

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

    // destroy() may have run while the fetch above was in flight, or a later
    // loadModel() begun. The engine supersedes only the loads that reach it in
    // order, and this one, its fetch the slower, would reach it last and
    // replace the model asked for after it.
    if (!this.player || load !== this.loadCount) return;

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
      (id, value) => player.setParameter(id, value),
    );
    if (this.gaze) this.motion.setGazeTarget(this.gaze.x, this.gaze.y);

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

    motion.update(now);

    // A model's `Idle` clips replace the procedural head and gaze, and the
    // engine's gaze target moves nothing under them: put the eyes there
    // directly, as the engine asks of a host. The head stays the clips'.
    const gaze = this.gaze;
    if (gaze && this.model?.motions?.[IDLE_MOTION_GROUP]) {
      player.setParameter(StandardParameter.EyeballX, gaze.x);
      player.setParameter(StandardParameter.EyeballY, gaze.y);
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
    this.setGaze(coords.x, coords.y);
  }

  updateViewWithMouse(coords: MouseCoordinates): void {
    if (!this.canvas) return;
    const rect = this.canvas.getBoundingClientRect();
    const origin = this.gazeOriginOnCanvas(rect);
    // Normalize to [-1, 1] with Y inverted (gaze y is up-positive).
    const x =
      (coords.clientX - (rect.left + rect.width / 2 + origin.x)) /
      (rect.width / 2);
    const y =
      -(coords.clientY - (rect.top + rect.height / 2 + origin.y)) /
      (rect.height / 2);
    this.setGaze(x, y);
  }

  /**
   * `MouseTrackable.setGazeOrigin`: measure the mouse gaze from a point of the
   * model's canvas (fractions, top-left to bottom-right) instead of the
   * canvas element's centre. Throws on a non-finite `x` or `y`: kept, it would
   * turn every pointer gaze into one the engine drops, and the mouse would
   * stop moving the eyes with nothing said.
   */
  setGazeOrigin(origin?: GazeOrigin): void {
    if (origin && !(Number.isFinite(origin.x) && Number.isFinite(origin.y))) {
      throw new Error(
        `Iki: setGazeOrigin() needs a finite x and y, got ${origin.x}, ${origin.y}`,
      );
    }
    this.gazeOrigin = origin;
  }

  /**
   * Where the gaze origin lands, in CSS px from the canvas's centre (y down),
   * by the fit the engine draws with: the view, or the model's box, scaled to
   * the canvas with its aspect kept and centred. The centre itself when no
   * origin is set or no model is loaded to place one on.
   */
  private gazeOriginOnCanvas(rect: DOMRect): { x: number; y: number } {
    const origin = this.gazeOrigin;
    const model = this.model?.canvas;
    if (!origin || !model) return { x: 0, y: 0 };
    // The fractions, in model units: origin at the box's centre, +y up.
    const x = (origin.x - 0.5) * model.width;
    const y = (0.5 - origin.y) * model.height;
    const view = this.view ?? { x: 0, y: 0, ...model };
    const fit = Math.min(rect.width / view.width, rect.height / view.height);
    return { x: (x - view.x) * fit, y: -(y - view.y) * fit };
  }

  /**
   * The eyes go to the target and the head follows through the engine's idle
   * (`IkiMotion.setGazeTarget`), not through head angles written here: those
   * would stack on the idle's own drift and gaze follow.
   */
  private setGaze(x: number, y: number): void {
    // The engine ignores a non-finite pair; keep it out of the Idle-group
    // eye write too.
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    this.gaze = { x: clamp(x, -1, 1), y: clamp(y, -1, 1) };
    this.motion?.setGazeTarget(this.gaze.x, this.gaze.y);
  }

  /**
   * Frame `view` (centre and size in model units, +y up) instead of the
   * model's box, e.g. a full body whose raised arm leaves the box; no argument
   * restores the box. The engine keeps it across loads and throws on a
   * non-finite centre or a non-positive size — before initialize(), that
   * throw comes from initialize().
   */
  setView(view?: IkiView): void {
    this.player?.setView(view);
    this.view = view;
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

// ── Local helpers ─────────────────────────────────────────────────────────────

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function clamp01(v: number): number {
  return clamp(v, 0, 1);
}
