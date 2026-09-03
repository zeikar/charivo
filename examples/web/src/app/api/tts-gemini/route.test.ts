import { beforeEach, describe, expect, it, vi } from "vitest";

const generateSpeech = vi.fn();
const createGeminiTTSProvider = vi.fn(() => ({
  generateSpeech,
}));

vi.mock("@charivo/server/gemini", () => ({
  createGeminiTTSProvider: (...args: unknown[]) =>
    createGeminiTTSProvider(...(args as [])),
}));

import { POST } from "./route";
import {
  TTS_FALLBACK_VOICE,
  TTS_GEMINI_ALLOWED_VOICES,
  TTS_GEMINI_FALLBACK_VOICE,
  TTS_GEMINI_MAX_TEXT_CHARS,
  TTS_GEMINI_MODEL,
  TTS_GEMINI_ROUTE_TIMEOUT_MS,
} from "../demo-limits";
import { CHARACTER_CONFIGS } from "../../config/characters";

function postRequest(body: unknown): Request {
  return new Request("http://localhost/api/tts-gemini", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

describe("examples/web /api/tts-gemini route", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    createGeminiTTSProvider.mockClear();
    generateSpeech.mockReset();
    generateSpeech.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
  });

  it("calls the factory with a deadline pinned under the remote player's timeout", async () => {
    await POST(postRequest({ text: "Hello" }) as never);

    expect(createGeminiTTSProvider).toHaveBeenCalledWith({
      apiKey: "test-key",
      defaultModel: TTS_GEMINI_MODEL,
      timeoutMs: TTS_GEMINI_ROUTE_TIMEOUT_MS,
    });
  });

  it("uses the character's own Gemini voice rather than the fallback", async () => {
    const characterVoice = CHARACTER_CONFIGS.Wanko.voices.gemini;
    expect(characterVoice).toBeDefined();
    expect(characterVoice).not.toBe(TTS_GEMINI_FALLBACK_VOICE);

    const response = await POST(
      postRequest({ text: "Hello", voice: characterVoice }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: characterVoice,
    });
  });

  it("falls back only when the request names no voice", async () => {
    await POST(postRequest({ text: "Hello" }) as never);

    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: TTS_GEMINI_FALLBACK_VOICE,
    });
  });

  it("keeps the fallback off every shipped character's Gemini voice", () => {
    const characterVoices = Object.values(CHARACTER_CONFIGS).map(
      (config) => config.voices.gemini,
    );

    expect(characterVoices).not.toContain(TTS_GEMINI_FALLBACK_VOICE);
  });

  it("rejects text past the demo cap, since a longer synthesis will not fit the budget", async () => {
    const response = await POST(
      postRequest({ text: "x".repeat(TTS_GEMINI_MAX_TEXT_CHARS + 1) }) as never,
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

  it("rejects an OpenAI voice id, since it is not a Gemini voice", async () => {
    expect(TTS_GEMINI_ALLOWED_VOICES.has(TTS_FALLBACK_VOICE)).toBe(false);

    const response = await POST(
      postRequest({ text: "Hello", voice: TTS_FALLBACK_VOICE }) as never,
    );

    expect(response.status).toBe(400);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("rejects a non-numeric speed", async () => {
    const response = await POST(
      postRequest({ text: "Hello", speed: "fast" }) as never,
    );

    expect(response.status).toBe(400);
    expect(generateSpeech).not.toHaveBeenCalled();
  });

  it("accepts an out-of-range speed without forwarding it, since Gemini TTS ignores rate", async () => {
    const response = await POST(
      postRequest({ text: "Hello", speed: 99 }) as never,
    );

    expect(response.status).toBe(200);
    expect(generateSpeech).toHaveBeenCalledWith("Hello", {
      voice: TTS_GEMINI_FALLBACK_VOICE,
    });
  });

  it("fails closed when GEMINI_API_KEY is not configured", async () => {
    delete process.env.GEMINI_API_KEY;

    const response = await POST(postRequest({ text: "Hello" }) as never);

    expect(response.status).toBe(500);
    expect(createGeminiTTSProvider).not.toHaveBeenCalled();
  });
});
