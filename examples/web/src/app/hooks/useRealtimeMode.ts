import { useCallback } from "react";
import { createRealtimeManager } from "@charivo/realtime";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { useChatStore } from "../stores/useChatStore";
import { buildDemoRealtimeTools } from "../lib/avatar-tools";
import { buildDemoRealtimeInstructions } from "../lib/realtime-instructions";

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
      });
      logRealtimeMode("avatar-tools.registered", {
        expressions: avatarCatalog.expressions,
        motions: avatarCatalog.motions,
        toolNames: realtimeManager
          .getRegisteredTools()
          .map((tool) => tool.name),
      });
      charivo.attachRealtime(realtimeManager);
      await charivo.getRenderManager()?.prepareAudio?.();

      await realtimeManager.startSession({
        provider: "openai",
        instructions: buildDemoRealtimeInstructions(
          charivo.getCurrentCharacter(),
        ),
      });

      setIsRealtimeMode(true);

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
  ]);

  const disableRealtimeMode = useCallback(async () => {
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
  ]);

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

  return {
    toggleRealtimeMode,
    sendRealtimeMessage,
  };
}
