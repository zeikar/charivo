import type { Page } from "@playwright/test";
import type { HarnessSnapshot, SmokeHarnessApi } from "./harness-types";

type SmokeWindow = Window & {
  __charivoSmoke?: SmokeHarnessApi;
  __charivoAssistantSettle?: {
    signature: string;
    since: number;
  };
};

export async function getSnapshot(page: Page): Promise<HarnessSnapshot> {
  return page.evaluate(() => {
    const smoke = (window as SmokeWindow).__charivoSmoke;

    if (!smoke) {
      throw new Error("Smoke harness state is not available");
    }

    return smoke.getSnapshot();
  });
}

export async function sendPrompt(page: Page, text: string): Promise<void> {
  await page.evaluate((nextText: string) => {
    const smoke = (window as SmokeWindow).__charivoSmoke;

    if (!smoke) {
      throw new Error("Smoke harness API is not available");
    }

    return smoke.sendPrompt(nextText);
  }, text);
}

export async function updateSession(
  page: Page,
  config: Record<string, unknown>,
): Promise<void> {
  await page.evaluate((nextConfig: Record<string, unknown>) => {
    const smoke = (window as SmokeWindow).__charivoSmoke;

    if (!smoke) {
      throw new Error("Smoke harness API is not available");
    }

    return smoke.updateSession(nextConfig);
  }, config);
}

export async function forceReconnectOutage(page: Page): Promise<void> {
  await page.evaluate(() => {
    const smoke = (window as SmokeWindow).__charivoSmoke;

    if (!smoke) {
      throw new Error("Smoke harness API is not available");
    }

    return smoke.forceReconnectOutage();
  });
}

export async function stopSession(page: Page): Promise<void> {
  if (page.isClosed()) {
    return;
  }

  try {
    await page.evaluate(() => {
      const smoke = (window as SmokeWindow).__charivoSmoke;

      if (!smoke) {
        return;
      }

      void smoke.stopSession();
    });

    await page.waitForFunction(
      () => {
        const smoke = (window as SmokeWindow).__charivoSmoke;

        if (!smoke) {
          return true;
        }

        return smoke.getSnapshot().sessionStatus === "idle";
      },
      undefined,
      { timeout: 5_000 },
    );
  } catch {
    // Best-effort cleanup for live sessions.
  }
}

export async function waitForConnected(page: Page): Promise<void> {
  await page.waitForFunction(
    () => {
      const smoke = (window as SmokeWindow).__charivoSmoke;

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
}

export async function waitForNoHarnessError(
  page: Page,
  timeout = 5_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const smoke = (window as SmokeWindow).__charivoSmoke;

      return smoke?.getSnapshot().lastError === null;
    },
    undefined,
    {
      timeout,
    },
  );
}

export async function waitForAssistantCompletion(
  page: Page,
  completedTurns: number,
): Promise<void> {
  await page.waitForFunction(
    (expectedCompletions: number) => {
      const smoke = (window as SmokeWindow).__charivoSmoke;

      if (!smoke) {
        return false;
      }

      const snapshot = smoke.getSnapshot();
      return (
        snapshot.assistantCompletions >= expectedCompletions &&
        snapshot.assistantStatus === "completed" &&
        snapshot.assistantText.trim().length > 0
      );
    },
    completedTurns,
    {
      timeout: 60_000,
    },
  );
}

export async function waitForAssistantSettled(
  page: Page,
  quietMs = 1_200,
): Promise<void> {
  await page.waitForFunction(
    (expectedQuietMs: number) => {
      const smokeWindow = window as SmokeWindow;
      const smoke = smokeWindow.__charivoSmoke;

      if (!smoke) {
        return false;
      }

      const snapshot = smoke.getSnapshot();

      if (
        snapshot.lastError !== null ||
        snapshot.assistantStatus !== "completed"
      ) {
        smokeWindow.__charivoAssistantSettle = undefined;
        return false;
      }

      const signature = JSON.stringify([
        snapshot.assistantCompletions,
        snapshot.assistantText,
        snapshot.toolCalls.length,
        snapshot.avatarEvents.length,
        snapshot.usageEvents.length,
      ]);
      const now = Date.now();
      const settled = smokeWindow.__charivoAssistantSettle;

      if (!settled || settled.signature !== signature) {
        smokeWindow.__charivoAssistantSettle = {
          signature,
          since: now,
        };
        return false;
      }

      return now - settled.since >= expectedQuietMs;
    },
    quietMs,
    {
      timeout: 15_000,
    },
  );
}

export async function waitForToolAndAvatarActivity(page: Page): Promise<void> {
  await page.waitForFunction(() => {
    const smoke = (window as SmokeWindow).__charivoSmoke;

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
}

export async function waitForSessionInstructions(
  page: Page,
  expectedFragment: string,
): Promise<void> {
  await page.waitForFunction(
    (fragment: string) => {
      const smoke = (window as SmokeWindow).__charivoSmoke;

      if (!smoke) {
        return false;
      }

      return (
        smoke.getSnapshot().sessionInstructions?.includes(fragment) ?? false
      );
    },
    expectedFragment,
    {
      timeout: 30_000,
    },
  );
}
