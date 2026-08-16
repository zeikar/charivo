import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { POST } from "./route";
import { REALTIME_TRANSCRIPTION_MODEL } from "../demo-limits";

const CLIENT_SECRETS_URL = "https://api.openai.com/v1/realtime/client_secrets";
const CALLS_URL = "https://api.openai.com/v1/realtime/calls";
const ANSWER_SDP = "v=0\r\na=answer\r\n";

const originalFetch = globalThis.fetch;
const fetchMock = vi.fn();

function bootstrapRequest(body: unknown): Request {
  return new Request("http://localhost/api/realtime-transcription", {
    method: "POST",
    body: JSON.stringify(body),
    headers: {
      "Content-Type": "application/json",
    },
  });
}

function upstreamCall(index: number): { url: string; init: RequestInit } {
  const [url, init] = fetchMock.mock.calls[index] as [string, RequestInit];
  return { url, init };
}

function headerOf(init: RequestInit, name: string): string | undefined {
  return (init.headers as Record<string, string>)[name];
}

describe("examples/web /api/realtime-transcription route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
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

  it("rejects a bootstrap request without an SDP offer", async () => {
    const response = await POST(
      bootstrapRequest({ session: { model: "gpt-realtime-whisper" } }) as never,
    );

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: "sdpOffer is required",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("pins the transcription model, ignoring the caller's choice", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-4o-realtime-preview" },
      }) as never,
    );

    const { init } = upstreamCall(0);
    const payload = JSON.parse(String(init.body));
    expect(payload.session.audio.input.transcription.model).toBe(
      REALTIME_TRANSCRIPTION_MODEL,
    );
  });

  it("mints a session when the caller omits the model entirely", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    const response = await POST(
      bootstrapRequest({ sdpOffer: "v=0\r\na=offer\r\n" }) as never,
    );

    expect(response.status).toBe(200);
    const { init } = upstreamCall(0);
    expect(
      JSON.parse(String(init.body)).session.audio.input.transcription.model,
    ).toBe(REALTIME_TRANSCRIPTION_MODEL);
  });

  it("fails when the OpenAI key is not configured", async () => {
    delete process.env.OPENAI_API_KEY;

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "OPENAI_API_KEY not configured",
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("mints a transcription session with the model the transcriber asked for", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    const { url, init } = upstreamCall(0);
    expect(url).toBe(CLIENT_SECRETS_URL);
    expect(headerOf(init, "Authorization")).toBe("Bearer test-key");
    expect(headerOf(init, "Content-Type")).toBe("application/json");
    expect(JSON.parse(String(init.body))).toEqual({
      session: {
        type: "transcription",
        audio: {
          input: {
            transcription: { model: "gpt-realtime-whisper" },
            turn_detection: null,
          },
        },
      },
    });
    expect(response.status).toBe(200);
  });

  it("forwards the language hint only when the transcriber supplies one", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper", language: "ko" },
      }) as never,
    );

    const { init } = upstreamCall(0);
    expect(
      JSON.parse(String(init.body)).session.audio.input.transcription,
    ).toEqual({
      model: "gpt-realtime-whisper",
      language: "ko",
    });
  });

  it("exchanges the offer with the ephemeral secret rather than the standing key", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    const { url, init } = upstreamCall(1);
    expect(url).toBe(CALLS_URL);
    expect(headerOf(init, "Authorization")).toBe("Bearer ephemeral-secret");
    expect(headerOf(init, "Content-Type")).toBe("application/sdp");
    expect(init.body).toBe("v=0\r\na=offer\r\n");
    await expect(response.json()).resolves.toEqual({ answerSdp: ANSWER_SDP });
  });

  it("accepts the older client_secret.value shape", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ client_secret: { value: "legacy" } })),
    );
    fetchMock.mockResolvedValueOnce(new Response(ANSWER_SDP));

    await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(headerOf(upstreamCall(1).init, "Authorization")).toBe(
      "Bearer legacy",
    );
  });

  it("fails before the SDP exchange when the mint response carries no secret", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ id: "sess" })),
    );

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain("[step 1/2 client_secrets]");
    expect(payload.details).toContain("no ephemeral secret");
  });

  it("surfaces a failed mint with the step label and upstream status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response("invalid api key", { status: 401 }),
    );

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to create Realtime transcription session",
      details:
        "[step 1/2 client_secrets] mint failed with 401: invalid api key",
    });
  });

  it("surfaces a failed SDP exchange with the step label and upstream status", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(
      new Response("no capacity", { status: 503 }),
    );

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toBe(
      "[step 2/2 realtime/calls] SDP exchange failed with 503: no capacity",
    );
  });

  it("rejects an exchange response that is not SDP", async () => {
    fetchMock.mockResolvedValueOnce(
      new Response(JSON.stringify({ value: "ephemeral-secret" })),
    );
    fetchMock.mockResolvedValueOnce(new Response('{"error":"nope"}'));

    const response = await POST(
      bootstrapRequest({
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );

    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toContain(
      "[step 2/2 realtime/calls] response body was not SDP",
    );
  });

  it("aborts both upstream steps on one shared deadline", async () => {
    vi.useFakeTimers();

    // The mint spends most of the budget, so a per-call timeout would leave the
    // exchange alive well past the deadline the transcriber is waiting on.
    fetchMock.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          setTimeout(
            () => resolve(new Response(JSON.stringify({ value: "secret" }))),
            8_000,
          );
        }),
    );
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
        sdpOffer: "v=0\r\na=offer\r\n",
        session: { model: "gpt-realtime-whisper" },
      }) as never,
    );
    // 12s is the whole-bootstrap budget, kept under the 15s the transcriber
    // allows for bootstrap.
    await vi.advanceTimersByTimeAsync(12_000);
    const response = await pending;

    expect(upstreamCall(0).init.signal).toBe(upstreamCall(1).init.signal);
    expect(response.status).toBe(500);
    const payload = (await response.json()) as { details: string };
    expect(payload.details).toBe(
      "[step 2/2 realtime/calls] timed out after 12000ms",
    );
  });
});
