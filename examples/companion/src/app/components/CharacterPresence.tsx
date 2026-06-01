"use client";

import React from "react";

// The character figure. The Live2D canvas floats directly on the ambient stage
// (no glass tile) and the halos/floor/rim provide the only grounding glow.
// `align` places her (left during the intro, center on the main stage) and
// `dim` is the dormant pre-meet look — muted halos and a darkened avatar that
// brightens when she wakes.
export function CharacterPresence({
  canvasContainerRef,
  rendererReady,
  align = "center",
  dim = false,
}: {
  canvasContainerRef: React.RefObject<HTMLDivElement | null>;
  rendererReady: boolean;
  align?: "left" | "center" | "right";
  dim?: boolean;
}) {
  return (
    <div className={`stage-fig align-${align}${dim ? " dim" : ""}`}>
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
