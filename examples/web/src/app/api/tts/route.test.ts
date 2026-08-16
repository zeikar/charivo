import { beforeEach, describe, expect, it, vi } from "vitest";

const generateSpeech = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAITTSProvider: vi.fn(() => ({
    generateSpeech,
  })),
}));

import { POST } from "./route";
import { TTS_DEFAULT_VOICE, TTS_MAX_TEXT_CHARS } from "../demo-limits";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/tts", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/web /api/tts route", () => {
  beforeEach(() => {
    process.env.OPENAI_API_KEY = "test-key";
    generateSpeech.mockReset();
    generateSpeech.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  });

  it("synthesizes with a voice a shipped character uses", async () => {
    const response = await POST(
      postRequest({ text: "Hello", voice: TTS_DEFAULT_VOICE }) as never,
    );

    expect(response.status).toBe(200);
    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: TTS_DEFAULT_VOICE,
      rate: 1.0,
    });
  });

  it("rejects text past the demo cap, since TTS bills per character", async () => {
    const response = await POST(
      postRequest({ text: "x".repeat(TTS_MAX_TEXT_CHARS + 1) }) as never,
    );

    expect(response.status).toBe(400);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("rejects a voice no shipped character uses", async () => {
    const response = await POST(
      postRequest({ text: "Hello", voice: "not-a-demo-voice" }) as never,
    );

    expect(response.status).toBe(400);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("clamps an out-of-range speed instead of forwarding it", async () => {
    await POST(postRequest({ text: "Hello", speed: 99 }) as never);

    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: TTS_DEFAULT_VOICE,
      rate: 4,
    });
  });
});
