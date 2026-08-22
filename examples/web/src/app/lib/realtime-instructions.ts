import type { AvatarControlCatalog, Character } from "@charivo/core";
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import { buildAvatarControlInstructions } from "@charivo/avatar";

const DEMO_REALTIME_INSTRUCTIONS = `
Keep replies short and natural for a live voice demo.
Let the face carry the feeling, and pick the expression that reads at a glance rather than the faintest one that fits — a viewer is watching from across the room, and a barely-there smile does not survive the trip.
Motion is the opposite: reach for it only when a moment earns it, and do not repeat the same one turn after turn.
`.trim();

export function buildDemoRealtimeInstructions(
  character: Character | null,
  avatarCatalog?: AvatarControlCatalog | null,
): string {
  const baseInstructions = buildRealtimeSessionConfig({
    character,
  }).instructions;

  const avatarInstructions = avatarCatalog
    ? buildAvatarControlInstructions(avatarCatalog)
    : null;

  return [baseInstructions, avatarInstructions, DEMO_REALTIME_INSTRUCTIONS]
    .filter(Boolean)
    .join("\n");
}
