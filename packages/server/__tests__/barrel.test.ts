import { describe, expect, it } from "vitest";
import {
  createOpenAILLMProvider,
  OpenAILLMProvider,
  createOpenAITTSProvider,
  OpenAITTSProvider,
  createOpenAISTTProvider,
  OpenAISTTProvider,
  createOpenAIRealtimeProvider,
  OpenAIRealtimeProvider,
} from "@charivo/server/openai";
import {
  createOpenClawLLMProvider,
  OpenClawLLMProvider,
} from "@charivo/server/openclaw";
import {
  createGeminiLLMProvider,
  GeminiLLMProvider,
  createGeminiTTSProvider,
  GeminiTTSProvider,
  createGeminiRealtimeProvider,
  GeminiRealtimeProvider,
} from "@charivo/server/gemini";

// @charivo/server re-exports these providers/factories from the modality
// packages instead of implementing them. No other test constructs providers
// through these subpath specifiers, so this pins that the re-export wiring
// still holds: names exist, factories return instances of the exported
// classes (the `instanceof` contract external consumers rely on), and the
// concrete methods beyond the narrow interface (e.g. TTS setVoice/setModel)
// survive the barrel.
describe("@charivo/server/openai", () => {
  it("re-exports the LLM provider and factory", () => {
    const provider = createOpenAILLMProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(OpenAILLMProvider);
  });

  it("re-exports the TTS provider and factory with concrete setVoice/setModel", () => {
    const provider = createOpenAITTSProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(OpenAITTSProvider);
    expect(typeof provider.setVoice).toBe("function");
    expect(typeof provider.setModel).toBe("function");
  });

  it("re-exports the STT provider and factory", () => {
    const provider = createOpenAISTTProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(OpenAISTTProvider);
  });

  it("re-exports the realtime provider and factory", () => {
    const provider = createOpenAIRealtimeProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(OpenAIRealtimeProvider);
  });
});

describe("@charivo/server/openclaw", () => {
  it("re-exports the LLM provider and factory", () => {
    const provider = createOpenClawLLMProvider({ token: "token" });
    expect(provider).toBeInstanceOf(OpenClawLLMProvider);
  });
});

describe("@charivo/server/gemini", () => {
  it("re-exports the realtime provider and factory", () => {
    const provider = createGeminiRealtimeProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(GeminiRealtimeProvider);
  });

  it("re-exports the LLM provider and factory", () => {
    const provider = createGeminiLLMProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(GeminiLLMProvider);
  });

  it("re-exports the TTS provider and factory with concrete setVoice/setModel", () => {
    const provider = createGeminiTTSProvider({ apiKey: "key" });
    expect(provider).toBeInstanceOf(GeminiTTSProvider);
    expect(typeof provider.setVoice).toBe("function");
    expect(typeof provider.setModel).toBe("function");
  });
});
