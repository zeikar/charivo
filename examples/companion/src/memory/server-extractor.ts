import type { FactExtractor } from "./promotion-types";

/**
 * Server-side fact extractor seam for the live write path.
 *
 * The MVP ships a NO-OP extractor: promotion still persists the session row and
 * advances the longitudinal relationship (sessionCount / rapport / lastSeenAt —
 * neither needs extraction), but emits no content facts. A real LLM extractor
 * lands later behind an env flag; we deliberately do NOT ship a heuristic that
 * would pollute long-term memory with low-confidence facts (precision-first,
 * per .hyperclaude/tasks/README.md).
 */
export function createServerExtractor(): FactExtractor {
  return {
    extract: () => Promise.resolve([]),
  };
}
