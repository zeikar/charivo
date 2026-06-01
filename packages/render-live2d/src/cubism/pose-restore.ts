/**
 * The minimal slice of a Cubism model that {@link PoseRestore} needs: read the
 * parameter count, read each parameter's current and default value, and write a
 * value back. `CubismModel` satisfies this structurally.
 */
export interface RestorableModel {
  getParameterCount(): number;
  getParameterValueByIndex(index: number): number;
  getParameterDefaultValue(index: number): number;
  setParameterValueByIndex(index: number, value: number): void;
}

/**
 * Eases a model's parameters from the pose held when restoration begins back to
 * their default (rest) values over a fixed real-time window. LAppModel uses this
 * as the fallback when a motion finishes and the model has no "Idle" group to
 * take over, so a one-shot gesture does not leave a residual pose.
 *
 * The pose to ease *from* is captured on the first {@link step} after a
 * {@link reset}; each subsequent `step` interpolates by elapsed time — frame-rate
 * independent, and an exact settle (it reaches the defaults at `durationSeconds`,
 * with no exponential tail).
 */
export class PoseRestore {
  private start: Float32Array | null = null;
  private elapsedSeconds = 0;

  constructor(private readonly durationSeconds: number) {}

  /** Forget the captured pose so the next {@link step} re-captures the current one. */
  reset(): void {
    this.start = null;
  }

  /** Advance the ease by `deltaSeconds` and write the interpolated values to `model`. */
  step(model: RestorableModel, deltaSeconds: number): void {
    const count = model.getParameterCount();
    if (!this.start || this.start.length !== count) {
      this.start = new Float32Array(count);
      for (let i = 0; i < count; i++) {
        this.start[i] = model.getParameterValueByIndex(i);
      }
      this.elapsedSeconds = 0;
    }

    this.elapsedSeconds += deltaSeconds;
    const t =
      this.durationSeconds > 0
        ? Math.min(1, this.elapsedSeconds / this.durationSeconds)
        : 1;
    for (let i = 0; i < count; i++) {
      const start = this.start[i];
      const def = model.getParameterDefaultValue(i);
      model.setParameterValueByIndex(i, start + (def - start) * t);
    }
  }
}
