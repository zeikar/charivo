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

  // The agents SDK rebuilds `session.update` from an allowlist of fields it
  // knows, so a key it has no mapping for is dropped before it reaches the
  // wire -- and it has no mapping for the GA `max_output_tokens`. `providerData`
  // is spread raw into the session payload, so it is the only way through.
  if (config?.maxTokens !== undefined) {
    sessionConfig.providerData = { max_output_tokens: config.maxTokens };
  }

  return sessionConfig;
}
