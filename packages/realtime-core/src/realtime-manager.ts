import type {
  Character,
  CharivoEventEmitter,
  RealtimeManager as CoreRealtimeManager,
  RealtimeSessionConfig,
  RealtimeState,
} from "@charivo/core";
import { Emotion } from "@charivo/core";
import type { RealtimeTransportClient, RealtimeTransportEvent } from "./types";
import { buildRealtimeSessionConfig } from "./tools";

export interface RealtimeManagerOptions {
  defaultSessionConfig?: RealtimeSessionConfig;
}

/**
 * Provider-agnostic realtime manager.
 *
 * It owns session state, character-aware session config generation, and event
 * relaying. Transport-specific event parsing belongs to concrete client
 * packages such as `@charivo/realtime-client-openai`.
 */
export class RealtimeManagerImpl implements CoreRealtimeManager {
  private eventEmitter?: CharivoEventEmitter;
  private character: Character | null = null;
  private isStoppingSession = false;
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
  private isAudioPlaybackActive = false;

  constructor(
    private client: RealtimeTransportClient,
    private options: RealtimeManagerOptions = {},
  ) {
    this.client.onEvent((event) => {
      this.handleClientEvent(event);
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

  getState(): RealtimeState {
    return {
      ...this.state,
      session: {
        ...this.state.session,
        config: this.state.session.config
          ? { ...this.state.session.config }
          : null,
      },
      response: {
        ...this.state.response,
      },
    };
  }

  async startSession(config?: RealtimeSessionConfig): Promise<void> {
    if (this.state.session.status === "active") {
      throw new Error("Realtime session already active");
    }

    const mergedConfig = mergeSessionConfig(
      this.options.defaultSessionConfig,
      config,
    );
    const sessionConfig = buildRealtimeSessionConfig({
      character: this.character,
      baseConfig: mergedConfig,
    });

    this.state = {
      ...this.state,
      connection: "connecting",
      session: {
        status: "starting",
        config: sessionConfig,
        characterId: this.character?.id,
      },
      response: {
        status: "idle",
        text: "",
      },
      lastError: null,
    };
    this.emitState();

    try {
      await this.client.connect(sessionConfig);
      this.state = {
        ...this.state,
        connection: "connected",
        session: {
          ...this.state.session,
          status: "active",
        },
      };
      this.emitState();
      this.eventEmitter?.emit("realtime:session:start", {
        state: this.getState(),
      });
    } catch (error) {
      this.applyError(
        error instanceof Error ? error : new Error(String(error)),
        "error",
      );
      throw error;
    }
  }

  async stopSession(): Promise<void> {
    if (this.state.session.status !== "active") {
      return;
    }

    this.isStoppingSession = true;
    this.state = {
      ...this.state,
      connection: "disconnecting",
    };
    this.emitState();

    try {
      await this.client.disconnect();
      this.finalizeStoppedSession(true);
    } finally {
      this.isStoppingSession = false;
    }
  }

  async sendMessage(text: string): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new Error("Realtime session not active");
    }

    await this.client.sendText(text);
  }

  async sendAudioChunk(audio: ArrayBuffer): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new Error("Realtime session not active");
    }

    await this.client.sendAudio(audio);
  }

  async interrupt(): Promise<void> {
    if (this.state.session.status !== "active") {
      throw new Error("Realtime session not active");
    }

    await this.client.interrupt();
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

  private handleClientEvent(event: RealtimeTransportEvent): void {
    switch (event.type) {
      case "session.started":
        this.state = {
          ...this.state,
          connection: "connected",
          session: {
            ...this.state.session,
            status: "active",
          },
        };
        this.emitState();
        return;

      case "session.ended":
        if (this.isStoppingSession) {
          return;
        }

        this.finalizeStoppedSession(true);
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
        this.handleBuiltInToolCall(event.name, event.args);
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
        this.applyError(event.error, this.state.connection);
        return;
    }
  }

  private handleBuiltInToolCall(
    name: string,
    args: Record<string, unknown>,
  ): void {
    if (name !== "setEmotion") {
      return;
    }

    const emotion = args.emotion;
    if (typeof emotion !== "string") {
      return;
    }

    this.eventEmitter?.emit("realtime:emotion", {
      emotion: emotion as Emotion,
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

  private emitState(): void {
    this.eventEmitter?.emit("realtime:state", {
      state: this.getState(),
    });
  }

  private applyError(
    error: Error,
    connection: RealtimeState["connection"],
  ): void {
    this.emitAudioEnd();
    this.state = {
      ...this.state,
      connection,
      lastError: error,
    };
    this.eventEmitter?.emit("realtime:error", { error });
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

  private finalizeStoppedSession(emitSessionEnd: boolean): void {
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
      this.eventEmitter?.emit("realtime:session:end", {
        state: this.getState(),
      });
    }
  }
}

export function createRealtimeManager(
  client: RealtimeTransportClient,
  options?: RealtimeManagerOptions,
): CoreRealtimeManager {
  return new RealtimeManagerImpl(client, options);
}

function mergeSessionConfig(
  baseConfig?: RealtimeSessionConfig,
  overrideConfig?: RealtimeSessionConfig,
): RealtimeSessionConfig | undefined {
  if (!baseConfig && !overrideConfig) {
    return undefined;
  }

  return {
    ...baseConfig,
    ...overrideConfig,
    tools: overrideConfig?.tools ?? baseConfig?.tools,
  };
}

function mergeRealtimeState(
  current: RealtimeState,
  partial: Partial<RealtimeState>,
): RealtimeState {
  return {
    connection: partial.connection ?? current.connection,
    session: {
      ...current.session,
      ...partial.session,
    },
    response: {
      ...current.response,
      ...partial.response,
    },
    lastError:
      partial.lastError === undefined ? current.lastError : partial.lastError,
  };
}
