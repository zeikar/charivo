export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

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

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
  timeoutMs = DEFAULT_REQUEST_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fetch(input, {
      ...init,
      signal: controller.signal,
    });
  } catch (error) {
    if (isAbortError(error)) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}

function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
