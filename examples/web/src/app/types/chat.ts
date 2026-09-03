import type { Character, Message } from "@charivo/core";

export type ChatMessage = Message & { character?: Character };

export type RealtimeTurnStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "responding"
  | "interrupted"
  | "reconnecting";

/**
 * Which demo cost cap ended the last activity, when one did. The caps stop a
 * session or a recording silently by design (see `api/demo-limits.ts`), so this
 * is what lets the UI say why instead of leaving it looking like a failure.
 */
export type DemoCapNotice = "realtime-session" | "stt-recording";

export type TTSPlayerType =
  | "remote"
  | "web"
  | "openai"
  | "gemini-remote"
  | "gemini"
  | "none";

export type STTTranscriberType =
  | "remote"
  | "web"
  | "openai"
  | "openai-realtime"
  | "gemini-remote"
  | "gemini"
  | "none";

export type LLMClientType =
  | "remote"
  | "openai"
  | "gemini-remote"
  | "gemini"
  | "openclaw-remote"
  | "openclaw"
  | "stub";

export type RealtimeProviderType = "openai" | "gemini";
