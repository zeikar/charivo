import type { AvatarControlCatalog } from "@charivo/core";

// Iterates `catalog.expressions` (not `Object.keys(descriptions)`) because this
// function is the single enforcement point for the key-intersection contract:
// output order must follow the catalog's own expression order, and description
// keys with no matching expression must be silently dropped rather than
// validated by callers.
export function formatExpressionMeanings(
  catalog: AvatarControlCatalog,
): string | null {
  const descriptions = catalog.expressionDescriptions;
  if (!descriptions) {
    return null;
  }

  const entries = catalog.expressions
    .filter((expressionId) => Object.hasOwn(descriptions, expressionId))
    .map((expressionId) => `${expressionId} = ${descriptions[expressionId]}`);

  if (entries.length === 0) {
    return null;
  }

  return entries.join("; ");
}

// Same key-intersection contract as formatExpressionMeanings, extended one
// dimension: a group's descriptions are positional, so an entry past the
// group's real motion count describes a motion that does not exist and is
// dropped rather than surfaced.
export function formatMotionMeanings(
  catalog: AvatarControlCatalog,
): string | null {
  const descriptions = catalog.motionDescriptions;
  if (!descriptions) {
    return null;
  }

  const entries = Object.entries(catalog.motions)
    .filter(([group]) => Object.hasOwn(descriptions, group))
    .flatMap(([group, count]) =>
      (descriptions[group] ?? [])
        .slice(0, count)
        .flatMap((text, index) =>
          text ? [`${group} #${index} = ${text}`] : [],
        ),
    );

  if (entries.length === 0) {
    return null;
  }

  return entries.join("; ");
}
