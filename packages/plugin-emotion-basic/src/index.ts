import type { Plugin, Message } from "@charivo/core";

export type Emotion =
  | "happy"
  | "sad"
  | "angry"
  | "surprised"
  | "neutral"
  | "excited";

export interface EmotionData {
  emotion: Emotion;
  intensity: number; // 0-1
  timestamp: Date;
}

export interface EmotionPlugin extends Plugin {
  analyzeEmotion(message: Message): EmotionData;
  getEmotionHistory(): EmotionData[];
}

export class BasicEmotionPlugin implements EmotionPlugin {
  id = "emotion-basic";
  name = "Basic Emotion System";
  version = "0.0.0";
  enabled = true;

  private emotionHistory: EmotionData[] = [];

  analyzeEmotion(message: Message): EmotionData {
    // Simple keyword-based emotion detection
    const content = message.content.toLowerCase();
    let emotion: Emotion = "neutral";
    let intensity = 0.5;

    if (
      content.includes("happy") ||
      content.includes("joy") ||
      content.includes("😊")
    ) {
      emotion = "happy";
      intensity = 0.8;
    } else if (content.includes("sad") || content.includes("😢")) {
      emotion = "sad";
      intensity = 0.7;
    } else if (
      content.includes("angry") ||
      content.includes("mad") ||
      content.includes("😠")
    ) {
      emotion = "angry";
      intensity = 0.9;
    } else if (
      content.includes("surprised") ||
      content.includes("wow") ||
      content.includes("😲")
    ) {
      emotion = "surprised";
      intensity = 0.8;
    } else if (
      content.includes("excited") ||
      content.includes("amazing") ||
      content.includes("😃")
    ) {
      emotion = "excited";
      intensity = 0.9;
    }

    const emotionData: EmotionData = {
      emotion,
      intensity,
      timestamp: new Date(),
    };

    this.emotionHistory.push(emotionData);
    return emotionData;
  }

  getEmotionHistory(): EmotionData[] {
    return [...this.emotionHistory];
  }
}

export function createEmotionPlugin(): EmotionPlugin {
  return new BasicEmotionPlugin();
}
