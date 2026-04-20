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

// Voice latency baseline for Phase 0.
//
// T0 = realtime:session:start + known WAV offsets. The fixture structure is
//   500ms leading silence + ~2000ms speech + 1500ms trailing silence.
// T1 = realtime:assistant:start (first response-side signal).
//
// deltaMs floors at roughly 3000ms (2000ms speech + ~500ms server VAD silence
// window + ~500ms playback-start drift after session:start). The interesting
// part is run-to-run variance and any upward trend over time — not the
// absolute value. Bounds here are sanity, not gates.

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
    "Set RUN_LIVE_REALTIME_TESTS=1 RUN_LIVE_VOICE=1 OPENAI_API_KEY=... to run voice baseline.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("measures session-start to first assistant event with canned audio", async ({
    page,
  }) => {
    await page.goto("/?mode=voice");

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

    // Wait for the full response so assistantText is finalized before logging.
    await waitForAssistantCompletion(page, 1);
    await waitForNoHarnessError(page);

    const snapshot = await getSnapshot(page);
    const { deltaMs, sessionStartAt, firstAssistantEventAt } =
      snapshot.voiceLatency;

    console.log(
      `[voice baseline] sessionStart→assistantStart: ${deltaMs}ms ` +
        `(sessionStartAt=${sessionStartAt}, firstAssistantEventAt=${firstAssistantEventAt}; ` +
        `includes ~2000ms speech + ~500ms trailing silence before VAD endpoint + network + model)`,
    );
    console.log(
      `[voice baseline] assistant response: ${JSON.stringify(snapshot.assistantText)}`,
    );
    console.log(
      `[voice baseline] tool calls: ${JSON.stringify(snapshot.toolCalls)}`,
    );
    console.log(
      `[voice baseline] avatar events: ${JSON.stringify(snapshot.avatarEvents)}`,
    );

    expect(deltaMs).not.toBeNull();
    expect(deltaMs!).toBeGreaterThan(0);
    expect(deltaMs!).toBeLessThan(20_000);
  });
});
