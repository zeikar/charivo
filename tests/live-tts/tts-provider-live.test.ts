import { describe, expect, it } from "vitest";
import { createOpenAITTSProvider } from "@charivo/tts/openai";
import { createGeminiTTSProvider } from "@charivo/tts/gemini";

// Live contract check for the server-side TTS providers, one provider at a
// time and without the browser chain: each case calls the provider class
// directly against the vendor API, so it proves what the SDK/fetch-mocked unit
// tests cannot -- that the request shape each provider builds is one the vendor
// accepts, and that the bytes coming back are a container a player can open.
// The container is the point: `TTSManager` plays through `new Audio(blobUrl)`,
// and the mocked unit tests cannot see what a vendor actually returns. Each
// player's `audioMimeType` is derived from these measurements, so the
// assertions here are what keep the labels honest.
//
// Budget: one `generateSpeech` per provider per run. That is one API request
// for OpenAI, and up to two for Gemini, which retries a 5xx once while sharing
// the original deadline -- so a busy model surfaces either as the vendor's own
// 503 or as CharivoTimeoutError, depending on whether budget remained.

const RUN_LIVE_TTS_TESTS = process.env.RUN_LIVE_TTS_TESTS === "1";

// The OpenAI provider maps a request to CharivoTimeoutError at a fixed 30 s.
// Gemini is pinned to the same 25 s the demo route uses, so this exercises the
// deadline the demo actually ships. See the budget note above for how a busy
// model surfaces.
const GEMINI_TIMEOUT_MS = 25_000;
const SINGLE_CALL_TEST_TIMEOUT_MS = 40_000;

// Short on purpose: neither provider streams here, and Gemini's measured
// latency is ~0.55-0.7x the audio duration, so a longer line only buys wall
// clock.
const TEXT = "Hi there.";

/** The first bytes of a container, for identifying what came back. */
function magic(audio: ArrayBuffer, length = 12): string {
  const head = new Uint8Array(audio).slice(0, length);
  const ascii = String.fromCharCode(...head).replace(/[^\x20-\x7e]/g, ".");
  const hex = [...head].map((b) => b.toString(16).padStart(2, "0")).join(" ");

  return `${ascii} | ${hex}`;
}

function asciiAt(audio: ArrayBuffer, offset: number, length: number): string {
  return String.fromCharCode(
    ...new Uint8Array(audio).slice(offset, offset + length),
  );
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const liveOpenAIDescribe =
  RUN_LIVE_TTS_TESTS && OPENAI_API_KEY ? describe : describe.skip;

liveOpenAIDescribe("openai TTS provider (live)", () => {
  const provider = createOpenAITTSProvider({
    apiKey: OPENAI_API_KEY ?? "",
    defaultModel: "gpt-4o-mini-tts",
  });

  it(
    "synthesizes speech as MPEG audio",
    async () => {
      const audio = await provider.generateSpeech(TEXT);

      console.log(
        `[live-tts] openai: ${audio.byteLength} bytes, ${magic(audio)}`,
      );
      expect(audio.byteLength).toBeGreaterThan(0);

      // MPEG, not WAV, as measured on 2026-09-04 (`ff f3 c4 c4 ...`).
      // `packages/tts/src/openai/provider.ts` sends `format: "wav"`, which the
      // API does not read -- the parameter is `response_format` -- so the mp3
      // default stands, and `audioMimeType` names it. If this assertion ever
      // fails the container moved; move the labels with it rather than
      // loosening the check.
      const head = new Uint8Array(audio);
      expect(head[0]).toBe(0xff);
      // Frame sync is 11 set bits: 0xff then the top 3 bits of the next byte.
      expect(head[1]! & 0xe0).toBe(0xe0);
      // Sync alone would also admit AAC in an ADTS container, which carries
      // 0x00 in these two layer bits. Layer III is what makes this mp3.
      expect((head[1]! & 0x06) >> 1).toBe(0b01);
    },
    SINGLE_CALL_TEST_TIMEOUT_MS,
  );
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const liveGeminiDescribe =
  RUN_LIVE_TTS_TESTS && GEMINI_API_KEY ? describe : describe.skip;

liveGeminiDescribe("gemini TTS provider (live)", () => {
  const provider = createGeminiTTSProvider({
    apiKey: GEMINI_API_KEY ?? "",
    timeoutMs: GEMINI_TIMEOUT_MS,
  });

  it(
    "synthesizes speech as a WAV the player can open",
    async () => {
      const audio = await provider.generateSpeech(TEXT);

      console.log(
        `[live-tts] gemini: ${audio.byteLength} bytes, ${magic(audio)}`,
      );

      // The API returns headerless `audio/l16` PCM; the provider is what wraps
      // it in the 44-byte RIFF header `new Audio(blobUrl)` needs. Asserting the
      // header here is what proves the wrap survived a real response body,
      // which the fetch-mocked unit tests can only assume.
      expect(asciiAt(audio, 0, 4)).toBe("RIFF");
      expect(asciiAt(audio, 8, 4)).toBe("WAVE");
      expect(audio.byteLength).toBeGreaterThan(44);
    },
    SINGLE_CALL_TEST_TIMEOUT_MS,
  );
});
