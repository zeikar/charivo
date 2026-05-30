"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventBus, type Character, type RealtimeState } from "@charivo/core";
import {
  createRealtimeManager,
  buildRealtimeSessionConfig,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { composeInstructions } from "../lib/compose-instructions";
import { createWriteJobScheduler } from "@/memory/trigger";
import type { Turn } from "@/memory/promotion-types";

const COMPANION_DEMO_GUIDANCE = `
Keep replies short and natural for a live voice demo.
Favor subtle reactions over big repeated motions unless the moment clearly calls for emphasis.
`.trim();

const DEFAULT_CHARACTER: Character = {
  id: "companion-default",
  name: "Companion",
  description: "A helpful and friendly companion.",
  personality: "warm, concise, and attentive",
};

async function fetchMemoryBlock(
  scope: { userId: string; characterId: string },
  query?: string,
): Promise<string> {
  try {
    const body: {
      scope: { userId: string; characterId: string };
      query?: string;
    } = { scope };
    if (query !== undefined) body.query = query;
    const res = await fetch("/api/memory", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      console.warn(
        "[realtime-session] fetchMemoryBlock non-ok response",
        res.status,
      );
      return "";
    }
    const data: unknown = await res.json();
    return typeof (data as { instructionsBlock?: unknown })
      .instructionsBlock === "string"
      ? (data as { instructionsBlock: string }).instructionsBlock
      : "";
  } catch (error) {
    console.warn("[realtime-session] fetchMemoryBlock failed", error);
    return "";
  }
}

/**
 * Post a (cumulative) transcript to the server write path. Throws on a non-ok
 * response so the write scheduler's runJob sees the failure (it catches and
 * keeps the session schedulable). node:sqlite stays server-side — this only
 * sends JSON.
 */
async function postPromote(payload: {
  scope: { userId: string; characterId: string };
  sessionId: string;
  startedAt: number;
  endedAt: number | null;
  turns: Turn[];
  finalize: boolean;
}): Promise<void> {
  const res = await fetch("/api/memory/promote", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    throw new Error(`promote failed: ${res.status}`);
  }
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
  const eventBusRef = useRef<EventBus | null>(null);
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
  // Kept so stop() can build the postPromote payload without closing over the
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
    postPromote({ ...pending, endedAt: Date.now(), finalize: true })
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

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
      // Best-effort final write if the component unmounts mid-session (the user
      // navigated away without calling stop). Fire-and-forget — cleanup cannot
      // await, and the scheduler short-circuits if already finalized.
      if (schedulerRef.current) {
        schedulerRef.current.onSessionEnd(sessionIdRef.current).catch(() => {});
        schedulerRef.current = null;
      }
      // Re-attempt any retained failed write from the previous stop() call.
      flushPendingFailedWrite();
      if (managerRef.current) {
        managerRef.current.stopSession().catch((error: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[realtime-session] stopSession on unmount failed",
              error,
            );
          }
        });
        managerRef.current = null;
      }
      eventBusRef.current = null;
    };
  }, []);

  const start = useCallback(async () => {
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
      const client = createRemoteRealtimeClient({
        apiEndpoint: "/api/realtime",
        debug: process.env.NODE_ENV !== "production",
      });

      const manager = createRealtimeManager(client);
      const eventBus = new EventBus();
      manager.setEventEmitter!(eventBus);

      const scope = { userId: "local-user", characterId: resolvedCharacter.id };
      scopeRef.current = scope;
      const personaInstructions = buildRealtimeSessionConfig({
        character: resolvedCharacter,
      }).instructions;

      // Fresh write-job scheduler per session. runJob posts the cumulative
      // transcript to the server write path; the scheduler coalesces fires and
      // never overlaps runs. promoteSession is idempotent, so cumulative
      // resends are safe.
      const sessionId = crypto.randomUUID();
      sessionIdRef.current = sessionId;
      startedAtRef.current = Date.now();
      turnsRef.current = [];
      const scheduler = createWriteJobScheduler({
        runJob: (sid, { finalize }) =>
          postPromote({
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
            const refreshedBlock = await fetchMemoryBlock(scope, data.text);
            const instructions = composeInstructions([
              personaInstructions,
              COMPANION_DEMO_GUIDANCE,
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

      eventBus.on("realtime:state", onState);
      eventBus.on("realtime:assistant:start", onAssistantStart);
      eventBus.on("realtime:assistant:delta", onDelta);
      eventBus.on("realtime:assistant:done", onDone);
      eventBus.on("realtime:user:transcript", onUserTranscript);

      unsubscribeRef.current = () => {
        eventBus.off("realtime:state", onState);
        eventBus.off("realtime:assistant:start", onAssistantStart);
        eventBus.off("realtime:assistant:delta", onDelta);
        eventBus.off("realtime:assistant:done", onDone);
        eventBus.off("realtime:user:transcript", onUserTranscript);
      };

      managerRef.current = manager;
      eventBusRef.current = eventBus;

      const memoryBlock = await fetchMemoryBlock(scope);
      const instructions = composeInstructions([
        personaInstructions,
        COMPANION_DEMO_GUIDANCE,
        memoryBlock,
      ]);

      await manager.startSession({
        provider: "openai",
        model: "gpt-realtime-mini",
        instructions,
        // Enable input transcription so `conversation.item.input_audio_transcription.completed`
        // fires and the manager emits `realtime:user:transcript`. Without this
        // OpenAI defaults transcription OFF, which silences onUserTranscript entirely.
        inputAudioTranscription: { model: "gpt-4o-mini-transcribe" },
      });

      // If the component unmounted while the connection was in-flight, stop the
      // session immediately so microphone/WebRTC resources are not leaked.
      if (!mountedRef.current) {
        manager.stopSession().catch((error: unknown) => {
          if (process.env.NODE_ENV !== "production") {
            console.warn(
              "[realtime-session] stopSession after unmounted start failed",
              error,
            );
          }
        });
        return;
      }

      logSession("session started");
    } catch (error) {
      console.error("[realtime-session] Failed to start session:", error);
      isConnectingRef.current = false;
      isConnectedRef.current = false;
      setIsConnecting(false);
      setIsConnected(false);
    }
  }, [resolvedCharacter]);

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

    const manager = managerRef.current;
    managerRef.current = null;
    eventBusRef.current = null;

    if (manager) {
      try {
        await manager.stopSession();
      } catch (error) {
        console.error("[realtime-session] Failed to stop session:", error);
      }
    }

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
