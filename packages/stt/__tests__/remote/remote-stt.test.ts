import { afterEach, describe, expect, it, vi } from "vitest";
import { CharivoTransportError } from "@charivo/core";

const recorder = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
  isRecording: vi.fn(() => false),
};

vi.mock("../../src/media-recorder-helper", () => ({
  MediaRecorderHelper: vi.fn(() => recorder),
}));

import { createRemoteSTTTranscriber } from "@charivo/stt/remote";

const originalFetch = globalThis.fetch;
const createAbortError = () => {
  const error = new Error("aborted");
  error.name = "AbortError";
  return error;
};

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe("RemoteSTTTranscriber", () => {
  it("forwards language hints to the remote form payload", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;

        expect(formData.get("language")).toBe("en");
        expect(formData.get("audio")).toBeInstanceOf(File);

        return new Response(JSON.stringify({ transcription: "Hello" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    globalThis.fetch = fetchMock as typeof fetch;

    const transcriber = createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" });
    await transcriber.startRecording({ language: "en" });
    const result = await transcriber.stopRecording();

    expect(result).toBe("Hello");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stt",
      expect.objectContaining({ method: "POST" }),
    );
  });

  it("throws a timeout-specific error after recording completes", async () => {
    vi.useFakeTimers();
    globalThis.fetch = vi.fn(
      (_input: RequestInfo | URL, init?: RequestInit) =>
        new Promise((_, reject) => {
          init?.signal?.addEventListener("abort", () => {
            reject(createAbortError());
          });
        }),
    ) as typeof fetch;

    const transcriber = createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" });
    await transcriber.startRecording();
    const request = transcriber.stopRecording();
    const expectation = expect(request).rejects.toThrow(
      "STT request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });

  it("preserves non-timeout fetch failures", async () => {
    globalThis.fetch = vi.fn(async () => {
      throw new Error("network down");
    }) as typeof fetch;

    const transcriber = createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" });
    await transcriber.startRecording();
    const request = transcriber.stopRecording();

    await expect(request).rejects.toBeInstanceOf(CharivoTransportError);
    await expect(request).rejects.toMatchObject({
      message: "STT request failed",
      cause: expect.objectContaining({
        message: "network down",
      }),
    });
  });
});
