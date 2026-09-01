import type { AvatarControlCatalog } from "@charivo/core";

/**
 * Shared by every browser harness that drives avatar tools over a live session.
 *
 * The `expressionDescriptions` below are hard-won empirical data — established
 * by rendering each expression, reading the face, and cross-checking the
 * `.exp3.json` deltas (a mapping circulating on the web is wrong). One copy on
 * purpose: with two, one gets corrected and the harnesses silently start
 * measuring different things.
 */

export const AVATAR_MOTIONS = {
  Emphasis: 3,
  // Separate greeting-style motion group so pairing probes have a plausible
  // expression + motion choice instead of only a generic emphasis motion.
  Wave: 1,
};

// The smoke stays deterministic: one self-describing expression ID, which
// SMOKE_TEST_INSTRUCTIONS names verbatim.
export const SMOKE_AVATAR_CATALOG = {
  expressions: ["Smile"],
  motions: AVATAR_MOTIONS,
} satisfies AvatarControlCatalog;

// The evaluation modes instead use OPAQUE IDs (`F01`..`F08`) carrying meaning
// only through `expressionDescriptions` — the shape a real Cubism model ships
// (Haru's expressions are named exactly this in the demo app, with the same
// meanings). That makes the description channel observable over a live realtime
// session: with the descriptions removed the model has nothing to choose on but
// the bare enum. No spec asserts a specific ID, so this only sharpens them.
export const AVATAR_CATALOG = {
  expressions: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
  expressionDescriptions: {
    F01: "gentle smile",
    F02: "big laugh, excited",
    F03: "angry",
    F04: "sad",
    F05: "beaming, eyes closed",
    F06: "surprised",
    F07: "shy, blushing",
    F08: "unimpressed, deadpan",
  },
  motions: AVATAR_MOTIONS,
} satisfies AvatarControlCatalog;
