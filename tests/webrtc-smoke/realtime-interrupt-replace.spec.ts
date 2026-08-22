import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  interruptSession,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
  waitForAssistantText,
  waitForConnected,
  waitForNoHarnessError,
  waitForResponding,
} from "./spec-helpers";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

/**
 * Interrupt, then immediately send a replacement. The cancelled turn reports
 * afterwards, and its completion must not be credited to the replacement —
 * doing so releases the replacement's send lock while it is still pending.
 *
 * The adapter suites cover this deterministically, but only against a mock.
 * A mock can express orderings the SDK cannot produce, which has cut both ways
 * here: once making an unreachable defect look real, once hiding a real one.
 * This spec pins it against the actual SDK sequencing and a live server.
 *
 * It asserts the defect itself rather than counting turns: the fake microphone
 * can trip server VAD into an extra unsolicited turn, so any assertion on how
 * many turns ran is noise, not signal.
 */
test.describe("realtime interrupt-and-replace", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("never completes the turn it interrupted", async ({ page }) => {
    await page.goto("/");

    await page.getByTestId("connect-button").click();
    await waitForConnected(page);
    await waitForNoHarnessError(page);

    await sendPrompt(page, "Please count slowly from one to twenty.");
    await waitForResponding(page);
    await waitForAssistantText(page, 20);

    // What the interrupted turn had said so far. A completion carrying this
    // text later is that turn reporting in, whatever order it arrives in.
    const beforeInterrupt = await getSnapshot(page);
    const partial = beforeInterrupt.assistantText.trim();
    expect(partial.length).toBeGreaterThan(10);
    const doneEventsSeen = beforeInterrupt.events.filter(
      (event) => event.type === "realtime:assistant:done",
    ).length;
    const completionsBefore = beforeInterrupt.assistantCompletions;

    await interruptSession(page);
    expect((await getSnapshot(page)).awaitingResponse).toBe(false);

    // The SDK queues this behind the cancelled response, so that response
    // reports first — which is the window the defect lived in.
    await sendPrompt(page, "Never mind. Say the word done, once.");
    expect((await getSnapshot(page)).awaitingResponse).toBe(true);

    await waitForAssistantCompletion(page, completionsBefore + 1);
    await waitForNoHarnessError(page);

    const after = await getSnapshot(page);
    const laterDoneTexts = after.events
      .filter((event) => event.type === "realtime:assistant:done")
      .slice(doneEventsSeen)
      .map((event) => (event.payload as { text?: string }).text ?? "");

    // The assertion, and it does not depend on ordering: the interrupted turn
    // must never be reported as a completed turn. Before the fix its late
    // report surfaced here — indistinguishable from a real turn except by the
    // text it carried — and freed the replacement's lock.
    const head = partial.slice(0, 24);
    expect(laterDoneTexts.filter((text) => text.includes(head))).toEqual([]);

    expect(after.lastError).toBeNull();
    expect(after.assistantText.trim().length).toBeGreaterThan(0);
  });
});
