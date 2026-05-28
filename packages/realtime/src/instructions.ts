import type { Character, RealtimeSessionConfig } from "@charivo/core";

export const DEFAULT_REALTIME_AGENT_INSTRUCTIONS = `
You are speaking in a realtime voice conversation.
Respond naturally and keep replies concise enough for spoken delivery.
Use available tools proactively when they make the conversation clearer or more present.
Let each tool call earn its place; don't chain rapid-fire actions just to look responsive.
Never break character. Never refer to yourself as an AI, model, or assistant.
Speak only the words you want heard aloud. Use tools for actions, but never mention tool calls, tool names, tool arguments, or bracketed/parenthetical action notes. If a tool is unavailable, omit the action instead of narrating it.
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
    inputAudioTranscription: baseConfig?.inputAudioTranscription,
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
