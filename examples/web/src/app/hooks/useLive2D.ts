"use client";

import { useEffect, useRef, type MutableRefObject } from "react";
import type { Character } from "@charivo/core";
type Live2DRendererModule = typeof import("@charivo/render-live2d");
type Live2DRendererClass = Live2DRendererModule["Live2DRenderer"];
type Live2DRendererHandle = InstanceType<Live2DRendererClass>;

import { useLive2DStore } from "../stores/useLive2DStore";

type UseLive2DOptions = {
  canvasContainerRef: MutableRefObject<HTMLDivElement | null>;
  onRendererReady?: (
    renderer: Live2DRendererHandle,
    character: Character,
  ) => void;
};

export function useLive2D({
  canvasContainerRef,
  onRendererReady,
}: UseLive2DOptions) {
  const { selectedModel, getModelPath, getCharacter } = useLive2DStore();
  const live2DRendererRef = useRef<Live2DRendererHandle | null>(null);

  useEffect(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 300;
    canvas.height = 300;
    canvas.style.border = "2px solid #ccc";
    canvas.style.borderRadius = "8px";

    let isMounted = true;
    let live2DRenderer: Live2DRendererHandle | null = null;
    const container = canvasContainerRef.current;

    const initLive2D = async () => {
      if (!container) return;

      container.innerHTML = "";
      container.appendChild(canvas);

      const { Live2DRenderer } = await import("@charivo/render-live2d");
      const renderer = new Live2DRenderer({
        canvas,
        mouseTracking: "document",
      });
      live2DRenderer = renderer;
      live2DRendererRef.current = renderer;

      await renderer.initialize();
      await renderer.loadModel(getModelPath(selectedModel));

      const character = getCharacter(selectedModel);

      if (!isMounted) return;

      onRendererReady?.(renderer, character);
    };

    initLive2D().catch((error: unknown) => {
      console.error("Failed to initialize Live2D:", error);
    });

    return () => {
      isMounted = false;

      if (container && container.contains(canvas)) {
        container.removeChild(canvas);
      }

      if (live2DRenderer) {
        void live2DRenderer.destroy().catch((error: unknown) => {
          console.error("Failed to destroy Live2D renderer:", error);
        });
      }
    };
  }, [
    canvasContainerRef,
    selectedModel,
    getModelPath,
    getCharacter,
    onRendererReady,
  ]);

  return { live2DRendererRef };
}
