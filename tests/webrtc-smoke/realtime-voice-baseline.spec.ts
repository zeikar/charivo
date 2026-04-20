import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  stopSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForNoHarnessError,
} from "./spec-helpers";

// Tool-free voice latency baseline.
//
// Pairs with `realtime-voice-e2e.spec.ts`. The e2e spec exercises tools
// (noisy for latency); this spec strips the tool surface and custom
// instructions so the measured delta reflects only network + VAD + model.
//
// ── Timing anchors ────────────────────────────────────────────────────
// T0 = realtime:session:start (when the realtime manager reports the
//   session as active in the browser)
// T1 = realtime:assistant:start (first response-side event from the model)
//
// The raw deltaMs from T0 to T1 includes known fixed cost from the WAV
// fixture (leading silence + speech + VAD silence window). We subtract
// that cost below to derive an "estimated post-VAD response latency"
// that trends with model+network behavior rather than fixture length.
//
// If the WAV is regenerated with different voice/rate, update the
// constants below to match the new fixture. See
// `tests/webrtc-smoke/fixtures/README.md` for the regeneration command.

// Current fixture: 500ms leading silence + ~2000ms speech + 1500ms trailing silence.
const WAV_LEADING_SILENCE_MS = 500;
const WAV_SPEECH_MS = 2000;
// OpenAI Realtime server VAD default silence threshold before endpointing.
// https://platform.openai.com/docs/guides/realtime-vad
const VAD_SILENCE_THRESHOLD_MS = 500;
// Sum of "fixed" cost from WAV playback start to the moment VAD endpoints
// the utterance. Anything beyond this floor is model + network latency.
const WAV_SPEECH_END_OFFSET_MS =
  WAV_LEADING_SILENCE_MS + WAV_SPEECH_MS + VAD_SILENCE_THRESHOLD_MS;

const WAV_PATH = fileURLToPath(
  new URL("fixtures/voice-smoke-input.wav", import.meta.url),
);
const WAV_PRESENT = existsSync(WAV_PATH);

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const VOICE_ENABLED = process.env.RUN_LIVE_VOICE === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime voice latency baseline", () => {
  test.skip(
    !WAV_PRESENT,
    "voice-smoke-input.wav missing — see tests/webrtc-smoke/fixtures/README.md",
  );
  test.skip(
    !LIVE_ENABLED || !VOICE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 RUN_LIVE_VOICE=1 OPENAI_API_KEY=... to run voice suite.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("measures VAD-to-response latency on a tool-free session", async ({
    page,
  }) => {
    await page.goto("/?mode=voice-baseline");

    await page.getByTestId("connect-button").click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: {
              getSnapshot: () => { voiceLatency: { deltaMs: number | null } };
            };
          }
        ).__charivoSmoke;
        return smoke?.getSnapshot().voiceLatency.deltaMs !== null;
      },
      undefined,
      { timeout: 30_000 },
    );

    await waitForAssistantCompletion(page, 1);
    await waitForNoHarnessError(page);

    const snapshot = await getSnapshot(page);
    const { deltaMs } = snapshot.voiceLatency;

    const postVadEstimateMs =
      deltaMs !== null ? deltaMs - WAV_SPEECH_END_OFFSET_MS : null;

    console.log(
      `[voice baseline] raw sessionStart→assistantStart: ${deltaMs}ms`,
    );
    console.log(
      `[voice baseline] post-VAD response estimate: ${postVadEstimateMs}ms ` +
        `(raw − ${WAV_SPEECH_END_OFFSET_MS}ms fixed WAV+VAD cost)`,
    );
    console.log(
      `[voice baseline] assistant response: ${JSON.stringify(snapshot.assistantText)}`,
    );

    expect(deltaMs).not.toBeNull();
    expect(deltaMs!).toBeGreaterThan(0);
    expect(deltaMs!).toBeLessThan(20_000);
  });
});
