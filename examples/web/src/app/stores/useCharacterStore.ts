import { create } from "zustand";
import type { Character } from "@charivo/core";

export const CHARACTERS: Character[] = [
  {
    id: "haru",
    name: "Haru",
    description:
      "A bright and energetic character who brings warmth to every conversation",
    personality:
      "Cheerful, optimistic, and always ready to help. Speaks with enthusiasm and uses friendly, casual language. Loves to encourage others and share positive energy.",
    voice: { rate: 1.1, pitch: 1.3, volume: 0.8 },
  },
  {
    id: "hiyori",
    name: "Hiyori",
    description: "A thoughtful and gentle character with a calm demeanor",
    personality:
      "Soft-spoken, empathetic, and caring. Takes time to listen and respond thoughtfully. Uses polite and soothing language, creating a comfortable atmosphere.",
    voice: { rate: 1.0, pitch: 1.2, volume: 0.8 },
  },
  {
    id: "mao",
    name: "Mao",
    description: "A playful and mischievous character with a sense of humor",
    personality:
      "Witty, playful, and sometimes teasing. Enjoys jokes and light-hearted banter. Speaks with a fun, casual tone and loves to make people smile.",
    voice: { rate: 1.2, pitch: 1.1, volume: 0.9 },
  },
  {
    id: "mark",
    name: "Mark",
    description:
      "A confident and knowledgeable character who enjoys deep conversations",
    personality:
      "Intelligent, articulate, and slightly formal. Enjoys discussing ideas and sharing knowledge. Speaks clearly and precisely, with a professional yet friendly tone.",
    voice: { rate: 0.9, pitch: 0.9, volume: 0.8 },
  },
  {
    id: "natori",
    name: "Natori",
    description: "A mysterious and elegant character with a sophisticated air",
    personality:
      "Graceful, mysterious, and intriguing. Chooses words carefully and speaks with elegance. Has a subtle charm and enjoys leaving things to imagination.",
    voice: { rate: 0.95, pitch: 1.0, volume: 0.75 },
  },
  {
    id: "rice",
    name: "Rice",
    description:
      "An adorable and innocent character who sees the world with wonder",
    personality:
      "Cute, innocent, and curious about everything. Asks lots of questions and expresses wonder easily. Uses simple, endearing language with a childlike charm.",
    voice: { rate: 1.15, pitch: 1.4, volume: 0.85 },
  },
  {
    id: "wanko",
    name: "Wanko",
    description: "A loyal and energetic character with puppy-like enthusiasm",
    personality:
      "Loyal, energetic, and eager to please. Shows excitement easily and is always happy to help. Speaks with enthusiasm and uses warm, friendly expressions.",
    voice: { rate: 1.1, pitch: 1.2, volume: 0.9 },
  },
] as const;

export type CharacterName = (typeof CHARACTERS)[number]["name"];

type CharacterStore = {
  selectedCharacter: CharacterName;
  setSelectedCharacter: (name: CharacterName) => void;
  getCharacter: (name: CharacterName) => Character;
  getLive2DModelPath: (name: CharacterName) => string;
};

export const useCharacterStore = create<CharacterStore>((set) => ({
  selectedCharacter: "Hiyori",
  setSelectedCharacter: (name) => set({ selectedCharacter: name }),
  getCharacter: (name) => {
    const character = CHARACTERS.find((c) => c.name === name);
    if (!character) {
      throw new Error(`Character not found: ${name}`);
    }
    return character;
  },
  getLive2DModelPath: (name) =>
    `/live2d/${name}/${name.toLowerCase()}.model3.json`,
}));
