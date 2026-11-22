"use client";

import { useRef } from "react";

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

        <section
          aria-label="Stream chat"
          className="flex min-h-64 min-w-0 flex-col rounded-xl border border-gray-200 bg-white lg:col-start-2 lg:row-span-2 lg:row-start-1"
        >
          <h2 className="border-b border-gray-200 px-4 py-3 text-base font-semibold text-gray-900">
            Stream chat
          </h2>
          <p className="px-4 py-3 text-sm text-gray-500">No chat yet.</p>
        </section>

        <section
          aria-label="Director"
          className="min-w-0 rounded-2xl bg-slate-950 text-slate-100 ring-1 ring-white/10 lg:col-start-1 lg:row-start-2"
        >
          <h2 className="border-b border-white/10 px-4 py-3 text-sm font-semibold tracking-wide">
            Director
          </h2>
          <p className="px-4 py-3 text-xs text-slate-400">
            The show log appears here.
          </p>
        </section>
      </main>
    </div>
  );
}
