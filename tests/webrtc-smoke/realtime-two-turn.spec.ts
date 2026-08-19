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
 * Everything else in this harness drives a single turn, which is exactly why a
 * whole class of realtime defect stayed invisible: state that a turn leaves
 * behind only hurts the turn after it.
 *
 * What this covers: lip-sync analysis is paused at every playback end, and
 * resuming it used to hang off the SDK's `audio_start` — derived from a
 * transport `audio` event that only the WebSocket transport emits, so on WebRTC
 * the mouth stopped moving after turn one while audio kept playing.
 *
 * What this does NOT cover: the stranded response lock. Reproducing that needs
 * a turn that ends without text, which no prompt can be relied on to produce.
 * It is covered deterministically instead by "frees the manager send lock after
 * a turn that produced nothing" in the agents client suite.
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
