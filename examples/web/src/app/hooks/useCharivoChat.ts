"use client";

import {
  useCallback,
  useEffect,
  useRef,
  type KeyboardEvent,
  type MutableRefObject,
} from "react";
import {
  type AvatarControlCatalog,
  createCharivo,
  type Charivo,
  type Character,
  type GazeCoordinates,
  type LLMClient,
  type LLMManager,
  type Message,
  type RenderManager,
  type STTManager,
  type STTTranscriber,
  type TTSManager,
  type TTSPlayer,
} from "@charivo/core";
import { createSTTManager } from "@charivo/stt";
import { REALTIME_SESSION_MAX_MS } from "../api/demo-limits";
import { createSessionCap } from "./session-cap";
import type { OpenAIRealtimeTranscriptionBootstrapFn } from "@charivo/stt/openai-realtime";
import { createTTSManager } from "@charivo/tts";
import type { Live2DRenderer } from "@charivo/render-live2d";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";

import type {
  LLMClientType,
  STTTranscriberType,
  TTSPlayerType,
} from "../types/chat";
import { useLive2D } from "./useLive2D";
import { buildDemoRealtimeInstructions } from "../lib/realtime-instructions";
import { syncAvatarControlTools } from "../lib/avatar-tools";
import { useCharacterStore } from "../stores/useCharacterStore";
import { useChatStore } from "../stores/useChatStore";
import {
  createRealtimeAssistantMessage,
  getRealtimeTurnStatus,
  shouldResetRealtimeUiState,
} from "./realtime-ui";

type Live2DRendererHandle = Live2DRenderer;

type UseCharivoChatOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

const OPENAI_TESTING_PROMPT =
  "Enter your OpenAI API key. This direct browser client is for development/testing only.";
const OPENCLAW_TESTING_PROMPT =
  "Enter your OpenClaw token. This direct browser client is for development/testing only and may be blocked by CORS.";
const REALTIME_TRANSCRIPTION_ENDPOINT = "/api/realtime-transcription";
const REALTIME_UI_DEBUG = process.env.NODE_ENV !== "production";

function logRealtimeUi(...args: unknown[]): void {
  if (REALTIME_UI_DEBUG) {
    console.info("[realtime-ui]", ...args);
  }
}

function logAvatarControl(...args: unknown[]): void {
  if (REALTIME_UI_DEBUG) {
    console.info("[avatar-control]", ...args);
  }
}

function summarizeToolApplication(
  name: string,
  output: Record<string, unknown>,
): Record<string, unknown> | null {
  switch (name) {
    case "setExpression":
      return typeof output.expressionId === "string"
        ? {
            expression: output.expressionId,
          }
        : null;

    case "playMotion":
      return typeof output.group === "string" &&
        typeof output.index === "number"
        ? {
            motion: {
              group: output.group,
              index: output.index,
            },
          }
        : null;

    case "lookAt":
      return typeof output.x === "number" && typeof output.y === "number"
        ? {
            gaze: {
              x: output.x,
              y: output.y,
            },
          }
        : null;

    default:
      return null;
  }
}

function promptForSecret(message: string, missingMessage: string): string {
  const value = window.prompt(message)?.trim();
  if (!value) {
    throw new Error(missingMessage);
  }
  return value;
}

// The streaming STT transcriber never sees a credential: it hands us its SDP
// offer, and /api/realtime-transcription mints the ephemeral secret server-side
// and returns the answer SDP.
const bootstrapRealtimeTranscription: OpenAIRealtimeTranscriptionBootstrapFn =
  async (sessionRequest) => {
    const response = await fetch(REALTIME_TRANSCRIPTION_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(sessionRequest),
    });

    const rawBody = await response.text();
    let payload: { answerSdp?: unknown; error?: unknown; details?: unknown } =
      {};
    try {
      payload = JSON.parse(rawBody);
    } catch {
      // Leave payload empty; the raw body goes into the error below.
    }

    if (!response.ok || typeof payload.answerSdp !== "string") {
      const message = [payload.error, payload.details]
        .filter((part): part is string => typeof part === "string")
        .join(": ");
      throw new Error(
        message ||
          `Transcription bootstrap failed with ${response.status}: ${rawBody}`,
      );
    }

    return { answerSdp: payload.answerSdp };
  };

async function stopRealtime(instance: Charivo | null): Promise<void> {
  const realtimeManager = instance?.getRealtimeManager();
  if (!realtimeManager) {
    return;
  }

  try {
    await realtimeManager.stopSession();
  } catch {
    // Ignore teardown errors during effect cleanup.
  }
}

function readAvatarCatalog(
  renderer: Live2DRendererHandle | null,
  expressionDescriptions?: Record<string, string>,
): AvatarControlCatalog {
  return {
    expressions: renderer?.getAvailableExpressions() ?? [],
    motions: renderer?.getAvailableMotionGroups() ?? {},
    ...(expressionDescriptions ? { expressionDescriptions } : {}),
  };
}

export function useCharivoChat({ canvasContainerRef }: UseCharivoChatOptions) {
  const { getLive2DModelPath, getExpressionDescriptions } = useCharacterStore();
  const { canvas, character } = useLive2D({ canvasContainerRef });

  const {
    charivo,
    setCharivo,
    addMessage,
    clearMessages,
    input,
    setInput,
    setIsLoading,
    setIsSpeaking,
    isRecording,
    setIsRecording,
    setIsTranscribing,
    selectedLLMClient,
    selectedTTSPlayer,
    selectedSTTTranscriber,
    setLlmError,
    setTtsError,
    setSttError,
    isRealtimeMode,
    setIsRealtimeMode,
    setIsConnecting,
    setIsConnected,
    setRealtimeError,
    setRealtimeState,
    appendRealtimeAssistantDraft,
    resetRealtimeUiState,
    setRealtimeAssistantDraft,
    setRealtimeInterruptedDraft,
    moveRealtimeDraftToInterrupted,
    setRealtimeTurnStatus,
    setAvatarCatalog,
    setAvatarDebug,
    resetAvatarDebug,
  } = useChatStore();

  const rendererRef = useRef<Live2DRendererHandle | null>(null);
  const renderManagerRef = useRef<RenderManager | null>(null);
  const llmManagerRef = useRef<LLMManager | null>(null);
  const sttManagerRef = useRef<STTManager | null>(null);
  const recordingCapRef = useRef(createSessionCap());
  const currentCharacterRef = useRef(character);
  const syncedCharacterIdRef = useRef<string | null>(null);
  const isRealtimeRefreshPendingRef = useRef(false);

  useEffect(() => {
    currentCharacterRef.current = character;
  }, [character]);

  const createLLMClient = useCallback(
    async (type: LLMClientType): Promise<LLMClient> => {
      setLlmError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteLLMClient } = await import(
              "@charivo/llm/remote"
            );
            return createRemoteLLMClient({ apiEndpoint: "/api/chat" });
          }
          case "openai": {
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI LLM client.",
            );
            const { createOpenAILLMClient } = await import(
              "@charivo/llm/openai"
            );
            return createOpenAILLMClient({ apiKey });
          }
          case "openclaw-remote": {
            const { createRemoteLLMClient } = await import(
              "@charivo/llm/remote"
            );
            return createRemoteLLMClient({ apiEndpoint: "/api/chat-openclaw" });
          }
          case "openclaw": {
            const token = promptForSecret(
              OPENCLAW_TESTING_PROMPT,
              "Token is required for the direct OpenClaw client.",
            );
            const { createOpenClawLLMClient } = await import(
              "@charivo/llm/openclaw"
            );
            return createOpenClawLLMClient({ token });
          }
          case "stub":
          default: {
            const { createStubLLMClient } = await import("@charivo/llm/stub");
            return createStubLLMClient();
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown LLM client error";
        setLlmError(`Failed to load ${type} LLM client: ${message}`);
        throw error;
      }
    },
    [setLlmError],
  );

  const createTTSPlayer = useCallback(
    async (type: TTSPlayerType): Promise<TTSPlayer | null> => {
      setTtsError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteTTSPlayer } = await import(
              "@charivo/tts/remote"
            );
            return createRemoteTTSPlayer();
          }
          case "web": {
            const { createWebTTSPlayer } = await import("@charivo/tts/web");
            return createWebTTSPlayer();
          }
          case "openai": {
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI TTS client.",
            );
            const { createOpenAITTSPlayer } = await import(
              "@charivo/tts/openai"
            );
            return createOpenAITTSPlayer({ apiKey });
          }
          case "none":
          default:
            return null;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown TTS client error";
        setTtsError(`Failed to load ${type} TTS player: ${message}`);
        throw error;
      }
    },
    [setTtsError],
  );

  const createSTTTranscriber = useCallback(
    async (type: STTTranscriberType): Promise<STTTranscriber | null> => {
      setSttError(null);

      try {
        switch (type) {
          case "remote": {
            const { createRemoteSTTTranscriber } = await import(
              "@charivo/stt/remote"
            );
            return createRemoteSTTTranscriber();
          }
          case "web": {
            const { createWebSTTTranscriber } = await import(
              "@charivo/stt/web"
            );
            return createWebSTTTranscriber();
          }
          case "openai": {
            const apiKey = promptForSecret(
              OPENAI_TESTING_PROMPT,
              "API key is required for the direct OpenAI STT client.",
            );
            const { createOpenAISTTTranscriber } = await import(
              "@charivo/stt/openai"
            );
            return createOpenAISTTTranscriber({ apiKey });
          }
          case "openai-realtime": {
            const { createOpenAIRealtimeSTTTranscriber } = await import(
              "@charivo/stt/openai-realtime"
            );
            return createOpenAIRealtimeSTTTranscriber({
              bootstrap: bootstrapRealtimeTranscription,
            });
          }
          case "none":
          default:
            return null;
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Unknown STT client error";
        setSttError(`Failed to load ${type} STT transcriber: ${message}`);
        throw error;
      }
    },
    [setSttError],
  );

  useEffect(() => {
    if (!canvas) {
      return;
    }

    let disposed = false;
    let instance: Charivo | null = null;
    let renderManager: RenderManager | null = null;
    let ttsManager: TTSManager | null = null;
    let sttManager: STTManager | null = null;

    const teardown = async () => {
      // A dep change starts the next initialize() while this one may still be
      // unwinding at an await, so the shared refs and store state can already
      // belong to a newer effect. Clear them only while this effect is still
      // the owner — renderManagerRef is set first and by every run, so it
      // stands in for the whole set. Disposing this effect's own managers
      // below stays unconditional. Same guarded-assign idiom as
      // examples/companion's teardownThisRender.
      if (renderManagerRef.current === renderManager) {
        setCharivo(null);
        rendererRef.current = null;
        renderManagerRef.current = null;
        llmManagerRef.current = null;
        syncedCharacterIdRef.current = null;
        setIsLoading(false);
        setIsSpeaking(false);
        setIsRecording(false);
        setIsTranscribing(false);
        setIsConnecting(false);
        setIsConnected(false);
        setIsRealtimeMode(false);
        setRealtimeState(null);
        setAvatarCatalog({ expressions: [], motions: {} });
        resetAvatarDebug();
        resetRealtimeUiState();
      }

      if (sttManagerRef.current === sttManager) {
        sttManagerRef.current = null;
      }

      if (ttsManager) {
        try {
          await ttsManager.stop();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }

        try {
          await ttsManager.dispose?.();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }

      if (sttManager?.isRecording()) {
        try {
          await sttManager.stop();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }

      await stopRealtime(instance);
      instance?.detachRealtime();
      instance?.detachSTT();
      instance?.detachTTS();

      if (renderManager) {
        try {
          await renderManager.destroy();
        } catch {
          // Ignore teardown errors during effect cleanup.
        }
      }
    };

    const initialize = async () => {
      try {
        const initialCharacter = currentCharacterRef.current;
        const [
          { createLive2DRenderer },
          { createRenderManager },
          { createLLMManager },
        ] = await Promise.all([
          import("@charivo/render-live2d"),
          import("@charivo/render"),
          import("@charivo/llm"),
        ]);

        const renderer = createLive2DRenderer({ canvas });
        rendererRef.current = renderer;

        renderManager = createRenderManager(renderer, {
          canvas,
          mouseTracking: "document",
        });
        renderManagerRef.current = renderManager;

        await renderManager.initialize();
        await renderManager.loadModel?.(
          getLive2DModelPath(initialCharacter.id),
        );
        const initialCatalog = readAvatarCatalog(
          renderer,
          getExpressionDescriptions(initialCharacter.id),
        );
        setAvatarCatalog(initialCatalog);
        logAvatarControl("catalog.loaded", {
          characterId: initialCharacter.id,
          expressions: initialCatalog.expressions,
          motions: initialCatalog.motions,
          expressionDescriptions: initialCatalog.expressionDescriptions,
        });

        if (disposed) {
          await teardown();
          return;
        }

        renderManager.setMessageCallback?.(
          (message: Message, owner?: Character) => {
            if (disposed) {
              return;
            }
            addMessage({ ...message, character: owner });
          },
        );

        const llmClient = await createLLMClient(selectedLLMClient);
        if (disposed) {
          await teardown();
          return;
        }

        const llmManager = createLLMManager(llmClient, {
          tools: createAvatarControlTools(initialCatalog),
          resultProjectors: [createAvatarResultProjector()],
          toolInstructions: buildAvatarControlInstructions(initialCatalog),
        });
        llmManagerRef.current = llmManager;

        const nextTtsPlayer = await createTTSPlayer(selectedTTSPlayer);
        if (nextTtsPlayer) {
          ttsManager = createTTSManager(nextTtsPlayer);
        }

        // Assign the manager above before this check so teardown can dispose
        // it; bail after it so a torn-down effect never reaches the factory.
        // Attaching a render manager that teardown already destroyed would
        // re-register the event-bus listeners its destroy() just removed.
        if (disposed) {
          await teardown();
          return;
        }

        const nextSttTranscriber = await createSTTTranscriber(
          selectedSTTTranscriber,
        );
        if (nextSttTranscriber) {
          sttManager = createSTTManager(nextSttTranscriber);
        }

        if (disposed) {
          await teardown();
          return;
        }

        // Published only once this effect is known to still be current, so a
        // stale run cannot hand its transcriber to a newer session.
        if (sttManager) {
          sttManagerRef.current = sttManager;
        }

        // TTS and STT are user-selectable and may resolve to nothing, so both
        // are built before the instance — createCharivo reads a null manager as
        // "not supplied", the same as omitting it.
        instance = createCharivo({
          renderer: renderManager,
          llm: llmManager,
          tts: ttsManager,
          stt: sttManager,
          character: initialCharacter,
        });
        syncedCharacterIdRef.current = initialCharacter.id;

        instance.on("tts:start", () => {
          if (!disposed) {
            setIsSpeaking(true);
          }
        });

        instance.on("tts:end", () => {
          if (!disposed) {
            setIsSpeaking(false);
          }
        });

        instance.on("tts:error", () => {
          if (!disposed) {
            setIsSpeaking(false);
          }
        });

        instance.on("stt:start", () => {
          if (!disposed) {
            setIsRecording(true);
          }
        });

        // Cumulative interim snapshot, not an incremental fragment: replace the
        // draft so the live text lands in the same box the final transcript
        // overwrites at stt:stop.
        instance.on("stt:partial", ({ text }) => {
          if (disposed) {
            return;
          }
          setInput(text);
        });

        instance.on("stt:stop", ({ text }) => {
          if (disposed) {
            return;
          }
          setIsRecording(false);
          setIsTranscribing(false);
          setInput(text);
        });

        instance.on("stt:error", ({ error }) => {
          if (disposed) {
            return;
          }
          setIsRecording(false);
          setIsTranscribing(false);
          setSttError(error.message);
        });

        instance.on("realtime:state", ({ state }) => {
          if (disposed) {
            return;
          }

          if (state.response.status === "interrupted") {
            moveRealtimeDraftToInterrupted();
          }

          setRealtimeState(state);
          setIsConnecting(state.connection === "connecting");
          setIsConnected(state.connection === "connected");
          setRealtimeTurnStatus(
            getRealtimeTurnStatus(state, {
              isRefreshing: isRealtimeRefreshPendingRef.current,
            }),
          );

          if (
            shouldResetRealtimeUiState(state, {
              isRefreshing: isRealtimeRefreshPendingRef.current,
            })
          ) {
            resetRealtimeUiState();
          }
        });

        instance.on("realtime:session:end", ({ reason }) => {
          if (disposed) {
            return;
          }

          if (reason === "refresh") {
            isRealtimeRefreshPendingRef.current = true;
            setRealtimeAssistantDraft(null);
            setRealtimeInterruptedDraft(null);
            setRealtimeTurnStatus("reconnecting");
            return;
          }

          isRealtimeRefreshPendingRef.current = false;
          resetRealtimeUiState();
        });

        instance.on("realtime:session:start", ({ reason }) => {
          if (disposed) {
            return;
          }

          if (reason === "refresh") {
            isRealtimeRefreshPendingRef.current = false;
            setRealtimeTurnStatus(
              getRealtimeTurnStatus(useChatStore.getState().realtimeState),
            );
          }
        });

        instance.on("realtime:assistant:start", () => {
          if (disposed) {
            return;
          }

          logRealtimeUi("assistant.start");
          setRealtimeAssistantDraft(null);
          setRealtimeInterruptedDraft(null);
        });

        instance.on("realtime:assistant:delta", ({ text }) => {
          if (disposed) {
            return;
          }

          appendRealtimeAssistantDraft(text);
        });

        instance.on("realtime:assistant:done", ({ text }) => {
          if (disposed) {
            return;
          }

          // Read the latest draft from the store because this handler may run
          // after multiple delta events and a captured value would go stale.
          const draft = useChatStore.getState().realtimeAssistantDraft;
          const finalText = draft || text;

          if (finalText.trim()) {
            logRealtimeUi("assistant.done", finalText);
            addMessage(
              createRealtimeAssistantMessage(
                finalText,
                currentCharacterRef.current,
              ),
            );
          }

          setRealtimeAssistantDraft(null);
          setRealtimeInterruptedDraft(null);
        });

        instance.on("tool:call", ({ name, args, callId }) => {
          if (disposed) {
            return;
          }

          setAvatarDebug({
            lastToolCall: {
              name,
              callId,
              args,
              at: Date.now(),
            },
          });
          logRealtimeUi("tool.call", {
            name,
            callId,
            args,
          });
        });

        instance.on("tool:result", ({ name, output, callId }) => {
          if (disposed) {
            return;
          }

          const appliedActions = summarizeToolApplication(
            name,
            output as Record<string, unknown>,
          );
          setAvatarDebug({
            lastToolResult: {
              name,
              callId,
              output: output as Record<string, unknown>,
              appliedActions,
              at: Date.now(),
            },
          });
          logRealtimeUi("tool.result", {
            name,
            callId,
            output,
            appliedActions,
          });
        });

        instance.on("tool:error", ({ name, error, callId }) => {
          if (disposed) {
            return;
          }

          logRealtimeUi("tool.error", {
            name,
            callId,
            message: error.message,
          });
        });

        instance.on("avatar:expression", ({ expressionId }) => {
          if (disposed) {
            return;
          }

          setAvatarDebug({
            lastExpression: {
              expressionId,
              at: Date.now(),
            },
          });
          logAvatarControl("expression", { expressionId });
        });

        instance.on("avatar:motion", ({ group, index }) => {
          if (disposed) {
            return;
          }

          setAvatarDebug({
            lastMotion: {
              group,
              index,
              at: Date.now(),
            },
          });
          logAvatarControl("motion", { group, index });
        });

        instance.on("avatar:gaze", ({ x, y }) => {
          if (disposed) {
            return;
          }

          setAvatarDebug({
            lastGaze: {
              x,
              y,
              at: Date.now(),
            },
          });
          logAvatarControl("gaze", { x, y });
        });

        instance.on("realtime:error", ({ error }) => {
          if (disposed) {
            return;
          }

          isRealtimeRefreshPendingRef.current = false;
          setRealtimeError(error.message);
          setRealtimeInterruptedDraft(null);

          // Read the latest realtime state at event time rather than relying on
          // a captured closure value from the effect setup.
          const latestState = useChatStore.getState().realtimeState;
          if (shouldResetRealtimeUiState(latestState)) {
            resetRealtimeUiState();
          }
        });

        clearMessages();
        setRealtimeError(null);
        setRealtimeState(null);
        isRealtimeRefreshPendingRef.current = false;
        resetAvatarDebug();
        resetRealtimeUiState();
        setCharivo(instance);
      } catch (error) {
        if (!disposed) {
          console.error("Failed to initialize chat session:", error);
        }
        await teardown();
      }
    };

    void initialize();

    return () => {
      disposed = true;
      clearMessages();
      void teardown();
    };
  }, [
    addMessage,
    canvas,
    clearMessages,
    createLLMClient,
    createSTTTranscriber,
    createTTSPlayer,
    getExpressionDescriptions,
    getLive2DModelPath,
    selectedLLMClient,
    selectedSTTTranscriber,
    selectedTTSPlayer,
    setCharivo,
    setInput,
    setIsConnected,
    setIsConnecting,
    setIsLoading,
    setIsRecording,
    setIsRealtimeMode,
    setIsSpeaking,
    setIsTranscribing,
    setLlmError,
    setRealtimeError,
    setRealtimeState,
    appendRealtimeAssistantDraft,
    resetRealtimeUiState,
    setRealtimeAssistantDraft,
    setRealtimeInterruptedDraft,
    moveRealtimeDraftToInterrupted,
    setRealtimeTurnStatus,
    setAvatarCatalog,
    setAvatarDebug,
    resetAvatarDebug,
    setSttError,
  ]);

  useEffect(() => {
    if (!charivo || !renderManagerRef.current) {
      return;
    }

    if (syncedCharacterIdRef.current === character.id) {
      return;
    }

    let cancelled = false;

    const syncCharacter = async () => {
      try {
        clearMessages();
        resetRealtimeUiState();
        resetAvatarDebug();
        setRealtimeError(null);
        charivo.clearHistory();
        charivo.setCharacter(character);
        await renderManagerRef.current?.loadModel?.(
          getLive2DModelPath(character.id),
        );
        const nextCatalog = readAvatarCatalog(
          rendererRef.current,
          getExpressionDescriptions(character.id),
        );
        setAvatarCatalog(nextCatalog);
        logAvatarControl("catalog.loaded", {
          characterId: character.id,
          expressions: nextCatalog.expressions,
          motions: nextCatalog.motions,
          expressionDescriptions: nextCatalog.expressionDescriptions,
        });

        if (cancelled) {
          return;
        }

        syncedCharacterIdRef.current = character.id;

        const llmManager = llmManagerRef.current;
        if (llmManager) {
          syncAvatarControlTools(llmManager, nextCatalog);
          llmManager.setToolInstructions?.(
            buildAvatarControlInstructions(nextCatalog),
          );
        }

        if (isRealtimeMode) {
          const realtimeManager = charivo.getRealtimeManager();
          if (realtimeManager?.getState().session.status === "active") {
            logAvatarControl("catalog.sync", {
              characterId: character.id,
              expressions: nextCatalog.expressions,
              motions: nextCatalog.motions,
            });
            syncAvatarControlTools(realtimeManager, nextCatalog);
            // Pre-mark the UI before refresh lifecycle events land so the
            // avatar switch does not briefly fall back to a stale ready state.
            isRealtimeRefreshPendingRef.current = true;
            setRealtimeAssistantDraft(null);
            setRealtimeInterruptedDraft(null);
            setRealtimeTurnStatus("reconnecting");
            await realtimeManager.updateSession({
              instructions: buildDemoRealtimeInstructions(
                character,
                nextCatalog,
              ),
            });
          }
        }
      } catch (error) {
        if (cancelled) {
          return;
        }

        isRealtimeRefreshPendingRef.current = false;
        setRealtimeError(
          error instanceof Error
            ? error.message
            : "Failed to sync character session",
        );
      }
    };

    void syncCharacter();

    return () => {
      cancelled = true;
    };
  }, [
    character,
    charivo,
    clearMessages,
    getExpressionDescriptions,
    getLive2DModelPath,
    isRealtimeMode,
    resetRealtimeUiState,
    setRealtimeAssistantDraft,
    setRealtimeInterruptedDraft,
    setRealtimeTurnStatus,
    setRealtimeError,
    setAvatarCatalog,
    resetAvatarDebug,
  ]);

  const handleSend = useCallback(async () => {
    if (!charivo || !input.trim()) {
      return;
    }

    const userMessage = input;
    setInput("");
    setIsLoading(true);

    try {
      await charivo.userSay(userMessage);
    } catch (error) {
      setLlmError(
        error instanceof Error ? error.message : "Failed to send message",
      );
    } finally {
      setIsLoading(false);
    }
  }, [charivo, input, setInput, setIsLoading, setLlmError]);

  const handleKeyPress = useCallback(
    (event: KeyboardEvent<HTMLInputElement>) => {
      if (event.key === "Enter" && !event.shiftKey) {
        event.preventDefault();
        if (isRealtimeMode && charivo) {
          const realtimeManager = charivo.getRealtimeManager();
          if (realtimeManager && input.trim()) {
            void realtimeManager.sendMessage(input);
            setInput("");
          }
        } else {
          void handleSend();
        }
      }
    },
    [charivo, handleSend, input, isRealtimeMode, setInput],
  );

  const playExpression = useCallback(
    (expressionId: string) => {
      // Routed through the event bus (not rendererRef directly) so the
      // RenderManager stays the single owner of expression state, including
      // its auto-release timer.
      charivo?.emit("avatar:expression", { expressionId });
    },
    [charivo],
  );

  const playMotion = useCallback((group: string, index: number) => {
    rendererRef.current?.playMotionByGroup(group, index);
  }, []);

  const playGaze = useCallback((coords: GazeCoordinates) => {
    rendererRef.current?.lookAt(coords);
  }, []);

  const getAvailableExpressions = useCallback((): string[] => {
    return rendererRef.current?.getAvailableExpressions() ?? [];
  }, []);

  const getAvailableMotionGroups = useCallback((): Record<string, number> => {
    return rendererRef.current?.getAvailableMotionGroups() ?? {};
  }, []);

  const recordingCap = recordingCapRef.current;

  const clearRecordingCap = useCallback(() => {
    recordingCap.clear();
  }, [recordingCap]);

  const handleStopRecording = useCallback(async () => {
    clearRecordingCap();

    if (!sttManagerRef.current || !isRecording) {
      return;
    }

    try {
      setIsTranscribing(true);
      await sttManagerRef.current.stop();
    } catch (error) {
      setSttError(
        error instanceof Error ? error.message : "Transcription failed",
      );
      setIsRecording(false);
      setIsTranscribing(false);
    }
  }, [
    isRecording,
    setIsRecording,
    setIsTranscribing,
    setSttError,
    clearRecordingCap,
  ]);

  const handleStartRecording = useCallback(async () => {
    if (!sttManagerRef.current) {
      setSttError(
        "STT is not initialized. Use the remote/browser path or provide a direct-testing API key.",
      );
      return;
    }

    try {
      setSttError(null);
      await sttManagerRef.current.start();

      // The streaming transcriber holds an open, wall-clock-billed realtime
      // session for as long as it records, so an abandoned tab bills until the
      // browser is closed. Same courtesy cap as a realtime voice session; on
      // the batch and browser-native paths it simply bounds the clip.
      recordingCap.arm(REALTIME_SESSION_MAX_MS);
    } catch (error) {
      setSttError(error instanceof Error ? error.message : "Recording failed");
      setIsRecording(false);
    }
  }, [setIsRecording, setSttError, recordingCap]);

  // The cap must call the CURRENT stop handler, not the one that existed when it
  // was armed -- see session-cap.ts. Arming happens inside handleStartRecording,
  // where isRecording is still false, so the handler captured there would no-op.
  useEffect(() => {
    recordingCap.update(handleStopRecording);
  }, [recordingCap, handleStopRecording]);

  // An unmount mid-recording must not leave the cap armed.
  useEffect(() => recordingCap.clear, [recordingCap]);

  return {
    handleSend,
    handleKeyPress,
    handleStartRecording,
    handleStopRecording,
    playExpression,
    playMotion,
    playGaze,
    getAvailableExpressions,
    getAvailableMotionGroups,
  };
}
