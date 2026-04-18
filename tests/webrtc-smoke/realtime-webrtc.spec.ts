import { expect, test } from "@playwright/test";

const LIVE_ENABLED = process.env.RUN_LIVE_REALTIME_TESTS === "1";
const HAS_API_KEY = Boolean(process.env.OPENAI_API_KEY);

test.describe("realtime WebRTC smoke harness", () => {
  test.skip(
    !LIVE_ENABLED || !HAS_API_KEY,
    "Set RUN_LIVE_REALTIME_TESTS=1 and OPENAI_API_KEY to run live WebRTC smoke tests.",
  );

  test("connects a live session and emits realtime tool/avatar events", async ({
    page,
  }) => {
    await page.goto("/");

    const connectButton = page.getByTestId("connect-button");
    const sendButton = page.getByTestId("send-button");
    const sessionStatus = page.getByTestId("session-status");
    const assistantStatus = page.getByTestId("assistant-status");
    const lastError = page.getByTestId("last-error");

    await connectButton.click();

    await expect(sessionStatus).toContainText("connected/active", {
      timeout: 60_000,
    });
    await expect(lastError).toHaveText("-", {
      timeout: 5_000,
    });

    await sendButton.click();

    await expect(assistantStatus).toContainText("completed", {
      timeout: 60_000,
    });
    await expect(lastError).toHaveText("-", {
      timeout: 5_000,
    });

    await page.waitForFunction(() => {
      const smoke = (
        window as Window & {
          __charivoSmoke?: {
            getSnapshot: () => {
              toolCalls: Array<{ name: string }>;
              avatarEvents: Array<{ type: string }>;
              assistantText: string;
            };
          };
        }
      ).__charivoSmoke;

      if (!smoke) {
        return false;
      }

      const snapshot = smoke.getSnapshot();
      return (
        snapshot.toolCalls.length > 0 &&
        snapshot.avatarEvents.length > 0 &&
        snapshot.assistantText.trim().length > 0
      );
    });

    const snapshot = await page.evaluate(() => {
      const smoke = (
        window as Window & {
          __charivoSmoke?: { getSnapshot: () => unknown };
        }
      ).__charivoSmoke;

      if (!smoke) {
        throw new Error("Smoke harness state is not available");
      }

      return smoke.getSnapshot();
    });

    expect(snapshot).toMatchObject({
      sessionStatus: "active",
      connection: "connected",
    });
    expect(
      (snapshot as { toolCalls: unknown[] }).toolCalls.length,
    ).toBeGreaterThan(0);
    expect(
      (snapshot as { avatarEvents: unknown[] }).avatarEvents.length,
    ).toBeGreaterThan(0);
    expect(
      (snapshot as { assistantText: string }).assistantText.trim().length,
    ).toBeGreaterThan(0);
  });
});
