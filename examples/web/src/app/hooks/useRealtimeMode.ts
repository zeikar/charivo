import { useCallback, useEffect, useRef } from "react";
import type { RealtimeSessionConfig } from "@charivo/core";
import { createRealtimeManager } from "@charivo/realtime";
import { createAvatarResultProjector } from "@charivo/avatar";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import { useChatStore } from "../stores/useChatStore";
import { useCharacterStore } from "../stores/useCharacterStore";
import { getCharacterConfig } from "../config/characters";
import { buildDemoRealtimeTools } from "../lib/avatar-tools";
import { buildDemoRealtimeInstructions } from "../lib/realtime-instructions";
import {
  REALTIME_GEMINI_MODEL,
  REALTIME_OPENAI_MODEL,
  REALTIME_SESSION_MAX_MS,
} from "../api/demo-limits";
import { createSessionCap } from "./session-cap";
import {
  shouldInterruptBeforeSend,
  toRealtimeErrorMessage,
} from "./realtime-ui";

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
    setCapNotice,
    selectedRealtimeProvider,
  } = useChatStore();
  const { selectedCharacter } = useCharacterStore();

  const sessionCapRef = useRef(createSessionCap());
  const sessionCap = sessionCapRef.current;

  const clearSessionCap = useCallback(() => {
    sessionCap.clear();
  }, [sessionCap]);

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
      setRealtimeError(toRealtimeErrorMessage(error));
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
    // Starting another session answers the previous cap notice.
    setCapNotice(null);

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

      const sessionConfig: RealtimeSessionConfig = {
        provider: selectedRealtimeProvider,
        // Transport is explicit because the remote client defaults it to
        // "webrtc", and it only reaches the Gemini adapter for provider
        // "gemini" paired with transport "websocket"
        // (`packages/realtime/src/remote/client.ts:261-272`). The route pins
        // the model server-side regardless; sending it keeps the client honest
        // about what it is asking for.
        ...(selectedRealtimeProvider === "gemini"
          ? { transport: "websocket", model: REALTIME_GEMINI_MODEL }
          : { transport: "webrtc", model: REALTIME_OPENAI_MODEL }),
        instructions: buildDemoRealtimeInstructions(
          charivo.getCurrentCharacter(),
          avatarCatalog,
        ),
        // The character `charivo` holds carries the TTS player's voice, and the
        // two providers name their voices differently -- so the realtime voice
        // is chosen here instead. `buildRealtimeSessionConfig`
        // (`packages/realtime/src/instructions.ts`) prefers an explicit `voice`
        // over `character.voice.voiceId`, and `updateSession` merges patches
        // over this base config, so the voice named here also outlives the
        // character sync's `updateSession({ instructions })`.
        voice:
          getCharacterConfig(selectedCharacter).voices[
            selectedRealtimeProvider
          ],
      };

      // Both calls must land on the same adapter, which they do by carrying
      // the same provider/transport values -- the manager rebuilds the config
      // on its way to startSession, so object identity is not what matches.
      await realtimeManager.prepareAudio?.(sessionConfig);

      await realtimeManager.startSession(sessionConfig);

      setIsRealtimeMode(true);

      // Realtime bills on wall clock, and after bootstrap the browser talks to
      // the provider directly — the server is out of the loop and cannot hang
      // up. So this timer is what bounds an ordinary visitor's session cost. It
      // is a courtesy cap, not an abuse control: see `api/demo-limits.ts`.
      sessionCap.arm(REALTIME_SESSION_MAX_MS);

      console.log("✅ Realtime mode enabled");
    } catch (error) {
      console.error("❌ Failed to enable Realtime mode:", error);
      setIsRealtimeMode(false);
      setIsConnected(false);
      resetRealtimeUiState();
      setRealtimeError(toRealtimeErrorMessage(error));
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
    sessionCap,
    setCapNotice,
    selectedRealtimeProvider,
    selectedCharacter,
  ]);

  // The cap must call the CURRENT teardown, not the one that existed when it was
  // armed -- see session-cap.ts. Arming happens inside enableRealtimeMode, where
  // isRealtimeMode is still false, so the teardown captured there would no-op.
  useEffect(() => {
    sessionCap.update(() => {
      logRealtimeMode("session-cap.reached", { ms: REALTIME_SESSION_MAX_MS });
      // Flag it before tearing down, so the notice is already up when the
      // button falls back to its "off" state -- but only for a session that is
      // still running. A session that already died on its own leaves
      // session.status "stopped", and that earlier failure must not be
      // re-attributed to the cap. A reconnect keeps the status "active", so
      // this does not swallow the notice mid-recovery. The teardown itself is
      // unconditional: the cost bound must never depend on reading state
      // correctly.
      if (
        charivo?.getRealtimeManager()?.getState().session.status === "active"
      ) {
        setCapNotice("realtime-session");
      }
      return disableRealtimeMode();
    });
  }, [sessionCap, disableRealtimeMode, setCapNotice, charivo]);

  // An unmount mid-session must not leave the cap armed.
  useEffect(() => sessionCap.clear, [sessionCap]);

  const toggleRealtimeMode = useCallback(async () => {
    if (isRealtimeMode) {
      await disableRealtimeMode();
    } else {
      await enableRealtimeMode();
    }
  }, [isRealtimeMode, enableRealtimeMode, disableRealtimeMode]);

  const sendRealtimeMessage = useCallback(
    async (text: string): Promise<boolean> => {
      if (!charivo || !isRealtimeMode) {
        console.warn("Realtime mode not active");
        return false;
      }

      const realtimeManager = charivo.getRealtimeManager();
      if (!realtimeManager) {
        console.error("Realtime manager not found");
        return false;
      }

      try {
        // Typing over the character means what speaking over it means, and
        // server VAD already handles that as a barge-in — so take the turn
        // rather than refusing the message.
        if (shouldInterruptBeforeSend(realtimeManager.getState())) {
          await realtimeManager.interrupt();
        }

        await realtimeManager.sendMessage(text);
        return true;
      } catch (error) {
        console.error("Failed to send Realtime message:", error);
        setRealtimeError(toRealtimeErrorMessage(error));
        return false;
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
      setRealtimeError(toRealtimeErrorMessage(error));
    }
  }, [charivo, isRealtimeMode, setRealtimeError]);

  return {
    toggleRealtimeMode,
    sendRealtimeMessage,
    interruptRealtime,
  };
}
