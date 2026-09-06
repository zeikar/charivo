import { beforeEach, describe, expect, it, vi } from "vitest";

const generateSpeech = vi.fn();
const generateSpeechStream = vi.fn();
const createGeminiTTSProvider = vi.fn(() => ({
  generateSpeech,
  generateSpeechStream,
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

function postRequest(
  body: unknown,
  headers: Record<string, string> = {},
): Request {
  return new Request("http://localhost/api/tts-gemini", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json", ...headers },
  });
}

function pcmStream(chunks: Uint8Array[]) {
  return {
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) {
          controller.enqueue(chunk);
        }
        controller.close();
      },
    }),
    format: { encoding: "pcm-s16le" as const, sampleRate: 24_000, channels: 1 },
  };
}

describe("examples/web /api/tts-gemini route", () => {
  beforeEach(() => {
    process.env.GEMINI_API_KEY = "test-key";
    createGeminiTTSProvider.mockClear();
    generateSpeech.mockReset();
    generateSpeech.mockResolvedValue(new Uint8Array([1, 2, 3]).buffer);
    generateSpeechStream.mockReset();
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

  it("rejects an OpenAI voice id, since it is not a Gemini voice", async () => {
    expect(TTS_GEMINI_ALLOWED_VOICES.has(TTS_FALLBACK_VOICE)).toBe(false);

    const response = await POST(
      postRequest({ text: "Hello", voice: TTS_FALLBACK_VOICE }) as never,
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

  it("streams PCM and forwards the request's own signal when Accept names audio/pcm", async () => {
    generateSpeechStream.mockResolvedValue(
      pcmStream([new Uint8Array([10, 20, 30]), new Uint8Array([40, 50])]),
    );

    const request = postRequest({ text: "Hello" }, { Accept: "audio/pcm" });
    const response = await POST(request as never);

    expect(generateSpeechStream).toHaveBeenCalledWith(
      "Hello",
      { voice: TTS_GEMINI_FALLBACK_VOICE },
      request.signal,
    );
    expect(generateSpeech).not.toHaveBeenCalled();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "audio/pcm; rate=24000; channels=1",
    );
    expect(response.headers.get("Content-Length")).toBeNull();
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(
      new Uint8Array([10, 20, 30, 40, 50]),
    );
  });

  it("keeps the buffered audio/wav path when the request names no Accept header", async () => {
    const response = await POST(postRequest({ text: "Hello" }) as never);

    expect(response.headers.get("Content-Type")).toBe("audio/wav");
    expect(generateSpeechStream).not.toHaveBeenCalled();
  });

  it("fails closed with the JSON 500 when generateSpeechStream rejects", async () => {
    generateSpeechStream.mockRejectedValue(new Error("upstream boom"));

    const response = await POST(
      postRequest({ text: "Hello" }, { Accept: "audio/pcm" }) as never,
    );

    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: "Failed to generate speech",
    });
  });

  it("surfaces a body error after the stream already started, rather than a JSON error", async () => {
    // Headers commit as soon as `generateSpeechStream` resolves, before any
    // byte of this body has been read -- so a failure that happens while
    // reading it can no longer turn into a JSON error response. It has to
    // reach the player as a rejection on the body's own reader.
    //
    // The chunk and the error are handed out from two separate `pull()`
    // calls, not both from `start()`: erroring a controller resets its queue
    // per the streams spec, so an error queued in the same tick as an enqueue
    // would wipe that chunk before it could ever be read, which is not the
    // failure this test is pinning.
    const bodyError = new Error("upstream dropped mid-stream");
    let pullCount = 0;
    generateSpeechStream.mockResolvedValue({
      body: new ReadableStream<Uint8Array>({
        pull(controller) {
          pullCount += 1;
          if (pullCount === 1) {
            controller.enqueue(new Uint8Array([1, 2, 3]));
            return;
          }
          controller.error(bodyError);
        },
      }),
      format: {
        encoding: "pcm-s16le" as const,
        sampleRate: 24_000,
        channels: 1,
      },
    });

    const response = await POST(
      postRequest({ text: "Hello" }, { Accept: "audio/pcm" }) as never,
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(
      "audio/pcm; rate=24000; channels=1",
    );

    const reader = response.body!.getReader();
    await expect(reader.read()).resolves.toEqual({
      done: false,
      value: new Uint8Array([1, 2, 3]),
    });
    await expect(reader.read()).rejects.toBe(bodyError);
  });

  const REQUEST_VARIANTS: Array<{
    label: string;
    headers: Record<string, string>;
  }> = [
    { label: "buffered (no Accept header)", headers: {} },
    {
      label: "streaming (Accept: audio/pcm)",
      headers: { Accept: "audio/pcm" },
    },
  ];

  describe.each(REQUEST_VARIANTS)(
    "validation on the $label path",
    ({ headers }) => {
      it("rejects a request with no text", async () => {
        const response = await POST(postRequest({}, headers) as never);

        expect(response.status).toBe(400);
        expect(generateSpeech).not.toHaveBeenCalled();
        expect(generateSpeechStream).not.toHaveBeenCalled();
      });

      it("rejects text past the demo cap", async () => {
        const response = await POST(
          postRequest(
            { text: "x".repeat(TTS_GEMINI_MAX_TEXT_CHARS + 1) },
            headers,
          ) as never,
        );

        expect(response.status).toBe(400);
        expect(generateSpeech).not.toHaveBeenCalled();
        expect(generateSpeechStream).not.toHaveBeenCalled();
      });

      it("rejects a voice no shipped character uses", async () => {
        const response = await POST(
          postRequest(
            { text: "Hello", voice: "not-a-demo-voice" },
            headers,
          ) as never,
        );

        expect(response.status).toBe(400);
        expect(generateSpeech).not.toHaveBeenCalled();
        expect(generateSpeechStream).not.toHaveBeenCalled();
      });

      it("rejects a non-numeric speed", async () => {
        const response = await POST(
          postRequest({ text: "Hello", speed: "fast" }, headers) as never,
        );

        expect(response.status).toBe(400);
        expect(generateSpeech).not.toHaveBeenCalled();
        expect(generateSpeechStream).not.toHaveBeenCalled();
      });
    },
  );
});
