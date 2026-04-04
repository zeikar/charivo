import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WebSTTTranscriber } from "@charivo/stt-transcriber-web";

class MockSpeechRecognition {
  static instances: MockSpeechRecognition[] = [];

  continuous = false;
  interimResults = false;
  lang = "";
  maxAlternatives = 1;
  onresult: ((event: Event) => void) | null = null;
  onerror: ((event: Event) => void) | null = null;
  onend: ((event: Event) => void) | null = null;
  onstart: ((event: Event) => void) | null = null;
  start = vi.fn(() => {
    this.onstart?.(new Event("start"));
  });
  stop = vi.fn(() => undefined);
  abort = vi.fn(() => undefined);

  constructor() {
    MockSpeechRecognition.instances.push(this);
  }
}

const speechResult = (transcript: string, isFinal: boolean) => ({
  0: { transcript, confidence: 1 },
  length: 1,
  isFinal,
  item: () => ({ transcript, confidence: 1 }),
});

beforeEach(() => {
  MockSpeechRecognition.instances = [];
});

afterEach(() => {
  Reflect.deleteProperty(window, "SpeechRecognition");
  Reflect.deleteProperty(window, "webkitSpeechRecognition");
  vi.restoreAllMocks();
});

describe("WebSTTTranscriber", () => {
  it("throws the documented error when Web Speech API is unavailable", async () => {
    const warnSpy = vi
      .spyOn(console, "warn")
      .mockImplementation(() => undefined);
    const transcriber = new WebSTTTranscriber();

    expect(transcriber.isSupportedBrowser()).toBe(false);
    await expect(transcriber.startRecording()).rejects.toThrow(
      "Web Speech API is not supported in this browser. Please use a supported browser (Chrome, Edge, etc.) or switch to OpenAI/Remote transcriber.",
    );
    expect(warnSpy).toHaveBeenCalled();
  });

  it("configures language and resolves the final transcript on end", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      configurable: true,
    });

    const transcriber = new WebSTTTranscriber();
    await transcriber.startRecording({ language: "ko-KR" });

    const recognition = MockSpeechRecognition.instances[0]!;
    expect(recognition.lang).toBe("ko-KR");

    recognition.onresult?.({
      resultIndex: 0,
      results: [speechResult("안녕", true), speechResult("하세요", true)],
    } as unknown as Event);

    const stopPromise = transcriber.stopRecording();
    recognition.onend?.(new Event("end"));

    await expect(stopPromise).resolves.toBe("안녕 하세요");
  });

  it("rejects repeated starts while recording", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      configurable: true,
    });

    const transcriber = new WebSTTTranscriber();
    await transcriber.startRecording();

    await expect(transcriber.startRecording()).rejects.toThrow(
      "Already recording",
    );
  });

  it("rejects stop when not recording", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      configurable: true,
    });

    const transcriber = new WebSTTTranscriber();
    await expect(transcriber.stopRecording()).rejects.toThrow("Not recording");
  });

  it("rejects start when recognition emits an error", async () => {
    class StartErrorRecognition extends MockSpeechRecognition {
      override start = vi.fn(() => {
        this.onerror?.({
          error: "network",
          message: "bad connection",
        } as unknown as Event);
      });
    }

    Object.defineProperty(window, "SpeechRecognition", {
      value: StartErrorRecognition,
      configurable: true,
    });

    const transcriber = new WebSTTTranscriber();

    await expect(transcriber.startRecording()).rejects.toThrow(
      "Speech recognition error: network - bad connection",
    );
  });

  it("rejects stop when recognition errors after recording started", async () => {
    Object.defineProperty(window, "SpeechRecognition", {
      value: MockSpeechRecognition,
      configurable: true,
    });

    const transcriber = new WebSTTTranscriber();
    await transcriber.startRecording();

    const recognition = MockSpeechRecognition.instances[0]!;
    const stopPromise = transcriber.stopRecording();

    recognition.onerror?.({
      error: "audio-capture",
      message: "microphone lost",
    } as unknown as Event);

    await expect(stopPromise).rejects.toThrow(
      "Speech recognition error: audio-capture - microphone lost",
    );
    await expect(transcriber.stopRecording()).rejects.toThrow("Not recording");
  });
});
