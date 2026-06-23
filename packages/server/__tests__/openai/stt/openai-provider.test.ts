import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const openaiMocks = vi.hoisted(() => {
  const instances: Array<{ config: unknown }> = [];
  const createTranscription = vi.fn(
    async (_payload: { file: File; model: string; language?: string }) => ({
      text: "Hello",
    }),
  );

  class MockOpenAI {
    audio = {
      transcriptions: {
        create: createTranscription,
      },
    };

    constructor(public config: unknown) {
      instances.push({ config });
    }
  }

  return { createTranscription, instances, MockOpenAI };
});

vi.mock("openai", () => ({
  default: openaiMocks.MockOpenAI,
}));

import { OpenAISTTProvider } from "@charivo/server/openai";

beforeEach(() => {
  openaiMocks.createTranscription.mockClear();
  openaiMocks.instances.length = 0;
  openaiMocks.createTranscription.mockResolvedValue({ text: "Hello" });
});

afterEach(() => {
  vi.useRealTimers();
  Reflect.deleteProperty(globalThis, "window");
});

describe("OpenAISTTProvider", () => {
  it("uses the default language and creates a File payload from Blob input", async () => {
    const provider = new OpenAISTTProvider({
      apiKey: "key",
      defaultLanguage: "en",
    });

    const result = await provider.transcribe(new Blob(["audio"]));

    expect(result).toBe("Hello");
    expect(openaiMocks.createTranscription).toHaveBeenCalledWith({
      file: expect.any(File),
      model: "whisper-1",
      language: "en",
    });
  });

  it("lets explicit language override the default and accepts ArrayBuffer input", async () => {
    const provider = new OpenAISTTProvider({
      apiKey: "key",
      defaultLanguage: "en",
    });

    await provider.transcribe(new ArrayBuffer(8), { language: "en" });

    const payload = openaiMocks.createTranscription.mock.calls[0]![0];
    expect(payload.file).toBeInstanceOf(File);
    expect(payload.language).toBe("en");
  });

  it("enforces server-only usage unless dangerouslyAllowBrowser is enabled", () => {
    Object.defineProperty(globalThis, "window", {
      value: {},
      configurable: true,
    });

    expect(() => new OpenAISTTProvider({ apiKey: "key" })).toThrow(
      "OpenAI provider is for server-side use only. Set dangerouslyAllowBrowser: true for testing",
    );

    expect(
      () =>
        new OpenAISTTProvider({
          apiKey: "key",
          dangerouslyAllowBrowser: true,
        }),
    ).not.toThrow();
  });

  it("preserves non-timeout SDK errors", async () => {
    openaiMocks.createTranscription.mockRejectedValueOnce(new Error("boom"));
    const provider = new OpenAISTTProvider({ apiKey: "key" });

    await expect(provider.transcribe(new Blob(["audio"]))).rejects.toThrow(
      "boom",
    );
  });

  it("throws a timeout-specific error when OpenAI does not respond", async () => {
    vi.useFakeTimers();
    openaiMocks.createTranscription.mockImplementationOnce(
      () => new Promise(() => undefined),
    );

    const provider = new OpenAISTTProvider({ apiKey: "key" });
    const request = provider.transcribe(new Blob(["audio"]));
    const expectation = expect(request).rejects.toThrow(
      "OpenAI STT request timed out after 30000ms",
    );

    await vi.advanceTimersByTimeAsync(30_000);

    await expectation;
  });
});
