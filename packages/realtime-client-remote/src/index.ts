import type {
  RealtimeSessionBootstrap,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  createOpenAIRealtimeClient,
  type OpenAIRealtimeClientOptions,
} from "@charivo/realtime-client-openai";
import type {
  RealtimeSessionConfig,
  RealtimeTransportClient,
} from "@charivo/realtime-core";

export interface RemoteRealtimeClientConfig {
  apiEndpoint?: string;
  debug?: boolean;
}

const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Production browser client for server-mediated realtime sessions.
 *
 * Phase 1 supports the OpenAI WebRTC transport through a provider-agnostic
 * bootstrap contract returned by the server route.
 */
export class RemoteRealtimeClient implements RealtimeTransportClient {
  private transportClient: RealtimeTransportClient;

  constructor(private config: RemoteRealtimeClientConfig = {}) {
    const transportConfig: OpenAIRealtimeClientOptions = {
      debug: config.debug,
      sessionBootstrap: (request) => this.requestBootstrap(request),
    };
    this.transportClient = createOpenAIRealtimeClient(transportConfig);
  }

  connect(config?: RealtimeSessionConfig): Promise<void> {
    return this.transportClient.connect(config);
  }

  disconnect(): Promise<void> {
    return this.transportClient.disconnect();
  }

  sendText(text: string): Promise<void> {
    return this.transportClient.sendText(text);
  }

  sendAudio(audio: ArrayBuffer): Promise<void> {
    return this.transportClient.sendAudio(audio);
  }

  interrupt(): Promise<void> {
    if (!this.transportClient.interrupt) {
      throw new Error("Realtime transport does not support interruption");
    }

    return this.transportClient.interrupt();
  }

  onEvent(callback: Parameters<RealtimeTransportClient["onEvent"]>[0]): void {
    this.transportClient.onEvent(callback);
  }

  private async requestBootstrap(
    request: RealtimeSessionRequest,
  ): Promise<RealtimeSessionBootstrap> {
    const response = await fetchWithTimeout(
      this.config.apiEndpoint || "/api/realtime",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(request),
      },
      `Realtime session request timed out after ${REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Realtime session: ${errorText}`);
    }

    const bootstrap = (await response.json()) as unknown;
    if (!isRealtimeSessionBootstrap(bootstrap)) {
      throw new Error("Invalid realtime session bootstrap response");
    }

    return bootstrap;
  }
}

export function createRemoteRealtimeClient(
  config?: RemoteRealtimeClientConfig,
): RealtimeTransportClient {
  return new RemoteRealtimeClient(config);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isRealtimeSessionBootstrap(
  value: unknown,
): value is RealtimeSessionBootstrap {
  if (!isRecord(value) || typeof value.transport !== "string") {
    return false;
  }

  if (value.transport === "webrtc") {
    return typeof value.answerSdp === "string";
  }

  if (value.transport === "websocket") {
    return typeof value.url === "string" && typeof value.token === "string";
  }

  return false;
}

async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit,
  timeoutMessage: string,
): Promise<Response> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

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
