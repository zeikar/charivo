"use client";

import { useEffect, useRef, useState } from "react";
import { useRealtimeSession } from "./hooks/useRealtimeSession";

export default function Page() {
  const canvasContainerRef = useRef<HTMLDivElement | null>(null);
  const [canvas, setCanvas] = useState<HTMLCanvasElement | null>(null);

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

  const {
    isConnected,
    isConnecting,
    transcript,
    start,
    stop,
    sendMessage,
    interrupt,
  } = useRealtimeSession(canvas);

  const [input, setInput] = useState("");

  async function handleSend() {
    const text = input.trim();
    if (!text) return;
    const ok = await sendMessage(text);
    if (ok) setInput("");
  }

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <h1 className="text-2xl font-bold">Charivo Companion</h1>

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
        {isConnected ? (
          <button
            onClick={stop}
            className="rounded bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
          >
            Disconnect
          </button>
        ) : (
          <button
            onClick={start}
            disabled={isConnecting}
            className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50"
          >
            {isConnecting ? "Connecting…" : "Connect"}
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
