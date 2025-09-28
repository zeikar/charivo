import { beforeEach, describe, expect, it, vi } from "vitest";

const openaiMocks = vi.hoisted(() => {
  const createSpeech = vi.fn(
    async (_payload: {
      model: string;
      voice: string;
      input: string;
      speed: number;
      format: string;
    }) => ({
      arrayBuffer: vi.fn(async () => new ArrayBuffer(4)),
    }),
  );

  class MockOpenAI {
    audio = {
      speech: {
        create: createSpeech,
      },
    };

    constructor(public config: unknown) {}
  }

  return { createSpeech, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAITTSProvider } from "@charivo/tts-provider-openai";

beforeEach(() => {
  openaiMocks.createSpeech.mockClear();
});

describe("OpenAITTSProvider", () => {
  it("requests audio with defaults and overrides", async () => {
    const provider = new OpenAITTSProvider({ apiKey: "key" });
    provider.setModel("tts-1-hd");

    await provider.generateSpeech("hello", { voice: "nova", rate: 1.5 });

    expect(openaiMocks.createSpeech).toHaveBeenCalledWith({
      model: "tts-1-hd",
      voice: "nova",
      input: "hello",
      speed: 1.5,
      format: "wav",
    });
  });

  it("updates default voice when set", async () => {
    const provider = new OpenAITTSProvider({
      apiKey: "key",
      defaultVoice: "alloy",
    });
    provider.setVoice("shimmer");
    await provider.generateSpeech("good day");

    expect(openaiMocks.createSpeech).toHaveBeenCalledWith({
      model: "gpt-4o-mini-tts",
      voice: "shimmer",
      input: "good day",
      speed: 1,
      format: "wav",
    });
  });
});
