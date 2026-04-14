export const CHARIVO_VERSION = "0.0.0";
export const DEFAULT_REQUEST_TIMEOUT_MS = 30_000;

export const DEFAULT_CONFIG = {
  maxMessages: 100,
  responseTimeout: 30000,
  retryAttempts: 3,
} as const;

export function generateId(): string {
  let id = "";

  while (id.length < 9) {
    id += Math.random().toString(36).slice(2);
  }

  return id.slice(0, 9);
}

export function formatTimestamp(date: Date): string {
  return date.toISOString();
}

export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number,
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return (...args: Parameters<T>) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => func(...args), wait);
  };
}

export function throttle<T extends (...args: unknown[]) => unknown>(
  func: T,
  limit: number,
): (...args: Parameters<T>) => void {
  let inThrottle = false;

  return (...args: Parameters<T>) => {
    if (!inThrottle) {
      func(...args);
      inThrottle = true;
      setTimeout(() => (inThrottle = false), limit);
    }
  };
}

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
  } /* v8 ignore next */ finally {
    clearTimeout(timeoutId);
  }
}

export function isAbortError(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof Error && error.name === "AbortError")
  );
}
