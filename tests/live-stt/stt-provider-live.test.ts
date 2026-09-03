import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { createOpenAISTTProvider } from "@charivo/stt/openai";
import { createGeminiSTTProvider } from "@charivo/stt/gemini";

// Live contract check for the server-side STT providers, one provider at a
// time and without the browser chain: each case calls the provider class
// directly against the vendor API, so it proves what the fetch/SDK-mocked
// unit tests cannot — that the request shape each provider builds is one the
// vendor accepts, and that Gemini's measured response shapes (silence
// answering with `content: {}`) still hold.
//
// Budget: the Gemini block below makes exactly 2 requests per run. Gemini's
// free tier allows 3 requests per minute, and the cascade smoke's Gemini leg
// spends 1 of those, so a cascade run immediately followed by this suite
// still fits inside the window — running this suite twice within a minute
// does not.

const RUN_LIVE_STT_TESTS = process.env.RUN_LIVE_STT_TESTS === "1";

// Each provider gives a request 30 s before mapping it to CharivoTimeoutError.
// The budget below is sized per provider call, so a slow-but-successful call
// (measured on the 4 s clip: 1.5-3.4 s for Gemini, ~1.8 s for whisper-1)
// cannot trip a test before the provider's own timeout does.
const PROVIDER_TIMEOUT_MS = 30_000;
const SINGLE_CALL_TEST_TIMEOUT_MS = PROVIDER_TIMEOUT_MS + 10_000;

const WAV_PATH = fileURLToPath(
  new URL("../webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);
// Same fixture tests/cascade-smoke/cascade-e2e.spec.ts guards on — see
// tests/webrtc-smoke/fixtures/README.md if it is missing.
const WAV_PRESENT = existsSync(WAV_PATH);
const fixtureBlob = WAV_PRESENT
  ? new Blob([readFileSync(WAV_PATH)], { type: "audio/wav" })
  : undefined;

/**
 * Builds a 16 kHz mono 16-bit PCM WAV of silence with a minimal 44-byte RIFF
 * header. This is the exact shape that made Gemini answer with
 * `content: {}` (measured 2026-09-03) — the fetch-mocked unit tests can only
 * assume that response, this proves it.
 */
function silentWav(seconds: number): Blob {
  const sampleRate = 16_000;
  const bytesPerSample = 2;
  const dataSize = seconds * sampleRate * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);

  const writeString = (offset: number, value: string) => {
    for (let i = 0; i < value.length; i++) {
      view.setUint8(offset + i, value.charCodeAt(i));
    }
  };

  writeString(0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, "WAVE");
  writeString(12, "fmt ");
  view.setUint32(16, 16, true); // fmt chunk size
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * bytesPerSample, true); // byte rate
  view.setUint16(32, bytesPerSample, true); // block align
  view.setUint16(34, 16, true); // bits per sample
  writeString(36, "data");
  view.setUint32(40, dataSize, true);
  // The rest of the buffer is already zeroed, which is the silence itself.

  return new Blob([buffer], { type: "audio/wav" });
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY;
const liveOpenAIDescribe =
  RUN_LIVE_STT_TESTS && OPENAI_API_KEY ? describe : describe.skip;

liveOpenAIDescribe("openai STT provider (live)", () => {
  const provider = createOpenAISTTProvider({
    apiKey: OPENAI_API_KEY ?? "",
    defaultModel: "whisper-1",
  });

  it.skipIf(!WAV_PRESENT)(
    "transcribes the canned fixture",
    async () => {
      const text = await provider.transcribe(fixtureBlob!);

      console.log(`[live-stt] openai fixture: ${text}`);
      expect(text).toMatch(/smile/i);
    },
    SINGLE_CALL_TEST_TIMEOUT_MS,
  );
});

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const liveGeminiDescribe =
  RUN_LIVE_STT_TESTS && GEMINI_API_KEY ? describe : describe.skip;

liveGeminiDescribe("gemini STT provider (live)", () => {
  const provider = createGeminiSTTProvider({ apiKey: GEMINI_API_KEY ?? "" });

  it.skipIf(!WAV_PRESENT)(
    "transcribes the canned fixture with a language hint",
    async () => {
      // One call proves both the transcription and that
      // `audioTranscriptionConfig.languageCodes` is still the accepted field
      // name — the cascade already covers the no-hint path, and the
      // free-tier budget above is why the hint is not a separate call.
      const text = await provider.transcribe(fixtureBlob!, {
        language: "en",
      });

      console.log(`[live-stt] gemini fixture: ${text}`);
      expect(text).toMatch(/smile/i);
    },
    SINGLE_CALL_TEST_TIMEOUT_MS,
  );

  it(
    "resolves an empty string for a silent clip",
    async () => {
      // Pins the measured `content: {}` silence shape. whisper-1 is excluded
      // because it hallucinates text on silence, which is not a contract
      // this suite owns.
      const text = await provider.transcribe(silentWav(1));

      expect(text).toBe("");
    },
    SINGLE_CALL_TEST_TIMEOUT_MS,
  );
});
