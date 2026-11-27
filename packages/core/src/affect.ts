import type {
  AffectCue,
  AffectMap,
  AffectMapEntry,
  MotionSelection,
} from "./types";

/** What a cue shows; empty when it resolved to nothing. */
export interface ResolvedAffect {
  expressionId?: string;
  motion?: MotionSelection;
}

/**
 * A1: a string expression is an id, used as is; `{ affect, intensity? }`
 * picks, among the label's entries, the one with the highest `minIntensity`
 * not above the clamped intensity (decision 5). The cue's own motion wins over
 * the entry's.
 */
export function resolveAffect(
  cue: AffectCue | undefined,
  map: AffectMap | null,
): ResolvedAffect {
  if (!cue) {
    return {};
  }
  const { expression } = cue;
  const entry =
    expression !== undefined && typeof expression !== "string"
      ? pickEntry(map, expression.affect, expression.intensity)
      : undefined;
  const expressionId =
    typeof expression === "string" ? expression : entry?.expressionId;
  const motion = cue.motion ?? entry?.motion;
  return {
    ...(expressionId !== undefined ? { expressionId } : {}),
    ...(motion !== undefined ? { motion } : {}),
  };
}

function pickEntry(
  map: AffectMap | null,
  affect: string,
  intensity = 0.5,
): AffectMapEntry | undefined {
  if (!map || !Object.hasOwn(map, affect)) {
    return undefined;
  }
  // A NaN intensity counts as unset, like an omitted one.
  const level = Number.isNaN(intensity)
    ? 0.5
    : Math.min(1, Math.max(0, intensity));
  const listed = map[affect]!;
  let chosen: AffectMapEntry | undefined;
  for (const entry of Array.isArray(listed) ? listed : [listed]) {
    const min = entry.minIntensity ?? 0;
    if (min <= level && (!chosen || min > (chosen.minIntensity ?? 0))) {
      chosen = entry;
    }
  }
  return chosen;
}
