import { useCallback, useEffect, useRef } from "react";
import { createRealtimeManager } from "@charivo/realtime";
import { createAvatarResultProjector } from "@charivo/avatar";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { useChatStore } from "../stores/useChatStore";
import { buildDemoRealtimeTools } from "../lib/avatar-tools";
import { buildDemoRealtimeInstructions } from "../lib/realtime-instructions";
import { REALTIME_MODEL, REALTIME_SESSION_MAX_MS } from "../api/demo-limits";

const REALTIME_DEBUG = process.env.NODE_ENV !== "production";

function logRealtimeMode(...args: unknown[]): void {
  if (REALTIME_DEBUG) {
    console.info("[realtime-mode]", ...args);
  }
}

/**
 * Realtime Mode Hook (Refactored with Zustand)
 */
export function useRealtimeMode() {
  const {
    charivo,
    isRealtimeMode,
    setIsRealtimeMode,
    isConnecting,
    setIsConnecting,
    setIsConnected,
    setRealtimeError,
    resetRealtimeUiState,
    avatarCatalog,
  } = useChatStore();

  const sessionCapRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // `disableRealtimeMode` is defined below and the cap timer has to reach it,
  // so route the call through a ref instead of reordering the callbacks.
  const disableRef = useRef<() => Promise<void>>(async () => {});

  const clearSessionCap = useCallback(() => {
    if (sessionCapRef.current !== null) {
      clearTimeout(sessionCapRef.current);
      sessionCapRef.current = null;
    }
  }, []);

  const enableRealtimeMode = useCallback(async () => {
    if (!charivo) {
      console.error("Charivo instance not available");
      return;
    }

    if (isRealtimeMode || isConnecting) {
      console.warn("Realtime mode already active or connecting");
      return;
    }

    setIsConnecting(true);
    setRealtimeError(null);

    try {
      console.log("🌐 Enabling Realtime mode...");

      const realtimeClient = createRemoteRealtimeClient({
        apiEndpoint: "/api/realtime",
        debug: REALTIME_DEBUG,
      });

      const realtimeManager = createRealtimeManager(realtimeClient, {
        tools: buildDemoRealtimeTools(avatarCatalog),
        resultProjectors: [createAvatarResultProjector()],
      });
      logRealtimeMode("avatar-tools.registered", {
        expressions: avatarCatalog.expressions,
        motions: avatarCatalog.motions,
        toolNames: realtimeManager
          .getRegisteredTools()
          .map((tool) => tool.name),
      });
      charivo.attachRealtime(realtimeManager);
      await realtimeManager.prepareAudio?.({ provider: "openai" });

      await realtimeManager.startSession({
        provider: "openai",
        // The route pins this server-side regardless; sending the same value
        // keeps the client honest about what it is asking for.
        model: REALTIME_MODEL,
        instructions: buildDemoRealtimeInstructions(
          charivo.getCurrentCharacter(),
          avatarCatalog,
        ),
      });

      setIsRealtimeMode(true);

      // Realtime bills on wall clock, and after bootstrap the browser talks to
      // OpenAI directly — the server is out of the loop and cannot hang up. So
      // this timer is what bounds an ordinary visitor's session cost. It is a
      // courtesy cap, not an abuse control: see `api/demo-limits.ts`.
      clearSessionCap();
      sessionCapRef.current = setTimeout(() => {
        logRealtimeMode("session-cap.reached", {
          ms: REALTIME_SESSION_MAX_MS,
        });
        void disableRef.current();
      }, REALTIME_SESSION_MAX_MS);

      console.log("✅ Realtime mode enabled");
    } catch (error) {
      console.error("❌ Failed to enable Realtime mode:", error);
      setIsRealtimeMode(false);
      setIsConnected(false);
      resetRealtimeUiState();
      setRealtimeError(
        error instanceof Error ? error.message : "Unknown error",
      );
    } finally {
      setIsConnecting(false);
    }
  }, [
    charivo,
    isRealtimeMode,
    isConnecting,
    setIsConnecting,
    setIsRealtimeMode,
    setIsConnected,
    setRealtimeError,
    resetRealtimeUiState,
    avatarCatalog,
    clearSessionCap,
  ]);

  const disableRealtimeMode = useCallback(async () => {
    clearSessionCap();

    if (!charivo || !isRealtimeMode) {
      return;
    }

    try {
      console.log("🔌 Disabling Realtime mode...");

      const realtimeManager = charivo.getRealtimeManager();
      if (realtimeManager) {
        await realtimeManager.stopSession();
      }

      charivo.detachRealtime();

      setIsRealtimeMode(false);
      setIsConnected(false);
      resetRealtimeUiState();

      console.log("✅ Realtime mode disabled");
    } catch (error) {
      console.error("❌ Failed to disable Realtime mode:", error);
      setRealtimeError(
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }, [
    charivo,
    isRealtimeMode,
    setIsRealtimeMode,
    setIsConnected,
    setRealtimeError,
    resetRealtimeUiState,
    clearSessionCap,
  ]);

  // Keep the cap timer pointed at the current teardown, and make sure an
  // unmount mid-session does not leave it armed.
  useEffect(() => {
    disableRef.current = disableRealtimeMode;
  }, [disableRealtimeMode]);

  useEffect(() => clearSessionCap, [clearSessionCap]);

  const toggleRealtimeMode = useCallback(async () => {
    if (isRealtimeMode) {
      await disableRealtimeMode();
    } else {
      await enableRealtimeMode();
    }
  }, [isRealtimeMode, enableRealtimeMode, disableRealtimeMode]);

  const sendRealtimeMessage = useCallback(
    async (text: string) => {
      if (!charivo || !isRealtimeMode) {
        console.warn("Realtime mode not active");
        return;
      }

      const realtimeManager = charivo.getRealtimeManager();
      if (!realtimeManager) {
        console.error("Realtime manager not found");
        return;
      }

      try {
        await realtimeManager.sendMessage(text);
      } catch (error) {
        console.error("Failed to send Realtime message:", error);
        setRealtimeError(
          error instanceof Error ? error.message : "Unknown error",
        );
      }
    },
    [charivo, isRealtimeMode, setRealtimeError],
  );

  const interruptRealtime = useCallback(async () => {
    if (!charivo || !isRealtimeMode) {
      console.warn("Realtime mode not active");
      return;
    }

    const realtimeManager = charivo.getRealtimeManager();
    if (!realtimeManager) {
      console.error("Realtime manager not found");
      return;
    }

    try {
      await realtimeManager.interrupt();
    } catch (error) {
      console.error("Failed to interrupt Realtime response:", error);
      setRealtimeError(
        error instanceof Error ? error.message : "Unknown error",
      );
    }
  }, [charivo, isRealtimeMode, setRealtimeError]);

  return {
    toggleRealtimeMode,
    sendRealtimeMessage,
    interruptRealtime,
  };
}
