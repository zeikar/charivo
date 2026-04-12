import {
  Emotion,
  type Character,
  type RealtimeSessionConfig,
  type RealtimeToolRegistration,
  type RealtimeTool,
} from "@charivo/core";

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-realtime-mini";
const DEFAULT_VOICE = "marin";

/**
 * Get emotion enum values for tool definition.
 */
const EMOTION_VALUES = Object.values(Emotion);

/**
 * Built-in emotion tool definition for realtime agents.
 */
export const setEmotionTool: RealtimeTool = {
  type: "function",
  name: "setEmotion",
  description:
    "Update the Live2D character emotion when the conversation mood changes.",
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

export interface EmotionArgs {
  emotion: Emotion;
}

export const setEmotionRealtimeTool: RealtimeToolRegistration = {
  definition: setEmotionTool,
  async handler(args) {
    const emotion = args.emotion;

    if (
      typeof emotion !== "string" ||
      !EMOTION_VALUES.includes(emotion as Emotion)
    ) {
      throw new Error('setEmotion requires a valid "emotion" string');
    }

    return {
      success: true,
      emotion,
    };
  },
};

export const DEFAULT_REALTIME_AGENT_INSTRUCTIONS = `
You are a realtime voice agent controlling a Live2D character.
Respond naturally, stay in character, and keep replies concise enough for spoken delivery.
When the conversation mood changes, call the "setEmotion" tool so the character expression can update.
Do not mention tool calls in the spoken response.
`.trim();

export interface BuildRealtimeSessionConfigOptions {
  character?: Character | null;
  baseConfig?: RealtimeSessionConfig;
}

export function buildRealtimeSessionConfig({
  character,
  baseConfig,
}: BuildRealtimeSessionConfigOptions = {}): RealtimeSessionConfig {
  return {
    provider: baseConfig?.provider ?? DEFAULT_PROVIDER,
    transport: baseConfig?.transport ?? "webrtc",
    model: baseConfig?.model ?? DEFAULT_MODEL,
    voice: baseConfig?.voice ?? character?.voice?.voiceId ?? DEFAULT_VOICE,
    instructions:
      baseConfig?.instructions ?? buildCharacterInstructions(character),
    temperature: baseConfig?.temperature,
    maxTokens: baseConfig?.maxTokens,
    tools: baseConfig?.tools,
    toolChoice: baseConfig?.toolChoice ?? "auto",
  };
}

function buildCharacterInstructions(character?: Character | null): string {
  if (!character) {
    return DEFAULT_REALTIME_AGENT_INSTRUCTIONS;
  }

  const lines = [DEFAULT_REALTIME_AGENT_INSTRUCTIONS];
  lines.push(`Character name: ${character.name}.`);

  if (character.description) {
    lines.push(`Character description: ${character.description}.`);
  }

  if (character.personality) {
    lines.push(`Character personality: ${character.personality}.`);
  }

  return lines.join("\n");
}
