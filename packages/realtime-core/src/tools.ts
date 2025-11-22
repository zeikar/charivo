import type { RealtimeTool } from "./types";
import { Emotion } from "@charivo/core";

/**
 * Get emotion enum values for tool definition
 */
const EMOTION_VALUES = Object.values(Emotion);

/**
 * setEmotion tool definition for OpenAI Realtime API
 *
 * This tool allows the LLM to update the Live2D character's emotion.
 */
export const setEmotionTool: RealtimeTool = {
  type: "function",
  name: "setEmotion",
  description:
    "Update Live2D character emotion. Call this when the conversation mood or emotion changes.",
  parameters: {
    type: "object",
    properties: {
      emotion: {
        type: "string",
        description: "Emotion of the character.",
        enum: EMOTION_VALUES,
      },
    },
    required: ["emotion"],
  },
};

/**
 * Emotion tool call arguments type
 */
export interface EmotionArgs {
  emotion: Emotion;
}

/**
 * Default instructions for character with emotion support
 */
export const DEFAULT_EMOTION_INSTRUCTIONS = `
You are a Live2D character with emotions and expressions.
Respond naturally to the user's messages.
When the conversation mood or emotion changes, call the 'setEmotion' tool to update your expression and motion.
Do NOT mention the tool call in your response - just respond naturally and let the emotion show through your character.
`.trim();

/**
 * Get default Realtime session config with emotion support
 */
export function getEmotionSessionConfig(overrides?: {
  model?: string;
  voice?: string;
  instructions?: string;
}): {
  type: string;
  model: string;
  audio: { output: { voice: string } };
  instructions: string;
  tools: RealtimeTool[];
  tool_choice: "auto";
} {
  return {
    type: "realtime",
    model: overrides?.model || "gpt-realtime-mini",
    audio: {
      output: {
        voice: overrides?.voice || "marin",
      },
    },
    instructions: overrides?.instructions || DEFAULT_EMOTION_INSTRUCTIONS,
    tools: [setEmotionTool],
    tool_choice: "auto",
  };
}
