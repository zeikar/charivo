import { defineCharacterConfig } from "./types";

export const HIYORI_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Hiyori",
  character: {
    id: "Hiyori",
    name: "Hiyori",
    description: "A thoughtful and gentle character with a calm demeanor",
    personality:
      "Soft-spoken, empathetic, and caring. Takes time to listen and respond thoughtfully. Uses polite and soothing language, creating a comfortable atmosphere.",
    voice: { rate: 1.0, pitch: 1.2, volume: 0.8 },
  },
  live2d: {
    modelPath: "/live2d/Hiyori/Hiyori.model3.json",
  },
});
