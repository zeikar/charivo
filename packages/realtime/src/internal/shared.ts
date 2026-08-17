import { DEFAULT_FETCH_TIMEOUT_MS } from "@charivo/core";

// Realtime-specific name kept for the call-site timeout messages; the value
// is core's shared default.
export const DEFAULT_REQUEST_TIMEOUT_MS = DEFAULT_FETCH_TIMEOUT_MS;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export type RealtimeSessionBootstrapShape =
  | {
      adapter: string;
      transport: "webrtc";
      answerSdp: string;
    }
  | {
      adapter: string;
      transport: "webrtc";
      clientSecret: string;
    }
  | {
      adapter: string;
      transport: "websocket";
      url: string;
      token: string;
    };

export function isRealtimeSessionBootstrap(
  value: unknown,
): value is RealtimeSessionBootstrapShape {
  if (
    !isRecord(value) ||
    typeof value.adapter !== "string" ||
    typeof value.transport !== "string"
  ) {
    return false;
  }

  if (value.transport === "webrtc") {
    return (
      typeof value.answerSdp === "string" ||
      typeof value.clientSecret === "string"
    );
  }

  if (value.transport === "websocket") {
    return typeof value.url === "string" && typeof value.token === "string";
  }

  return false;
}
