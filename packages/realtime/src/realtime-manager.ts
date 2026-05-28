import type {
  Character,
  CharivoEventEmitter,
  RealtimeManager as CoreRealtimeManager,
  RealtimeReconnectCause,
  RealtimeSessionConfig,
  RealtimeSessionTransitionReason,
  RealtimeState,
  RealtimeTool,
  RealtimeToolRegistration,
  RealtimeUsageEvent,
} from "@charivo/core";
import { CharivoStateError, toCharivoError } from "@charivo/core";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "./types";
import { buildRealtimeSessionConfig } from "./instructions";
import { RealtimeAudioOutput } from "./internal/audio-output";
import { RealtimeBrowserLifecycle } from "./internal/browser-lifecycle";
import {
  createRealtimeSessionId,
  mergeRealtimeState,
  mergeSessionConfig,
} from "./internal/manager-state";
import { delay } from "./internal/timing";
import { RealtimeToolRegistry } from "./internal/tool-registry";
import {
  executeRealtimeToolCall,
  type RealtimeToolResultProjector,
} from "./internal/tool-runner";

export type {
  RealtimeToolResultProjector,
  RealtimeToolResultProjectorContext,
} from "./internal/tool-runner";

const DEFAULT_TOOL_TIMEOUT_MS = 10_000;
const RECONNECT_DELAYS_MS = [500, 1_000, 2_000, 4_000, 5_000] as const;

export interface RealtimeManagerOptions {
  defaultSessionConfig?: Omit<RealtimeSessionConfig, "tools">;
  tools?: RealtimeToolRegistration[];
  defaultToolTimeoutMs?: number;
  resultProjectors?: RealtimeToolResultProjector[];
  logger?: RealtimeLogger;
}

export interface RealtimeLogger {
  debug?(message: string, context?: Record<string, unknown>): void;
  info?(message: string, context?: Record<string, unknown>): void;
  warn?(message: string, context?: Record<string, unknown>): void;
  error?(message: string, context?: Record<string, unknown>): void;
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
  private sessionBaseConfig?: RealtimeSessionConfig;
  private refreshInFlight: Promise<void> | null = null;
  private reconnectInFlight: Promise<void> | null = null;
  private hasQueuedRefresh = false;
  private stopRequestedDuringRefresh = false;
  private reconnectToken = 0;
  private sessionId?: string;
  private readonly toolRegistry = new RealtimeToolRegistry();
  private readonly audioOutput = new RealtimeAudioOutput((event, payload) => {
    this.eventEmitter?.emit(event, payload);
  });
  private readonly browserLifecycle = new RealtimeBrowserLifecycle(
    () => this.state,
  );
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

    this.browserLifecycle.install();

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
    this.toolRegistry.register(tool);
    this.requestToolRefresh();
  }

  unregisterTool(name: string): void {
    this.toolRegistry.unregister(name);
    this.requestToolRefresh();
  }

  getRegisteredTools(): RealtimeTool[] {
    return this.toolRegistry.getDefinitions();
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
    this.sessionId = createRealtimeSessionId();

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
    this.browserLifecycle.install();
    this.emitState();

    try {
      await this.client.connect(sessionConfig);
      this.commitActiveSession(sessionConfig);
      void this.browserLifecycle.requestWakeLock();
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

    if (this.state.response.status === "responding") {
      throw new CharivoStateError(
        "Response already in progress. Call interrupt() before sending a new message.",
      );
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
    this.audioOutput.end();
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
        this.emitUsageEvent(event);
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
        this.audioOutput.start();
        return;

      case "audio.output.ended":
        this.audioOutput.end();
        return;

      case "audio.lipsync":
        if (event.rms > 0.001 && !this.audioOutput.isActive()) {
          this.audioOutput.start();
        }
        this.eventEmitter?.emit("tts:lipsync:update", { rms: event.rms });
        return;

      case "tool.call":
        this.eventEmitter?.emit("realtime:tool:call", {
          name: event.name,
          args: event.args,
          callId: event.callId,
        });
        await executeRealtimeToolCall({
          event,
          tool: this.toolRegistry.get(event.name),
          client: this.client,
          character: this.character,
          state: this.getState(),
          defaultToolTimeoutMs:
            this.options.defaultToolTimeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
          resultProjectors: this.options.resultProjectors,
          emit: (eventName, payload) => {
            this.eventEmitter?.emit(eventName, payload);
          },
          log: (level, message, context) => {
            this.log(level, message, context);
          },
        });
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
      this.audioOutput.end();
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
    this.log("warn", "Realtime reconnect started", {
      cause,
      connection: this.state.connection,
    });
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
      this.log("info", "Realtime reconnect attempt", {
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
        void this.browserLifecycle.requestWakeLock();
        this.eventEmitter?.emit("realtime:reconnect:success", {
          attempts: attempt,
          totalMs: Date.now() - startedAt,
          cause,
        });
        this.log("info", "Realtime reconnect succeeded", {
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
    this.log("error", "Realtime reconnect exhausted", {
      attempts: RECONNECT_DELAYS_MS.length,
      totalMs: Date.now() - startedAt,
      cause,
      error: lastError.message,
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
    this.audioOutput.end();
    this.state = {
      ...this.state,
      connection,
      lastError: typedError,
    };
    this.eventEmitter?.emit("realtime:error", { error: typedError });
    this.emitState();
    this.log("error", "Realtime transport error surfaced", {
      connection,
      error: typedError.message,
    });
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

  private requestToolRefresh(): void {
    if (this.state.session.status !== "active") return;
    this.updateSession().catch(() => {
      // performSessionRefresh calls applyError (which emits realtime:error
      // and sets state.lastError) before rethrowing; swallow here to avoid
      // an unhandled rejection.
    });
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
    this.log("debug", "Realtime session patch started", {
      voice: sessionConfig.voice,
      model: sessionConfig.model,
    });

    try {
      await this.client.updateSession(sessionConfig);
      if (this.stopRequestedDuringRefresh) {
        return;
      }

      this.commitPatchedSession(sessionConfig);
      this.log("info", "Realtime session patch succeeded", {
        voice: sessionConfig.voice,
        model: sessionConfig.model,
      });
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
      this.log("error", "Realtime session patch failed", {
        error: typedRefreshError.message,
      });

      throw typedRefreshError;
    } finally {
      this.isRefreshingSession = false;
    }
  }

  private emitSessionStart(
    reason: RealtimeSessionTransitionReason,
    state: RealtimeState = this.getState(),
  ): void {
    this.log("info", "Realtime session started", {
      reason,
      connection: state.connection,
    });
    this.eventEmitter?.emit("realtime:session:start", {
      state,
      reason,
    });
  }

  private emitSessionEnd(
    reason: RealtimeSessionTransitionReason,
    state: RealtimeState = this.getState(),
  ): void {
    this.log("info", "Realtime session ended", {
      reason,
      connection: state.connection,
    });
    this.eventEmitter?.emit("realtime:session:end", {
      state,
      reason,
    });
  }

  private finalizeFailedSession(error: Error): void {
    this.cancelReconnectLoop();
    this.browserLifecycle.dispose();
    this.audioOutput.end();
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
    this.log("error", "Realtime session failed", {
      error: error.message,
    });
    this.sessionId = undefined;
  }

  private finalizeStoppedSession(
    emitSessionEnd: boolean,
    reason: RealtimeSessionTransitionReason,
  ): void {
    this.cancelReconnectLoop();
    this.browserLifecycle.dispose();
    this.audioOutput.end();
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

    this.sessionId = undefined;
  }

  private emitUsageEvent(
    event: Extract<
      RealtimeTransportEvent,
      { type: "assistant.response.completed" }
    >,
  ): void {
    if (!event.usage) {
      return;
    }

    const payload: RealtimeUsageEvent = {
      usage: event.usage,
      model: event.model,
      responseId: event.responseId,
      sessionId: this.sessionId,
    };

    this.eventEmitter?.emit("realtime:usage", payload);
    this.log("debug", "Realtime usage reported", {
      model: event.model,
      responseId: event.responseId,
    });
  }

  private log(
    level: keyof RealtimeLogger,
    message: string,
    context?: Record<string, unknown>,
  ): void {
    const mergedContext =
      this.sessionId === undefined
        ? context
        : {
            ...context,
            sessionId: this.sessionId,
          };

    this.options.logger?.[level]?.(message, mergedContext);
  }
}

export function createRealtimeManager(
  client: RealtimeTransportClient,
  options?: RealtimeManagerOptions,
): CoreRealtimeManager {
  return new RealtimeManagerImpl(client, options);
}
