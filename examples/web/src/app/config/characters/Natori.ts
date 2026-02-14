import { Emotion } from "@charivo/core";
import { defineCharacterConfig } from "./types";

export const NATORI_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Natori",
  character: {
    id: "Natori",
    name: "Natori",
    description: "A mysterious and elegant character with a sophisticated air",
    personality:
      "Graceful, mysterious, and intriguing. Chooses words carefully and speaks with elegance. Has a subtle charm and enjoys leaving things to imagination.",
    voice: { rate: 0.95, pitch: 1.0, volume: 0.75 },
    emotionMappings: [
      {
        emotion: Emotion.HAPPY,
        expression: "Smile",
        motion: { group: "TapBody", index: 0 },
      },
      {
        emotion: Emotion.SAD,
        expression: "Sad",
        motion: { group: "Idle", index: 1 },
      },
      {
        emotion: Emotion.ANGRY,
        expression: "Angry",
        motion: { group: "Idle", index: 2 },
      },
      {
        emotion: Emotion.SURPRISED,
        expression: "Surprised",
        motion: { group: "TapBody", index: 1 },
      },
      {
        emotion: Emotion.SHY,
        expression: "Blushing",
        motion: { group: "Idle", index: 0 },
      },
      {
        emotion: Emotion.NEUTRAL,
        expression: "Normal",
        motion: { group: "Idle", index: 0 },
      },
      {
        emotion: Emotion.THINKING,
        expression: "Normal",
        motion: { group: "Idle", index: 1 },
      },
      {
        emotion: Emotion.EXCITED,
        expression: "Smile",
        motion: { group: "TapBody", index: 2 },
      },
    ],
  },
  live2d: {
    modelPath: "/live2d/Natori/Natori.model3.json",
  },
});
