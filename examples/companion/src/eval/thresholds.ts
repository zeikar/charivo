/**
 * Product thresholds for the memory eval (the policy half of the boundary).
 *
 * Precision is the PRIMARY gate: on these curated fixtures it is 1.0 — any false
 * positive (a junk/hallucinated fact admitted) or false negative (a real fact
 * dropped) is a regression. Recall is reported AND gated to 1.0 here ONLY because
 * the curated set has full expected coverage; on a real corpus recall would be a
 * softer, secondary target.
 */
export const EVAL_THRESHOLDS = {
  extractionPrecisionMin: 1.0,
  extractionRecallMin: 1.0,
  precisionAtKMin: 1.0,
  deletionComplianceRequired: true,
  scopeIsolationRequired: true,
  temporalCorrectionRequired: true,
} as const;
