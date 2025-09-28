import { afterEach, describe, expect, it, vi } from "vitest";
import { RemoteLLMClient } from "@charivo/llm-client-remote";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
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
});
