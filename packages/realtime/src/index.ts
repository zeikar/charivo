export * from "./types";
export {
  createRealtimeManager,
  type RealtimeManagerOptions,
  type RealtimeLogger,
  type RealtimeToolResultProjector,
  type RealtimeToolResultProjectorContext,
} from "./realtime-manager";
export type {
  ToolResultProjector,
  ToolResultProjectorContext,
} from "@charivo/core";
export {
  DEFAULT_REALTIME_AGENT_INSTRUCTIONS,
  buildRealtimeSessionConfig,
  type BuildRealtimeSessionConfigOptions,
} from "./instructions";
