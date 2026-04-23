import { DEFAULT_REALTIME_AGENT_INSTRUCTIONS as DEFAULT_GENERIC_REALTIME_AGENT_INSTRUCTIONS } from "../instructions";

// Mirrors packages/server/src/openai/realtime/index.ts until the server/browser
// OpenAI defaults consolidate under ROADMAP P0-ARCH-2.
export const DEFAULT_OPENAI_REALTIME_MODEL = "gpt-realtime-mini";
export const DEFAULT_OPENAI_REALTIME_VOICE = "marin";
export const DEFAULT_OPENAI_REALTIME_AGENT_INSTRUCTIONS =
  DEFAULT_GENERIC_REALTIME_AGENT_INSTRUCTIONS;
