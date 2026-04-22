import type { RealtimeSessionConfig } from "@charivo/core";
import { DEFAULT_REALTIME_VOICE } from "../instructions";

export const DEFAULT_AGENT_INSTRUCTIONS =
  "You are a realtime voice agent controlling a Live2D character.";
export const DEFAULT_MODEL = "gpt-realtime-mini";

export function resolveInstructions(config?: RealtimeSessionConfig): string {
  return config?.instructions ?? DEFAULT_AGENT_INSTRUCTIONS;
}

export function resolveVoice(config?: RealtimeSessionConfig): string {
  return config?.voice ?? DEFAULT_REALTIME_VOICE;
}

export function toOpenAIRealtimeAgentsSessionConfig(
  config?: RealtimeSessionConfig,
): Record<string, unknown> {
  const sessionConfig: Record<string, unknown> = {
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

  if (config?.temperature !== undefined) {
    sessionConfig.temperature = config.temperature;
  }

  if (config?.maxTokens !== undefined) {
    sessionConfig.maxResponseOutputTokens = config.maxTokens;
  }

  return sessionConfig;
}
