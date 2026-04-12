import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import { OPENAI_REALTIME_ADAPTER } from "@charivo/core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";
import type {
  RealtimeTransportClient,
  RealtimeTransportEvent,
} from "@charivo/realtime-core";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  fetchWithTimeout,
  isRealtimeSessionBootstrap,
} from "@charivo/shared";

export interface RemoteRealtimeAdapterFactoryOptions {
  debug?: boolean;
  requestBootstrap: (
    request: RealtimeSessionRequest,
  ) => Promise<RealtimeSessionBootstrap>;
}

export type RemoteRealtimeAdapterFactory = (
  options: RemoteRealtimeAdapterFactoryOptions,
) => RealtimeTransportClient;

export const DEFAULT_REMOTE_REALTIME_ADAPTERS = {
  [OPENAI_REALTIME_ADAPTER]: (options) =>
    createOpenAIRealtimeClient({
      debug: options.debug,
      sessionBootstrap: options.requestBootstrap,
    }),
} satisfies Record<string, RemoteRealtimeAdapterFactory>;

export interface RemoteRealtimeClientConfig {
  apiEndpoint?: string;
  debug?: boolean;
  adapters?: Record<string, RemoteRealtimeAdapterFactory>;
  resolveAdapterId?: (config?: RealtimeSessionConfig) => string;
}

/**
 * Production browser client for server-mediated realtime sessions.
 *
 * It resolves a browser-side transport adapter, forwards bootstrap requests to
 * your server route, and validates that the returned bootstrap matches the
 * selected adapter.
 */
export class RemoteRealtimeClient implements RealtimeTransportClient {
  private transportClient: RealtimeTransportClient | null = null;
  private readonly adapters: Map<string, RemoteRealtimeAdapterFactory>;
  private readonly eventCallbacks = new Set<
    (event: RealtimeTransportEvent) => void
  >();

  constructor(private config: RemoteRealtimeClientConfig = {}) {
    this.adapters = new Map(
      Object.entries({
        ...DEFAULT_REMOTE_REALTIME_ADAPTERS,
        ...config.adapters,
      }),
    );
  }

  async connect(config?: RealtimeSessionConfig): Promise<void> {
    const adapterId = this.resolveAdapterId(config);
    const factory = this.adapters.get(adapterId);

    if (!factory) {
      throw new Error(
        `No realtime adapter registered for "${adapterId}". Registered adapters: ${Array.from(this.adapters.keys()).join(", ") || "(none)"}`,
      );
    }

    const transportClient = factory({
      debug: this.config.debug,
      requestBootstrap: (request) =>
        this.requestBootstrap(request, { expectedAdapterId: adapterId }),
    });

    for (const callback of this.eventCallbacks) {
      transportClient.onEvent(callback);
    }

    this.transportClient = transportClient;

    try {
      await transportClient.connect(config);
    } catch (error) {
      this.transportClient = null;
      throw error;
    }
  }

  async disconnect(): Promise<void> {
    if (!this.transportClient) {
      return;
    }

    const transportClient = this.transportClient;
    this.transportClient = null;
    await transportClient.disconnect();
  }

  async sendText(text: string): Promise<void> {
    await this.getActiveTransportClient().sendText(text);
  }

  async sendAudio(audio: ArrayBuffer): Promise<void> {
    await this.getActiveTransportClient().sendAudio(audio);
  }

  async interrupt(): Promise<void> {
    await this.getActiveTransportClient().interrupt();
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
    this.transportClient?.onEvent(callback);
  }

  private getActiveTransportClient(): RealtimeTransportClient {
    if (!this.transportClient) {
      throw new Error("Realtime session not active");
    }

    return this.transportClient;
  }

  private resolveAdapterId(config?: RealtimeSessionConfig): string {
    if (this.config.resolveAdapterId) {
      return this.config.resolveAdapterId(config);
    }

    const transport = config?.transport ?? "webrtc";
    if (config?.provider === "openai" && transport === "webrtc") {
      return OPENAI_REALTIME_ADAPTER;
    }

    throw new Error(
      `No remote realtime adapter resolver for provider "${config?.provider ?? "(unspecified)"}" and transport "${transport}"`,
    );
  }

  private async requestBootstrap(
    request: RealtimeSessionRequest,
    options: { expectedAdapterId: string },
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
      `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to create Realtime session: ${errorText}`);
    }

    const bootstrap = (await response.json()) as unknown;
    if (!isRealtimeSessionBootstrap(bootstrap)) {
      throw new Error("Invalid realtime session bootstrap response");
    }

    if (bootstrap.adapter !== options.expectedAdapterId) {
      throw new Error(
        `Realtime session bootstrap adapter mismatch: expected ${options.expectedAdapterId}, received ${bootstrap.adapter}`,
      );
    }

    return bootstrap as RealtimeSessionBootstrap;
  }
}

export function createRemoteRealtimeClient(
  config?: RemoteRealtimeClientConfig,
): RealtimeTransportClient {
  return new RemoteRealtimeClient(config);
}
