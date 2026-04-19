import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteLLMClient } from "@charivo/llm/remote";

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

describe("RemoteLLMClient", () => {
  it("calls the configured endpoint and returns message", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true, message: "hi there" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RemoteLLMClient({ apiEndpoint: "/api/chat" });
    const result = await client.call([{ role: "user", content: "hello" }]);

    expect(result).toBe("hi there");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/chat",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws when API responds with error status", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ error: "nope" }), {
          status: 500,
          statusText: "Server Error",
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RemoteLLMClient();

    await expect(client.call([])).rejects.toThrow("API call failed: nope");
    errorSpy.mockRestore();
  });

  it("throws when API indicates failure", async () => {
    const errorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const fetchMock = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: false, error: "bad request" }), {
          status: 200,
        }),
    );
    globalThis.fetch = fetchMock as typeof fetch;

    const client = new RemoteLLMClient();
    await expect(client.call([])).rejects.toThrow("bad request");
    errorSpy.mockRestore();
  });

  it("throws a timeout-specific error when the request is aborted", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const client = new RemoteLLMClient();
    const request = client.call([]);
    const expectation = expect(request).rejects.toThrow(
      "LLM request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("preserves non-timeout fetch errors", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const client = new RemoteLLMClient();

    await expect(client.call([])).rejects.toThrow("network down");
  });
});
