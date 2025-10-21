import { useState, useCallback } from "react";
import { Charivo } from "@charivo/core";
import { createRealtimeManager } from "@charivo/realtime-core";
import { createOpenAIRealtimeClient } from "@charivo/realtime-client-openai";

interface UseRealtimeModeOptions {
  charivo: Charivo | null;
  onError?: (error: Error) => void;
}

/**
 * Realtime Mode Hook
 *
 * OpenAI Realtime API (WebRTC)를 사용한 실시간 대화 모드를 관리합니다.
 *
 * 기능:
 * - WebRTC 연결 시작/종료
 * - 자동 마이크/스피커 처리
 * - 립싱크 자동 연동
 * - 기존 LLM/TTS/STT 비활성화
 */
export function useRealtimeMode({ charivo, onError }: UseRealtimeModeOptions) {
  const [isRealtimeMode, setIsRealtimeMode] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [isConnected, setIsConnected] = useState(false);

  /**
   * Realtime 모드 활성화
   */
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

      // 1. Create Realtime client (WebRTC)
      const realtimeClient = createOpenAIRealtimeClient({
        apiEndpoint: "/api/realtime",
      });

      // 2. Create Realtime manager
      const realtimeManager = createRealtimeManager(realtimeClient);

      // 3. Attach to Charivo
      charivo.attachRealtime(realtimeManager);

      // 4. Start session
      await realtimeManager.startSession({
        model: "gpt-realtime",
        voice: "verse",
      });

      // 5. Enable realtime lip sync on renderer
      charivo.emit("tts:audio:start", { audioElement: new Audio() });

      setIsRealtimeMode(true);
      setIsConnected(true);

      console.log("✅ Realtime mode enabled");
    } catch (error) {
      console.error("❌ Failed to enable Realtime mode:", error);
      setIsRealtimeMode(false);
      setIsConnected(false);
      onError?.(error as Error);
    } finally {
      setIsConnecting(false);
    }
  }, [charivo, isRealtimeMode, isConnecting, onError]);

  /**
   * Realtime 모드 비활성화
   */
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

      // Disable realtime lip sync
      charivo.emit("tts:audio:end", {});

      setIsRealtimeMode(false);
      setIsConnected(false);

      console.log("✅ Realtime mode disabled");
    } catch (error) {
      console.error("❌ Failed to disable Realtime mode:", error);
      onError?.(error as Error);
    }
  }, [charivo, isRealtimeMode, onError]);

  /**
   * Realtime 모드 토글
   */
  const toggleRealtimeMode = useCallback(async () => {
    if (isRealtimeMode) {
      await disableRealtimeMode();
    } else {
      await enableRealtimeMode();
    }
  }, [isRealtimeMode, enableRealtimeMode, disableRealtimeMode]);

  /**
   * 텍스트 메시지 전송 (Realtime 모드)
   */
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
        onError?.(error as Error);
      }
    },
    [charivo, isRealtimeMode, onError],
  );

  return {
    isRealtimeMode,
    isConnecting,
    isConnected,
    enableRealtimeMode,
    disableRealtimeMode,
    toggleRealtimeMode,
    sendRealtimeMessage,
  };
}
