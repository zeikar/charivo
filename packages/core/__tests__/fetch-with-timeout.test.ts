import { afterEach, describe, expect, it, vi } from "vitest";
import {
  CharivoTimeoutError,
  CharivoTransportError,
  DEFAULT_FETCH_TIMEOUT_MS,
  fetchWithTimeout,
} from "@charivo/core";

const originalFetch = globalThis.fetch;

const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("fetchWithTimeout", () => {
  it("rejects with CharivoTimeoutError carrying the abort cause when the internal timeout fires", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out" },
    );
    const expectation =
      expect(request).rejects.toBeInstanceOf(CharivoTimeoutError);

    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);

    await expectation;
    await expect(request).rejects.toMatchObject({
      message: "timed out",
      cause: expect.any(Error),
    });
  });

  it("forwards an already-aborted external signal synchronously before fetch is called, with no listener registered", async () => {
    const controller = new AbortController();
    controller.abort();
    const addEventListenerSpy = vi.spyOn(controller.signal, "addEventListener");

    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      // Real fetch rejects immediately with the reason when handed an
      // already-aborted signal, without starting a network request.
      Promise.reject(init?.signal?.reason),
    ) as typeof fetch;

    await expect(
      fetchWithTimeout(
        "/api/thing",
        {},
        { timeoutMessage: "timed out", signal: controller.signal },
      ),
    ).rejects.toBe(controller.signal.reason);

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it("forwards an already-aborted external signal with a custom non-Error reason", async () => {
    const controller = new AbortController();
    controller.abort("custom-reason");
    const addEventListenerSpy = vi.spyOn(controller.signal, "addEventListener");

    globalThis.fetch = vi.fn((_input: RequestInfo | URL, init?: RequestInit) =>
      Promise.reject(init?.signal?.reason),
    ) as typeof fetch;

    await expect(
      fetchWithTimeout(
        "/api/thing",
        {},
        { timeoutMessage: "timed out", signal: controller.signal },
      ),
    ).rejects.toBe("custom-reason");

    expect(addEventListenerSpy).not.toHaveBeenCalled();
  });

  it("aborts the signal handed to fetch when the external signal aborts mid-flight, and rethrows the abort error as-is", async () => {
    const controller = new AbortController();
    let signalGivenToFetch: AbortSignal | undefined;
    const abortError = createAbortError();

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) => {
        signalGivenToFetch = init?.signal ?? undefined;
        return new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(abortError);
          });
        });
      },
    ) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", signal: controller.signal },
    );

    controller.abort();

    expect(signalGivenToFetch?.aborted).toBe(true);
    await expect(request).rejects.toBe(abortError);
  });

  it("rethrows the external signal's own reason as-is when fetch's rejection is that exact reason (not an AbortError-named error)", async () => {
    const controller = new AbortController();
    const customReason = { code: "cancelled" };

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(init.signal!.reason);
          });
        }),
    ) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", signal: controller.signal },
    );

    controller.abort(customReason);

    await expect(request).rejects.toBe(customReason);
  });

  it("race pinning: classifies as CharivoTimeoutError when the timeout wins even if the external signal also aborts before classification", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();

    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            // Simulate the external signal aborting after the internal
            // timeout already fired, but before this rejection is caught
            // and classified.
            controller.abort();
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", signal: controller.signal },
    );
    const expectation =
      expect(request).rejects.toBeInstanceOf(CharivoTimeoutError);

    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);

    await expectation;
  });

  it("falls back to the default transport wrap when fetch rejects with a network error and the external signal aborts before classification (lost race)", async () => {
    const controller = new AbortController();

    globalThis.fetch = vi.fn(() => {
      // The external signal aborts "concurrently" with the network failure,
      // but the rejection is a plain network error, not that abort/reason,
      // and not an AbortError - so it must still be classified as a
      // transport failure, not rethrown as the external abort.
      controller.abort();
      return Promise.reject(new TypeError("Failed to fetch"));
    }) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", signal: controller.signal },
    );

    await expect(request).rejects.toBeInstanceOf(CharivoTransportError);
    await expect(request).rejects.toMatchObject({
      message: "Request failed",
      cause: expect.objectContaining({ message: "Failed to fetch" }),
    });
  });

  it("wraps a plain network TypeError as CharivoTransportError with failureMessage and cause", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new TypeError("Failed to fetch");
    }) as typeof fetch;

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", failureMessage: "LLM request failed" },
    );

    await expect(request).rejects.toBeInstanceOf(CharivoTransportError);
    await expect(request).rejects.toMatchObject({
      message: "LLM request failed",
      cause: expect.objectContaining({ message: "Failed to fetch" }),
    });
  });

  it("uses mapError instead of the default transport wrap when provided", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("boom");
    }) as typeof fetch;

    class CustomError extends Error {}

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      {
        timeoutMessage: "timed out",
        mapError: (error) => new CustomError(`mapped: ${String(error)}`),
      },
    );

    await expect(request).rejects.toBeInstanceOf(CustomError);
    await expect(request).rejects.toMatchObject({
      message: "mapped: Error: boom",
    });
  });

  it("resolves with the Response on success, and a later timer tick causes no stray abort or unhandled rejection", async () => {
    vi.useFakeTimers();
    const response = new Response("ok");
    globalThis.fetch = vi.fn(async () => response) as typeof fetch;
    const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");

    const request = fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out" },
    );

    const result = await request;
    expect(result).toBe(response);
    expect(clearTimeoutSpy).toHaveBeenCalled();

    // Advancing the timer past the (already-cleared) timeout must not throw
    // or produce a stray rejection.
    await vi.advanceTimersByTimeAsync(DEFAULT_FETCH_TIMEOUT_MS);
  });

  it("removes the abort listener from the external signal after settling", async () => {
    const response = new Response("ok");
    globalThis.fetch = vi.fn(async () => response) as typeof fetch;

    const controller = new AbortController();
    const removeEventListenerSpy = vi.spyOn(
      controller.signal,
      "removeEventListener",
    );

    await fetchWithTimeout(
      "/api/thing",
      {},
      { timeoutMessage: "timed out", signal: controller.signal },
    );

    expect(removeEventListenerSpy).toHaveBeenCalledWith(
      "abort",
      expect.any(Function),
    );
  });
});
