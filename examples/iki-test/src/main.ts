import { createCharivo } from "@charivo/core";
import { createRenderManager } from "@charivo/render";
import { createIkiRenderer, type IkiView } from "@charivo/render-iki";
// The web demo ships these models as its Iki characters; one copy serves both.
import heroUrl from "../../web/public/iki/hero.iki?url";
import mintUrl from "../../web/public/iki/mint.iki?url";

// The models this harness can load, picked with `?model=<name>`. A full body
// is framed in a view wider than its box, so the waving hand stays on canvas;
// the numbers are mint's `canvas` size.
const MODELS: Record<string, { path: string; view?: IkiView }> = {
  hero: { path: heroUrl },
  mint: {
    path: mintUrl,
    view: { x: 0, y: 0, width: 1.6 * 1100, height: 3692 },
  },
};

const canvas = document.getElementById("avatar") as HTMLCanvasElement;
const statusEl = document.getElementById("status") as HTMLDivElement;
const expressionsEl = document.getElementById("expressions") as HTMLDivElement;
const motionsEl = document.getElementById("motions") as HTMLDivElement;
const claimsEl = document.getElementById("claims") as HTMLDivElement;
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
  // declares, and go through the bus so RenderManager's catalog filter and
  // claim arbitration run.
  const catalog = renderer.getAvatarControlCatalog();

  for (const id of catalog.expressions) {
    const description = catalog.expressionDescriptions?.[id] ?? "";
    expressionsEl.append(
      makeButton(id, description, () => {
        charivo.emit("avatar:expression", { expressionId: id });
        setStatus(
          `avatar:expression → ${id} (held for the next speech, or ~8 s if none starts)`,
        );
      }),
    );
  }
  // The buttons above claim as the default source, "app"; releasing that
  // source drops their claim without touching any other writer's.
  expressionsEl.append(
    makeButton("■ Stop", "Release the app's expression claim", () => {
      charivo.emit("avatar:release", { source: "app", channel: "expression" });
      setStatus("avatar:release → app expression released");
    }),
  );

  // Two writers on one face: a held "inferred" pick, as a text director would
  // make, and a short "reflex" a game event would fire. The reflex wins while
  // it lasts, then the face falls back to the inferred one.
  const [calm, startled] = pickClaimPair(catalog.expressions);
  if (calm && startled) {
    claimsEl.append(
      makeButton(
        `Inferred: ${calm}`,
        "director, inferred, until release",
        () => {
          charivo.emit("avatar:expression", {
            expressionId: calm,
            source: "director",
            priority: "inferred",
            hold: "until-release",
          });
          setStatus(`director (inferred) holds ${calm}`);
        },
      ),
      makeButton(`Reflex: ${startled} 1.5 s`, "game, reflex, 1.5 s", () => {
        charivo.emit("avatar:expression", {
          expressionId: startled,
          source: "game",
          priority: "reflex",
          hold: { ms: 1500 },
        });
        charivo.emit("avatar:gaze", {
          x: 0.8,
          y: 0.2,
          source: "game",
          priority: "reflex",
          hold: { ms: 1500 },
        });
        setStatus(`game (reflex) ${startled} + glance for 1.5 s`);
      }),
      makeButton("Release director", "avatar:release director", () => {
        charivo.emit("avatar:release", { source: "director" });
        setStatus("avatar:release → director released");
      }),
    );
  }

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

// The demo pair: the model's first expression as the calm pick, and one whose
// id or description reads as surprise as the reflex, else the second one.
function pickClaimPair(ids: string[]): [string?, string?] {
  const calm = ids[0];
  const startled =
    ids.find((id) => id !== calm && /surpris|shock|startl/i.test(id)) ??
    ids.find((id) => id !== calm);
  return [calm, startled];
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
