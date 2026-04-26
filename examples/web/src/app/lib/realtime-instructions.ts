import type { AvatarControlCatalog, Character } from "@charivo/core";
import { buildRealtimeSessionConfig } from "@charivo/realtime";
import { buildAvatarControlInstructions } from "@charivo/realtime-avatar";

const DEMO_REALTIME_INSTRUCTIONS = `
Keep replies short and natural for a live voice demo.
Favor subtle reactions over big repeated motions unless the moment clearly calls for emphasis.
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
