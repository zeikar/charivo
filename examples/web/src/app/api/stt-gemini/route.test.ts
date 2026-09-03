import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribe = vi.fn();
const createGeminiSTTProvider = vi.fn(() => ({
  transcribe,
}));

vi.mock("@charivo/server/gemini", () => ({
  createGeminiSTTProvider: (...args: unknown[]) =>
    createGeminiSTTProvider(...(args as [])),
}));

import { POST } from "./route";
import { STT_GEMINI_MODEL, STT_MAX_AUDIO_BYTES } from "../demo-limits";

describe("examples/web /api/stt-gemini route", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    createGeminiSTTProvider.mockClear();
    transcribe.mockReset();
  });

  it("calls the factory with the pinned model", async () => {
    transcribe.mockResolvedValue("Hello");

    const formData = new FormData();
    formData.append(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "recording.webm", {
        type: "audio/webm",
      }),
    );

    const request = new Request("http://localhost/api/stt-gemini", {
      method: "POST",
      body: formData,
    });
    await POST(request as never);

    expect(createGeminiSTTProvider).toHaveBeenCalledWith({
      apiKey: "test-key",
      defaultModel: STT_GEMINI_MODEL,
    });
  });

  it("passes the optional language hint to the provider", async () => {
    transcribe.mockResolvedValue("Hello");

    const formData = new FormData();
    formData.append(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "recording.webm", {
        type: "audio/webm",
      }),
    );
    formData.append("language", "en");

    const request = new Request("http://localhost/api/stt-gemini", {
      method: "POST",
      body: formData,
    });
    const response = await POST(request as never);

    expect(transcribe).toHaveBeenCalledWith(expect.any(Blob), {
      language: "en",
    });
    await expect(response.json()).resolves.toEqual({
      transcription: "Hello",
    });
  });

  it("rejects a request with no audio field before calling the provider", async () => {
    const formData = new FormData();

    const request = new Request("http://localhost/api/stt-gemini", {
      method: "POST",
      body: formData,
    });
    const response = await POST(request as never);

    expect(response.status).toBe(400);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("rejects audio past the demo size cap before paying to transcribe it", async () => {
    const formData = new FormData();
    formData.append(
      "audio",
      new File([new Uint8Array(STT_MAX_AUDIO_BYTES + 1)], "huge.webm", {
        type: "audio/webm",
      }),
    );

    const request = new Request("http://localhost/api/stt-gemini", {
      method: "POST",
      body: formData,
    });
    const response = await POST(request as never);

    expect(response.status).toBe(413);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it("fails closed when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const formData = new FormData();
    formData.append(
      "audio",
      new File([new Uint8Array([1, 2, 3])], "recording.webm", {
        type: "audio/webm",
      }),
    );

    const request = new Request("http://localhost/api/stt-gemini", {
      method: "POST",
      body: formData,
    });
    const response = await POST(request as never);

    expect(response.status).toBe(500);
    expect(createGeminiSTTProvider).not.toHaveBeenCalled();
  });
});
