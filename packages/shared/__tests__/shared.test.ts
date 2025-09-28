import { describe, expect, it, vi } from "vitest";
import {
  CHARIVO_VERSION,
  DEFAULT_CONFIG,
  debounce,
  formatTimestamp,
  generateId,
  throttle,
} from "@charivo/shared";

describe("shared utilities", () => {
  it("exposes the framework version", () => {
    expect(CHARIVO_VERSION).toMatch(/\d+\.\d+\.\d+/);
  });

  it("provides a readonly default config", () => {
    expect(DEFAULT_CONFIG).toEqual({
      maxMessages: 100,
      responseTimeout: 30000,
      retryAttempts: 3,
    });
  });

  it("generates reasonably unique ids", () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateId());
    }
    expect(ids.size).toBe(100);
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9]{9}$/);
    }
  });

  it("formats timestamps as ISO strings", () => {
    const date = new Date("2024-01-01T00:00:00.000Z");
    expect(formatTimestamp(date)).toBe("2024-01-01T00:00:00.000Z");
  });

  it("debounces function calls", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const debounced = debounce(spy, 100);

    debounced();
    debounced();
    debounced();

    vi.advanceTimersByTime(99);
    expect(spy).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(spy).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });

  it("throttles function calls", () => {
    vi.useFakeTimers();
    const spy = vi.fn();
    const throttled = throttle(spy, 100);

    throttled();
    throttled();
    throttled();

    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(99);
    throttled();
    expect(spy).toHaveBeenCalledTimes(1);

    vi.advanceTimersByTime(1);
    throttled();
    expect(spy).toHaveBeenCalledTimes(2);
    vi.useRealTimers();
  });
});
