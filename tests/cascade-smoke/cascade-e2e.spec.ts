import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  getSnapshot,
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
// TTS playback — the path exercised by RenderManager + RealTimeLipSync, which
// node-level tests cannot reproduce.

const WAV_PATH = fileURLToPath(
  new URL("../webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);
const WAV_PRESENT = existsSync(WAV_PATH);

const LIVE_ENABLED = process.env.RUN_LIVE_CASCADE === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("cascade stt → llm → tts e2e", () => {
  test.skip(
    !WAV_PRESENT,
    "voice-smoke-input.wav missing — see tests/webrtc-smoke/fixtures/README.md",
  );
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_CASCADE=1 OPENAI_API_KEY=... to run the cascade suite.",
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
  });
});
