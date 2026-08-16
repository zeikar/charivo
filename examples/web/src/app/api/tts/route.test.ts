import { beforeEach, describe, expect, it, vi } from "vitest";

const generateSpeech = vi.fn();

vi.mock("@charivo/server/openai", () => ({
  createOpenAITTSProvider: vi.fn(() => ({
    generateSpeech,
  })),
}));

import { POST } from "./route";
import { TTS_FALLBACK_VOICE, TTS_MAX_TEXT_CHARS } from "../demo-limits";
import { CHARACTER_CONFIGS } from "../../config/characters";

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

  it("uses the character's own voice rather than the fallback", async () => {
    const characterVoice = CHARACTER_CONFIGS.Wanko.character.voice?.voiceId;
    expect(characterVoice).toBeDefined();
    expect(characterVoice).not.toBe(TTS_FALLBACK_VOICE);

    const response = await POST(
      postRequest({ text: "Hello", voice: characterVoice }) as never,
    );

    expect(response.status).toBe(200);
    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: characterVoice,
      rate: 1.0,
    });
  });

  it("falls back only when the request names no voice", async () => {
    await POST(postRequest({ text: "Hello" }) as never);

    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: TTS_FALLBACK_VOICE,
      rate: 1.0,
    });
  });

  it("keeps the fallback off every shipped character's voice", () => {
    const characterVoices = Object.values(CHARACTER_CONFIGS).map(
      (config) => config.character.voice?.voiceId,
    );

    expect(characterVoices).not.toContain(TTS_FALLBACK_VOICE);
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
      voice: TTS_FALLBACK_VOICE,
      rate: 4,
    });
  });
});
