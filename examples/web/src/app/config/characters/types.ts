import type { Character } from "@charivo/core";

export interface Live2DConfig {
  modelPath: string;
}

export interface CharacterConfig<TId extends string = string> {
  id: TId;
  character: Character & { id: TId };
  live2d: Live2DConfig;
}

export function defineCharacterConfig<TId extends string>(
  config: CharacterConfig<TId>,
): CharacterConfig<TId> {
  return config;
}
