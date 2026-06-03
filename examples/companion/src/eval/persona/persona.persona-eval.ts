/**
 * Persona feel — live capture eval suite.
 *
 * Opt-in: requires RUN_PERSONA_EVAL=1 AND OPENAI_API_KEY to run.
 * LIVE / PAID: each enabled run makes ~8 sequential API calls (gpt-4o-mini).
 * NEVER in CI — the vitest.persona-eval.config.ts is excluded from pnpm verify.
 *
 * Skips cleanly (exit 0) when either env var is absent; no network call, no
 * failure on the disabled path.
 *
 * The judge is Claude (or a human) reading the written artifact, NOT any
 * assertion in this file — tone/score judgement is out of band.
 */

import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import { runCapture } from "./persona-capture";

// Computed once at module load — cheap, no I/O, no throw.
const ENABLED =
  process.env.RUN_PERSONA_EVAL === "1" && Boolean(process.env.OPENAI_API_KEY);

describe("persona feel — live capture (advisory)", () => {
  it.skipIf(!ENABLED)(
    "captures persona transcripts for Claude to judge",
    async () => {
      const { artifactPath, recordCount } = await runCapture();
      console.log(
        `[eval] persona artifact written: ${artifactPath} (${recordCount} captures)`,
      );
      expect(recordCount).toBeGreaterThan(0);
      expect(existsSync(artifactPath)).toBe(true);
    },
    60_000,
  );
});
