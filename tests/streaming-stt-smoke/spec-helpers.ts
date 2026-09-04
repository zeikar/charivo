import type { Page } from "@playwright/test";
import type {
  StreamingSTTHarnessApi,
  StreamingSTTSnapshot,
} from "./streaming-stt-harness-types";

type StreamingSTTWindow = Window & {
  __charivoStreamingStt?: StreamingSTTHarnessApi;
};

export async function waitForHarnessReady(page: Page): Promise<void> {
  await page.waitForFunction(
    () => Boolean((window as StreamingSTTWindow).__charivoStreamingStt),
    undefined,
    { timeout: 15_000 },
  );
}

export async function startRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as StreamingSTTWindow).__charivoStreamingStt;
    if (!harness) {
      throw new Error("Streaming STT harness API is not available");
    }

    harness.start();
  });
}

/**
 * Wait until capture is live, so a fixed record window measures audio rather
 * than session bring-up. See `StreamingSTTStatus` in the harness types.
 */
export async function waitForCapturing(
  page: Page,
  timeout = 15_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const harness = (window as StreamingSTTWindow).__charivoStreamingStt;
      const snapshot = harness?.getSnapshot();
      if (snapshot?.status === "error") {
        // A session that already failed will never capture; report why now
        // instead of spending the whole timeout on it.
        throw new Error(`session failed before capture: ${snapshot.error}`);
      }

      return snapshot?.status === "recording";
    },
    undefined,
    { timeout },
  );
}

export async function stopRecording(page: Page): Promise<void> {
  await page.evaluate(() => {
    const harness = (window as StreamingSTTWindow).__charivoStreamingStt;
    if (!harness) {
      throw new Error("Streaming STT harness API is not available");
    }

    harness.stop();
  });
}

export async function waitForSettled(
  page: Page,
  timeout = 30_000,
): Promise<void> {
  await page.waitForFunction(
    () => {
      const harness = (window as StreamingSTTWindow).__charivoStreamingStt;
      const status = harness?.getSnapshot().status;
      return status === "done" || status === "error";
    },
    undefined,
    { timeout },
  );
}

export async function getSnapshot(page: Page): Promise<StreamingSTTSnapshot> {
  return page.evaluate(() => {
    const harness = (window as StreamingSTTWindow).__charivoStreamingStt;
    if (!harness) {
      throw new Error("Streaming STT harness API is not available");
    }

    return harness.getSnapshot();
  });
}
