import { DEFAULT_REALTIME_AGENT_INSTRUCTIONS as DEFAULT_GENERIC_REALTIME_AGENT_INSTRUCTIONS } from "../instructions";

// OpenAI realtime defaults, intentionally duplicated with
// packages/server/src/openai/realtime/index.ts. Strict layering keeps browser and
// server providers self-contained (no shared module / cross-package dep) — the
// same pattern the tts/stt OpenAI defaults follow.
export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
export const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
export const DEFAULT_OPENAI_REALTIME_AGENT_INSTRUCTIONS =
  DEFAULT_GENERIC_REALTIME_AGENT_INSTRUCTIONS;
