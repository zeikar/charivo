import { beforeEach, describe, expect, it, vi } from "vitest";

const transcribe = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAISTTProvider: vi.fn(() => ({
    transcribe,
  })),
}));

import { POST } from "./route";

describe("examples/web /api/stt route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    transcribe.mockReset();
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

    const request = new Request("http://localhost/api/stt", {
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
});
