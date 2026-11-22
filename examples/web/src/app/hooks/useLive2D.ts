"use client";

import { useEffect, useState, type MutableRefObject } from "react";

import {
  getCharacterEngine,
  type AppCharacter,
  type CharacterEngine,
} from "../config/characters";
import { useCharacterStore } from "../stores/useCharacterStore";

type UseLive2DOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

type UseLive2DResult = {
  canvas: HTMLCanvasElement | null;
  /** The engine `canvas` was mounted for; undefined while there is none. */
  canvasEngine: CharacterEngine | undefined;
  character: AppCharacter;
};

export function useLive2D({
  canvasContainerRef,
}: UseLive2DOptions): UseLive2DResult {
  const { selectedCharacter, getCharacter } = useCharacterStore();
  const engine = getCharacterEngine(selectedCharacter);
  const [mounted, setMounted] = useState<{
    canvas: HTMLCanvasElement;
    engine: CharacterEngine;
  } | null>(null);

  // One canvas per engine, not one for the page: each renderer asks the canvas
  // for a WebGL context with its own attributes (Iki's needs a stencil buffer),
  // and a canvas hands back the first context it made whatever is asked later.
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) {
      return;
    }

    const nextCanvas = document.createElement("canvas");
    if (engine === "iki") {
      // The Iki player sizes its buffer from the canvas's CSS box and centres
      // the model in it; the Live2D renderer sizes the canvas itself. The box
      // stands on the panel's bottom edge at the panel's width, and
      // `useCharivoChat` gives it each character's shape as its model loads;
      // in a panel wider than that shape it is the whole panel.
      nextCanvas.style.width = "100%";
      nextCanvas.style.maxHeight = "100%";
      nextCanvas.style.alignSelf = "flex-end";
    } else {
      nextCanvas.width = 300;
      nextCanvas.height = 300;
    }

    container.replaceChildren(nextCanvas);
    setMounted({ canvas: nextCanvas, engine });

    return () => {
      setMounted((current) =>
        current?.canvas === nextCanvas ? null : current,
      );

      if (container.contains(nextCanvas)) {
        container.removeChild(nextCanvas);
      }
    };
  }, [canvasContainerRef, engine]);

  return {
    canvas: mounted?.canvas ?? null,
    canvasEngine: mounted?.engine,
    character: getCharacter(selectedCharacter),
  };
}
