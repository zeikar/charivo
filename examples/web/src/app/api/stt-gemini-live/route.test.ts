import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { STT_GEMINI_LIVE_MODEL } from "../demo-limits";

const AUTH_TOKENS_URL =
  "https://generativelanguage.googleapis.com/v1beta/auth_tokens";
const GEMINI_LIVE_WEBSOCKET_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";
const TOKEN = "auth_tokens/ephemeral";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

function bootstrapRequest(body: unknown): Request {
  return new Request("http://localhost/api/stt-gemini-live", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function mintCall(): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { url, init };
}

function mintSetup(): Record<string, unknown> {
  const payload = JSON.parse(String(mintCall().init.body)) as {
    bidiGenerateContentSetup: Record<string, unknown>;
  };
  return payload.bidiGenerateContentSetup;
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("examples/web /api/stt-gemini-live route", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    fetchMock.mockReset();
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    // The route logs every failure; keep the expected failures out of the run.
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it("mints a single-use token and hands back the websocket url it is good for", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: TOKEN })),
    );

    const response = await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );

    const { url, init } = mintCall();
    // The key rides the header, never the query string: proxies and request
    // logs capture URLs.
    expect(url).toBe(AUTH_TOKENS_URL);
    expect(headerOf(init, "x-goog-api-key")).toBe("test-key");
    expect(headerOf(init, "Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      uses: 1,
      bidiGenerateContentSetup: {
        model: `models/${STT_GEMINI_LIVE_MODEL}`,
        generationConfig: { responseModalities: ["TEXT"] },
        inputAudioTranscription: { mode: "VERBATIM" },
        // The minted setup replaces the browser's, so manual VAD only holds if
        // it is pinned here: otherwise the server segments the recording itself.
        realtimeInputConfig: {
          automaticActivityDetection: { disabled: true },
        },
      },
    });
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      url: GEMINI_LIVE_WEBSOCKET_URL,
      token: TOKEN,
    });
  });

  it("pins the transcription model, ignoring the caller's choice", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: TOKEN })),
    );

    await POST(
      bootstrapRequest({
        session: { model: "gemini-3.1-flash-live-preview" },
      }) as never,
    );

    expect(mintSetup().model).toBe(`models/${STT_GEMINI_LIVE_MODEL}`);
  });

  it("mints a session when the caller omits the model entirely", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: TOKEN })),
    );

    const response = await POST(bootstrapRequest({}) as never);

    expect(response.status).toBe(200);
    expect(mintSetup().model).toBe(`models/${STT_GEMINI_LIVE_MODEL}`);
  });

  it("forwards the language hint only when the transcriber supplies one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ name: TOKEN })),
    );

    await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL, language: "ko-KR" },
      }) as never,
    );

    expect(mintSetup().inputAudioTranscription).toEqual({
      mode: "VERBATIM",
      languageCodes: ["ko-KR"],
    });
  });

  it("fails when the Gemini key is not configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const response = await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "GEMINI_API_KEY not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a failed mint with the upstream status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("quota exceeded", { status: 429 }),
    );

    const response = await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to mint the streaming transcription token",
      details: "[auth_tokens] mint failed with 429: quota exceeded",
    });
  });

  it("rejects a mint response that is not JSON", async () => {
    fetchMock.mockResolvedValueOnce(new Response("<html>gateway</html>"));

    const response = await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toBe(
      "[auth_tokens] response was not JSON: <html>gateway</html>",
    );
  });

  it("rejects a mint response that carries no token name", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ expireTime: "2026-09-04T00:00:00Z" })),
    );

    const response = await POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("[auth_tokens]");
    expect(payload.details).toContain("no ephemeral token `name`");
  });

  it("aborts the mint on the bootstrap deadline", async () => {
    vi.useFakeTimers();

    // Only the abort resolves this call, so the deadline has to actually fire
    // the signal — a route that merely carried a timeout would hang here.
    fetchMock.mockImplementationOnce(
      (_url: string, init: RequestInit) =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener("abort", () =>
            reject(new Error("The operation was aborted")),
          );
        }),
    );

    const pending = POST(
      bootstrapRequest({
        session: { model: STT_GEMINI_LIVE_MODEL },
      }) as never,
    );
    // 12s is the mint budget, kept under the 15s the transcriber allows for
    // the whole bootstrap.
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toBe("[auth_tokens] timed out after 12000ms");
  });
});
