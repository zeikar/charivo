import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForLipSyncSamples,
  waitForNoHarnessError,
  waitForPlaybackEnded,
} from "./spec-helpers";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

/**
 * Every other spec here drives a single turn, so state a turn leaves behind
 * stayed invisible — lip-sync analysis paused at the first playback end and
 * never resumed.
 *
 * Not covered: the stranded send lock, which needs a turn that ends without
 * text. That one is deterministic in the agents client suite instead.
 */
test.describe("realtime WebRTC two-turn harness", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("keeps lip-sync alive into a second turn", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("connect-button").click();
    await waitForConnected(page);
    await waitForNoHarnessError(page);

    await sendPrompt(page, "Say hello in one short sentence.");
    await waitForAssistantCompletion(page, 1);
    // Playback outlives the response, and the segment closing is what pauses
    // analysis — the precondition for the second turn proving anything.
    await waitForPlaybackEnded(page, 1);
    await waitForNoHarnessError(page);

    const afterFirstTurn = await getSnapshot(page);

    // Baseline: the first turn has to actually produce spoken audio, or the
    // second-turn comparison below proves nothing.
    expect(afterFirstTurn.lipSync.audioStarts).toBeGreaterThan(0);
    expect(afterFirstTurn.lipSync.activeSamples).toBeGreaterThan(0);

    // Turn two.
    await sendPrompt(page, "Now count from one to three.");

    // The assertion, and it is a wait rather than a comparison: analysis has to
    // resume and meter real audio again. Before the fix this never happened, so
    // this call is what times out on a regression.
    await waitForLipSyncSamples(page, afterFirstTurn.lipSync.activeSamples);

    await waitForAssistantCompletion(page, 2);
    await waitForNoHarnessError(page);

    const afterSecondTurn = await getSnapshot(page);

    expect(afterSecondTurn.lastError).toBeNull();
    expect(afterSecondTurn.assistantCompletions).toBeGreaterThanOrEqual(2);
    expect(afterSecondTurn.lipSync.audioStarts).toBeGreaterThan(
      afterFirstTurn.lipSync.audioStarts,
    );
  });
});
