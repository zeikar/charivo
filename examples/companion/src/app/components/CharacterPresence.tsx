"use client";

import React from "react";

export function CharacterPresence({
  canvasContainerRef,
  rendererReady,
}: {
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  rendererReady: boolean;
}) {
  return (
    <div className="stage-fig align-center">
      <div className="fig-wrap">
        <div className="fig-floor" />
        <div className="halo halo-3" />
        <div className="halo halo-2" />
        <div className="halo halo-1" />
        <div className="fig-rim" />
        <div className="fig-mount">
          <div className={"fig-tile" + (rendererReady ? "" : " loading")}>
            <div ref={canvasContainerRef} className="fig-canvas-mount" />
          </div>
        </div>
      </div>
    </div>
  );
}
