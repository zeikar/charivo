import type { Page } from "@playwright/test";
import type {
  CascadeHarnessApi,
  CascadeSnapshot,
} from "./cascade-harness-types";

type CascadeWindow = Window & {
  __charivoCascade?: CascadeHarnessApi;
};

export async function waitForHarnessReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as CascadeWindow).__charivoCascade),
    undefined,
    { timeout: 15_000 },
  );
}

export async function startTurn(page: Page, recordMs?: number): Promise<void> {
  // Fire the turn without awaiting it inside the page; the spec polls the
  // snapshot for completion (the full chain takes longer than an action call).
  await page.evaluate((ms: number | undefined) => {
    const cascade = (window as CascadeWindow).__charivoCascade;
    if (!cascade) {
      throw new Error("Cascade harness API is not available");
    }

    void cascade.runTurn(ms);
  }, recordMs);
}

export async function waitForTurnSettled(
  page: Page,
  timeout = 90_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const cascade = (window as CascadeWindow).__charivoCascade;
      const status = cascade?.getSnapshot().status;
      return status === "done" || status === "error";
    },
    undefined,
    { timeout },
  );
}

export async function getSnapshot(page: Page): Promise<CascadeSnapshot> {
  return page.evaluate(() => {
    const cascade = (window as CascadeWindow).__charivoCascade;
    if (!cascade) {
      throw new Error("Cascade harness API is not available");
    }

    return cascade.getSnapshot();
  });
}
