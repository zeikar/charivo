import { Charivo } from "@charivo/core";
import { createRenderManager } from "@charivo/render";
import { createIkiRenderer } from "@charivo/render-iki";

const canvas = document.getElementById("avatar") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const setStatus = (m: string): void => {
  statusEl.textContent = m;
};

async function main(): Promise<void> {
  // The full charivo render path: RenderManager wraps the iki adapter, the
  // adapter drives an .iki model through the iki engine. Mouse tracking + the
  // event bus exercise gaze and lip-sync exactly as the real app would.
  const renderer = createIkiRenderer({ canvas });
  const renderManager = createRenderManager(renderer, {
    canvas,
    mouseTracking: "document",
  });

  const charivo = new Charivo();
  charivo.attachRenderer(renderManager);

  await renderManager.initialize();
  await renderManager.loadModel("/sample.iki.json");
  setStatus(
    "model loaded — idle breath + blink running. Move the mouse to gaze.",
  );

  // Simulate TTS: enable lip-sync, stream a speech-like RMS envelope, then end.
  let speaking = false;
  document.getElementById("speak")!.addEventListener("click", () => {
    if (speaking) return;
    speaking = true;
    setStatus("speaking… (driving ParamMouthOpenY from simulated RMS)");
    charivo.emit("tts:audio:start", {});
    const start = performance.now();
    const DURATION_MS = 2600;
    const timer = setInterval(() => {
      const t = performance.now() - start;
      if (t >= DURATION_MS) {
        clearInterval(timer);
        charivo.emit("tts:lipsync:update", { rms: 0 });
        charivo.emit("tts:audio:end", {});
        speaking = false;
        setStatus("done speaking — back to idle.");
        return;
      }
      // Syllable-ish envelope with jitter, in 0..1.
      const env = Math.abs(Math.sin(t / 95)) * (0.45 + Math.random() * 0.55);
      charivo.emit("tts:lipsync:update", { rms: Math.min(1, env * 0.7) });
    }, 50);
  });

  // Gaze buttons go through the event bus (realtime:gaze) like the live model.
  const gaze = (x: number, y: number): void => {
    charivo.emit("realtime:gaze", { x, y });
    setStatus(`gaze → x=${x}, y=${y}`);
  };
  document
    .getElementById("gazeL")!
    .addEventListener("click", () => gaze(-1, 0));
  document.getElementById("gazeR")!.addEventListener("click", () => gaze(1, 0));
  document
    .getElementById("gazeUp")!
    .addEventListener("click", () => gaze(0, 1));
  document.getElementById("gazeC")!.addEventListener("click", () => gaze(0, 0));
}

main().catch((err) => {
  setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
});
