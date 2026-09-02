import type { RealtimeSessionConfig } from "@charivo/core";
import { DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL } from "./defaults";

/**
 * The `audio.input` block an OpenAI realtime session gets for
 * `inputAudioTranscription`, shared by every browser-side OpenAI serializer in
 * this package so the contract cannot drift between them: `undefined` omits the
 * block (off unless asked), `enabled: false` sends `null` to turn it off, and
 * `enabled: true` or any supplied `model` turns it on. OpenAI requires a model
 * on the block (measured: `{}` is a 400), so an enable without one gets the
 * default rather than being dropped.
 *
 * `packages/server/src/openai/realtime/index.ts` carries its own copy on
 * purpose — server providers stay self-contained, the same pattern as the
 * defaults.
 */
export function resolveOpenAIAudioInput(
  transcription: RealtimeSessionConfig["inputAudioTranscription"],
): Record<string, unknown> | undefined {
  if (transcription === undefined) {
    return undefined;
  }

  if (transcription.enabled === false) {
    return { transcription: null };
  }

  if (transcription.enabled === true || transcription.model !== undefined) {
    return {
      transcription: {
        model:
          transcription.model ?? DEFAULT_OPENAI_REALTIME_TRANSCRIPTION_MODEL,
      },
    };
  }

  return undefined;
}
