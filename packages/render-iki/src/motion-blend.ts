import { StandardParameter } from "@ikijs/format";

/** Host gaze target: each axis -1..1, y up. Undefined until lookAt / mouse first fires. */
export interface HostGaze {
  x: number;
  y: number;
}

/**
 * Full gaze deflection → this many degrees of head turn. Leaves room for the
 * engine's idle sway (±3.5° X, ±1.6° Y) inside the ±30 parameter range, so an
 * off-canvas pointer parks the head at 26° with the sway still visible instead
 * of clipping into a twitch; costs ~13% of the face-warp reach only at the extreme.
 */
export const HEAD_ANGLE_RANGE_DEG = 26;

/**
 * Decide the value actually written for `id`, blending the host's gaze target
 * with the value `IkiMotion` (idle + physics) already computed. Applied in the
 * renderer's IkiMotion sink, BEFORE the player, so PhysicsMotion (which reads
 * back through the player) lags the blended pose.
 */
export function blendMotionWrite(
  id: string,
  motionValue: number,
  gaze: HostGaze | undefined,
): number {
  if (!gaze) return motionValue;
  switch (id) {
    // Head target + idle sway: the character looks where told, with life on top.
    case StandardParameter.AngleX:
      return gaze.x * HEAD_ANGLE_RANGE_DEG + motionValue;
    case StandardParameter.AngleY:
      return gaze.y * HEAD_ANGLE_RANGE_DEG + motionValue;
    // Eyes lock on target outright — additive would visibly wander off the cursor.
    case StandardParameter.EyeballX:
      return gaze.x;
    case StandardParameter.EyeballY:
      return gaze.y;
    // Everything else (AngleZ, blink, breath, hair-sway outputs) passes
    // through: no host lean term on AngleZ — a roll riding on the turn swung
    // the crown ahead of the face, which is why the auto-rig dropped its own —
    // and idle or physics owns the rest. The mouth never reaches this
    // function: lip-sync writes it directly, and no driver writes it.
    default:
      return motionValue;
  }
}
