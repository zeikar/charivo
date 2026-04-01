import { afterEach, describe, expect, it, vi } from "vitest";

const recorder = {
  start: vi.fn(async () => undefined),
  stop: vi.fn(async () => new Blob(["audio"], { type: "audio/webm" })),
  isRecording: vi.fn(() => false),
};

vi.mock("@charivo/stt-core", () => ({
  MediaRecorderHelper: vi.fn(() => recorder),
}));

import { RemoteSTTTranscriber } from "@charivo/stt-transcriber-remote";

const originalFetch = globalThis.fetch;

afterEach(() => {
  globalThis.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("RemoteSTTTranscriber", () => {
  it("forwards language hints to the remote form payload", async () => {
    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        const formData = init?.body as FormData;

        expect(formData.get("language")).toBe("ko");
        expect(formData.get("audio")).toBeInstanceOf(File);

        return new Response(JSON.stringify({ transcription: "안녕하세요" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      },
    );

    globalThis.fetch = fetchMock as typeof fetch;

    const transcriber = new RemoteSTTTranscriber({ apiEndpoint: "/api/stt" });
    await transcriber.startRecording({ language: "ko" });
    const result = await transcriber.stopRecording();

    expect(result).toBe("안녕하세요");
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/stt",
      expect.objectContaining({ method: "POST" }),
    );
  });
});
