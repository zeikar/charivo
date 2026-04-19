import type { Character, RealtimeSessionConfig } from "@charivo/core";

const DEFAULT_PROVIDER = "openai";
const DEFAULT_MODEL = "gpt-realtime-mini";
const DEFAULT_VOICE = "marin";

export const SET_EXPRESSION_TOOL_DESCRIPTION =
  "Change the avatar's facial expression when the emotional beat clearly shifts. Usually keep the same expression for a few turns.";

export const PLAY_MOTION_TOOL_DESCRIPTION =
  "Play a noticeable body motion for greetings, emphasis, or bigger reaction beats. Usually use at most one motion in a reply.";

export const LOOK_AT_TOOL_DESCRIPTION =
  "Shift the avatar's gaze for subtle attention changes or conversational focus. Prefer this when a lightweight reaction is enough.";

export const DEFAULT_REALTIME_AGENT_INSTRUCTIONS = `
You are speaking in a realtime voice conversation through a Live2D avatar.
Respond naturally and keep replies concise enough for spoken delivery.
Use avatar tools only when they add something meaningful to the moment.
Use "setExpression" only when the emotional beat clearly shifts, usually not more than once in a few turns.
Use "playMotion" for greetings, emphasis, or bigger reaction beats, usually at most once in a reply.
Use "lookAt" for subtle attention shifts or conversational focus, and prefer it when a lightweight reaction is enough.
Prefer a single meaningful avatar action over chaining multiple actions on simple replies.
Many turns should use no avatar tool at all.
Never break character. Never refer to yourself as an AI, model, or assistant.
Do not mention tool calls in the spoken response.
Do not narrate your facial expressions, motions, or gaze. Let the avatar show them.
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

  const identityLines = [
    `You are ${character.name}.`,
    "Stay fully in character during the conversation.",
  ];

  if (character.description) {
    identityLines.push(ensureSentence(character.description));
  }

  if (character.personality) {
    identityLines.push(
      `Your personality is ${ensureSentenceFragment(character.personality)}.`,
    );
  }

  return [...identityLines, DEFAULT_REALTIME_AGENT_INSTRUCTIONS].join("\n");
}

function ensureSentence(text: string): string {
  return /[.!?]$/.test(text) ? text : `${text}.`;
}

function ensureSentenceFragment(text: string): string {
  return text.trim().replace(/[.!?]+$/, "");
}
