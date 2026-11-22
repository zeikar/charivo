"use client";

import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type RefObject,
} from "react";
import {
  createCharivo,
  getErrorMessage,
  type AvatarControlCatalog,
  type BuiltInTTSManager,
  type Charivo,
  type RenderManager,
} from "@charivo/core";
import {
  buildAvatarControlInstructions,
  createAvatarControlTools,
  createAvatarResultProjector,
} from "@charivo/avatar";
import { createTTSManager } from "@charivo/tts";

import {
  applyShowProtocol,
  createCharivoCascadePort,
  type CharivoCascadePort,
} from "../../adapters/charivo-cascade-port";
import {
  createDirector,
  createPushSource,
  type Director,
  type DirectorSnapshot,
  type PushSource,
} from "../../director";
import { SHOW_MAX_HISTORY_TURNS } from "../api/demo-limits";
import {
  HARU_CHARACTER,
  HARU_EXPRESSION_DESCRIPTIONS,
  HARU_GAZE_ORIGIN,
  HARU_MODEL_PATH,
  HARU_MOTION_DESCRIPTIONS,
} from "../lib/character";
import { FAKE_GAME_EVENT_SCRIPT } from "../lib/fake-game-events";
import { FAKE_VIEWER_SCRIPT } from "../lib/fake-viewers";
import { createScriptedSource } from "../lib/scripted-source";
import { DEFAULT_SHOW_PLAN, SHOW_DIRECTOR_CONFIG } from "../lib/show-plan";
import { appendToShowLog, EMPTY_SHOW_LOG, type ShowLog } from "../lib/show-log";

export type ShowLifecycle = "idle" | "starting" | "running" | "stopping";

export type CharacterStatus = "speaking" | "thinking" | "idle" | "failed";

/** What one run of the setup effect built; replaced whole on a remount. */
interface Session {
  charivo: Charivo;
  tts: BuiltInTTSManager;
  port: CharivoCascadePort;
}

export interface VtuberShow {
  portReady: boolean;
  lifecycle: ShowLifecycle;
  /** True once the port's audio could not be stopped; only a reload recovers. */
  needsReload: boolean;
  snapshot: DirectorSnapshot | null;
  /** The current show's log; emptied when a new show starts. */
  log: ShowLog;
  status: CharacterStatus;
  caption: string;
  error: string | null;
  scriptedViewers: boolean;
  scriptedGameEvents: boolean;
  setScriptedViewers(enabled: boolean): void;
  setScriptedGameEvents(enabled: boolean): void;
  startShow(): Promise<void>;
  stopShow(): Promise<void>;
  /** Dropped unless a show is running. */
  submitChat(message: {
    viewer: string;
    text: string;
    highlighted: boolean;
  }): void;
}

export function useVtuberShow({
  canvasContainerRef,
}: {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
}): VtuberShow {
  const [portReady, setPortReady] = useState(false);
  const [lifecycle, setLifecycleState] = useState<ShowLifecycle>("idle");
  const [needsReload, setNeedsReloadState] = useState(false);
  const [snapshot, setSnapshot] = useState<DirectorSnapshot | null>(null);
  const [log, setLog] = useState<ShowLog>(EMPTY_SHOW_LOG);
  const [scriptedViewers, setScriptedViewersState] = useState(true);
  const [scriptedGameEvents, setScriptedGameEventsState] = useState(true);
  const [audioActive, setAudioActive] = useState(false);
  const [caption, setCaption] = useState("");
  const [error, setError] = useState<string | null>(null);

  const sessionRef = useRef<Session | null>(null);
  // The single claim on the port: startShow and stopShow read it
  // synchronously, so a double click cannot slip past a pending state update.
  const lifecycleRef = useRef<ShowLifecycle>("idle");
  const needsReloadRef = useRef(false);
  const directorRef = useRef<Director | null>(null);
  const unsubscribeRef = useRef<(() => void) | null>(null);
  const chatSourceRef = useRef<PushSource | null>(null);
  // Read by the scripted sources as each entry comes due, so a toggle takes
  // effect mid-show without restarting it.
  const scriptedViewersRef = useRef(true);
  const scriptedGameEventsRef = useRef(true);

  const setLifecycle = useCallback((next: ShowLifecycle) => {
    lifecycleRef.current = next;
    setLifecycleState(next);
  }, []);

  const setNeedsReload = useCallback((next: boolean) => {
    needsReloadRef.current = next;
    setNeedsReloadState(next);
  }, []);

  const setScriptedViewers = useCallback((enabled: boolean) => {
    scriptedViewersRef.current = enabled;
    setScriptedViewersState(enabled);
  }, []);

  const setScriptedGameEvents = useCallback((enabled: boolean) => {
    scriptedGameEventsRef.current = enabled;
    setScriptedGameEventsState(enabled);
  }, []);

  // A port stays unusable for good, so this only ever turns needsReload on;
  // the setup effect turns it off when it builds a new port.
  const checkUsable = useCallback(
    (session: Session) => {
      if (sessionRef.current === session && !session.port.isUsable()) {
        setNeedsReload(true);
      }
    },
    [setNeedsReload],
  );

  // Gives up the claim, but only for the Director that still holds it: a
  // continuation that resumes after a newer show started must not end that one.
  const releaseDirector = useCallback(
    (director: Director) => {
      if (directorRef.current !== director) return;
      unsubscribeRef.current?.();
      unsubscribeRef.current = null;
      directorRef.current = null;
      setLifecycle("idle");
    },
    [setLifecycle],
  );

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    container.replaceChildren(canvas);

    let disposed = false;
    let renderManager: RenderManager | null = null;
    let charivo: Charivo | null = null;
    let port: CharivoCascadePort | null = null;

    // Before createCharivo the render manager has no owner to destroy it.
    const destroyOrphanRenderManager = async () => {
      try {
        await renderManager?.destroy();
      } catch (destroyError) {
        console.error("Failed to destroy the renderer:", destroyError);
      }
    };

    const setup = async () => {
      try {
        // Loaded on the client only: the Live2D renderer reaches for browser
        // globals as its module loads.
        const [
          { createLive2DRenderer },
          { createRenderManager },
          { createLLMManager },
          { createRemoteLLMClient },
          { createRemoteTTSPlayer },
        ] = await Promise.all([
          import("@charivo/render-live2d"),
          import("@charivo/render"),
          import("@charivo/llm"),
          import("@charivo/llm/remote"),
          import("@charivo/tts/remote"),
        ]);
        if (disposed) return;

        const renderer = createLive2DRenderer({ canvas });
        renderManager = createRenderManager(renderer, {
          canvas,
          mouseTracking: "document",
        });
        await renderManager.initialize();
        await renderManager.loadModel(HARU_MODEL_PATH);
        if (disposed) {
          await destroyOrphanRenderManager();
          return;
        }

        // The renderer holds the origin across loads, so it is set after the
        // model is in, as examples/web does.
        renderer.setGazeOrigin(HARU_GAZE_ORIGIN);

        const catalog: AvatarControlCatalog = {
          expressions: renderer.getAvailableExpressions(),
          motions: renderer.getAvailableMotionGroups(),
          expressionDescriptions: HARU_EXPRESSION_DESCRIPTIONS,
          motionDescriptions: HARU_MOTION_DESCRIPTIONS,
        };

        const llm = createLLMManager(
          createRemoteLLMClient({ apiEndpoint: "/api/chat" }),
          {
            tools: createAvatarControlTools(catalog),
            resultProjectors: [createAvatarResultProjector()],
            toolInstructions: buildAvatarControlInstructions(catalog),
            maxHistoryTurns: SHOW_MAX_HISTORY_TURNS,
          },
        );

        // No await from here to the ready flag: once Charivo exists the
        // cleanup owns every manager through charivo.dispose(), and nothing
        // in between can be left half-built by a cleanup that runs mid-way.
        const tts = createTTSManager(
          createRemoteTTSPlayer({ apiEndpoint: "/api/tts" }),
        );
        const instance = createCharivo({
          renderer: renderManager,
          llm,
          tts,
          character: applyShowProtocol(HARU_CHARACTER),
        });
        charivo = instance;
        port = createCharivoCascadePort(instance);

        instance.on("tts:audio:start", () => {
          if (!disposed) setAudioActive(true);
        });
        instance.on("tts:audio:end", () => {
          if (!disposed) setAudioActive(false);
        });
        instance.on("character:speak", ({ text }) => {
          if (!disposed) setCaption(text);
        });

        sessionRef.current = { charivo: instance, tts, port };
        setNeedsReload(false);
        setError(null);
        setPortReady(true);
      } catch (setupError) {
        if (!charivo) await destroyOrphanRenderManager();
        if (!disposed) {
          console.error("Failed to set up the stage:", setupError);
          setError(getErrorMessage(setupError));
        }
      }
    };

    void setup();

    return () => {
      disposed = true;
      if (sessionRef.current?.port === port) sessionRef.current = null;
      setPortReady(false);
      setAudioActive(false);
      setSnapshot(null);
      setCaption("");

      // A show mid-stop is released by its own stopShow once stop() settles.
      const director = directorRef.current;
      if (director) {
        void director.stop();
        if (lifecycleRef.current === "running") releaseDirector(director);
      }

      if (container.contains(canvas)) container.removeChild(canvas);

      // Setup still running: it sees `disposed` at its next check and
      // destroys the render manager itself.
      if (!charivo) return;
      port?.dispose();
      // Stops and disposes TTS and destroys the render manager, each even
      // when an earlier step failed.
      charivo.dispose().catch((disposeError: unknown) => {
        console.error("Failed to dispose Charivo:", disposeError);
      });
    };
  }, [canvasContainerRef, releaseDirector, setNeedsReload]);

  const startShow = useCallback(async () => {
    const session = sessionRef.current;
    if (!session || needsReloadRef.current || lifecycleRef.current !== "idle") {
      return;
    }
    setLifecycle("starting");
    setError(null);

    try {
      await session.tts.prepareAudio();
    } catch (prepareError) {
      setLifecycle("idle");
      setError(getErrorMessage(prepareError));
      return;
    }
    if (sessionRef.current !== session) {
      setLifecycle("idle");
      return;
    }

    // A new show starts from an empty conversation, not the last show's.
    session.charivo.clearHistory();
    setCaption("");
    setLog(EMPTY_SHOW_LOG);
    // Fresh sources per show: the scripts replay from this Start.
    const chatSource = createPushSource();
    chatSourceRef.current = chatSource;
    const director = createDirector({
      port: session.port,
      plan: DEFAULT_SHOW_PLAN,
      config: SHOW_DIRECTOR_CONFIG,
      sources: [
        chatSource,
        createScriptedSource(
          FAKE_VIEWER_SCRIPT,
          () => scriptedViewersRef.current,
        ),
        createScriptedSource(
          FAKE_GAME_EVENT_SCRIPT,
          () => scriptedGameEventsRef.current,
        ),
      ],
    });
    directorRef.current = director;
    unsubscribeRef.current = director.subscribe((next, entries) => {
      if (sessionRef.current !== session) return;
      setSnapshot(next);
      if (entries.length > 0) {
        setLog((current) => appendToShowLog(current, entries));
      }
      checkUsable(session);
      if (
        (next.status === "finished" || next.status === "failed") &&
        lifecycleRef.current === "running"
      ) {
        releaseDirector(director);
      }
    });
    // Before start(): a show that ends inside start() is then released by
    // the listener above rather than left marked running.
    setLifecycle("running");
    director.start();
  }, [checkUsable, releaseDirector, setLifecycle]);

  const stopShow = useCallback(async () => {
    const director = directorRef.current;
    if (!director || lifecycleRef.current !== "running") return;
    const session = sessionRef.current;
    setLifecycle("stopping");
    await director.stop();
    if (session) checkUsable(session);
    releaseDirector(director);
  }, [checkUsable, releaseDirector, setLifecycle]);

  // The Director stops its sources when the show ends, so the push source
  // drops a message sent before Start or after the end.
  const submitChat = useCallback<VtuberShow["submitChat"]>(
    ({ viewer, text, highlighted }) => {
      chatSourceRef.current?.push({ kind: "chat", viewer, text, highlighted });
    },
    [],
  );

  let status: CharacterStatus = "idle";
  if (audioActive) status = "speaking";
  else if (snapshot?.status === "failed") status = "failed";
  else if (snapshot?.inFlight) status = "thinking";

  return {
    portReady,
    lifecycle,
    needsReload,
    snapshot,
    log,
    status,
    caption,
    error,
    scriptedViewers,
    scriptedGameEvents,
    setScriptedViewers,
    setScriptedGameEvents,
    startShow,
    stopShow,
    submitChat,
  };
}
