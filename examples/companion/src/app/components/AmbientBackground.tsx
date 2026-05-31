"use client";

import type { CssVars } from "../lib/hearth-theme";

// Motes are computed once at module scope using a seeded PRNG (mulberry32,
// seed=0xdeadbeef) so SSR and client render identical values — no hydration mismatch.
function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let z = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    z = (z ^ (z + Math.imul(z ^ (z >>> 7), 61 | z))) >>> 0;
    return z / 0x100000000;
  };
}

const N = 14;
const rand = mulberry32(0xdeadbeef);

const MOTES = Array.from({ length: N }, (_, i) => ({
  id: i,
  left: rand() * 100,
  top: rand() * 100,
  size: 2 + rand() * 9,
  dur: 14 + rand() * 22,
  delay: -rand() * 30,
  drift: (rand() - 0.5) * 40,
  op: 0.15 + rand() * 0.4,
}));

export function AmbientBackground() {
  return (
    <div className="amb">
      <div className="amb-base" />
      <div className="amb-glow" />
      <div className="amb-vignette" />
      <div className="amb-motes">
        {MOTES.map((m) => (
          <span
            key={m.id}
            className="mote"
            style={
              {
                left: m.left + "%",
                top: m.top + "%",
                width: m.size,
                height: m.size,
                opacity: m.op,
                "--dur": m.dur + "s",
                "--delay": m.delay + "s",
                "--drift": m.drift + "px",
              } as CssVars
            }
          />
        ))}
      </div>
    </div>
  );
}
