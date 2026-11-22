import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  CHARACTER_CONFIGS,
  CHARACTER_IDS,
  findCharacterId,
  getCharacterEngine,
  resolveCharacterVoice,
} from "./index";

const EXPECTED_VOICE_IDS = {
  Haru: "coral",
  Hiyori: "marin",
  Mao: "shimmer",
  Mark: "cedar",
  Mint: "marin",
  Natori: "verse",
  Rice: "ballad",
  Twin: "shimmer",
  Wanko: "alloy",
} as const;

const EXPECTED_GEMINI_VOICE_IDS = {
  Haru: "Zephyr",
  Hiyori: "Achernar",
  Mao: "Puck",
  Mark: "Charon",
  Mint: "Callirrhoe",
  Natori: "Despina",
  Rice: "Leda",
  Twin: "Aoede",
  Wanko: "Fenrir",
} as const;

const BUILT_IN_DEMO_VOICES = new Set([
  "alloy",
  "ballad",
  "cedar",
  "coral",
  "marin",
  "shimmer",
  "verse",
]);

// Local copy of ALLOWED_VOICES from packages/server/src/gemini/realtime/index.ts:
// that set is module-private, so the demo's own allow-list is derived from the
// characters and checked against this copy instead of importing it.
const GEMINI_PREBUILT_VOICES = new Set([
  "Zephyr",
  "Puck",
  "Charon",
  "Kore",
  "Fenrir",
  "Leda",
  "Orus",
  "Aoede",
  "Callirrhoe",
  "Autonoe",
  "Enceladus",
  "Iapetus",
  "Umbriel",
  "Algieba",
  "Despina",
  "Erinome",
  "Algenib",
  "Rasalgethi",
  "Laomedeia",
  "Achernar",
  "Alnilam",
  "Schedar",
  "Gacrux",
  "Pulcherrima",
  "Achird",
  "Zubenelgenubi",
  "Vindemiatrix",
  "Sadachbia",
  "Sadaltager",
  "Sulafat",
]);

describe("demo character voice defaults", () => {
  it("assigns an explicit curated voiceId to every demo character", () => {
    for (const id of CHARACTER_IDS) {
      const voiceId = CHARACTER_CONFIGS[id].character.voice?.voiceId;

      expect(voiceId).toBe(EXPECTED_VOICE_IDS[id]);
      expect(BUILT_IN_DEMO_VOICES.has(voiceId ?? "")).toBe(true);
    }
  });

  it("maps voices.openai to the character's own voiceId and voices.gemini to a curated prebuilt voice", () => {
    for (const id of CHARACTER_IDS) {
      const { character, voices } = CHARACTER_CONFIGS[id];

      expect(voices.openai).toBe(character.voice?.voiceId);
      expect(voices.gemini).toBe(EXPECTED_GEMINI_VOICE_IDS[id]);
      expect(GEMINI_PREBUILT_VOICES.has(voices.gemini)).toBe(true);
    }
  });
});

describe("resolveCharacterVoice", () => {
  it("swaps in the gemini voiceId and leaves every other field equal to the original", () => {
    const original = CHARACTER_CONFIGS.Haru;
    const originalVoiceId = original.character.voice?.voiceId;

    const resolved = resolveCharacterVoice(original, "gemini");

    expect(resolved).toEqual({
      ...original.character,
      voice: { ...original.character.voice, voiceId: "Zephyr" },
    });
    expect(original.character.voice?.voiceId).toBe(originalVoiceId);
  });

  it("resolves the openai provider to the character's existing voiceId", () => {
    const resolved = resolveCharacterVoice(CHARACTER_CONFIGS.Haru, "openai");

    expect(resolved.voice?.voiceId).toBe("coral");
  });
});

/** Expression IDs a Live2D model actually ships, read from its model3.json. */
function readModelMotionFiles(modelPath: string): Record<string, string[]> {
  const publicDir = fileURLToPath(
    new URL("../../../../public", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${publicDir}${modelPath}`, "utf8"),
  ) as {
    FileReferences?: { Motions?: Record<string, Array<{ File: string }>> };
  };

  return Object.fromEntries(
    Object.entries(manifest.FileReferences?.Motions ?? {}).map(
      ([group, entries]) => [group, entries.map((entry) => entry.File)],
    ),
  );
}

// Motion descriptions are POSITIONAL, so counts alone cannot protect them: an
// SDK asset refresh that reorders or swaps files inside a group would remap
// every description while every count still matched. These are the ordered
// files that were on disk when the motions were watched.
const EXPECTED_MOTION_FILES: Record<string, Record<string, string[]>> = {
  Haru: {
    Idle: [
      "motions/haru_g_idle.motion3.json",
      "motions/haru_g_m15.motion3.json",
    ],
    TapBody: [
      "motions/haru_g_m26.motion3.json",
      "motions/haru_g_m06.motion3.json",
      "motions/haru_g_m20.motion3.json",
      "motions/haru_g_m09.motion3.json",
    ],
  },
  Mao: {
    Idle: ["motions/mtn_01.motion3.json", "motions/sample_01.motion3.json"],
    TapBody: [
      "motions/mtn_02.motion3.json",
      "motions/mtn_03.motion3.json",
      "motions/mtn_04.motion3.json",
      "motions/special_01.motion3.json",
      "motions/special_02.motion3.json",
      "motions/special_03.motion3.json",
    ],
  },
};

function readModelExpressionIds(modelPath: string): string[] {
  const publicDir = fileURLToPath(
    new URL("../../../../public", import.meta.url),
  );
  const manifest = JSON.parse(
    readFileSync(`${publicDir}${modelPath}`, "utf8"),
  ) as { FileReferences?: { Expressions?: Array<{ Name: string }> } };

  return (manifest.FileReferences?.Expressions ?? []).map((e) => e.Name);
}

// `@charivo/avatar` silently ignores description keys that are not in the
// catalog's expression list, so a typo'd or stale key is a no-op rather than an
// error. These assertions are what turn that into a caught mistake.
describe("expression descriptions", () => {
  const documented = CHARACTER_IDS.filter(
    (id) => CHARACTER_CONFIGS[id].live2d?.expressionDescriptions !== undefined,
  );

  it("covers the characters whose model IDs are opaque", () => {
    expect(documented.sort()).toEqual(["Haru", "Mao"]);
  });

  for (const id of documented) {
    it(`${id}: every key names a real expression, with a non-empty value`, () => {
      const { modelPath, expressionDescriptions } =
        CHARACTER_CONFIGS[id].live2d!;
      const declared = Object.keys(expressionDescriptions ?? {}).sort();

      expect(declared).toEqual(readModelExpressionIds(modelPath).sort());
      for (const value of Object.values(expressionDescriptions ?? {})) {
        expect(typeof value).toBe("string");
        expect(value.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

describe("motion descriptions", () => {
  const documented = CHARACTER_IDS.filter(
    (id) => CHARACTER_CONFIGS[id].live2d?.motionDescriptions !== undefined,
  );

  it("covers the characters whose motions were watched", () => {
    expect(documented.sort()).toEqual(["Haru", "Mao"]);
  });

  for (const id of documented) {
    it(`${id}: motion files are still in the observed order`, () => {
      const { modelPath } = CHARACTER_CONFIGS[id].live2d!;
      expect(readModelMotionFiles(modelPath)).toEqual(
        EXPECTED_MOTION_FILES[id],
      );
    });

    it(`${id}: every group is described, one entry per motion`, () => {
      const { motionDescriptions } = CHARACTER_CONFIGS[id].live2d!;
      const pinned = EXPECTED_MOTION_FILES[id]!;

      // Equality, not inclusion: a partial or empty motionDescriptions would
      // otherwise satisfy a per-group loop vacuously.
      expect(Object.keys(motionDescriptions ?? {}).sort()).toEqual(
        Object.keys(pinned).sort(),
      );

      for (const [group, files] of Object.entries(pinned)) {
        const entries = motionDescriptions?.[group] ?? [];
        expect(entries).toHaveLength(files.length);
        for (const entry of entries) {
          expect(typeof entry).toBe("string");
          expect(entry.trim().length).toBeGreaterThan(0);
        }
      }
    });
  }
});

// An Iki character carries no descriptions in its config: the LLM's catalog is
// whatever the `.iki` file declares, so an empty or undescribed one would leave
// avatar control with nothing to pick from, silently.
describe("iki characters", () => {
  const ikiIds = CHARACTER_IDS.filter((id) => getCharacterEngine(id) === "iki");

  it("are the ones the demo ships", () => {
    expect(ikiIds).toEqual(["Mint", "Twin"]);
  });

  for (const id of ikiIds) {
    it(`${id}: the model file declares described expressions and motions, and has the configured shape`, () => {
      const publicDir = fileURLToPath(
        new URL("../../../../public", import.meta.url),
      );
      const model = JSON.parse(
        readFileSync(
          `${publicDir}${CHARACTER_CONFIGS[id].iki!.modelPath}`,
          "utf8",
        ),
      ) as {
        canvas: { width: number; height: number };
        parts: Array<{ id: string; transform: { x: number; y: number } }>;
        expressions?: Array<{ id: string; description: string }>;
        motions?: Record<string, Array<{ description: string }>>;
      };

      const descriptions = [
        ...(model.expressions ?? []),
        ...Object.values(model.motions ?? {}).flat(),
      ].map((entry) => entry.description);

      const { view, canvasAspect } = CHARACTER_CONFIGS[id].iki!;
      const framed = view ?? model.canvas;
      expect(canvasAspect).toBe(framed.width / framed.height);
      // A view may be larger than the model's own box, never smaller.
      expect(framed.width).toBeGreaterThanOrEqual(model.canvas.width);
      expect(framed.height).toBeGreaterThanOrEqual(model.canvas.height);
      // The gaze origin is a number copied from the file, which a model
      // refresh can move (or swap the character behind `hero.iki` altogether):
      // it must still sit between the eyes the file draws. Part positions are
      // model units from the canvas's centre, y up; the origin is a fraction
      // of the canvas from its top-left.
      const eyes = ["eye_L", "eye_R"].map((partId) => {
        const { x, y } = model.parts.find(
          (part) => part.id === partId,
        )!.transform;
        return {
          x: 0.5 + x / model.canvas.width,
          y: 0.5 - y / model.canvas.height,
        };
      });
      const gazeOrigin = CHARACTER_CONFIGS[id].gazeOrigin!;
      expect(gazeOrigin.x).toBeCloseTo((eyes[0].x + eyes[1].x) / 2, 2);
      expect(gazeOrigin.y).toBeCloseTo((eyes[0].y + eyes[1].y) / 2, 2);

      expect(model.expressions?.length).toBeGreaterThan(0);
      expect(Object.keys(model.motions ?? {}).length).toBeGreaterThan(0);
      for (const description of descriptions) {
        expect(description.trim().length).toBeGreaterThan(0);
      }
    });
  }
});

describe("getCharacterEngine", () => {
  it("is live2d for every other character", () => {
    expect(
      CHARACTER_IDS.filter((id) => getCharacterEngine(id) === "live2d"),
    ).toEqual(["Haru", "Hiyori", "Mao", "Mark", "Natori", "Rice", "Wanko"]);
  });
});

describe("findCharacterId", () => {
  it("finds a character by its id, in any case", () => {
    expect(findCharacterId("Twin")).toBe("Twin");
    expect(findCharacterId("twin")).toBe("Twin");
    expect(findCharacterId("HARU")).toBe("Haru");
  });

  it("is undefined for no value, an empty one, or a name no character has", () => {
    expect(findCharacterId(null)).toBeUndefined();
    expect(findCharacterId("")).toBeUndefined();
    expect(findCharacterId("Twi")).toBeUndefined();
    expect(findCharacterId("toString")).toBeUndefined();
  });
});

describe("gaze origins", () => {
  it("are points inside the model's canvas, where a character has one", () => {
    for (const id of CHARACTER_IDS) {
      const origin = CHARACTER_CONFIGS[id].gazeOrigin;
      if (!origin) continue;
      for (const value of [origin.x, origin.y]) {
        expect(value).toBeGreaterThan(0);
        expect(value).toBeLessThan(1);
      }
    }
  });

  it("are set for every character but the one whose model has no eyes to find", () => {
    expect(
      CHARACTER_IDS.filter((id) => !CHARACTER_CONFIGS[id].gazeOrigin),
    ).toEqual(["Wanko"]);
  });
});
