import type { RealtimeState } from "@charivo/core";
import { subscribeBrowserLifecycle } from "@charivo/core";

type WakeLockSentinelLike = {
  release(): Promise<void>;
  addEventListener?(
    type: "release",
    listener: () => void,
    options?: AddEventListenerOptions,
  ): void;
};

export class RealtimeBrowserLifecycle {
  private wakeLockSentinel: WakeLockSentinelLike | null = null;
  private teardownBrowserLifecycle?: () => void;

  constructor(private readonly getState: () => RealtimeState) {}

  install(): void {
    if (this.teardownBrowserLifecycle) {
      return;
    }

    this.teardownBrowserLifecycle = subscribeBrowserLifecycle({
      onHidden: () => {
        void this.releaseWakeLock();
      },
      onPageHide: () => {
        void this.releaseWakeLock();
      },
      onPageShow: () => {
        void this.requestWakeLock();
      },
      onVisible: () => {
        void this.requestWakeLock();
      },
    });
  }

  dispose(): void {
    this.teardownBrowserLifecycle?.();
    this.teardownBrowserLifecycle = undefined;
    void this.releaseWakeLock();
  }

  async requestWakeLock(): Promise<void> {
    const state = this.getState();
    if (
      state.session.status !== "active" ||
      state.connection === "disconnecting" ||
      typeof navigator === "undefined" ||
      typeof document === "undefined" ||
      document.visibilityState !== "visible" ||
      !("wakeLock" in navigator)
    ) {
      return;
    }

    if (this.wakeLockSentinel) {
      return;
    }

    const wakeLockApi = navigator as Navigator & {
      wakeLock?: {
        request(type: "screen"): Promise<WakeLockSentinelLike>;
      };
    };

    try {
      this.wakeLockSentinel = await wakeLockApi.wakeLock?.request("screen");
      this.wakeLockSentinel?.addEventListener?.(
        "release",
        () => {
          this.wakeLockSentinel = null;
        },
        { once: true },
      );
    } catch {
      // Best-effort only.
    }
  }

  async releaseWakeLock(): Promise<void> {
    if (!this.wakeLockSentinel) {
      return;
    }

    const wakeLockSentinel = this.wakeLockSentinel;
    this.wakeLockSentinel = null;

    try {
      await wakeLockSentinel.release();
    } catch {
      // Best-effort only.
    }
  }
}
