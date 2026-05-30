/**
 * Product-policy seam for fact admission.
 *
 * This module is intentionally separate from the generic merge mechanism,
 * so `decideMerge` can graduate to @charivo/memory without product policy.
 * A future privacy policy (redaction, suppression) will plug in here.
 */

import type { FactCandidate } from "./promotion-types";

/**
 * Minimum importance threshold for admitting a candidate into the memory system.
 * Candidates below this are not worth storing.
 * This is the importance-admission policy, deliberately kept in the product-policy seam.
 */
export const IMPORTANCE_ADMIT_THRESHOLD = 0.4;

/**
 * Admission gate for fact candidates.
 * MVP: importance-only check. PII / sensitive-topic filtering is pass-through pending a future privacy policy.
 */
export function policyFilter(candidate: FactCandidate): boolean {
  return candidate.importance >= IMPORTANCE_ADMIT_THRESHOLD;
}
