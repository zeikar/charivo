"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { EventBus, type Character, type RealtimeState } from "@charivo/core";
import {
  createRealtimeManager,
  buildRealtimeSessionConfig,
} from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { composeInstructions } from "../lib/compose-instructions";

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
  sendMessage: (text: string) => Promise<void>;
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

  const managerRef = useRef<ReturnType<typeof createRealtimeManager> | null>(
    null,
  );
  const eventBusRef = useRef<EventBus | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
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

    isConnectingRef.current = true;
    setIsConnecting(true);
    setTranscript("");

    try {
      const client = createRemoteRealtimeClient({
        apiEndpoint: "/api/realtime",
        debug: process.env.NODE_ENV !== "production",
      });

      const manager = createRealtimeManager(client);
      const eventBus = new EventBus();
      manager.setEventEmitter!(eventBus);

      const onState = (data: { state: RealtimeState }) => {
        const conn = data.state.connection;
        isConnectedRef.current = conn === "connected";
        isConnectingRef.current = conn === "connecting";
        setIsConnected(conn === "connected");
        setIsConnecting(conn === "connecting");
        logSession("state", conn);
      };

      const onDelta = (data: { text: string }) => {
        setTranscript((prev) => prev + data.text);
      };

      const onDone = (data: { text: string }) => {
        setTranscript(data.text);
        logSession("assistant:done", data.text.slice(0, 60));
      };

      eventBus.on("realtime:state", onState);
      eventBus.on("realtime:assistant:delta", onDelta);
      eventBus.on("realtime:assistant:done", onDone);

      unsubscribeRef.current = () => {
        eventBus.off("realtime:state", onState);
        eventBus.off("realtime:assistant:delta", onDelta);
        eventBus.off("realtime:assistant:done", onDone);
      };

      managerRef.current = manager;
      eventBusRef.current = eventBus;

      const instructions = composeInstructions([
        buildRealtimeSessionConfig({ character: resolvedCharacter })
          .instructions,
        COMPANION_DEMO_GUIDANCE,
      ]);

      await manager.startSession({
        provider: "openai",
        model: "gpt-realtime-mini",
        instructions,
      });

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
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
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

    isConnectedRef.current = false;
    isConnectingRef.current = false;
    setIsConnected(false);
    setIsConnecting(false);
    logSession("session stopped");
  }, []);

  const sendMessage = useCallback(async (text: string) => {
    const manager = managerRef.current;
    if (!manager) {
      console.warn("[realtime-session] No active session to send message");
      return;
    }

    try {
      await manager.sendMessage(text);
    } catch (error) {
      console.error("[realtime-session] Failed to send message:", error);
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
