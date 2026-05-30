import type { MemoryFact, RelationshipState } from "./types";
import { estimateTokens } from "./scoring";

/** Fixed product-policy memory budget in tokens. */
export const MEMORY_TOKEN_BUDGET = 600;

/** Fixed product policy; imported directly by build-memory-block.ts (Task 2). */
export const MAX_SUMMARIES = 2;

export const MEMORY_GUARD_LINE =
  "These notes are from earlier conversations and may be dated or incomplete — treat them as context, not certainty, and confirm with the user if unsure.";

/**
 * Render facts and optional summaries into a compact instruction block.
 * Returns "" when both facts and summaries are empty (so callers can drop it).
 */
export function renderMemoryBlock(
  facts: MemoryFact[],
  summaries?: string[],
): string {
  const hasFacts = facts.length > 0;
  const hasSummaries = (summaries?.length ?? 0) > 0;

  if (!hasFacts && !hasSummaries) return "";

  const lines: string[] = [];
  lines.push("## Memory");
  lines.push(MEMORY_GUARD_LINE);

  if (hasFacts) {
    lines.push("Known facts:");
    for (const fact of facts) {
      lines.push(`- ${fact.text}`);
    }
  }

  if (hasSummaries) {
    lines.push("Recent sessions:");
    for (const summary of summaries!) {
      lines.push(`- ${summary}`);
    }
  }

  return lines.join("\n");
}

/**
 * Render longitudinal relationship state into a terse instruction-shaped line.
 * Returns "" for null or first-ever meeting (sessionCount <= 0).
 */
export function renderRelationshipBlock(
  state: RelationshipState | null,
): string {
  if (state === null || state.sessionCount <= 0) return "";

  const parts: string[] = [];

  if (state.addressStyle !== "unknown") {
    parts.push(`Address the user in a ${state.addressStyle} style.`);
  }

  const rapportDescriptor =
    state.rapport > 0.3
      ? "warm"
      : state.rapport < -0.3
        ? "strained"
        : "neutral";
  parts.push(`Rapport is ${rapportDescriptor}.`);

  const sessionWord = state.sessionCount === 1 ? "session" : "sessions";
  parts.push(
    `You have spoken across ${state.sessionCount} prior ${sessionWord}.`,
  );

  return parts.join(" ");
}

/**
 * Select facts and summaries that fit within the token budget.
 * Budget defaults to MEMORY_TOKEN_BUDGET; pass a small value in tests to verify trimming.
 * Summaries are expected newest-first; MAX_SUMMARIES is a fixed product constant.
 */
export function selectMemoryForRender(args: {
  facts: MemoryFact[];
  summaries: string[];
  budgetTokens?: number;
}): { facts: MemoryFact[]; summaries: string[] } {
  const budget = args.budgetTokens ?? MEMORY_TOKEN_BUDGET;
  const candidateSummaries = args.summaries.slice(0, MAX_SUMMARIES);

  let remaining = budget;
  const admittedFacts: MemoryFact[] = [];

  for (const fact of args.facts) {
    const cost = estimateTokens(fact.text);
    if (cost <= remaining) {
      admittedFacts.push(fact);
      remaining -= cost;
    }
    // skip-style: continue to next fact even if this one didn't fit
  }

  const admittedSummaries: string[] = [];
  for (const summary of candidateSummaries) {
    const cost = estimateTokens(summary);
    if (cost <= remaining) {
      admittedSummaries.push(summary);
      remaining -= cost;
    }
  }

  return { facts: admittedFacts, summaries: admittedSummaries };
}
