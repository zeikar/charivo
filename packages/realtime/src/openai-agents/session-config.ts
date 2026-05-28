import type { RealtimeSessionConfig } from "@charivo/core";
import {
  DEFAULT_OPENAI_REALTIME_AGENT_INSTRUCTIONS,
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_VOICE,
} from "../openai/defaults";

export function resolveInstructions(config?: RealtimeSessionConfig): string {
  return config?.instructions ?? DEFAULT_OPENAI_REALTIME_AGENT_INSTRUCTIONS;
}

export function resolveVoice(config?: RealtimeSessionConfig): string {
  return config?.voice ?? DEFAULT_OPENAI_REALTIME_VOICE;
}

export function toOpenAIRealtimeAgentsSessionConfig(
  config?: RealtimeSessionConfig,
): Record<string, unknown> {
  const audio: Record<string, unknown> = {
    output: {
      voice: resolveVoice(config),
    },
  };

  const transcription = config?.inputAudioTranscription;
  if (transcription !== undefined) {
    if (transcription.enabled === false) {
      audio.input = { transcription: null };
    } else if (transcription.model !== undefined) {
      audio.input = { transcription: { model: transcription.model } };
    }
  }

  const sessionConfig: Record<string, unknown> = {
    model: config?.model ?? DEFAULT_OPENAI_REALTIME_MODEL,
    instructions: resolveInstructions(config),
    toolChoice: config?.toolChoice ?? "auto",
    outputModalities: ["audio"],
    audio,
  };

  if (config?.temperature !== undefined) {
    sessionConfig.temperature = config.temperature;
  }

  if (config?.maxTokens !== undefined) {
    sessionConfig.maxResponseOutputTokens = config.maxTokens;
  }

  return sessionConfig;
}
