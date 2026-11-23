import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createLinePlayer, LINES } from "./lines";

const urlFor = (file: string) => `/base${file}`;

// The playground serves examples/web's models; read the ids each declares.
const MODEL_FILES = { Twin: "hero.iki", Mint: "mint.iki" } as const;
function expressionIds(character: keyof typeof MODEL_FILES): string[] {
  const model = JSON.parse(
    readFileSync(
      path.join(
        __dirname,
        "../../../../examples/web/public/iki",
        MODEL_FILES[character],
      ),
      "utf8",
    ),
  ) as { expressions: { id: string }[] };
  return model.expressions.map((e) => e.id);
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("voice lines", () => {
  it("has a recording in static/voice for every line", () => {
    for (const line of LINES) {
      expect(
        existsSync(path.join(__dirname, "../../../static", line.file)),
      ).toBe(true);
    }
  });

  it("picks an expression its character's model has", () => {
    for (const line of LINES) {
      expect(expressionIds(line.character)).toContain(line.expression);
    }
  });

  it("speaks each text through a single line", () => {
    const texts = LINES.map((line) => line.text);
    expect(new Set(texts).size).toBe(texts.length);
  });

  it("fetches the recording of the text it is asked to say", async () => {
    const audio = new ArrayBuffer(4);
    const fetchMock = vi.fn(async () => new Response(audio));
    vi.stubGlobal("fetch", fetchMock);

    const player = createLinePlayer(urlFor);
    const result = await player.generateAudio!(LINES[0].text);

    expect(fetchMock).toHaveBeenCalledWith(`/base${LINES[0].file}`);
    expect(result.byteLength).toBe(4);
    expect(player.playbackMode).toBe("audio");
    expect(player.audioMimeType).toBe("audio/mp4");
  });

  it("rejects a text it has no recording for", async () => {
    vi.stubGlobal("fetch", vi.fn());
    await expect(
      createLinePlayer(urlFor).generateAudio!("unrecorded"),
    ).rejects.toThrow(/No recording/);
  });

  it("rejects a failed download", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(null, { status: 404 })),
    );
    await expect(
      createLinePlayer(urlFor).generateAudio!(LINES[0].text),
    ).rejects.toThrow(/404/);
  });
});
