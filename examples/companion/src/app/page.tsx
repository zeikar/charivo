"use client";

import { useEffect, useRef, useState } from "react";
import { useRealtimeSession } from "./hooks/useRealtimeSession";
import {
  loadUserName,
  saveUserName,
  clearUserName,
  sanitizeUserName,
} from "./lib/user-name-store";

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

  useEffect(() => {
    if (!hasMet) return;
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
  }, [hasMet]);

  const {
    isConnected,
    isConnecting,
    transcript,
    start,
    stop,
    sendMessage,
    interrupt,
    rendererReady,
  } = useRealtimeSession(canvas, undefined, userName);

  const [input, setInput] = useState("");

  // Returning visitor: land past the gate so the canvas mounts and the avatar
  // renders, but do NOT arm the connect intent here. The user taps "Meet her
  // again" (which calls handleRetry → setConnectRequested(true)) to connect —
  // that tap is the user gesture that lets start() → prepareAudio() unlock
  // AudioContext/lip-sync safely on iOS/Safari. Client-only (localStorage), so
  // SSR is unaffected.
  useEffect(() => {
    const saved = loadUserName();
    if (saved) {
      setUserName(saved);
      setHasMet(true);
    }
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

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    const ok = await sendMessage(text);
    if (ok) setInput("");
  }

  if (!hasMet) {
    const canMeet = sanitizeUserName(nameInput) !== "";
    return (
      <main className="flex min-h-screen flex-col items-center justify-center bg-gradient-to-b from-[#0a0a0a] via-[#0d0a12] to-[#0a0a0a] p-8">
        <div className="w-full max-w-md rounded-2xl border border-white/10 bg-white/[0.03] p-8 text-center shadow-2xl backdrop-blur-sm">
          <h1 className="bg-gradient-to-r from-rose-300 to-violet-300 bg-clip-text text-2xl font-semibold text-transparent">
            Ready to meet her?
          </h1>
          <p className="mt-3 text-sm leading-relaxed text-gray-400">
            She&apos;s been waiting for you. Tell her your name, and that&apos;s
            what she&apos;ll call you.
          </p>

          <input
            type="text"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleMeet()}
            placeholder="What should she call you?"
            className="mt-6 w-full rounded-lg border border-white/10 bg-black/40 px-4 py-3 text-center text-sm text-white placeholder-gray-600 outline-none focus:border-rose-400/40"
          />

          <button
            onClick={handleMeet}
            disabled={!canMeet}
            className="mt-4 w-full rounded-lg bg-gradient-to-r from-rose-500 to-violet-500 px-4 py-3 text-sm font-medium text-white transition hover:from-rose-400 hover:to-violet-400 disabled:cursor-not-allowed disabled:opacity-40"
          >
            Meet her
          </button>
        </div>
      </main>
    );
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <div className="flex items-center gap-3">
        <h1 className="text-2xl font-bold">Charivo Companion</h1>
        {userName && (
          <span className="text-sm text-gray-400">Hi, {userName}</span>
        )}
        <button
          onClick={handleChangeName}
          disabled={isConnecting}
          className="text-xs text-gray-500 underline-offset-2 hover:text-gray-300 hover:underline disabled:opacity-40"
        >
          Change name
        </button>
      </div>

      <div ref={canvasContainerRef} className="h-[320px] w-[320px]" />

      <p className="text-sm">
        Status:{" "}
        <span className="font-mono">
          {isConnecting
            ? "connecting"
            : isConnected
              ? "connected"
              : "disconnected"}
        </span>
      </p>

      <div className="flex gap-3">
        <button
          onClick={handleDisconnect}
          disabled={isConnecting || !isConnected}
          className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700 disabled:opacity-50"
        >
          Disconnect
        </button>

        {!isConnected && !isConnecting && (
          <button
            onClick={handleRetry}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
          >
            Meet her again
          </button>
        )}

        <button
          onClick={interrupt}
          disabled={!isConnected}
          className="rounded bg-yellow-600 px-4 py-2 text-sm font-medium text-white hover:bg-yellow-700 disabled:opacity-50"
        >
          Interrupt
        </button>
      </div>

      <div className="flex w-full max-w-lg gap-2">
        <input
          type="text"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSend()}
          placeholder="Type a message…"
          disabled={!isConnected}
          className="flex-1 rounded border border-gray-600 bg-gray-800 px-3 py-2 text-sm text-white placeholder-gray-500 disabled:opacity-50"
        />
        <button
          onClick={handleSend}
          disabled={!isConnected || !input.trim()}
          className="rounded bg-green-600 px-4 py-2 text-sm font-medium text-white hover:bg-green-700 disabled:opacity-50"
        >
          Send
        </button>
      </div>

      {transcript && (
        <div className="w-full max-w-lg rounded border border-gray-700 bg-gray-900 p-4 text-sm">
          <p className="mb-1 text-xs font-semibold uppercase text-gray-400">
            Assistant
          </p>
          <p>{transcript}</p>
        </div>
      )}
    </main>
  );
}
