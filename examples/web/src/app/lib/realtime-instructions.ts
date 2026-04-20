import type { Character } from "@charivo/core";
import { buildRealtimeSessionConfig } from "@charivo/realtime";

const DEMO_REALTIME_INSTRUCTIONS = `
Keep replies short and natural for a live voice demo.
Favor subtle reactions over big repeated motions unless the moment clearly calls for emphasis.
`.trim();

export function buildDemoRealtimeInstructions(
  character: Character | null,
): string {
  const baseInstructions = buildRealtimeSessionConfig({
    character,
  }).instructions;

  return [baseInstructions, DEMO_REALTIME_INSTRUCTIONS].join("\n");
}
