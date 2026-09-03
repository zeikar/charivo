import type { Character } from "@charivo/core";

export interface Live2DConfig {
  modelPath: string;
  expressionDescriptions?: Record<string, string>;
  /** Keyed by motion group; array position is the zero-based motion index. */
  motionDescriptions?: Record<string, string[]>;
}

export type CharacterVoiceProvider = "openai" | "gemini";

export interface CharacterConfig<TId extends string = string> {
  id: TId;
  character: Character & { id: TId };
  live2d: Live2DConfig;
  // character.voice.voiceId stays the OpenAI id so default behaviour is
  // unchanged; voices is what the demo resolves per provider.
  voices: Record<CharacterVoiceProvider, string>;
}

export function defineCharacterConfig<TId extends string>(
  config: CharacterConfig<TId>,
): CharacterConfig<TId> {
  return config;
}
