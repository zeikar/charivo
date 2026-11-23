import type { AvatarControlCatalog, LLMClient } from "@charivo/core";
import {
  formatExpressionMeanings,
  formatMotionMeanings,
} from "./catalog-meanings";
import type { AvatarClassifier, AvatarDecision } from "./director";

/**
 * An `AvatarClassifier` that asks `client` to pick the reaction for each line.
 * Every line is one stateless `call()` with no history, so it costs one
 * request per line and never touches the conversation.
 */
export function createLLMAvatarClassifier(client: LLMClient): AvatarClassifier {
  return async ({ text, catalog, signal }) => {
    const reply = await client.call(
      [
        { role: "system", content: buildSystemMessage(catalog) },
        { role: "user", content: text },
      ],
      { signal },
    );
    return parseDecision(reply);
  };
}

function buildSystemMessage(catalog: AvatarControlCatalog): string {
  // A group with no clips has no valid index to offer.
  const motionGroups = Object.entries(catalog.motions).filter(
    ([, count]) => count > 0,
  );
  const hasExpressions = catalog.expressions.length > 0;
  const hasMotions = motionGroups.length > 0;

  const fields: string[] = [];
  if (hasExpressions) {
    fields.push('"expression": <id or null>');
  }
  if (hasMotions) {
    fields.push('"motion": {"group": <group>, "index": <integer>} or null');
  }

  const lines = [
    "You choose an animated character's reaction to the line it is about to say.",
    `Reply with only one JSON object: {${fields.join(", ")}}.`,
  ];

  if (hasExpressions) {
    lines.push(`Expressions: ${catalog.expressions.join(", ")}.`);
    const meanings = formatExpressionMeanings(catalog);
    if (meanings !== null) {
      lines.push(`Expression meanings: ${meanings}.`);
    }
    lines.push(
      "Pick the expression that fits the feeling of the line, using the whole range rather than the first id; null for a neutral line.",
    );
  }

  if (hasMotions) {
    const ranges = motionGroups.map(([group, count]) =>
      count === 1
        ? `${group} (index 0)`
        : `${group} (index 0-${String(count - 1)})`,
    );
    lines.push(`Motions: ${ranges.join(", ")}.`);
    const meanings = formatMotionMeanings(catalog);
    if (meanings !== null) {
      lines.push(`Motion meanings: ${meanings}.`);
    }
    // Measured live: "only for bigger beats" alone still drew a motion on
    // every line, so the default is spelled out as null.
    lines.push(
      'Most lines need no motion: set "motion" to null unless the line is a greeting, a goodbye, or a strong reaction such as surprise or delight.',
    );
  }

  return lines.join("\n");
}

function parseDecision(reply: string): AvatarDecision {
  const parsed = readFirstJsonObject(reply);
  if (parsed === null) {
    throw new Error("Avatar classifier reply held no JSON object");
  }

  const decision: AvatarDecision = {};
  if (typeof parsed.expression === "string") {
    decision.expressionId = parsed.expression;
  }

  const motion = parsed.motion;
  if (typeof motion === "object" && motion !== null) {
    const { group, index } = motion as Record<string, unknown>;
    // Models sometimes quote numbers even when the contract asks for an integer.
    const motionIndex =
      typeof index === "string" && /^\d+$/.test(index.trim())
        ? Number(index)
        : index;
    if (typeof group === "string" && Number.isInteger(motionIndex)) {
      decision.motion = { group, index: motionIndex as number };
    }
  }

  return decision;
}

// Models wrap JSON in code fences or prose despite being told not to, so each
// `{` is tried as the start of an object, scanned to its balanced close (braces
// inside strings don't count), and the first span that parses wins.
function readFirstJsonObject(text: string): Record<string, unknown> | null {
  for (
    let start = text.indexOf("{");
    start !== -1;
    start = text.indexOf("{", start + 1)
  ) {
    const end = findObjectEnd(text, start);
    if (end === -1) {
      continue;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(text.slice(start, end + 1));
    } catch {
      // Not valid JSON, e.g. a brace in prose; the next `{` may still start
      // the object, so this span is skipped rather than reported.
      continue;
    }
    return parsed as Record<string, unknown>;
  }
  return null;
}

function findObjectEnd(text: string, start: number): number {
  let depth = 0;
  let inString = false;
  for (let i = start; i < text.length; i++) {
    const char = text[i];
    if (inString) {
      if (char === "\\") {
        i++;
      } else if (char === '"') {
        inString = false;
      }
    } else if (char === '"') {
      inString = true;
    } else if (char === "{") {
      depth++;
    } else if (char === "}") {
      depth--;
      if (depth === 0) {
        return i;
      }
    }
  }
  return -1;
}
