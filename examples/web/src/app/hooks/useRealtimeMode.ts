import { useCallback } from "react";
import { createRealtimeManager } from "@charivo/realtime-core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";
import { useChatStore } from "../stores/useChatStore";

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

    try {
      console.log("🌐 Enabling Realtime mode...");

      const realtimeClient = createOpenAIRealtimeClient({
        apiEndpoint: "/api/realtime",
      });

      const realtimeManager = createRealtimeManager(realtimeClient);
      charivo.attachRealtime(realtimeManager);

      await realtimeManager.startSession({
        model: "gpt-realtime-mini",
        voice: "marin",
      });

      charivo.emit("tts:audio:start", { audioElement: new Audio() });

      setIsRealtimeMode(true);
      setIsConnected(true);

      console.log("✅ Realtime mode enabled");
    } catch (error) {
      console.error("❌ Failed to enable Realtime mode:", error);
      setIsRealtimeMode(false);
      setIsConnected(false);
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
      charivo.emit("tts:audio:end", {});

      setIsRealtimeMode(false);
      setIsConnected(false);

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
