import {
  createCharivo,
  isCharivoError,
  type Character,
  type Charivo,
  type ConversationBrain,
  type LLMClient,
  type LLMMessage,
  type TTSManager,
} from "@charivo/core";
import {
  createCascadeBrain,
  createLLMManager,
  type CascadeBrainOptions,
} from "@charivo/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirector,
  createPushSource,
  DEFAULT_DIRECTOR_CONFIG,
  type ShowPlan,
} from "../director";
import {
  agentEventInput,
  directorCueInput,
  viewerChatInput,
} from "../director/line-input";
import {
  reviewReply,
  STAGE_DIRECTION_REPLY_MESSAGE,
} from "../app/lib/reply-review";
import { DEFAULT_SHOW_PLAN, SHOW_DIRECTOR_CONFIG } from "../app/lib/show-plan";
import { createCharivoCascadePort } from "./charivo-cascade-port";

const CHARACTER: Character = {
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and curious.",
};

const CUE = directorCueInput("Say hello.");

const SHORT_PLAN: ShowPlan = {
  segments: [
    {
      kind: "opening",
      title: "Hello",
      cue: "Greet the viewers.",
      durationMs: 600_000,
    },
    { kind: "ending", title: "Bye", cue: "Say goodbye." },
  ],
};

// Records every request and answers from a script, so a test can read what
// the model was sent and decide what it says back.
function createScriptedClient(
  reply: (index: number) => string | Error = (index) => `Reply ${index + 1}.`,
) {
  const requests: LLMMessage[][] = [];
  const client: LLMClient = {
    async call(messages) {
      requests.push(messages.map((message) => ({ ...message })));
      const answer = reply(requests.length - 1);
      if (answer instanceof Error) throw answer;
      return answer;
    },
  };
  return { client, requests };
}

interface FakeUtterance {
  text: string;
  settled: boolean;
}

// speak() settles when its timer runs out or when stop() lands, like the real
// manager's "resolves when the utterance finishes". It tracks how many
// utterances were unsettled at once. A rejecting stop() leaves speak()
// unsettled on purpose, as the worst case: the real TTSManager still tears
// playback down in a finally when its player's stop fails.
function createFakeTTS({
  durationMs = 1_000,
  stopDelayMs = 0,
}: { durationMs?: number; stopDelayMs?: number } = {}) {
  const utterances: FakeUtterance[] = [];
  const playing = new Map<FakeUtterance, () => void>();
  const order: string[] = [];
  let peakConcurrent = 0;

  const tts = {
    utterances,
    order,
    get peakConcurrent() {
      return peakConcurrent;
    },
    /** When set, speak() rejects with it. */
    speakError: null as Error | null,
    /** When set, stop() rejects with it and leaves the audio playing (see above). */
    stopError: null as Error | null,

    speak(text: string): Promise<void> {
      if (tts.speakError) return Promise.reject(tts.speakError);
      const utterance: FakeUtterance = { text, settled: false };
      utterances.push(utterance);
      return new Promise<void>((resolve) => {
        const finish = () => {
          clearTimeout(timer);
          playing.delete(utterance);
          utterance.settled = true;
          order.push("tts-speak-settled");
          resolve();
        };
        const timer = setTimeout(finish, durationMs);
        playing.set(utterance, finish);
        peakConcurrent = Math.max(peakConcurrent, playing.size);
      });
    },

    async stop(): Promise<void> {
      if (tts.stopError) throw tts.stopError;
      if (stopDelayMs > 0) {
        await new Promise((resolve) => setTimeout(resolve, stopDelayMs));
      }
      for (const finish of [...playing.values()]) finish();
      order.push("tts-stop-resolved");
    },

    setVoice() {},
    isSupported: () => true,
  } satisfies TTSManager & Record<string, unknown>;
  return tts;
}

function setup(
  options: {
    reply?: (index: number) => string | Error;
    durationMs?: number;
    stopDelayMs?: number;
    review?: CascadeBrainOptions["review"];
  } = {},
) {
  const llm = createScriptedClient(options.reply);
  const tts = createFakeTTS(options);
  const brain: ConversationBrain = createCascadeBrain(
    createLLMManager(llm.client, { directionRole: "user" }),
    { review: options.review ?? reviewReply },
  );
  const charivo: Charivo = createCharivo({
    brain,
    tts,
    character: CHARACTER,
  });
  const cancelledIds: string[] = [];
  charivo.on("turn:cancelled", ({ turnId }) => cancelledIds.push(turnId));
  const port = createCharivoCascadePort(brain);
  return { llm, tts, brain, charivo, port, cancelledIds };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("createCharivoCascadePort", () => {
  it("resolves completed with the reply once the TTS speak() has resolved", async () => {
    const { port, tts } = setup({ durationMs: 1_000 });
    let settled = false;
    const speaking = port.speak(CUE).then((result) => {
      settled = true;
      expect(tts.utterances[0]?.settled).toBe(true);
      return result;
    });

    await vi.advanceTimersByTimeAsync(999);
    expect(tts.utterances).toHaveLength(1);
    expect(settled).toBe(false);

    await vi.advanceTimersByTimeAsync(1);
    await expect(speaking).resolves.toEqual({
      status: "completed",
      text: "Reply 1.",
    });
  });

  it("resolves cancelled when interrupted mid-playback, and interrupt() waits for the TTS stop", async () => {
    const { port, tts, charivo, cancelledIds } = setup({
      durationMs: 1_000,
      stopDelayMs: 50,
    });
    const sentIds: string[] = [];
    charivo.on("message:sent", ({ message }) => sentIds.push(message.id));
    const speaking = port.speak(CUE);
    await vi.advanceTimersByTimeAsync(500);
    expect(tts.utterances).toHaveLength(1);

    const interrupting = port
      .interrupt()
      .then(() => tts.order.push("interrupt-resolved"));
    await vi.advanceTimersByTimeAsync(50);
    await interrupting;

    expect(tts.order).toEqual([
      "tts-speak-settled",
      "tts-stop-resolved",
      "interrupt-resolved",
    ]);
    expect(sentIds).toHaveLength(1);
    expect(cancelledIds).toEqual(sentIds);
    await expect(speaking).resolves.toEqual({
      status: "cancelled",
      text: "Reply 1.",
    });
  });

  it("resolves failed with the message when the LLM request rejects", async () => {
    const { port } = setup({
      reply: () => new Error("Text is longer than 500 characters."),
    });
    await expect(port.speak(CUE)).resolves.toEqual({
      status: "failed",
      text: "",
      error: "Text is longer than 500 characters.",
    });
  });

  it("resolves failed with the reply and the message when TTS speak() rejects", async () => {
    const { port, tts } = setup();
    tts.speakError = new Error("Speech synthesis failed.");

    await expect(port.speak(CUE)).resolves.toEqual({
      status: "failed",
      text: "Reply 1.",
      error: "Speech synthesis failed.",
    });
  });

  it("resolves failed and speaks nothing when the review withholds a reply repeating the cue", async () => {
    const cue =
      "The stream is ending. Thank the viewers for hanging out and say a warm goodbye.";
    const { port, tts } = setup({ reply: () => `Okay. ${cue}` });

    await expect(port.speak(directorCueInput(cue))).resolves.toEqual({
      status: "failed",
      text: "",
      error: STAGE_DIRECTION_REPLY_MESSAGE,
    });
    expect(tts.utterances).toHaveLength(0);
  });

  it("resolves failed when the brain gives no reply", async () => {
    const { port, tts } = setup({ review: () => null });

    await expect(port.speak(CUE)).resolves.toEqual({
      status: "failed",
      text: "",
      error: "The character gave no reply.",
    });
    expect(tts.utterances).toHaveLength(0);
  });

  it("rejects interrupt() with Charivo's error when the TTS stop rejects", async () => {
    const { port, tts } = setup();
    void port.speak(CUE);
    await vi.advanceTimersByTimeAsync(500);
    tts.stopError = new Error("Audio device is gone.");

    const rejection = await port.interrupt().catch((error: unknown) => error);
    expect(isCharivoError(rejection)).toBe(true);
    expect((rejection as Error).message).toBe("Audio device is gone.");
  });

  it("fails a Director without starting another line when the interrupt rejects", async () => {
    const { port, tts, llm } = setup({ durationMs: 1_000 });
    const chat = createPushSource();
    const director = createDirector({
      port,
      plan: SHORT_PLAN,
      config: { ...DEFAULT_DIRECTOR_CONFIG, idleAfterMs: 500 },
      sources: [chat],
    });
    director.start();

    // The opening cue plays for 1 s, then idle filler starts 500 ms later.
    await vi.advanceTimersByTimeAsync(1_600);
    expect(director.getSnapshot().inFlight?.source).toBe("idle");
    expect(llm.requests).toHaveLength(2);

    tts.stopError = new Error("Audio device is gone.");
    chat.push({ kind: "chat", viewer: "mika", text: "hi!", highlighted: true });
    await vi.advanceTimersByTimeAsync(0);

    expect(director.getSnapshot()).toMatchObject({
      status: "failed",
      error: "Audio device is gone.",
    });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llm.requests).toHaveLength(2);
    expect(tts.utterances).toHaveLength(2);
  });

  it("is unusable for good once an interrupt has rejected", async () => {
    const { port, tts, llm, brain } = setup();
    expect(port.isUsable()).toBe(true);
    void port.speak(CUE);
    await vi.advanceTimersByTimeAsync(500);
    tts.stopError = new Error("Audio device is gone.");
    await expect(port.interrupt()).rejects.toThrow("Audio device is gone.");
    expect(port.isUsable()).toBe(false);

    // Even once the audio could be stopped again, there is no way back.
    tts.stopError = null;
    await vi.advanceTimersByTimeAsync(5_000);
    const submit = vi.spyOn(brain, "submit");
    const requestsBefore = llm.requests.length;

    await expect(port.speak(CUE)).resolves.toMatchObject({
      status: "failed",
      error: expect.any(String),
    });

    const director = createDirector({
      port,
      plan: SHORT_PLAN,
      config: { ...DEFAULT_DIRECTOR_CONFIG, idleAfterMs: 500 },
    });
    const results: string[] = [];
    director.subscribe((_snapshot, entries) => {
      for (const entry of entries) {
        if (entry.kind === "line-end") results.push(entry.result.status);
      }
    });
    director.start();
    await vi.advanceTimersByTimeAsync(5_000);

    expect(results.length).toBeGreaterThan(0);
    expect(new Set(results)).toEqual(new Set(["failed"]));
    expect(submit).not.toHaveBeenCalled();
    expect(llm.requests).toHaveLength(requestsBefore);
    expect(port.isUsable()).toBe(false);
  });

  it("keeps viewer lines and agent events in history, and never a cue", async () => {
    const { port, llm, brain } = setup({ durationMs: 10 });
    const inputs = [
      directorCueInput("Greet the viewers."),
      viewerChatInput("mika", "hi!"),
      agentEventInput("weather", "It started raining."),
    ];
    for (const input of inputs) {
      const speaking = port.speak(input);
      await vi.advanceTimersByTimeAsync(10);
      await expect(speaking).resolves.toMatchObject({ status: "completed" });
    }

    // The cue reached the model once, in its own request.
    expect(llm.requests[0]?.at(-1)).toEqual({
      role: "user",
      content: expect.stringContaining("Greet the viewers."),
    });
    const history = brain.getHistory();
    expect(history.map((message) => message.type)).toEqual([
      "character",
      "user",
      "character",
      "event",
      "character",
    ]);
    expect(history[1]).toMatchObject({
      type: "user",
      source: "mika",
      content: "hi!",
    });
    expect(history[3]).toMatchObject({
      type: "event",
      source: "weather",
      content: "It started raining.",
    });
  });
});

describe("a Director on the cascade port", () => {
  it("runs two virtual minutes with nothing cut and one utterance at a time", async () => {
    const { port, tts, cancelledIds } = setup({ durationMs: 5_000 });
    const director = createDirector({
      port,
      plan: DEFAULT_SHOW_PLAN,
      config: SHOW_DIRECTOR_CONFIG,
    });
    director.start();

    await vi.advanceTimersByTimeAsync(120_000);

    expect(director.getSnapshot().status).toBe("running");
    expect(director.getSnapshot().counters.linesSpoken).toBeGreaterThan(5);
    expect(director.getSnapshot().counters.linesFailed).toBe(0);
    expect(cancelledIds).toEqual([]);
    expect(tts.peakConcurrent).toBe(1);
  });
});
