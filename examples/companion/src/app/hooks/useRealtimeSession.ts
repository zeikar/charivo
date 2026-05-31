"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Charivo,
  type Character,
  type RealtimeState,
  type RenderManager,
} from "@charivo/core";
import {
  createRealtimeManager,
  buildRealtimeSessionConfig,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { composeInstructions } from "../lib/compose-instructions";
import { createWriteJobScheduler } from "@/memory/trigger";
import { getClientMemoryStore } from "@/memory/client-store";
import { createFakeEmbedder } from "@/memory/embedding";
import { createServerExtractor } from "@/memory/server-extractor";
import { promoteSession } from "@/memory/promote";
import { buildMemoryInstructionBlock } from "@/memory/build-memory-block";
import type { Turn } from "@/memory/promotion-types";

const COMPANION_DEMO_GUIDANCE = `
Keep replies short and natural for a live voice demo.
Favor subtle reactions over big repeated motions unless the moment clearly calls for emphasis.
`.trim();

const DEFAULT_CHARACTER: Character = {
  id: "companion-default",
  name: "Hiyori",
  description: "A thoughtful and gentle character with a calm demeanor",
  personality:
    "Soft-spoken, empathetic, and caring. Takes time to listen and respond thoughtfully. Uses polite and soothing language, creating a comfortable atmosphere.",
  voice: { voiceId: "marin", rate: 1.0, pitch: 1.2, volume: 0.8 },
};

// The single field that selects the rendered model. Decoupled from Character.id
// (which is the stable memory scope key) and from Character.name (presentation).
const LIVE2D_MODEL_PATH = "/live2d/Hiyori/Hiyori.model3.json";

// Read (inject): build the memory block directly from the browser-local store.
// The whole memory engine is pure TS and runs client-side — no server round
// trip. Returns "" on any failure so a memory hiccup never blocks the session.
async function readMemoryBlock(
  scope: { userId: string; characterId: string },
  query?: string,
): Promise<string> {
  try {
    const store = getClientMemoryStore();
    const queryEmbedding =
      query !== undefined ? await createFakeEmbedder().embed(query) : undefined;
    return await buildMemoryInstructionBlock({
      store,
      scope,
      now: Date.now(),
      queryEmbedding,
    });
  } catch (error) {
    console.warn("[realtime-session] readMemoryBlock failed", error);
    return "";
  }
}

/**
 * Write (promote): run the promotion pipeline against the browser-local store.
 * Rejects on a pipeline error so the write scheduler's runJob sees the failure
 * (it catches and keeps the session schedulable). promoteSession is idempotent,
 * so the cumulative-transcript resends are safe.
 */
async function runPromote(payload: {
  scope: { userId: string; characterId: string };
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  turns: Turn[];
  finalize: boolean;
}): Promise<void> {
  await promoteSession({
    transcript: {
      sessionId: payload.sessionId,
      scope: payload.scope,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      turns: payload.turns,
    },
    store: getClientMemoryStore(),
    embedder: createFakeEmbedder(),
    extractor: createServerExtractor(),
    now: Date.now(),
    finalize: payload.finalize,
  });
}

function logSession(...args: unknown[]): void {
  if (process.env.NODE_ENV !== "production") {
    console.info("[realtime-session]", ...args);
  }
}

export interface UseRealtimeSessionResult {
  isConnected: boolean;
  isConnecting: boolean;
  transcript: string;
  start: () => Promise<void>;
  stop: () => Promise<void>;
  sendMessage: (text: string) => Promise<boolean>;
  interrupt: () => Promise<void>;
}

export function useRealtimeSession(
  canvas: HTMLCanvasElement | null,
  character?: Character,
): UseRealtimeSessionResult {
  const resolvedCharacter = useMemo(
    () => character ?? DEFAULT_CHARACTER,
    [character],
  );

  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [transcript, setTranscript] = useState("");

  const isConnectedRef = useRef(false);
  const isConnectingRef = useRef(false);
  // Tracks whether the component is currently mounted. Set to true on effect
  // setup and false on cleanup so Strict Mode's double-invoke correctly restores
  // the flag, and any in-flight startSession can detect a real unmount.
  const mountedRef = useRef(false);

  const managerRef = useRef<ReturnType<typeof createRealtimeManager> | null>(
    null,
  );
  // Charivo owns the internal EventBus; the renderer + realtime manager are
  // both attached to it so lip-sync and avatar control are wired automatically.
  const charivoRef = useRef<Charivo | null>(null);
  const renderManagerRef = useRef<RenderManager | null>(null);
  // The Live2D renderer handle is kept so the avatar control catalog can be read
  // off it (expressions / motion groups) after the model loads.
  const rendererRef = useRef<{
    getAvailableExpressions?: () => string[];
    getAvailableMotionGroups?: () => Record<string, number>;
  } | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const firstUtteranceHandledRef = useRef(false);

  // Write path: capture turns and flush them through the idempotent write-job
  // scheduler at checkpoints / on session end. The scheduler is recreated per
  // session so its runJob closes over that session's scope + startedAt.
  const schedulerRef = useRef<ReturnType<
    typeof createWriteJobScheduler
  > | null>(null);
  const turnsRef = useRef<Turn[]>([]);
  const sessionIdRef = useRef<string>("");
  const startedAtRef = useRef<number>(0);
  // Kept so stop() can build the runPromote payload without closing over the
  // start() local; updated at the top of every start() call.
  const scopeRef = useRef<{ userId: string; characterId: string } | null>(null);
  // Single-slot retry for a failed final write. Decoupled from the live session
  // refs so a reconnect (new start()) or unmount cannot clobber the snapshot.
  // Flushed fire-and-forget at the top of the next start(), or on unmount.
  const pendingFailedWriteRef = useRef<{
    scope: { userId: string; characterId: string };
    sessionId: string;
    startedAt: number;
    turns: Turn[];
  } | null>(null);
  // Guards against concurrent retry attempts (both start() and unmount can
  // trigger flushPendingFailedWrite; only one should be in-flight at a time).
  const retryInFlightRef = useRef(false);
  // Ref to the per-session user-utterance handler so sendMessage (text path) can
  // record user turns via the same code path as voice (onUserTranscript). Reset
  // to null at session start; assigned once the session is wired up.
  const recordUserUtteranceRef = useRef<((text: string) => void) | null>(null);

  // Fire-and-forget retry for the single-slot failed final write. Clears the
  // slot only on success so a still-failing retry leaves the snapshot queued
  // for the next start() / unmount attempt. The in-flight guard prevents two
  // concurrent attempts from racing (start() and unmount can both trigger this).
  const flushPendingFailedWrite = () => {
    const pending = pendingFailedWriteRef.current;
    if (!pending || retryInFlightRef.current) return;
    retryInFlightRef.current = true;
    runPromote({ ...pending, endedAt: Date.now(), finalize: true })
      .then(() => {
        // Only clear the slot if the same snapshot is still queued — a later
        // failed session may have replaced it while this retry was in-flight.
        if (pendingFailedWriteRef.current === pending) {
          pendingFailedWriteRef.current = null;
        }
      })
      .catch(() => {
        // Leave the snapshot queued for the next start() / unmount retry.
      })
      .finally(() => {
        retryInFlightRef.current = false;
      });
  };

  // Single owner of resource teardown so the four cleanup paths (stop, mid-start
  // unmount guard, start() catch, unmount effect) cannot drift. Touches only refs
  // — never UI state, the scheduler's memory finalization, or pendingFailedWriteRef.
  // Each step is guarded so a null ref is a no-op and one step's error cannot mask
  // another.
  // surfaceErrors: true (user-initiated stop) logs unconditionally via console.error;
  // omitted/false (cleanup paths) logs dev-only via console.warn. Never rethrows.
  const teardownSession = async (options?: { surfaceErrors?: boolean }) => {
    const surfaceErrors = options?.surfaceErrors ?? false;
    unsubscribeRef.current?.();
    unsubscribeRef.current = null;
    schedulerRef.current = null;
    recordUserUtteranceRef.current = null;
    firstUtteranceHandledRef.current = false;
    await managerRef.current?.stopSession().catch((error: unknown) => {
      if (surfaceErrors) {
        console.error("[realtime-session] Failed to stop session:", error);
      } else if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[realtime-session] stopSession during teardown failed",
          error,
        );
      }
    });
    try {
      await renderManagerRef.current?.destroy();
    } catch (error) {
      if (surfaceErrors) {
        console.error(
          "[realtime-session] renderManager.destroy during teardown failed",
          error,
        );
      } else if (process.env.NODE_ENV !== "production") {
        console.warn(
          "[realtime-session] renderManager.destroy during teardown failed",
          error,
        );
      }
    }
    charivoRef.current = null;
    managerRef.current = null;
    renderManagerRef.current = null;
    rendererRef.current = null;
  };

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // Unmount finalization routes through the scheduler so it cannot overlap
      // an in-flight checkpoint (one-in-flight serialization). The write itself
      // is a local promoteSession (localStorage, no network), so it resolves in
      // a microtask — there is no request to cancel. stop() remains the primary
      // finalize path (snapshot + retry while mounted).
      if (schedulerRef.current) {
        schedulerRef.current.onSessionEnd(sessionIdRef.current).catch(() => {});
        schedulerRef.current = null;
      }
      // Re-attempt any retained failed write from the previous stop() call.
      flushPendingFailedWrite();
      void teardownSession();
    };
  }, []);

  const start = useCallback(async () => {
    // Guard on the canvas before any connection-state mutation so a missing
    // canvas cannot wedge the UI into a stuck "connecting" state.
    if (!canvas) {
      console.warn("[realtime-session] No canvas yet");
      return;
    }

    if (isConnectingRef.current || isConnectedRef.current) {
      console.warn("[realtime-session] Already connecting or connected");
      return;
    }

    // Re-attempt any failed final write from the previous session before
    // installing new session refs. Fire-and-forget — the new session proceeds
    // regardless, and promoteSession is idempotent so a re-POST is safe.
    flushPendingFailedWrite();

    isConnectingRef.current = true;
    setIsConnecting(true);
    setTranscript("");
    firstUtteranceHandledRef.current = false;
    recordUserUtteranceRef.current = null;

    try {
      // Build the render + orchestrator stack before wiring events. The render
      // packages are browser-only, so they are dynamically imported; Charivo is a
      // static import.
      const [
        { Live2DRenderer },
        { createRenderManager },
        {
          createAvatarControlTools,
          createAvatarResultProjector,
          buildAvatarControlInstructions,
        },
      ] = await Promise.all([
        import("@charivo/render-live2d"),
        import("@charivo/render"),
        import("@charivo/realtime-avatar"),
      ]);

      const renderer = new Live2DRenderer({ canvas });
      const renderManager = createRenderManager(renderer, {
        canvas,
        mouseTracking: "document",
      });
      // Assign refs immediately so teardownSession can destroy them even if
      // initialize() or loadModel() throws below.
      rendererRef.current = renderer;
      renderManagerRef.current = renderManager;
      await renderManager.initialize();
      await renderManager.loadModel?.(LIVE2D_MODEL_PATH);

      const catalog = {
        expressions: renderer.getAvailableExpressions?.() ?? [],
        motions: renderer.getAvailableMotionGroups?.() ?? {},
      };

      const client = createRemoteRealtimeClient({
        apiEndpoint: "/api/realtime",
        debug: process.env.NODE_ENV !== "production",
      });

      const manager = createRealtimeManager(client, {
        tools: createAvatarControlTools(catalog),
        resultProjectors: [createAvatarResultProjector()],
      });

      // One Charivo instance owns the internal bus; attaching the renderer and the
      // realtime manager wires lip-sync + avatar control automatically.
      const charivo = new Charivo();
      charivo.setCharacter(resolvedCharacter);
      charivo.attachRenderer(renderManager);
      charivo.attachRealtime(manager);
      charivoRef.current = charivo;

      // "local-user" is a fixed placeholder: there is no auth, so userId is not
      // a real identity. Isolation comes from localStorage being per-browser —
      // each browser profile has its own memory namespace. characterId still
      // partitions memory per character. See examples/companion/README.md.
      const scope = { userId: "local-user", characterId: resolvedCharacter.id };
      scopeRef.current = scope;
      const personaInstructions = buildRealtimeSessionConfig({
        character: resolvedCharacter,
      }).instructions;

      // Fresh write-job scheduler per session. runJob promotes the cumulative
      // transcript into the browser-local store; the scheduler coalesces fires
      // and never overlaps runs. promoteSession is idempotent, so cumulative
      // resends are safe.
      const sessionId = crypto.randomUUID();
      sessionIdRef.current = sessionId;
      startedAtRef.current = Date.now();
      turnsRef.current = [];
      const scheduler = createWriteJobScheduler({
        runJob: (sid, { finalize }) =>
          runPromote({
            scope,
            sessionId: sid,
            startedAt: startedAtRef.current,
            endedAt: finalize ? Date.now() : null,
            turns: turnsRef.current,
            finalize,
          }),
      });
      schedulerRef.current = scheduler;

      const recordTurn = (role: "user" | "assistant", text: string) => {
        const turns = turnsRef.current;
        turns.push({ id: `turn_${turns.length}`, role, text, at: Date.now() });
        // Checkpoint scheduling only; the scheduler swallows runJob failures.
        void scheduler.onTurn(sessionId, turns.length);
      };

      const onState = (data: { state: RealtimeState }) => {
        const conn = data.state.connection;
        isConnectedRef.current = conn === "connected";
        isConnectingRef.current = conn === "connecting";
        setIsConnected(conn === "connected");
        setIsConnecting(conn === "connecting");
        logSession("state", conn);
      };

      // Reset transcript at the start of each new response so interrupted
      // partial text does not bleed into the next response's deltas.
      const onAssistantStart = () => {
        setTranscript("");
      };

      const onDelta = (data: { text: string }) => {
        setTranscript((prev) => prev + data.text);
      };

      const onDone = (data: { text: string }) => {
        setTranscript(data.text);
        recordTurn("assistant", data.text);
        logSession("assistant:done", data.text.slice(0, 60));
      };

      // Records every user utterance as a turn AND, on the FIRST one only,
      // refreshes the session instructions with query-relevant memory.
      const onUserTranscript = (data: { text: string }) => {
        recordTurn("user", data.text);
        if (firstUtteranceHandledRef.current) return;
        firstUtteranceHandledRef.current = true;
        void (async () => {
          try {
            const refreshedBlock = await readMemoryBlock(scope, data.text);
            const instructions = composeInstructions([
              personaInstructions,
              COMPANION_DEMO_GUIDANCE,
              buildAvatarControlInstructions(catalog),
              refreshedBlock,
            ]);
            await manager.updateSession({ instructions });
          } catch (error) {
            console.warn(
              "[realtime-session] onUserTranscript refresh failed",
              error,
            );
          }
        })();
      };

      // Expose the user-utterance handler so the text-chat sendMessage path can
      // record typed turns through the same logic. The remote transport does not
      // echo typed text back as a transcript, so there is no double-count risk.
      recordUserUtteranceRef.current = (text: string) =>
        onUserTranscript({ text });

      charivo.on("realtime:state", onState);
      charivo.on("realtime:assistant:start", onAssistantStart);
      charivo.on("realtime:assistant:delta", onDelta);
      charivo.on("realtime:assistant:done", onDone);
      charivo.on("realtime:user:transcript", onUserTranscript);

      unsubscribeRef.current = () => {
        charivo.off("realtime:state", onState);
        charivo.off("realtime:assistant:start", onAssistantStart);
        charivo.off("realtime:assistant:delta", onDelta);
        charivo.off("realtime:assistant:done", onDone);
        charivo.off("realtime:user:transcript", onUserTranscript);
      };

      managerRef.current = manager;

      const memoryBlock = await readMemoryBlock(scope);
      const instructions = composeInstructions([
        personaInstructions,
        COMPANION_DEMO_GUIDANCE,
        buildAvatarControlInstructions(catalog),
        memoryBlock,
      ]);

      await renderManager.prepareAudio?.();

      await manager.startSession({
        provider: "openai",
        model: "gpt-realtime-mini",
        instructions,
        // Enable input transcription so `conversation.item.input_audio_transcription.completed`
        // fires and the manager emits `realtime:user:transcript`. Without this
        // OpenAI defaults transcription OFF, which silences onUserTranscript entirely.
        inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      });

      // If the component unmounted while the connection was in-flight, tear the
      // session down immediately so microphone/WebRTC/render resources are not leaked.
      if (!mountedRef.current) {
        await teardownSession();
        return;
      }

      logSession("session started");
    } catch (error) {
      await teardownSession();
      console.error("[realtime-session] Failed to start session:", error);
      isConnectingRef.current = false;
      isConnectedRef.current = false;
      setIsConnecting(false);
      setIsConnected(false);
    }
  }, [resolvedCharacter, canvas]);

  const stop = useCallback(async () => {
    // Unsubscribe FIRST so no further turns are recorded, then flush the final
    // write with the now-frozen transcript. A memory write failure must never
    // block stopping the realtime session.
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }

    const scheduler = schedulerRef.current;
    schedulerRef.current = null;
    if (scheduler) {
      const finalized = await scheduler.onSessionEnd(sessionIdRef.current);
      if (!finalized) {
        // The final promote failed (scheduler logged the error in dev — B6).
        // Snapshot the frozen transcript into the decoupled retry slot so it
        // survives a reconnect (which overwrites sessionIdRef/turnsRef).
        // The live refs are always cleared below regardless.
        pendingFailedWriteRef.current = {
          scope: scopeRef.current ?? {
            userId: "local-user",
            characterId: "companion-default",
          },
          sessionId: sessionIdRef.current,
          startedAt: startedAtRef.current,
          turns: [...turnsRef.current],
        };
        if (process.env.NODE_ENV !== "production") {
          console.warn(
            "[realtime-session] final memory write failed — transcript snapshot retained for best-effort retry",
          );
        }
      }
    }

    // Resource teardown happens exactly once, through the shared helper: it owns
    // manager stop + render destroy + nulling managerRef/renderManagerRef/
    // charivoRef/rendererRef. UI state is reset only after it has awaited.
    await teardownSession({ surfaceErrors: true });

    turnsRef.current = [];
    isConnectedRef.current = false;
    isConnectingRef.current = false;
    firstUtteranceHandledRef.current = false;
    recordUserUtteranceRef.current = null;
    setIsConnected(false);
    setIsConnecting(false);
    logSession("session stopped");
  }, []);

  const sendMessage = useCallback(async (text: string): Promise<boolean> => {
    const manager = managerRef.current;
    if (!manager) {
      console.warn("[realtime-session] No active session to send message");
      return false;
    }

    try {
      await manager.sendMessage(text);
      // Record the typed text as a user turn via the same path as voice
      // (recordTurn + first-utterance memory refresh). The remote transport does
      // not echo typed input back as a transcript, so there is no double-count.
      recordUserUtteranceRef.current?.(text);
      return true;
    } catch (error) {
      console.error("[realtime-session] Failed to send message:", error);
      return false;
    }
  }, []);

  const interrupt = useCallback(async () => {
    const manager = managerRef.current;
    if (!manager) {
      console.warn("[realtime-session] No active session to interrupt");
      return;
    }

    try {
      await manager.interrupt();
    } catch (error) {
      console.error("[realtime-session] Failed to interrupt:", error);
    }
  }, []);

  return {
    isConnected,
    isConnecting,
    transcript,
    start,
    stop,
    sendMessage,
    interrupt,
  };
}
