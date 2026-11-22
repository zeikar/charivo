import { defineCharacterConfig } from "./types";

export const WANKO_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Wanko",
  character: {
    id: "Wanko",
    name: "Wanko",
    description: "A loyal and energetic character with puppy-like enthusiasm",
    personality:
      "Loyal, energetic, and eager to please. Shows excitement easily and is always happy to help. Speaks with enthusiasm and uses warm, friendly expressions.",
    voice: { voiceId: "alloy", rate: 1.1, pitch: 1.2, volume: 0.9 },
  },
  voices: { openai: "alloy", gemini: "Fenrir" },
  // No gazeOrigin: the model has no ParamEyeBallX to find its eyes by, and
  // the canvas's centre already sits on it.
  live2d: {
    modelPath: "/live2d/Wanko/Wanko.model3.json",
  },
});
