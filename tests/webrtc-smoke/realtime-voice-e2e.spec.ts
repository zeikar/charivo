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

// Voice end-to-end turnaround.
//
// Mirrors `realtime-avatar-prompt.spec.ts` but with a canned WAV feeding
// Chromium's fake microphone in place of `sendMessage(text)`. Exercises the
// full realistic voice path: server VAD endpoints the utterance, the agent
// selects and runs avatar tools, and the first assistant response cycle
// streams back.
//
// The `sessionStart → assistantStart` delta reported here is NOT a pure
// latency baseline — it includes session setup, WAV playback drift, VAD
// endpointing, model processing, AND tool selection overhead. For a tool-
// free latency baseline use `realtime-voice-baseline.spec.ts`.

const WAV_PATH = fileURLToPath(
  new URL("fixtures/voice-smoke-input.wav", import.meta.url),
);
const WAV_PRESENT = existsSync(WAV_PATH);

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const VOICE_ENABLED = process.env.RUN_LIVE_VOICE === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime voice e2e", () => {
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

  test("drives a realistic voice turn through canned audio with tools", async ({
    page,
  }) => {
    await page.goto("/?mode=voice-e2e");

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
      `[voice e2e] sessionStart→assistantStart: ${deltaMs}ms ` +
        `(sessionStartAt=${sessionStartAt}, firstAssistantEventAt=${firstAssistantEventAt}; ` +
        `includes session setup + WAV playback + VAD + model + tool selection)`,
    );
    console.log(
      `[voice e2e] assistant response: ${JSON.stringify(snapshot.assistantText)}`,
    );
    console.log(
      `[voice e2e] tool calls: ${JSON.stringify(snapshot.toolCalls)}`,
    );
    console.log(
      `[voice e2e] avatar events: ${JSON.stringify(snapshot.avatarEvents)}`,
    );

    expect(deltaMs).not.toBeNull();
    expect(deltaMs!).toBeGreaterThan(0);
    expect(deltaMs!).toBeLessThan(20_000);
  });
});
