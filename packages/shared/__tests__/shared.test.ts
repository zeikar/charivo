import { describe, expect, it, vi } from "vitest";
import {
  CHARIVO_VERSION,
  DEFAULT_CONFIG,
  DEFAULT_REQUEST_TIMEOUT_MS,
  debounce,
  fetchWithTimeout,
  formatTimestamp,
  generateId,
  isAbortError,
  isRealtimeSessionBootstrap,
  isRecord,
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
    expect(DEFAULT_REQUEST_TIMEOUT_MS).toBe(30000);
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

  it("detects record-like values", () => {
    expect(isRecord({ ok: true })).toBe(true);
    expect(isRecord(null)).toBe(false);
    expect(isRecord("text")).toBe(false);
  });

  it("validates realtime bootstrap payloads", () => {
    expect(
      isRealtimeSessionBootstrap({
        adapter: "openai-webrtc",
        transport: "webrtc",
        answerSdp: "answer-sdp",
      }),
    ).toBe(true);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "openai-agents-webrtc",
        transport: "webrtc",
        clientSecret: "secret",
      }),
    ).toBe(true);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "future-ws",
        transport: "websocket",
        url: "wss://example.test/socket",
        token: "secret",
      }),
    ).toBe(true);
    expect(
      isRealtimeSessionBootstrap({
        transport: "webrtc",
        answerSdp: "answer-sdp",
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "future-invalid",
        transport: 1,
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "openai-webrtc",
        transport: "webrtc",
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "openai-agents-webrtc",
        transport: "webrtc",
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "future-ws",
        transport: "websocket",
        url: "wss://example.test/socket",
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "future-ws",
        transport: "websocket",
        token: "secret",
      }),
    ).toBe(false);
    expect(
      isRealtimeSessionBootstrap({
        adapter: "future-custom",
        transport: "sse",
      }),
    ).toBe(false);
  });

  it("detects abort errors and rewrites fetch timeouts", async () => {
    vi.useFakeTimers();
    const originalFetch = globalThis.fetch;
    const abortError = new Error("aborted");
    abortError.name = "AbortError";

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => reject(abortError));
        }),
    ) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/test",
      { method: "POST" },
      "timeout",
      10,
    );
    const expectation = expect(request).rejects.toThrow("timeout");

    await vi.advanceTimersByTimeAsync(10);
    await expectation;

    expect(isAbortError(abortError)).toBe(true);
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(new Error("other"))).toBe(false);

    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("returns fetch responses and preserves provided request init", async () => {
    const originalFetch = globalThis.fetch;
    const response = new Response("ok", { status: 200 });

    globalThis.fetch = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.method).toBe("POST");
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return response;
      },
    ) as typeof fetch;

    await expect(
      fetchWithTimeout("/api/test", { method: "POST" }, "timeout", 10),
    ).resolves.toBe(response);

    globalThis.fetch = originalFetch;
  });

  it("rethrows non-abort fetch errors", async () => {
    const originalFetch = globalThis.fetch;
    const failure = new Error("network down");

    globalThis.fetch = vi.fn(async () => {
      throw failure;
    }) as typeof fetch;

    await expect(
      fetchWithTimeout("/api/test", { method: "GET" }, "timeout", 10),
    ).rejects.toBe(failure);

    globalThis.fetch = originalFetch;
  });

  it("rethrows synchronously thrown fetch errors", async () => {
    const originalFetch = globalThis.fetch;
    const failure = new Error("sync failure");

    globalThis.fetch = vi.fn(() => {
      throw failure;
    }) as typeof fetch;

    await expect(
      fetchWithTimeout("/api/test", { method: "GET" }, "timeout", 10),
    ).rejects.toBe(failure);

    globalThis.fetch = originalFetch;
  });
});
