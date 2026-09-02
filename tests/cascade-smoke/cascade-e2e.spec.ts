import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  startTextTurn,
  startTurn,
  waitForHarnessReady,
  waitForTurnSettled,
} from "./spec-helpers";

// Cascade end-to-end smoke.
//
// Feeds a canned WAV into Chromium's fake microphone, then drives the full
// non-realtime voice chain through the recommended remote-client + server-
// provider path:
//   STT (whisper) → Charivo.userSay → LLM (chat) → TTS (audio) → lip-sync.
//
// The lip-sync RMS assertion proves the browser audio→lip-sync loop ran during
// TTS playback — TTSManager analyzing audio through the shared core
// LipSyncAnalyzer and RenderManager consuming the resulting RMS, which
// node-level tests cannot reproduce.

const WAV_PATH = fileURLToPath(
  new URL("../webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);
const WAV_PRESENT = existsSync(WAV_PATH);

const LIVE_ENABLED = process.env.RUN_LIVE_CASCADE === "1";
// STT and TTS always run on OpenAI; CASCADE_LLM=gemini moves only the chat leg
// to the Gemini provider, which needs its own key (see vite.config.ts).
const CASCADE_LLM = process.env.CASCADE_LLM ?? "openai";
const HAS_API_KEYS =
  Boolean(process.env.OPENAI_API_KEY) &&
  (CASCADE_LLM !== "gemini" || Boolean(process.env.GEMINI_API_KEY));

// Mirrors the AVATAR_CATALOG expressions in src/main.ts, so the assertion
// below can prove the model only ever picked from the enum offered to it.
const AVATAR_CATALOG_EXPRESSIONS = [
  "F01",
  "F02",
  "F03",
  "F04",
  "F05",
  "F06",
  "F07",
  "F08",
];

// Sets for the semantic assertion below, derived from the descriptions in
// src/main.ts. `F03` is the only outright angry face; `F08` ("unimpressed,
// deadpan") is the acceptable softer read of the same request.
const DISPLEASED_EXPRESSIONS = ["F03", "F08"];
const SMILING_EXPRESSIONS = ["F01", "F02", "F05", "F07"];

test.describe("cascade stt → llm → tts e2e", () => {
  test.skip(
    !WAV_PRESENT,
    "voice-smoke-input.wav missing — see tests/webrtc-smoke/fixtures/README.md",
  );
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEYS,
    "Set RUN_LIVE_CASCADE=1 OPENAI_API_KEY=... to run the cascade suite (plus GEMINI_API_KEY=... when CASCADE_LLM=gemini).",
  );

  test("transcribes canned audio, generates a reply, synthesizes speech, and drives lip-sync", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarnessReady(page);

    await startTurn(page);
    await waitForTurnSettled(page);

    const snapshot = await getSnapshot(page);

    console.log(`[cascade] transcript: ${JSON.stringify(snapshot.transcript)}`);
    console.log(
      `[cascade] assistant: ${JSON.stringify(snapshot.assistantText)}`,
    );
    console.log(
      `[cascade] tts audio start/end: ${snapshot.ttsAudioStarted}/${snapshot.ttsAudioEnded}, ` +
        `lip-sync RMS updates: ${snapshot.lipsyncRmsUpdates}, maxRms: ${snapshot.maxRms.toFixed(4)}`,
    );
    console.log(`[cascade] timings(ms): ${JSON.stringify(snapshot.timings)}`);
    console.log(
      `[cascade] avatar events: ${JSON.stringify(snapshot.avatarEvents)}`,
    );

    expect(
      snapshot.lastError,
      `harness error: ${snapshot.lastError}`,
    ).toBeNull();
    expect(snapshot.status).toBe("done");

    // STT produced text.
    expect(snapshot.transcript?.trim().length ?? 0).toBeGreaterThan(0);
    // LLM produced a reply.
    expect(snapshot.assistantText?.trim().length ?? 0).toBeGreaterThan(0);
    // TTS synthesized + played audio through its full lifecycle.
    expect(snapshot.ttsAudioStarted).toBe(true);
    expect(snapshot.ttsAudioEnded).toBe(true);
    // The browser audio→lip-sync loop drove the renderer during playback.
    expect(snapshot.lipsyncRmsUpdates).toBeGreaterThan(0);

    // The LLM tool loop called setExpression: the canned utterance asks the
    // character to smile, and the avatar tool instructions push proactive
    // expression use, so an avatar:expression event should have fired -
    // proving the tool loop → result projector → bus path end-to-end.
    const expressionEvents = snapshot.avatarEvents.filter(
      (event) => event.type === "expression",
    );
    expect(expressionEvents.length).toBeGreaterThan(0);
    for (const event of expressionEvents) {
      expect(AVATAR_CATALOG_EXPRESSIONS).toContain(event.expressionId);
    }
    // No semantic assertion here on purpose. The canned utterance asks for a
    // smile, whose match (`F01`) is also the ID the model gravitates to with
    // the descriptions stripped — see the next test, which picks an utterance
    // where those two answers diverge.
  });

  // The expression IDs are opaque (`F01`..`F08`), so their meaning reaches the
  // model ONLY through `expressionDescriptions` in the setExpression schema and
  // the avatar instructions. This test asks for anger, whose match is `F03`.
  //
  // The utterance is chosen to have discriminating power. Control runs with the
  // descriptions stripped showed the model answering `F01` every time — it
  // gravitates to the lowest-numbered ID regardless of position or content. The
  // canned "smile for me" request also maps to `F01`, so a semantic assertion
  // there passes even with the channel disabled. Asking for anger makes the two
  // answers diverge: `F01` is now the WRONG answer, so this assertion can only
  // pass if the meanings actually reached the model. Keep it that way — an
  // utterance whose match is `F01` would silently neuter this test.
  test("picks a contextually correct expression from opaque IDs", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarnessReady(page);

    await startTextTurn(page, "Please be angry at me.");
    await waitForTurnSettled(page);

    const snapshot = await getSnapshot(page);

    console.log(
      `[cascade] assistant: ${JSON.stringify(snapshot.assistantText)}`,
    );
    console.log(
      `[cascade] avatar events: ${JSON.stringify(snapshot.avatarEvents)}`,
    );

    expect(
      snapshot.lastError,
      `harness error: ${snapshot.lastError}`,
    ).toBeNull();
    expect(snapshot.status).toBe("done");

    const chosen = snapshot.avatarEvents
      .filter((event) => event.type === "expression")
      .map((event) => event.expressionId);

    expect(chosen.length, "no setExpression call was made").toBeGreaterThan(0);
    for (const id of chosen) {
      expect(AVATAR_CATALOG_EXPRESSIONS).toContain(id);
    }
    expect(
      chosen.filter((id) => SMILING_EXPRESSIONS.includes(id)),
      `model answered an angry request with a smile: ${JSON.stringify(chosen)}`,
    ).toEqual([]);
    expect(
      chosen.some((id) => DISPLEASED_EXPRESSIONS.includes(id)),
      `expected an angry/displeased expression, got: ${JSON.stringify(chosen)}`,
    ).toBe(true);
  });
});
