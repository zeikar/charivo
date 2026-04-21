import type { Character, Message } from "@charivo/core";

export type ChatMessage = Message & { character?: Character };

export type RealtimeTurnStatus =
  | "idle"
  | "connecting"
  | "listening"
  | "responding"
  | "interrupted"
  | "reconnecting";

export type TTSPlayerType = "remote" | "web" | "openai" | "none";

export type STTTranscriberType = "remote" | "web" | "openai" | "none";

export type LLMClientType =
  | "remote"
  | "openai"
  | "openclaw-remote"
  | "openclaw"
  | "stub";
