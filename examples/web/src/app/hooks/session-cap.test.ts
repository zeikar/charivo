import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createSessionCap } from "./session-cap";

describe("createSessionCap", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("fires the teardown once the budget elapses", () => {
    const teardown = vi.fn();
    const cap = createSessionCap();
    cap.update(teardown);
    cap.arm(90_000);

    vi.advanceTimersByTime(89_999);
    expect(teardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  /**
   * The regression this module exists for. A session is armed from inside the
   * call that starts it, so the teardown available at that moment still guards
   * on pre-start UI state and would no-op. Only the teardown current at fire
   * time actually stops the session.
   */
  it("fires the teardown current at fire time, not the one present when armed", () => {
    const staleTeardown = vi.fn();
    const freshTeardown = vi.fn();

    const cap = createSessionCap();
    cap.update(staleTeardown);
    cap.arm(90_000);

    // Stands in for React re-rendering with updated callbacks after the
    // session state flips to active.
    cap.update(freshTeardown);

    vi.advanceTimersByTime(90_000);

    expect(staleTeardown).not.toHaveBeenCalled();
    expect(freshTeardown).toHaveBeenCalledTimes(1);
  });

  it("does not fire after clear()", () => {
    const teardown = vi.fn();
    const cap = createSessionCap();
    cap.update(teardown);
    cap.arm(90_000);
    cap.clear();

    vi.advanceTimersByTime(200_000);
    expect(teardown).not.toHaveBeenCalled();
    expect(cap.isArmed()).toBe(false);
  });

  it("keeps only the most recent countdown when re-armed", () => {
    const teardown = vi.fn();
    const cap = createSessionCap();
    cap.update(teardown);

    cap.arm(90_000);
    vi.advanceTimersByTime(60_000);
    cap.arm(90_000);

    // The first countdown would have elapsed by now had it survived.
    vi.advanceTimersByTime(30_000);
    expect(teardown).not.toHaveBeenCalled();

    vi.advanceTimersByTime(60_000);
    expect(teardown).toHaveBeenCalledTimes(1);
  });

  it("reports armed state and disarms itself after firing", () => {
    const cap = createSessionCap();
    cap.update(vi.fn());

    expect(cap.isArmed()).toBe(false);
    cap.arm(90_000);
    expect(cap.isArmed()).toBe(true);

    vi.advanceTimersByTime(90_000);
    expect(cap.isArmed()).toBe(false);
  });

  it("is inert when armed with no teardown registered", () => {
    const cap = createSessionCap();
    cap.arm(90_000);

    expect(() => vi.advanceTimersByTime(90_000)).not.toThrow();
  });
});
