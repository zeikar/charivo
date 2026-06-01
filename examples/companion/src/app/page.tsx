"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRealtimeSession } from "./hooks/useRealtimeSession";
import {
  loadUserName,
  saveUserName,
  clearUserName,
  sanitizeUserName,
} from "./lib/user-name-store";
import {
  type Phase,
  type Tod,
  type CssVars,
  getTimeOfDay,
  paletteFor,
} from "./lib/hearth-theme";
import {
  CHARACTER_CATALOG,
  DEFAULT_CHARACTER_ID,
  getCharacterById,
} from "./lib/character-catalog";
import { loadCharacterId, saveCharacterId } from "./lib/character-store";
import { AmbientBackground } from "./components/AmbientBackground";
import { CharacterPresence } from "./components/CharacterPresence";
import { TopBar } from "./components/TopBar";
import { VoiceOrb } from "./components/VoiceOrb";
import { Captions } from "./components/Captions";
import { IntroScreen } from "./components/IntroScreen";
import { SettingsPanel } from "./components/SettingsPanel";

export default function Page() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

  // Intro gate + one-action meet-and-connect state.
  const [hasMet, setHasMet] = useState(false);
  // The one-shot connect intent: armed by meet / revisit / "Meet her again",
  // consumed (set false) at the moment the auto-connect effect invokes start().
  const [connectRequested, setConnectRequested] = useState(false);
  const [userName, setUserName] = useState<string | null>(null);
  const [nameInput, setNameInput] = useState("");

  // Selected character id + hydration gate. Both reads (userName + characterId)
  // live in one effect to make the lock race-free: we know we're past SSR before
  // we render any actionable picker UI.
  const [characterId, setCharacterId] = useState<string>(DEFAULT_CHARACTER_ID);
  const [hydrated, setHydrated] = useState(false);

  // Mount the canvas once on load — independent of the intro gate — so the
  // avatar (rendered by the render effect in useRealtimeSession) is already
  // present, dimmed, during the intro and simply brightens when she wakes. The
  // CharacterPresence layer is always in the tree, so its container ref exists
  // on first commit.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }

    const nextCanvas = document.createElement("canvas");
    nextCanvas.width = 300;
    nextCanvas.height = 300;

    container.replaceChildren(nextCanvas);
    setCanvas(nextCanvas);

    return () => {
      setCanvas((currentCanvas) =>
        currentCanvas === nextCanvas ? null : currentCanvas,
      );

      if (container.contains(nextCanvas)) {
        container.removeChild(nextCanvas);
      }
    };
  }, []);

  // Resolve the stable catalog reference directly — getCharacterById returns the
  // module-level constant, so no useMemo needed.
  const character = getCharacterById(characterId);

  const { isConnected, isConnecting, transcript, start, stop, rendererReady } =
    useRealtimeSession(canvas, character, userName);

  // Voice-first UI state.
  const [phase, setPhase] = useState<Phase>("dormant");
  const [captionsOn, setCaptionsOn] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Deterministic SSR default ("evening"), then resolve the real time-of-day on
  // the client to avoid an SSR/CSR hydration mismatch.
  const [tod, setTod] = useState<Tod>("evening");
  useEffect(() => {
    setTod(getTimeOfDay());
  }, []);

  // Combined client-only hydration: both localStorage reads + the hydrated flag
  // live in one effect to make the lock race-free. The returning-visitor
  // setHasMet(true) behavior is preserved exactly — the user must tap
  // "Meet her again" (handleRetry) to reconnect; that gesture unlocks
  // AudioContext/lip-sync safely on iOS/Safari. SSR is unaffected.
  useEffect(() => {
    const saved = loadUserName();
    if (saved) {
      setUserName(saved);
      setHasMet(true);
    }
    const savedChar = loadCharacterId();
    if (savedChar) setCharacterId(savedChar);
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (connectRequested && rendererReady && !isConnected && !isConnecting) {
      // Consume the one-shot intent FIRST, so a start() failure or an
      // unexpected session drop (which flips isConnecting/isConnected back to
      // false) does NOT re-trigger this effect into a retry loop. One arming
      // == exactly one start() attempt; reconnect is a manual "Meet her again"
      // tap (or "Meet her" on first meet / revisit).
      setConnectRequested(false);
      void start();
    }
  }, [connectRequested, rendererReady, isConnected, isConnecting, start]);

  function handleMeet(): void {
    const name = sanitizeUserName(nameInput);
    if (!name) return;
    saveUserName(name);
    setUserName(name);
    setHasMet(true);
    setConnectRequested(true);
  }

  async function handleDisconnect(): Promise<void> {
    setConnectRequested(false);
    await stop();
  }

  function handleRetry(): void {
    setConnectRequested(true);
  }

  const cycleCharacter = (dir: 1 | -1) => {
    const idx = CHARACTER_CATALOG.findIndex((c) => c.id === characterId);
    const base = idx === -1 ? 0 : idx;
    const next =
      CHARACTER_CATALOG[
        (base + dir + CHARACTER_CATALOG.length) % CHARACTER_CATALOG.length
      ];
    setCharacterId(next.id);
    saveCharacterId(next.id);
  };

  // "Change name" is a full identity reset: it clears the connect intent, tears
  // down any live session, unmounts the canvas (→ teardownRender → rendererReady
  // false), and clears the stored name so a reload before re-confirming shows
  // the intro again.
  async function handleChangeName(): Promise<void> {
    setConnectRequested(false);
    if (isConnected) {
      await stop();
    }
    setHasMet(false);
    setUserName(null);
    setNameInput("");
    clearUserName();
  }

  // Public-surface-only phase derivation: the realtime:* events are internal to
  // the hook, so phase is inferred solely from isConnecting/isConnected and
  // transcript changes. The connected branch defaults to "listening" so the
  // stage never stalls in "connecting" once connected, and the speaking-settle
  // timer is always cleared before any non-connected phase so it cannot leak
  // across disconnect/reconnect. "thinking" is omitted — there is no exposed
  // signal for it.
  const prevTranscriptRef = useRef("");
  const speakTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    function clearSpeakTimer(): void {
      if (speakTimerRef.current) {
        clearTimeout(speakTimerRef.current);
        speakTimerRef.current = null;
      }
    }

    if (isConnecting) {
      clearSpeakTimer();
      setPhase("connecting");
      return;
    } else if (!isConnected) {
      clearSpeakTimer();
      setPhase("dormant");
      return;
    } else {
      const changed = transcript !== prevTranscriptRef.current;
      prevTranscriptRef.current = transcript;
      if (changed && transcript !== "") {
        setPhase("speaking");
        clearSpeakTimer();
        speakTimerRef.current = setTimeout(() => {
          setPhase("listening");
          speakTimerRef.current = null;
        }, 900);
      } else if (!speakTimerRef.current) {
        // No transcript change (or empty): land on "listening" immediately,
        // unless a settle timer is mid-flight from a recent delta.
        setPhase("listening");
      }
    }

    return () => {
      clearSpeakTimer();
    };
  }, [isConnecting, isConnected, transcript]);

  // --level is set ONLY via the phase-* class on the stage root — never written
  // from JS. The palette carries the time-of-day color tokens.
  const palette = useMemo<CssVars>(() => paletteFor(tod), [tod]);

  const topBarStatus = isConnecting
    ? "connecting"
    : isConnected
      ? "connected"
      : "dormant";

  // Single stage tree across intro and main so the avatar canvas mounts once and
  // persists: pre-meet she sits dimmed to the left behind the intro copy, and on
  // meet she slides center. `dim` tracks the dormant phase, so she is darkened
  // whenever she is asleep — both pre-meet and disconnected on the main stage —
  // and brightens (via the CSS fade) the moment she starts connecting. Pre-meet
  // phase is always "dormant", so `phase-${phase}` carries the intro look too.
  return (
    <div className={`stage phase-${phase}`} style={palette}>
      <AmbientBackground />
      <CharacterPresence
        canvasContainerRef={canvasContainerRef}
        rendererReady={rendererReady}
        align={hasMet ? "center" : "left"}
        dim={phase === "dormant"}
      />
      {hasMet ? (
        <>
          <VoiceOrb
            phase={phase}
            onTalk={!isConnected && !isConnecting ? handleRetry : undefined}
          />
          <TopBar
            name={character.name}
            status={topBarStatus}
            onSettings={() => setSettingsOpen(true)}
          />
          <Captions show={captionsOn} line={transcript} name={character.name} />
          <SettingsPanel
            open={settingsOpen}
            onClose={() => setSettingsOpen(false)}
            name={userName}
            onRename={(next) => {
              const clean = sanitizeUserName(next);
              if (!clean) return;
              saveUserName(clean);
              setUserName(clean);
            }}
            onChangeName={() => {
              setSettingsOpen(false);
              void handleChangeName();
            }}
            captions={captionsOn}
            onCaptions={setCaptionsOn}
            status={topBarStatus}
            onDisconnect={handleDisconnect}
            onReconnect={handleRetry}
            characterId={character.id}
          />
        </>
      ) : hydrated ? (
        <IntroScreen
          name={userName}
          nameInput={nameInput}
          onNameInput={setNameInput}
          onMeet={handleMeet}
          character={character}
          onPrevCharacter={() => cycleCharacter(-1)}
          onNextCharacter={() => cycleCharacter(1)}
        />
      ) : null}
    </div>
  );
}
