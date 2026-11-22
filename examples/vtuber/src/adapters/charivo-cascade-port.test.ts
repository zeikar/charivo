import {
  createCharivo,
  isCharivoError,
  type Character,
  type Charivo,
  type LLMClient,
  type LLMMessage,
  type TTSManager,
} from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  createDirector,
  createPushSource,
  DEFAULT_DIRECTOR_CONFIG,
  SHOW_PROTOCOL_INSTRUCTIONS,
  type ShowPlan,
} from "../director";
import {
  formatAgentEvent,
  formatDirectorCue,
  formatViewerChat,
} from "../director/envelope";
import { DEFAULT_SHOW_PLAN, SHOW_DIRECTOR_CONFIG } from "../app/lib/show-plan";
import {
  applyShowProtocol,
  createCharivoCascadePort,
} from "./charivo-cascade-port";

const CHARACTER: Character = {
  id: "hiyori",
  name: "Hiyori",
  personality: "Cheerful and curious.",
};

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
  } = {},
) {
  const llm = createScriptedClient(options.reply);
  const tts = createFakeTTS(options);
  const charivo: Charivo = createCharivo({
    llm: createLLMManager(llm.client),
    tts,
    character: applyShowProtocol(CHARACTER),
  });
  const cancelledIds: string[] = [];
  charivo.on("turn:cancelled", ({ userMessageId }) =>
    cancelledIds.push(userMessageId),
  );
  const port = createCharivoCascadePort(charivo);
  return { llm, tts, charivo, port, cancelledIds };
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
    const speaking = port.speak("[DIRECTOR] Say hello.").then((result) => {
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
    const speaking = port.speak("[DIRECTOR] Say hello.");
    await vi.advanceTimersByTimeAsync(500);
    expect(tts.utterances).toHaveLength(1);
    // userSay() stops leftover audio before each turn; that stop is not ours.
    tts.order.length = 0;

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
    await expect(speaking).resolves.toMatchObject({ status: "cancelled" });
  });

  it("ignores a turn:cancelled naming another message id", async () => {
    const { port, charivo } = setup({ durationMs: 1_000 });
    const speaking = port.speak("[DIRECTOR] Say hello.");
    await vi.advanceTimersByTimeAsync(500);

    charivo.emit("turn:cancelled", { userMessageId: "someone-else" });
    await vi.advanceTimersByTimeAsync(500);

    await expect(speaking).resolves.toEqual({
      status: "completed",
      text: "Reply 1.",
    });
  });

  it("resolves failed with the message when the LLM request rejects", async () => {
    const { port } = setup({
      reply: () => new Error("Text is longer than 500 characters."),
    });
    await expect(port.speak("[DIRECTOR] Say hello.")).resolves.toEqual({
      status: "failed",
      text: "",
      error: "Text is longer than 500 characters.",
    });
  });

  it("resolves failed with the message when TTS speak() rejects (tts:error)", async () => {
    const { port, tts, charivo } = setup();
    const ttsErrors: string[] = [];
    charivo.on("tts:error", ({ error }) => ttsErrors.push(error.message));
    tts.speakError = new Error("Speech synthesis failed.");

    await expect(port.speak("[DIRECTOR] Say hello.")).resolves.toEqual({
      status: "failed",
      text: "Reply 1.",
      error: "Speech synthesis failed.",
    });
    expect(ttsErrors).toEqual(["Speech synthesis failed."]);
  });

  it("rejects interrupt() with Charivo's error when the TTS stop rejects", async () => {
    const { port, tts } = setup();
    void port.speak("[DIRECTOR] Say hello.");
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
    const { port, tts, llm, charivo } = setup();
    expect(port.isUsable()).toBe(true);
    void port.speak("[DIRECTOR] Say hello.");
    await vi.advanceTimersByTimeAsync(500);
    tts.stopError = new Error("Audio device is gone.");
    await expect(port.interrupt()).rejects.toThrow("Audio device is gone.");
    expect(port.isUsable()).toBe(false);

    // Even once the audio could be stopped again, there is no way back.
    tts.stopError = null;
    await vi.advanceTimersByTimeAsync(5_000);
    const userSay = vi.spyOn(charivo, "userSay");
    const requestsBefore = llm.requests.length;

    await expect(port.speak("[DIRECTOR] Say hello.")).resolves.toMatchObject({
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
    expect(userSay).not.toHaveBeenCalled();
    expect(llm.requests).toHaveLength(requestsBefore);
    expect(port.isUsable()).toBe(false);
  });
});

describe("dispose", () => {
  it("removes every listener the port added to Charivo", () => {
    const charivo = createCharivo();
    const on = vi.spyOn(charivo, "on");
    const off = vi.spyOn(charivo, "off");
    const port = createCharivoCascadePort(charivo);
    expect(on).toHaveBeenCalled();
    expect(off).not.toHaveBeenCalled();

    port.dispose();

    expect(off.mock.calls).toHaveLength(on.mock.calls.length);
    for (const [event, listener] of on.mock.calls) {
      expect(off).toHaveBeenCalledWith(event, listener);
    }
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

describe("applyShowProtocol", () => {
  it("keeps the personality and appends the show protocol", () => {
    expect(applyShowProtocol(CHARACTER)).toEqual({
      ...CHARACTER,
      personality: `Cheerful and curious.\n\n${SHOW_PROTOCOL_INSTRUCTIONS}`,
    });
    expect(applyShowProtocol({ id: "a", name: "A" }).personality).toBe(
      SHOW_PROTOCOL_INSTRUCTIONS,
    );
  });

  it("sends the protocol as system prompt and each input with its envelope tag", async () => {
    const { port, llm, charivo } = setup({ durationMs: 10 });
    const cue = formatDirectorCue("Greet the viewers.");
    const prompts = [
      cue,
      formatViewerChat("mika", "hi!"),
      formatAgentEvent("weather", "It started raining."),
    ];
    for (const prompt of prompts) {
      const speaking = port.speak(prompt);
      await vi.advanceTimersByTimeAsync(10);
      await expect(speaking).resolves.toMatchObject({ status: "completed" });
    }

    expect(llm.requests.map((request) => request.at(-1))).toEqual([
      { role: "user", content: expect.stringMatching(/^\[DIRECTOR\] /) },
      { role: "user", content: expect.stringMatching(/^\[CHAT\] /) },
      { role: "user", content: expect.stringMatching(/^\[EVENT\] /) },
    ]);
    for (const request of llm.requests) {
      expect(request[0]).toEqual({
        role: "system",
        content: expect.stringContaining(SHOW_PROTOCOL_INSTRUCTIONS),
      });
    }

    // The known limitation this example reports: userSay() is the only way
    // in, so a cue is stored as though a viewer had said it.
    expect(charivo.getHistory()).toContainEqual(
      expect.objectContaining({ type: "user", content: cue }),
    );
  });
});
