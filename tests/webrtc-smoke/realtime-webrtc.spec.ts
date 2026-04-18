import { expect, test } from "@playwright/test";
import {
  getSnapshot,
  stopSession,
  waitForAssistantCompletion,
  waitForConnected,
  waitForNoHarnessError,
  waitForToolAndAvatarActivity,
} from "./spec-helpers";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime WebRTC smoke harness", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test.afterEach(async ({ page }) => {
    await stopSession(page);
  });

  test("connects a live session and emits realtime tool/avatar events", async ({
    page,
  }) => {
    await page.goto("/");

    const connectButton = page.getByTestId("connect-button");
    const sendButton = page.getByTestId("send-button");

    await connectButton.click();

    await waitForConnected(page);
    await waitForNoHarnessError(page);

    await sendButton.click();

    await waitForAssistantCompletion(page, 1);
    await waitForNoHarnessError(page);

    await waitForToolAndAvatarActivity(page);

    const snapshot = await getSnapshot(page);

    expect(snapshot).toMatchObject({
      sessionStatus: "active",
      connection: "connected",
    });
    expect(snapshot.toolCalls.length).toBeGreaterThan(0);
    expect(snapshot.avatarEvents.length).toBeGreaterThan(0);
    expect(snapshot.assistantText.trim().length).toBeGreaterThan(0);
  });
});
