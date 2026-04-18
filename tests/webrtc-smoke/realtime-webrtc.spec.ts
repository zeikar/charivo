import { expect, test, type Page } from "@playwright/test";
import type { HarnessSnapshot, SmokeHarnessApi } from "./harness-types";

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

    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: SmokeHarnessApi;
          }
        ).__charivoSmoke;

        if (!smoke) {
          return false;
        }

        const snapshot = smoke.getSnapshot();
        return (
          snapshot.connection === "connected" &&
          snapshot.sessionStatus === "active"
        );
      },
      undefined,
      {
        timeout: 60_000,
      },
    );
    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: SmokeHarnessApi;
          }
        ).__charivoSmoke;

        return smoke?.getSnapshot().lastError === null;
      },
      undefined,
      {
        timeout: 5_000,
      },
    );

    await sendButton.click();

    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: SmokeHarnessApi;
          }
        ).__charivoSmoke;

        if (!smoke) {
          return false;
        }

        const snapshot = smoke.getSnapshot();
        return (
          snapshot.assistantStatus === "completed" &&
          snapshot.assistantText.trim().length > 0
        );
      },
      undefined,
      {
        timeout: 60_000,
      },
    );
    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: SmokeHarnessApi;
          }
        ).__charivoSmoke;

        return smoke?.getSnapshot().lastError === null;
      },
      undefined,
      {
        timeout: 5_000,
      },
    );

    await page.waitForFunction(() => {
      const smoke = (
        window as Window & {
          __charivoSmoke?: SmokeHarnessApi;
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

async function getSnapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => {
    const smoke = (
      window as Window & {
        __charivoSmoke?: SmokeHarnessApi;
      }
    ).__charivoSmoke;

    if (!smoke) {
      throw new Error("Smoke harness state is not available");
    }

    return smoke.getSnapshot();
  });
}

async function stopSession(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  try {
    await page.evaluate(() => {
      const smoke = (
        window as Window & {
          __charivoSmoke?: SmokeHarnessApi;
        }
      ).__charivoSmoke;

      if (!smoke) {
        return;
      }

      void smoke.stopSession();
    });

    await page.waitForFunction(
      () => {
        const smoke = (
          window as Window & {
            __charivoSmoke?: SmokeHarnessApi;
          }
        ).__charivoSmoke;

        if (!smoke) {
          return true;
        }

        const snapshot = smoke.getSnapshot();
        return snapshot.sessionStatus === "idle";
      },
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    // Best-effort cleanup for live sessions.
  }
}
