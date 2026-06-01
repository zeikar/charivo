import type { CSSProperties } from "react";

// Animation Note: do NOT write --level per frame (e.g. via rAF). --level is a
// static per-phase value set via a phase-* CSS class on the stage root, ramped
// by a registered @property transition. Per-frame ancestor var writes starve
// concurrent CSS transitions and animations in the subtree.

export type Tod = "morning" | "evening" | "night";
export type Phase =
  | "dormant"
  | "connecting"
  | "speaking"
  | "listening"
  | "thinking";

/** CSS custom property map usable as a React inline style. */
export type CssVars = CSSProperties & Record<`--${string}`, string | number>;

/** Returns the time of day based on the hour (5–11 morning, 12–19 evening, else night). */
export function getTimeOfDay(date = new Date()): Tod {
  const h = date.getHours();
  return h >= 5 && h < 12 ? "morning" : h >= 12 && h < 20 ? "evening" : "night";
}

/** Hearth palette — shared text/sub tokens plus per-time-of-day color blocks.
 *  Values are verbatim from the handoff README "Color tokens (oklch)" section
 *  and cross-checked against PALETTES.hearth in companion-core.jsx. */
export const HEARTH_PALETTE = {
  text: "oklch(0.96 0.012 80)",
  sub: "oklch(0.74 0.02 70)",
  morning: {
    "--bg1": "oklch(0.47 0.05 74)",
    "--bg2": "oklch(0.28 0.04 56)",
    "--bg3": "oklch(0.15 0.025 46)",
    "--glow": "oklch(0.89 0.11 80)",
    "--halo": "oklch(0.86 0.12 72)",
    "--accent": "oklch(0.83 0.1 58)",
    "--warm": "oklch(0.88 0.1 64)",
    "--particle": "oklch(0.9 0.08 78)",
  },
  evening: {
    "--bg1": "oklch(0.41 0.07 40)",
    "--bg2": "oklch(0.24 0.05 30)",
    "--bg3": "oklch(0.12 0.03 24)",
    "--glow": "oklch(0.84 0.13 46)",
    "--halo": "oklch(0.82 0.13 42)",
    "--accent": "oklch(0.81 0.11 38)",
    "--warm": "oklch(0.85 0.11 50)",
    "--particle": "oklch(0.86 0.1 44)",
  },
  night: {
    "--bg1": "oklch(0.30 0.04 62)",
    "--bg2": "oklch(0.16 0.03 56)",
    "--bg3": "oklch(0.08 0.018 50)",
    "--glow": "oklch(0.85 0.1 74)",
    "--halo": "oklch(0.81 0.1 68)",
    "--accent": "oklch(0.83 0.09 66)",
    "--warm": "oklch(0.84 0.1 60)",
    "--particle": "oklch(0.85 0.08 70)",
  },
} as const;

/** Returns the full set of CSS custom properties for the given time of day.
 *  Mirrors paletteFor in companion-core.jsx (Hearth direction only). */
export function paletteFor(tod: Tod): CssVars {
  return {
    ...HEARTH_PALETTE[tod],
    "--text": HEARTH_PALETTE.text,
    "--sub": HEARTH_PALETTE.sub,
  };
}
