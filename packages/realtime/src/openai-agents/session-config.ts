import type { RealtimeSessionConfig } from "@charivo/core";
import {
  DEFAULT_OPENAI_REALTIME_AGENT_INSTRUCTIONS,
  DEFAULT_OPENAI_REALTIME_MODEL,
  DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL,
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
    } else if (
      transcription.enabled === true ||
      transcription.model !== undefined
    ) {
      // OpenAI requires a model on this block (measured: `{}` is a 400), so an
      // enable without one gets the default rather than being dropped.
      audio.input = {
        transcription: {
          model:
            transcription.model ?? DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL,
        },
      };
    }
  }

  const sessionConfig: Record<string, unknown> = {
    model: config?.model ?? DEFAULT_OPENAI_REALTIME_MODEL,
    instructions: resolveInstructions(config),
    toolChoice: config?.toolChoice ?? "auto",
    outputModalities: ["audio"],
    audio,
  };

  // The SDK rebuilds session.update from an allowlist and has no mapping for
  // `max_output_tokens`, so `providerData` is the only way through.
  if (config?.maxTokens !== undefined) {
    sessionConfig.providerData = { max_output_tokens: config.maxTokens };
  }

  return sessionConfig;
}
