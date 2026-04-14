import type { RealtimeSessionConfig } from "@charivo/core";

export const DEFAULT_AGENT_INSTRUCTIONS =
  "You are a realtime voice agent controlling a Live2D character.";
export const DEFAULT_MODEL = "gpt-realtime-mini";
export const DEFAULT_VOICE = "marin";

export function resolveInstructions(config?: RealtimeSessionConfig): string {
  return config?.instructions ?? DEFAULT_AGENT_INSTRUCTIONS;
}

export function resolveVoice(config?: RealtimeSessionConfig): string {
  return config?.voice ?? DEFAULT_VOICE;
}

export function toOpenAIRealtimeAgentsSessionConfig(
  config?: RealtimeSessionConfig,
): Record<string, unknown> {
  return {
    model: config?.model ?? DEFAULT_MODEL,
    instructions: resolveInstructions(config),
    toolChoice: config?.toolChoice ?? "auto",
    outputModalities: ["audio"],
    audio: {
      output: {
        voice: resolveVoice(config),
      },
    },
  };
}
