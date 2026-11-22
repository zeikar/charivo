"use client";

import { useRef } from "react";

import { ChatPanel } from "./components/ChatPanel";
import { DirectorPanel } from "./components/DirectorPanel";
import { ShowBar } from "./components/ShowBar";
import { Stage } from "./components/Stage";
import { useVtuberShow } from "./hooks/useVtuberShow";
import { DEFAULT_SHOW_PLAN } from "./lib/show-plan";

export default function Home() {
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const show = useVtuberShow({ canvasContainerRef });
  const canStart =
    show.portReady && show.lifecycle === "idle" && !show.needsReload;
  const canStop = show.lifecycle === "running";

  return (
    <div className="min-h-[100dvh] bg-white">
      <ShowBar
        status={show.status}
        snapshot={show.snapshot}
        plan={DEFAULT_SHOW_PLAN}
        lifecycle={show.lifecycle}
        canStart={canStart}
        canStop={canStop}
        onStart={() => void show.startShow()}
        onStop={() => void show.stopShow()}
      />

      {/* DOM order is the narrow-screen order: stage, chat, director. */}
      <main className="mx-auto grid max-w-7xl grid-cols-1 gap-4 px-4 py-4 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,26rem)]">
        <div className="min-w-0 lg:col-start-1 lg:row-start-1">
          <Stage
            canvasContainerRef={canvasContainerRef}
            portReady={show.portReady}
            caption={show.caption}
            needsReload={show.needsReload}
            error={show.error}
            snapshot={show.snapshot}
          />
        </div>

        <ChatPanel log={show.log} canSend={canStop} onSend={show.submitChat} />

        <DirectorPanel
          snapshot={show.snapshot}
          log={show.log}
          plan={DEFAULT_SHOW_PLAN}
          scriptedViewers={show.scriptedViewers}
          scriptedGameEvents={show.scriptedGameEvents}
          onScriptedViewersChange={show.setScriptedViewers}
          onScriptedGameEventsChange={show.setScriptedGameEvents}
        />
      </main>
    </div>
  );
}
