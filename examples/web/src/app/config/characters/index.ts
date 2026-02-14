import { HARU_CHARACTER_CONFIG } from "./Haru";
import { HIYORI_CHARACTER_CONFIG } from "./Hiyori";
import { MAO_CHARACTER_CONFIG } from "./Mao";
import { MARK_CHARACTER_CONFIG } from "./Mark";
import { NATORI_CHARACTER_CONFIG } from "./Natori";
import { RICE_CHARACTER_CONFIG } from "./Rice";
import { WANKO_CHARACTER_CONFIG } from "./Wanko";
import type { CharacterConfig } from "./types";

export { type CharacterConfig } from "./types";

export const CHARACTER_CONFIGS = {
  Haru: HARU_CHARACTER_CONFIG,
  Hiyori: HIYORI_CHARACTER_CONFIG,
  Mao: MAO_CHARACTER_CONFIG,
  Mark: MARK_CHARACTER_CONFIG,
  Natori: NATORI_CHARACTER_CONFIG,
  Rice: RICE_CHARACTER_CONFIG,
  Wanko: WANKO_CHARACTER_CONFIG,
} as const satisfies Record<string, CharacterConfig>;

export type CharacterId = keyof typeof CHARACTER_CONFIGS;

export const CHARACTER_IDS = Object.keys(CHARACTER_CONFIGS) as CharacterId[];

export const CHARACTERS: Array<
  (typeof CHARACTER_CONFIGS)[CharacterId]["character"]
> = CHARACTER_IDS.map((id) => CHARACTER_CONFIGS[id].character);

export type AppCharacter = (typeof CHARACTER_CONFIGS)[CharacterId]["character"];

export function getCharacterConfig(
  id: CharacterId,
): CharacterConfig<CharacterId> {
  return CHARACTER_CONFIGS[id] as CharacterConfig<CharacterId>;
}

export function getCharacter(id: CharacterId): AppCharacter {
  return getCharacterConfig(id).character;
}
