import type {
  RealtimeSessionBootstrap,
  RealtimeSessionConfig,
  RealtimeSessionRequest,
} from "@charivo/core";
import {
  CharivoProviderError,
  CharivoStateError,
  toCharivoError,
  fetchWithTimeout,
  OPENAI_REALTIME_ADAPTER,
  OPENAI_REALTIME_AGENTS_ADAPTER,
} from "@charivo/core";
import { createOpenAIRealtimeAgentsClient } from "../openai-agents";
import { createOpenAIRealtimeClient } from "../openai";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "../types";
import {
  DEFAULT_REQUEST_TIMEOUT_MS,
  isRealtimeSessionBootstrap,
} from "../internal/shared";

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
  [OPENAI_REALTIME_AGENTS_ADAPTER]: (options) =>
    createOpenAIRealtimeAgentsClient({
      debug: options.debug,
      sessionBootstrap: options.requestBootstrap,
    }),
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
  private preparedTransportClient: RealtimeTransportClient | null = null;
  private preparedAdapterId: string | null = null;
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
    try {
      const adapterId = this.resolveAdapterId(config);
      let transportClient: RealtimeTransportClient;

      if (
        this.preparedAdapterId === adapterId &&
        this.preparedTransportClient
      ) {
        transportClient = this.preparedTransportClient;
        this.preparedTransportClient = null;
        this.preparedAdapterId = null;
      } else {
        void this.discardPreparedTransportClient();
        transportClient = this.createTransportClient(adapterId);
      }

      this.transportClient = transportClient;
      await transportClient.connect(config);
    } catch (error) {
      this.transportClient = null;
      throw toCharivoError("transport", error);
    }
  }

  /**
   * Creates and prepares the browser-side transport adapter for `config` up
   * front so its audio context/lip-sync analyzer is warmed inside the same
   * user-gesture call stack. `connect()` reuses this same adapter instance
   * when it is called with a matching adapter selection. Repeated calls that
   * resolve to the same adapter reuse the already-prepared instance instead
   * of creating another one.
   */
  async prepareAudio(config?: RealtimeSessionConfig): Promise<void> {
    try {
      const adapterId = this.resolveAdapterId(config);

      if (
        this.preparedAdapterId !== adapterId ||
        !this.preparedTransportClient
      ) {
        void this.discardPreparedTransportClient();
        this.preparedTransportClient = this.createTransportClient(adapterId);
        this.preparedAdapterId = adapterId;
      }

      await this.preparedTransportClient.prepareAudio?.();
    } catch (error) {
      void this.discardPreparedTransportClient();
      throw toCharivoError("transport", error);
    }
  }

  /**
   * Releases a prepared-but-never-connected adapter's audio resources
   * (e.g. its `AudioContext`) when it is superseded, mismatched, or fails.
   * `disconnect()` on these adapters is safe to call without a prior
   * `connect()` — it tears down the lip-sync analyzer unconditionally.
   * Resolves once cleanup settles; a disconnect failure is reported instead
   * of being silently swallowed, since it was never part of an active
   * session and the caller has nothing else to react to.
   */
  private discardPreparedTransportClient(): Promise<void> {
    const prepared = this.preparedTransportClient;
    this.preparedTransportClient = null;
    this.preparedAdapterId = null;

    if (!prepared || prepared === this.transportClient) {
      return Promise.resolve();
    }

    return prepared.disconnect().catch((error) => {
      console.error("Failed to release a prepared realtime adapter:", error);
    });
  }

  private createTransportClient(adapterId: string): RealtimeTransportClient {
    const factory = this.adapters.get(adapterId);

    if (!factory) {
      throw new CharivoStateError(
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

    return transportClient;
  }

  async updateSession(config?: RealtimeSessionConfig): Promise<void> {
    await this.getActiveTransportClient()
      .updateSession(config)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async recover(config?: RealtimeSessionConfig): Promise<void> {
    await this.getActiveTransportClient()
      .recover(config)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async disconnect(): Promise<void> {
    await this.discardPreparedTransportClient();

    if (!this.transportClient) {
      return;
    }

    const transportClient = this.transportClient;
    this.transportClient = null;
    await transportClient
      .disconnect()
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async sendText(text: string): Promise<void> {
    await this.getActiveTransportClient()
      .sendText(text)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async sendAudio(audio: ArrayBuffer): Promise<void> {
    await this.getActiveTransportClient()
      .sendAudio(audio)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async sendToolResult(
    callId: string,
    output: Record<string, unknown>,
  ): Promise<void> {
    await this.getActiveTransportClient()
      .sendToolResult(callId, output)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async interrupt(): Promise<void> {
    await this.getActiveTransportClient()
      .interrupt()
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  onEvent(callback: (event: RealtimeTransportEvent) => void): void {
    this.eventCallbacks.add(callback);
    this.transportClient?.onEvent(callback);

    if (
      this.preparedTransportClient &&
      this.preparedTransportClient !== this.transportClient
    ) {
      this.preparedTransportClient.onEvent(callback);
    }
  }

  private getActiveTransportClient(): RealtimeTransportClient {
    if (!this.transportClient) {
      throw new CharivoStateError("Realtime session not active");
    }

    return this.transportClient;
  }

  private resolveAdapterId(config?: RealtimeSessionConfig): string {
    if (this.config.resolveAdapterId) {
      return this.config.resolveAdapterId(config);
    }

    const transport = config?.transport ?? "webrtc";
    if (config?.provider === "openai" && transport === "webrtc") {
      return OPENAI_REALTIME_AGENTS_ADAPTER;
    }

    throw new CharivoStateError(
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
        body: JSON.stringify({
          ...request,
          adapter: options.expectedAdapterId,
        } satisfies RealtimeSessionRequest),
      },
      {
        timeoutMessage: `Realtime session request timed out after ${DEFAULT_REQUEST_TIMEOUT_MS}ms`,
        failureMessage: "Realtime request failed",
      },
    );

    if (!response.ok) {
      const errorText = await response.text();
      throw new CharivoProviderError(
        `Failed to create Realtime session: ${errorText}`,
      );
    }

    const bootstrap = (await response.json()) as unknown;
    if (!isRealtimeSessionBootstrap(bootstrap)) {
      throw new CharivoProviderError(
        "Invalid realtime session bootstrap response",
      );
    }

    if (bootstrap.adapter !== options.expectedAdapterId) {
      throw new CharivoProviderError(
        `Realtime session bootstrap adapter mismatch: expected ${options.expectedAdapterId}, received ${bootstrap.adapter}`,
      );
    }

    return bootstrap as RealtimeSessionBootstrap;
  }
}
