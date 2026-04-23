import type { Character, RealtimeSessionConfig } from "@charivo/core";

export const DEFAULT_REALTIME_AGENT_INSTRUCTIONS = `
You are speaking in a realtime voice conversation.
Respond naturally and keep replies concise enough for spoken delivery.
Use tools only when they add something meaningful to the moment.
Prefer a single meaningful action over chaining multiple actions on simple replies.
Many turns should use no tool at all.
Never break character. Never refer to yourself as an AI, model, or assistant.
Do not mention tool calls in the spoken response.
Speak only the words you want heard aloud. Use tools for actions. Never say tool names or tool arguments out loud. Do not output bracketed or parenthetical action notes. If a tool is unavailable, omit the action entirely rather than narrating it.
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
    transport: baseConfig?.transport ?? "webrtc",
    provider: baseConfig?.provider,
    model: baseConfig?.model,
    voice: baseConfig?.voice ?? character?.voice?.voiceId,
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
