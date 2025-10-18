import type { Character, Message } from "@charivo/core";

export type ChatMessage = Message & { character?: Character };

export type TTSPlayerType = "remote" | "web" | "openai" | "none";

export type STTTranscriberType = "remote" | "web" | "openai" | "none";

export type LLMClientType = "remote" | "openai" | "stub";
