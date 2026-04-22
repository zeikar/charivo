import { expect, test } from "@playwright/test";
import {
  forceReconnectOutage,
  getSnapshot,
  sendPrompt,
  stopSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForNoHarnessError,
} from "./spec-helpers";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime reconnect smoke", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("recovers after a forced transport outage without restarting the session", async ({
    page,
  }) => {
    await page.goto("/");

    await page.getByTestId("connect-button").click();
    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const before = await getSnapshot(page);
    const sessionBoundaryCountBefore = before.events.filter(
      (event) =>
        event.type === "realtime:session:start" ||
        event.type === "realtime:session:end",
    ).length;

    // Browser offline emulation does not reliably sever an already-established
    // WebRTC session in Chromium. For the live reconnect smoke, force-close the
    // active transport so we deterministically exercise the reconnect path.
    await forceReconnectOutage(page);

    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: {
              getSnapshot(): { events: Array<{ type: string }> };
            };
          }
        ).__charivoSmoke;

        return (
          smoke
            ?.getSnapshot()
            .events.some(
              (event) => event.type === "realtime:reconnect:attempt",
            ) ?? false
        );
      },
      undefined,
      { timeout: 60_000 },
    );

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    const completionsBeforePrompt = (await getSnapshot(page))
      .assistantCompletions;
    await sendPrompt(page, "Say hello again in one short sentence.");
    await waitForAssistantCompletion(page, completionsBeforePrompt + 1);

    const after = await getSnapshot(page);
    const sessionBoundaryCountAfter = after.events.filter(
      (event) =>
        event.type === "realtime:session:start" ||
        event.type === "realtime:session:end",
    ).length;

    expect(after.connection).toBe("connected");
    expect(after.sessionStatus).toBe("active");
    expect(
      after.events.some((event) => event.type === "realtime:reconnect:success"),
    ).toBe(true);
    expect(sessionBoundaryCountAfter).toBe(sessionBoundaryCountBefore);
  });
});
