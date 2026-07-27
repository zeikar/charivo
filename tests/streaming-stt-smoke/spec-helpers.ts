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
