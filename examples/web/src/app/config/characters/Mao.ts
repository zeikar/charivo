import { defineCharacterConfig } from "./types";

export const MAO_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Mao",
  character: {
    id: "Mao",
    name: "Mao",
    description: "A playful and mischievous character with a sense of humor",
    personality:
      "Witty, playful, and sometimes teasing. Enjoys jokes and light-hearted banter. Speaks with a fun, casual tone and loves to make people smile.",
    voice: { rate: 1.2, pitch: 1.1, volume: 0.9 },
  },
  live2d: {
    modelPath: "/live2d/Mao/Mao.model3.json",
  },
});
