"use client";

import { useEffect, useState, type MutableRefObject } from "react";

import type { AppCharacter } from "../config/characters";
import { useCharacterStore } from "../stores/useCharacterStore";

type UseLive2DOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
};

type UseLive2DResult = {
  canvas: HTMLCanvasElement | null;
  character: AppCharacter;
};

export function useLive2D({
  canvasContainerRef,
}: UseLive2DOptions): UseLive2DResult {
  const { selectedCharacter, getCharacter } = useCharacterStore();
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
  }, [canvasContainerRef]);

  return {
    canvas,
    character: getCharacter(selectedCharacter),
  };
}
