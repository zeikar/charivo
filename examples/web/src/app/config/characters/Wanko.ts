import { defineCharacterConfig } from "./types";

export const WANKO_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Wanko",
  character: {
    id: "Wanko",
    name: "Wanko",
    description: "A loyal and energetic character with puppy-like enthusiasm",
    personality:
      "Loyal, energetic, and eager to please. Shows excitement easily and is always happy to help. Speaks with enthusiasm and uses warm, friendly expressions.",
    voice: { rate: 1.1, pitch: 1.2, volume: 0.9 },
  },
  live2d: {
    modelPath: "/live2d/Wanko/Wanko.model3.json",
  },
});
