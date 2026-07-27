import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  startRecording,
  stopRecording,
  waitForHarnessReady,
  waitForSettled,
} from "./spec-helpers";

// Streaming STT end-to-end smoke.
//
// Feeds a canned WAV into Chromium's fake microphone, then drives
// `@charivo/stt/openai-realtime` through the public path
// (transcriber → STTManager → Charivo events) over a real WebRTC connection to
// the OpenAI Realtime API.
//
// The design was validated over a WebSocket spike; the shipped transcriber uses
// WebRTC. This suite is what verifies the central claim on the transport that
// actually ships: transcript deltas stream live BEFORE any commit, and the
// single commit sent at stop yields the authoritative final.

const WAV_PATH = fileURLToPath(
  new URL("../webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);
const WAV_PRESENT = existsSync(WAV_PATH);

const LIVE_ENABLED = process.env.RUN_LIVE_STREAMING_STT === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

// The fixture is 4.01s (500ms silence + ~2000ms speech + 1500ms trailing
// silence) and loops, so speech is available whenever session setup happens to
// finish. This window leaves room for a full utterance plus the deltas it
// produces before stop. The transcript therefore contains repeated and/or
// partial sentences, which the assertions below tolerate. See the README.
const RECORD_MS = 5_000;

test.describe("streaming stt over webrtc e2e", () => {
  test.skip(
    !WAV_PRESENT,
    "voice-smoke-input.wav missing — see tests/webrtc-smoke/fixtures/README.md",
  );
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_STREAMING_STT=1 OPENAI_API_KEY=... to run the streaming STT suite.",
  );

  test("streams transcript deltas before the commit and finalizes at stop", async ({
    page,
  }) => {
    await page.goto("/");
    await waitForHarnessReady(page);

    await startRecording(page);
    await page.waitForTimeout(RECORD_MS);
    await stopRecording(page);
    await waitForSettled(page);

    const snapshot = await getSnapshot(page);

    console.log(
      `[streaming-stt] partials: ${snapshot.partials.length} ` +
        `(${snapshot.partialsBeforeStop} before stop)`,
    );
    console.log(
      `[streaming-stt] partial snapshots: ${JSON.stringify(snapshot.partials)}`,
    );
    console.log(`[streaming-stt] final: ${JSON.stringify(snapshot.final)}`);

    expect(snapshot.error, `harness error: ${snapshot.error}`).toBeNull();
    expect(snapshot.status).toBe("done");

    // Headline: deltas reached the app over WebRTC while audio was still
    // streaming, before stop() sent `input_audio_buffer.commit`.
    expect(snapshot.partialsBeforeStop).toBeGreaterThan(0);

    // Each `stt:partial` is a cumulative snapshot built by plain concatenation,
    // not an isolated fragment: every one extends its predecessor and never
    // rewinds. Compared on trimmed text because the last snapshot of an item is
    // rebuilt from the server's authoritative `...transcription.completed`
    // transcript, which drops the leading space the delta stream carried.
    for (let index = 1; index < snapshot.partials.length; index += 1) {
      const previous = snapshot.partials[index - 1].trim();
      const current = snapshot.partials[index].trim();
      expect(current.length).toBeGreaterThanOrEqual(previous.length);
      expect(current.startsWith(previous)).toBe(true);
    }

    // The single commit at stop resolved with the authoritative final.
    expect(snapshot.final?.trim().length ?? 0).toBeGreaterThan(0);

    // Loose match only — real ASR varies in punctuation, casing, and wording.
    // The fixture says "Please say hi and smile for me."
    expect(snapshot.final?.toLowerCase()).toContain("smile");
  });
});
