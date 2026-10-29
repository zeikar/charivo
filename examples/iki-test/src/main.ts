import { createCharivo } from "@charivo/core";
import { createRenderManager } from "@charivo/render";
import { createIkiRenderer, type IkiView } from "@charivo/render-iki";

// The models this harness can load, picked with `?model=<name>`. A full body
// is framed in a view wider than its box, so the waving hand stays on canvas;
// the numbers are mint's `canvas` size.
const MODELS: Record<string, { path: string; view?: IkiView }> = {
  hero: { path: "/hero.iki" },
  mint: {
    path: "/mint.iki",
    view: { x: 0, y: 0, width: 1.6 * 1100, height: 3692 },
  },
};

const canvas = document.getElementById("avatar") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const expressionsEl = document.getElementById("expressions") as HTMLDivElement;
const motionsEl = document.getElementById("motions") as HTMLDivElement;
const catalogEl = document.getElementById("catalog") as HTMLDListElement;
const modelsEl = document.getElementById("models") as HTMLDivElement;
const setStatus = (m: string): void => {
  statusEl.textContent = m;
};

async function main(): Promise<void> {
  const name = new URLSearchParams(location.search).get("model") ?? "hero";
  for (const option of Object.keys(MODELS)) {
    const link = document.createElement("a");
    link.textContent = option;
    link.href = `?model=${option}`;
    if (option === name) link.setAttribute("aria-current", "page");
    modelsEl.append(link);
  }
  const model = Object.hasOwn(MODELS, name) ? MODELS[name] : undefined;
  if (!model) {
    throw new Error(
      `unknown model "${name}" — pick one of ${Object.keys(MODELS).join(", ")}`,
    );
  }

  // The full charivo render path: RenderManager wraps the iki adapter, the
  // adapter drives an .iki model through the iki engine. Mouse tracking + the
  // event bus exercise gaze and lip-sync exactly as the real app would.
  const renderer = createIkiRenderer({ canvas });
  if (model.view) {
    renderer.setView(model.view);
    canvas.classList.add("full-body");
    canvas.style.setProperty(
      "--view-aspect",
      String(model.view.width / model.view.height),
    );
  }
  const renderManager = createRenderManager(renderer, {
    canvas,
    mouseTracking: "document",
  });

  const charivo = createCharivo({ renderer: renderManager });

  await renderManager.initialize();
  await renderManager.loadModel(model.path);
  setStatus(
    "model loaded — engine idle, blink, breath and hair physics running. Move the mouse to gaze.",
  );

  // Simulate TTS: enable lip-sync, stream a speech-like RMS envelope, then end.
  let speechTimer: ReturnType<typeof setInterval> | undefined;
  const endSpeech = (): void => {
    clearInterval(speechTimer);
    speechTimer = undefined;
    charivo.emit("tts:lipsync:update", { rms: 0 });
    charivo.emit("tts:audio:end", {});
  };
  document.getElementById("speak")!.addEventListener("click", () => {
    if (speechTimer) return;
    setStatus("speaking… (driving ParamMouthOpenY from simulated RMS)");
    charivo.emit("tts:audio:start", {});
    const start = performance.now();
    const DURATION_MS = 2600;
    speechTimer = setInterval(() => {
      const t = performance.now() - start;
      if (t >= DURATION_MS) {
        endSpeech();
        setStatus("done speaking — expression released, back to idle.");
        return;
      }
      // Syllable-ish envelope with jitter, in 0..1.
      const env = Math.abs(Math.sin(t / 95)) * (0.45 + Math.random() * 0.55);
      charivo.emit("tts:lipsync:update", { rms: Math.min(1, env * 0.7) });
    }, 50);
  });

  // Gaze buttons go through the event bus (avatar:gaze) like the live model.
  const gaze = (x: number, y: number): void => {
    charivo.emit("avatar:gaze", { x, y });
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

  // Expression and motion buttons come from the catalog the model file
  // declares, and go through the bus so RenderManager's catalog filter,
  // debounce and expression release all run.
  const catalog = renderer.getAvatarControlCatalog();

  for (const id of catalog.expressions) {
    const description = catalog.expressionDescriptions?.[id] ?? "";
    expressionsEl.append(
      makeButton(id, description, () => {
        charivo.emit("avatar:expression", { expressionId: id });
        setStatus(
          `avatar:expression → ${id} (released on tts:audio:end, or after ~8 s)`,
        );
      }),
    );
  }
  // RenderManager has no stop event: it releases an expression when speech
  // ends, so Stop sends the same tts:audio:end.
  expressionsEl.append(
    makeButton("■ Stop", "Release the expression via tts:audio:end", () => {
      if (speechTimer) endSpeech();
      else charivo.emit("tts:audio:end", {});
      setStatus("tts:audio:end → expression released");
    }),
  );

  for (const [group, count] of Object.entries(catalog.motions)) {
    for (let index = 0; index < count; index++) {
      const description = catalog.motionDescriptions?.[group]?.[index] ?? "";
      const label = count > 1 ? `${group} ${index}` : group;
      motionsEl.append(
        makeButton(label, description, () => {
          charivo.emit("avatar:motion", { group, index });
          setStatus(`avatar:motion → ${group}[${index}]`);
        }),
      );
    }
  }

  // Show the catalog an LLM would pick from.
  for (const id of catalog.expressions) {
    addCatalogEntry(id, catalog.expressionDescriptions?.[id]);
  }
  for (const [group, count] of Object.entries(catalog.motions)) {
    for (let index = 0; index < count; index++) {
      addCatalogEntry(
        `${group}[${index}]`,
        catalog.motionDescriptions?.[group]?.[index],
      );
    }
  }
}

function makeButton(
  label: string,
  title: string,
  onClick: () => void,
): HTMLButtonElement {
  const el = document.createElement("button");
  el.textContent = label;
  el.title = title;
  el.addEventListener("click", onClick);
  return el;
}

function addCatalogEntry(name: string, description = "—"): void {
  const dt = document.createElement("dt");
  dt.textContent = name;
  const dd = document.createElement("dd");
  dd.textContent = description;
  catalogEl.append(dt, dd);
}

main().catch((err) => {
  setStatus(`error: ${err instanceof Error ? err.message : String(err)}`);
  console.error(err);
});
