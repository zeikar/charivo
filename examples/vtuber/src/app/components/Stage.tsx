import type { RefObject } from "react";

import type { DirectorSnapshot } from "../../director";

type StageProps = {
  canvasContainerRef: RefObject<HTMLDivElement | null>;
  portReady: boolean;
  caption: string;
  needsReload: boolean;
  /** Setup or start failure. */
  error: string | null;
  snapshot: DirectorSnapshot | null;
};

export function Stage({
  canvasContainerRef,
  portReady,
  caption,
  needsReload,
  error,
  snapshot,
}: StageProps) {
  const directorError = snapshot?.status === "failed" ? snapshot.error : null;

  return (
    <section
      aria-label="Stage"
      className="relative h-[52vh] min-h-80 overflow-hidden rounded-xl border border-gray-200 bg-gray-50 lg:h-[min(62vh,36rem)]"
    >
      {/* The hook puts the canvas in here; the Live2D renderer sizes it to this box. */}
      <div
        ref={canvasContainerRef}
        className="absolute inset-0 flex items-center justify-center overflow-hidden touch-none"
      />

      {!portReady && !error && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
          <div className="text-center text-gray-400">
            <div className="mx-auto mb-2 h-8 w-8 animate-spin rounded-full border-2 border-blue-500 border-t-transparent" />
            <p className="text-sm">Loading...</p>
          </div>
        </div>
      )}

      <div className="pointer-events-none absolute inset-x-3 top-3 z-20 space-y-2">
        {needsReload && (
          <p
            role="alert"
            className="rounded-2xl border border-amber-200 bg-amber-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-amber-800"
          >
            The audio could not be stopped, so the show cannot start again.
            Reload the page.
          </p>
        )}
        {(directorError || error) && (
          <p
            role="alert"
            className="rounded-2xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-[13px] leading-relaxed text-red-700"
          >
            {directorError ?? error}
          </p>
        )}
      </div>

      {/* Always mounted: a live region added together with its text is often not announced. */}
      <div
        aria-live="polite"
        className="pointer-events-none absolute inset-x-3 bottom-4 z-10 flex justify-center md:inset-x-auto md:bottom-auto md:left-8 md:top-24 md:block"
      >
        {caption && (
          <div className="relative inline-block max-w-[min(20rem,calc(100vw-3rem))] rounded-[1.6rem] border border-gray-200 bg-white/96 px-4 py-2.5 text-gray-800 shadow-lg backdrop-blur-sm md:max-w-xs md:rounded-2xl md:px-5 md:py-3 md:shadow-md">
            <p className="text-sm">{caption}</p>
            {/* Tail pointing at the character, as in examples/web. */}
            <div className="absolute -right-[10px] top-[12px] hidden md:block">
              <div className="h-0 w-0 border-b-[7px] border-l-[10px] border-t-[7px] border-b-transparent border-l-gray-300 border-t-transparent" />
              <div className="absolute left-0 top-0 h-0 w-0 translate-x-[-1px] border-b-[7px] border-l-[9px] border-t-[7px] border-b-transparent border-l-white border-t-transparent" />
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
