import type {
  Character,
  CharivoEventEmitter,
  GazeCoordinates,
  RealtimeManager as CoreRealtimeManager,
  RealtimeReconnectCause,
  RealtimeSessionConfig,
  RealtimeSessionTransitionReason,
  RealtimeState,
  RealtimeTool,
  RealtimeToolRegistration,
} from "@charivo/core";
import {
  CharivoStateError,
  subscribeBrowserLifecycle,
  toCharivoError,
} from "@charivo/core";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "./types";
import { buildRealtimeSessionConfig } from "./instructions";
import {
  LOOK_AT_TOOL_NAME,
  PLAY_MOTION_TOOL_NAME,
  SET_EXPRESSION_TOOL_NAME,
} from "./tools";

const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener?(
    type: "release",
    listener: () => void,
    options?: AddEventListenerOptions,
  ): void;
};

export interface RealtimeManagerOptions {
  defaultSessionConfig?: Omit<RealtimeSessionConfig, "tools">;
  tools?: RealtimeToolRegistration[];
  defaultToolTimeoutMs?: number;
}

/**
 * Provider-agnostic realtime manager.
 *
 * It owns session state, character-aware session config generation, tool
 * execution, and event relaying. Transport-specific event parsing belongs to
 * concrete client packages such as `@charivo/realtime/openai`.
 */
export class RealtimeManagerImpl implements CoreRealtimeManager {
  private eventEmitter?: CharivoEventEmitter;
  private character: Character | null = null;
  private isStoppingSession = false;
  private isRefreshingSession = false;
  private isRecoveringConnection = false;
  private isAudioPlaybackActive = false;
  private sessionBaseConfig?: RealtimeSessionConfig;
  private refreshInFlight: Promise<void> | null = null;
  private reconnectInFlight: Promise<void> | null = null;
  private hasQueuedRefresh = false;
  private stopRequestedDuringRefresh = false;
  private reconnectToken = 0;
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private teardownBrowserLifecycle?: () => void;
  private readonly toolRegistry = new Map<string, RealtimeToolRegistration>();
  private state: RealtimeState = {
    connection: "idle",
    session: {
      status: "idle",
      config: null,
    },
    response: {
      status: "idle",
      text: "",
    },
    lastError: null,
  };

  constructor(
    private client: RealtimeTransportClient,
    private options: RealtimeManagerOptions = {},
  ) {
    for (const tool of options.tools ?? []) {
      this.registerTool(tool);
    }

    this.installBrowserLifecycleListeners();

    this.client.onEvent((event) => {
      void this.handleClientEvent(event).catch((error) => {
        this.applyError(
          error instanceof Error ? error : new Error(String(error)),
          this.state.connection === "idle" ? "error" : this.state.connection,
        );
      });
    });
  }

  setEventEmitter(eventEmitter: CharivoEventEmitter): void {
    this.eventEmitter = eventEmitter;
  }

  setCharacter(character: Character): void {
    this.character = character;
    this.state = {
      ...this.state,
      session: {
        ...this.state.session,
        characterId: character.id,
      },
    };
    this.emitState();
  }

  registerTool(tool: RealtimeToolRegistration): void {
    this.toolRegistry.set(tool.definition.name, tool);
  }

  unregisterTool(name: string): void {
    this.toolRegistry.delete(name);
  }

  getRegisteredTools(): RealtimeTool[] {
    return Array.from(this.toolRegistry.values(), (tool) => ({
      ...tool.definition,
      parameters: {
        ...tool.definition.parameters,
        properties: { ...tool.definition.parameters.properties },
        required: tool.definition.parameters.required
          ? [...tool.definition.parameters.required]
          : undefined,
      },
    }));
  }

  getState(): RealtimeState {
    return {
      ...this.state,
      session: {
        ...this.state.session,
        config: this.state.session.config
          ? {
              ...this.state.session.config,
              tools: this.state.session.config.tools
                ? [...this.state.session.config.tools]
                : undefined,
            }
          : null,
      },
      response: {
        ...this.state.response,
      },
    };
  }

  async startSession(config?: RealtimeSessionConfig): Promise<void> {
    if (
      this.state.session.status === "active" ||
      this.state.session.status === "starting" ||
      this.refreshInFlight ||
      this.reconnectInFlight
    ) {
      throw new CharivoStateError("Realtime session already active");
    }

    this.sessionBaseConfig = this.resolveNextSessionBaseConfig(config);
    const sessionConfig = this.buildEffectiveSessionConfig();

    this.state = {
      ...this.state,
      connection: "connecting",
      session: {
        status: "starting",
        config: null,
        characterId: this.character?.id,
      },
      response: {
        status: "idle",
        text: "",
      },
      lastError: null,
    };
    this.installBrowserLifecycleListeners();
    this.emitState();

    try {
      await this.client.connect(sessionConfig);
      this.commitActiveSession(sessionConfig);
      void this.requestWakeLock();
      this.emitSessionStart("user");
    } catch (error) {
      const typedError = toCharivoError("transport", error);
      this.finalizeFailedSession(typedError);
      throw typedError;
    }
  }

  updateSession(config?: RealtimeSessionConfig): Promise<void> {
    this.sessionBaseConfig = this.resolveNextSessionBaseConfig(config);

    if (this.state.session.status !== "active") {
      return Promise.resolve();
    }

    if (this.isRecoveringConnection) {
      return Promise.resolve();
    }

    if (this.refreshInFlight) {
      this.hasQueuedRefresh = true;
      return this.refreshInFlight;
    }

    this.stopRequestedDuringRefresh = false;
    this.hasQueuedRefresh = false;
    this.refreshInFlight = this.runRefreshLoop().finally(() => {
      this.refreshInFlight = null;
      this.hasQueuedRefresh = false;
      this.stopRequestedDuringRefresh = false;
    });

    return this.refreshInFlight;
  }

  async stopSession(): Promise<void> {
    const reconnectInFlight = this.reconnectInFlight;
    this.cancelReconnectLoop();

    if (reconnectInFlight) {
      try {
        await reconnectInFlight;
      } catch {
        // Reconnect failure already updates manager state.
      }
    }

    if (this.refreshInFlight) {
      this.stopRequestedDuringRefresh = true;
      this.hasQueuedRefresh = false;

      try {
        await this.refreshInFlight;
      } catch {
        // Refresh failure already updates manager state.
      }

      if (this.state.session.status === "active") {
        await this.performStopSession().catch((error) => {
          throw toCharivoError("transport", error);
        });
      }

      return;
    }

    if (this.state.session.status !== "active") {
      return;
    }

    await this.performStopSession().catch((error) => {
      throw toCharivoError("transport", error);
    });
  }

  async sendMessage(text: string): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new CharivoStateError("Realtime session not active");
    }

    if (this.state.connection !== "connected") {
      throw new CharivoStateError("Realtime session is reconnecting");
    }

    await this.client
      .sendText(text)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async sendAudioChunk(audio: ArrayBuffer): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new CharivoStateError("Realtime session not active");
    }

    if (this.state.connection !== "connected") {
      throw new CharivoStateError("Realtime session is reconnecting");
    }

    await this.client
      .sendAudio(audio)
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
  }

  async interrupt(): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new CharivoStateError("Realtime session not active");
    }

    if (this.state.connection !== "connected") {
      throw new CharivoStateError("Realtime session is reconnecting");
    }

    await this.client
      .interrupt()
      .catch((error) => Promise.reject(toCharivoError("transport", error)));
    this.state = {
      ...this.state,
      response: {
        ...this.state.response,
        status: "interrupted",
      },
    };
    this.emitAudioEnd();
    this.emitState();
  }

  private async handleClientEvent(
    event: RealtimeTransportEvent,
  ): Promise<void> {
    switch (event.type) {
      case "session.started":
        if (
          this.state.connection === "connecting" ||
          this.isRefreshingSession ||
          this.isRecoveringConnection
        ) {
          return;
        }

        this.state = mergeRealtimeState(this.state, {
          connection: "connected",
          session: {
            status:
              this.state.session.status === "starting"
                ? "active"
                : this.state.session.status,
            config: this.state.session.config,
            characterId: this.character?.id,
          },
        });
        this.emitState();
        return;

      case "session.ended":
        if (
          this.isStoppingSession ||
          this.isRefreshingSession ||
          this.isRecoveringConnection ||
          this.state.connection === "disconnecting"
        ) {
          return;
        }

        this.finalizeStoppedSession(true, "user");
        return;

      case "connection.lost":
        this.beginReconnect(event.cause, event.error);
        return;

      case "user.transcript":
        this.eventEmitter?.emit("realtime:user:transcript", {
          text: event.text,
        });
        return;

      case "assistant.response.started":
        this.state = {
          ...this.state,
          response: {
            status: "responding",
            text: "",
          },
        };
        this.eventEmitter?.emit("realtime:assistant:start", {
          state: this.getState(),
        });
        this.emitState();
        return;

      case "assistant.text.delta":
        this.ensureResponseStarted();
        this.state = {
          ...this.state,
          response: {
            status: "responding",
            text: this.state.response.text + event.text,
          },
        };
        this.eventEmitter?.emit("realtime:text:delta", { text: event.text });
        this.eventEmitter?.emit("realtime:assistant:delta", {
          text: event.text,
        });
        this.emitState();
        return;

      case "assistant.response.completed": {
        if (this.state.response.status === "interrupted") {
          return;
        }

        const text = event.text || this.state.response.text;
        this.state = {
          ...this.state,
          response: {
            status: "completed",
            text,
          },
        };
        this.eventEmitter?.emit("realtime:assistant:done", { text });
        this.emitState();
        return;
      }

      case "audio.output.started":
        this.emitAudioStart();
        return;

      case "audio.output.ended":
        this.emitAudioEnd();
        return;

      case "audio.lipsync":
        if (event.rms > 0.001 && !this.isAudioPlaybackActive) {
          this.emitAudioStart();
        }
        this.eventEmitter?.emit("tts:lipsync:update", { rms: event.rms });
        return;

      case "tool.call":
        this.eventEmitter?.emit("realtime:tool:call", {
          name: event.name,
          args: event.args,
          callId: event.callId,
        });
        await this.executeToolCall(event);
        return;

      case "tool.result":
        this.eventEmitter?.emit("realtime:tool:result", {
          name: event.name,
          output: event.output,
          callId: event.callId,
        });
        return;

      case "state":
        this.state = mergeRealtimeState(this.state, event.state);
        this.emitState();
        return;

      case "error":
        if (
          this.isRecoveringConnection &&
          this.state.connection === "connecting"
        ) {
          this.state = {
            ...this.state,
            lastError: event.error,
          };
          this.emitState();
          return;
        }
        this.applyError(event.error, this.state.connection);
        return;
    }
  }

  private async executeToolCall(
    event: Extract<RealtimeTransportEvent, { type: "tool.call" }>,
  ): Promise<void> {
    const tool = this.toolRegistry.get(event.name);
    if (!event.callId) {
      this.emitToolError(
        event.name,
        new Error(`Tool "${event.name}" is missing a call ID`),
        event.callId,
      );
      return;
    }

    if (!tool) {
      await this.handleToolExecutionFailure(
        event.name,
        event.callId,
        new Error(`No realtime tool registered for "${event.name}"`),
      );
      return;
    }

    try {
      const output = await this.runToolHandler(tool, event);
      await this.client.sendToolResult(event.callId, output);
      this.postProcessToolResult(event.name, output);
      this.eventEmitter?.emit("realtime:tool:result", {
        name: event.name,
        output,
        callId: event.callId,
      });
    } catch (error) {
      await this.handleToolExecutionFailure(
        event.name,
        event.callId,
        error instanceof Error ? error : new Error(String(error)),
      );
    }
  }

  private async runToolHandler(
    tool: RealtimeToolRegistration,
    event: Extract<RealtimeTransportEvent, { type: "tool.call" }>,
  ): Promise<Record<string, unknown>> {
    const timeoutMs =
      tool.timeoutMs ??
      this.options.defaultToolTimeoutMs ??
      DEFAULT_TOOL_TIMEOUT_MS;
    const result = await withTimeout(
      tool.handler(event.args, {
        character: this.character,
        state: this.getState(),
        callId: event.callId,
      }),
      timeoutMs,
      tool.definition.name,
    );

    if (!isRecord(result)) {
      throw new Error(
        `Realtime tool "${tool.definition.name}" must return an object`,
      );
    }

    return result;
  }

  private async handleToolExecutionFailure(
    name: string,
    callId: string,
    error: Error,
  ): Promise<void> {
    this.emitToolError(name, error, callId);

    try {
      await this.client.sendToolResult(callId, createFailureOutput(error));
    } catch (sendError) {
      this.emitToolError(
        name,
        sendError instanceof Error ? sendError : new Error(String(sendError)),
        callId,
      );
    }
  }

  private postProcessToolResult(
    name: string,
    output: Record<string, unknown>,
  ): void {
    switch (name) {
      case SET_EXPRESSION_TOOL_NAME: {
        const expressionId = output.expressionId;
        if (typeof expressionId === "string") {
          this.eventEmitter?.emit("realtime:expression", { expressionId });
        }
        return;
      }

      case PLAY_MOTION_TOOL_NAME: {
        const group = output.group;
        const index = output.index;
        if (typeof group === "string" && Number.isInteger(index)) {
          const motionIndex = index as number;
          this.eventEmitter?.emit("realtime:motion", {
            group,
            index: motionIndex,
          });
        }
        return;
      }

      case LOOK_AT_TOOL_NAME: {
        const coords = readGazeCoordinates(output);
        if (coords) {
          this.eventEmitter?.emit("realtime:gaze", coords);
        }
        return;
      }

      default:
        return;
    }
  }

  private emitToolError(name: string, error: Error, callId?: string): void {
    this.eventEmitter?.emit("realtime:tool:error", {
      name,
      error,
      callId,
    });
  }

  private ensureResponseStarted(): void {
    if (this.state.response.status === "responding") {
      return;
    }

    this.state = {
      ...this.state,
      response: {
        status: "responding",
        text: this.state.response.text,
      },
    };
    this.eventEmitter?.emit("realtime:assistant:start", {
      state: this.getState(),
    });
  }

  private beginReconnect(cause: RealtimeReconnectCause, error?: Error): void {
    if (
      this.state.session.status !== "active" ||
      this.isStoppingSession ||
      this.state.connection === "disconnecting" ||
      this.isRecoveringConnection
    ) {
      return;
    }

    this.isRecoveringConnection = true;
    this.reconnectToken += 1;
    const reconnectToken = this.reconnectToken;

    if (this.state.response.status === "responding") {
      this.emitAudioEnd();
      this.state = {
        ...this.state,
        connection: "connecting",
        response: {
          status: "interrupted",
          text: this.state.response.text,
        },
        lastError: error ?? this.state.lastError,
      };
    } else {
      this.state = {
        ...this.state,
        connection: "connecting",
        lastError: error ?? this.state.lastError,
      };
    }

    this.emitState();
    this.reconnectInFlight = this.runReconnectLoop(reconnectToken, cause)
      .catch((reconnectError) => {
        this.finalizeFailedSession(reconnectError);
      })
      .finally(() => {
        if (this.reconnectToken === reconnectToken) {
          this.reconnectInFlight = null;
          this.isRecoveringConnection = false;
        }
      });
  }

  private async runReconnectLoop(
    reconnectToken: number,
    cause: RealtimeReconnectCause,
  ): Promise<void> {
    const startedAt = Date.now();
    let lastError = new Error("Realtime reconnect exhausted");

    for (let index = 0; index < RECONNECT_DELAYS_MS.length; index += 1) {
      const attempt = index + 1;
      const delayMs = RECONNECT_DELAYS_MS[index]!;

      this.eventEmitter?.emit("realtime:reconnect:attempt", {
        attempt,
        delayMs,
        cause,
      });

      await delay(delayMs);
      if (!this.isReconnectTokenActive(reconnectToken)) {
        return;
      }

      const sessionConfig = this.buildEffectiveSessionConfig();

      try {
        await this.client.recover(sessionConfig);
        if (!this.isReconnectTokenActive(reconnectToken)) {
          return;
        }

        this.state = {
          ...this.state,
          connection: "connected",
          session: {
            ...this.state.session,
            status: "active",
            config: sessionConfig,
            characterId: this.character?.id,
          },
          lastError: null,
        };
        this.emitState();
        void this.requestWakeLock();
        this.eventEmitter?.emit("realtime:reconnect:success", {
          attempts: attempt,
          totalMs: Date.now() - startedAt,
          cause,
        });
        return;
      } catch (error) {
        lastError = error instanceof Error ? error : new Error(String(error));
        this.state = {
          ...this.state,
          connection: "connecting",
          lastError,
        };
        this.emitState();
      }
    }

    if (!this.isReconnectTokenActive(reconnectToken)) {
      return;
    }

    this.eventEmitter?.emit("realtime:reconnect:exhausted", {
      attempts: RECONNECT_DELAYS_MS.length,
      totalMs: Date.now() - startedAt,
      cause,
      lastError,
    });

    throw lastError;
  }

  private cancelReconnectLoop(): void {
    this.reconnectToken += 1;
    this.isRecoveringConnection = false;
    this.reconnectInFlight = null;
  }

  private isReconnectTokenActive(reconnectToken: number): boolean {
    return (
      this.reconnectToken === reconnectToken &&
      this.state.session.status === "active" &&
      !this.isStoppingSession
    );
  }

  private emitState(): void {
    this.eventEmitter?.emit("realtime:state", {
      state: this.getState(),
    });
  }

  private applyError(
    error: Error,
    connection: RealtimeState["connection"],
  ): void {
    const typedError = toCharivoError("transport", error);
    this.emitAudioEnd();
    this.state = {
      ...this.state,
      connection,
      lastError: typedError,
    };
    this.eventEmitter?.emit("realtime:error", { error: typedError });
    this.emitState();
  }

  private emitAudioStart(): void {
    if (this.isAudioPlaybackActive) {
      return;
    }

    this.isAudioPlaybackActive = true;
    this.eventEmitter?.emit("tts:audio:start", {});
  }

  private emitAudioEnd(): void {
    if (!this.isAudioPlaybackActive) {
      return;
    }

    this.isAudioPlaybackActive = false;
    this.eventEmitter?.emit("tts:lipsync:update", { rms: 0 });
    this.eventEmitter?.emit("tts:audio:end", {});
  }

  private installBrowserLifecycleListeners(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: () => {
        void this.releaseWakeLock();
      },
      onPageHide: () => {
        void this.releaseWakeLock();
      },
      onPageShow: () => {
        void this.requestWakeLock();
      },
      onVisible: () => {
        void this.requestWakeLock();
      },
    });
  }

  private async requestWakeLock(): Promise<void> {
    if (
      this.state.session.status !== "active" ||
      this.state.connection === "disconnecting" ||
      typeof navigator === "undefined" ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }

    if (this.wakeLockSentinel) {
      return;
    }

    const wakeLockApi = navigator as Navigator & {
      wakeLock?: {
        request(type: "screen"): Promise<WakeLockSentinelLike>;
      };
    };

    try {
      this.wakeLockSentinel = await wakeLockApi.wakeLock?.request("screen");
      this.wakeLockSentinel?.addEventListener?.(
        "release",
        () => {
          this.wakeLockSentinel = null;
        },
        { once: true },
      );
    } catch {
      // Best-effort only.
    }
  }

  private async releaseWakeLock(): Promise<void> {
    if (!this.wakeLockSentinel) {
      return;
    }

    const wakeLockSentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;

    try {
      await wakeLockSentinel.release();
    } catch {
      // Best-effort only.
    }
  }

  private resolveNextSessionBaseConfig(
    config?: RealtimeSessionConfig,
  ): RealtimeSessionConfig | undefined {
    return mergeSessionConfig(
      this.sessionBaseConfig ?? this.options.defaultSessionConfig,
      config,
    );
  }

  private buildEffectiveSessionConfig(): RealtimeSessionConfig {
    return buildRealtimeSessionConfig({
      character: this.character,
      baseConfig: {
        ...(this.sessionBaseConfig ?? {}),
        tools: this.getRegisteredTools(),
      },
    });
  }

  private commitActiveSession(config: RealtimeSessionConfig): void {
    this.state = {
      ...this.state,
      connection: "connected",
      session: {
        status: "active",
        config,
        characterId: this.character?.id,
      },
      response: {
        status: "idle",
        text: "",
      },
      lastError: null,
    };
    this.emitState();
  }

  private commitPatchedSession(config: RealtimeSessionConfig): void {
    this.state = {
      ...this.state,
      connection: "connected",
      session: {
        ...this.state.session,
        status: "active",
        config,
        characterId: this.character?.id,
      },
      lastError: null,
    };
    this.emitState();
  }

  private async performStopSession(): Promise<void> {
    this.isStoppingSession = true;
    this.state = {
      ...this.state,
      connection: "disconnecting",
    };
    this.emitState();

    try {
      await this.client.disconnect();
      this.finalizeStoppedSession(true, "user");
    } catch (error) {
      this.finalizeFailedSession(
        error instanceof Error ? error : new Error(String(error)),
      );
      throw error;
    } finally {
      this.isStoppingSession = false;
    }
  }

  private async runRefreshLoop(): Promise<void> {
    do {
      this.hasQueuedRefresh = false;
      await this.performSessionRefresh();
    } while (this.hasQueuedRefresh && !this.stopRequestedDuringRefresh);
  }

  private async performSessionRefresh(): Promise<void> {
    const sessionConfig = this.buildEffectiveSessionConfig();

    this.isRefreshingSession = true;
    this.state = {
      ...this.state,
      lastError: null,
    };
    this.emitState();

    try {
      await this.client.updateSession(sessionConfig);
      if (this.stopRequestedDuringRefresh) {
        return;
      }

      this.commitPatchedSession(sessionConfig);
    } catch (error) {
      const refreshError =
        error instanceof Error ? error : new Error(String(error));
      const typedRefreshError = toCharivoError("transport", refreshError);
      if (this.isRecoveringConnection) {
        throw typedRefreshError;
      }

      if (
        this.state.lastError !== typedRefreshError &&
        this.state.lastError?.cause !== refreshError
      ) {
        this.applyError(typedRefreshError, "connected");
      }

      throw typedRefreshError;
    } finally {
      this.isRefreshingSession = false;
    }
  }

  private emitSessionStart(
    reason: RealtimeSessionTransitionReason,
    state: RealtimeState = this.getState(),
  ): void {
    this.eventEmitter?.emit("realtime:session:start", {
      state,
      reason,
    });
  }

  private emitSessionEnd(
    reason: RealtimeSessionTransitionReason,
    state: RealtimeState = this.getState(),
  ): void {
    this.eventEmitter?.emit("realtime:session:end", {
      state,
      reason,
    });
  }

  private finalizeFailedSession(error: Error): void {
    this.cancelReconnectLoop();
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
    void this.releaseWakeLock();
    this.emitAudioEnd();
    this.state = {
      ...this.state,
      connection: "error",
      session: {
        status: "stopped",
        config: null,
        characterId: this.character?.id,
      },
      response: {
        status: "idle",
        text: "",
      },
      lastError: error,
    };
    this.eventEmitter?.emit("realtime:error", { error });
    this.emitState();
  }

  private finalizeStoppedSession(
    emitSessionEnd: boolean,
    reason: RealtimeSessionTransitionReason,
  ): void {
    this.cancelReconnectLoop();
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
    void this.releaseWakeLock();
    this.emitAudioEnd();
    this.state = {
      ...this.state,
      connection: "idle",
      session: {
        status: "stopped",
        config: null,
        characterId: this.character?.id,
      },
      response: {
        status: "idle",
        text: "",
      },
      lastError: null,
    };
    this.emitState();

    if (emitSessionEnd) {
      this.emitSessionEnd(reason);
    }
  }
}

function readGazeCoordinates(
  output: Record<string, unknown>,
): GazeCoordinates | null {
  const x = output.x;
  const y = output.y;

  if (typeof x !== "number" || typeof y !== "number") {
    return null;
  }

  return { x, y };
}

export function createRealtimeManager(
  client: RealtimeTransportClient,
  options?: RealtimeManagerOptions,
): CoreRealtimeManager {
  return new RealtimeManagerImpl(client, options);
}

function mergeSessionConfig(
  baseConfig?: Omit<RealtimeSessionConfig, "tools">,
  overrideConfig?: RealtimeSessionConfig,
): RealtimeSessionConfig | undefined {
  if (!baseConfig && !overrideConfig) {
    return undefined;
  }

  const { tools: _ignoredOverrideTools, ...overrideWithoutTools } =
    overrideConfig ?? {};

  return {
    ...baseConfig,
    ...overrideWithoutTools,
  };
}

function mergeRealtimeState(
  current: RealtimeState,
  partial: Partial<RealtimeState>,
): RealtimeState {
  return {
    connection: partial.connection ?? current.connection,
    session: {
      status: partial.session?.status ?? current.session.status,
      config: partial.session?.config ?? current.session.config,
      characterId: partial.session?.characterId ?? current.session.characterId,
    },
    response: {
      status: partial.response?.status ?? current.response.status,
      text: partial.response?.text ?? current.response.text,
    },
    lastError: partial.lastError ?? current.lastError,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function createFailureOutput(error: Error): Record<string, unknown> {
  return {
    success: false,
    error: error.message,
  };
}

async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  toolName: string,
): Promise<T> {
  let timeoutId: ReturnType<typeof setTimeout> | undefined;

  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timeoutId = setTimeout(() => {
          reject(
            new Error(
              `Realtime tool "${toolName}" timed out after ${timeoutMs}ms`,
            ),
          );
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timeoutId !== undefined) {
      clearTimeout(timeoutId);
    }
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
