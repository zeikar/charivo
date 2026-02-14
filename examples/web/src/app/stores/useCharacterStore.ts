import { create } from "zustand";
import {
  CHARACTER_CONFIGS,
  CHARACTERS,
  type AppCharacter,
  type CharacterId,
} from "../config/characters";

export { CHARACTERS, type CharacterId };

type CharacterStore = {
  selectedCharacter: CharacterId;
  setSelectedCharacter: (id: CharacterId) => void;
  getCharacter: (id: CharacterId) => AppCharacter;
  getLive2DModelPath: (id: CharacterId) => string;
};

export const useCharacterStore = create<CharacterStore>((set) => ({
  selectedCharacter: "Hiyori",
  setSelectedCharacter: (id) => set({ selectedCharacter: id }),
  getCharacter: (id) => {
    const config = CHARACTER_CONFIGS[id];
    if (!config) {
      throw new Error(`Character not found: ${id}`);
    }
    return config.character;
  },
  getLive2DModelPath: (id) => {
    const config = CHARACTER_CONFIGS[id];
    if (!config) {
      throw new Error(`Character config not found: ${id}`);
    }
    return config.live2d.modelPath;
  },
}));
