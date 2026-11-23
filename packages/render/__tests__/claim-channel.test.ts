import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvatarClaimPriority, AvatarHold } from "@charivo/core";
import { createClaimChannel } from "../src/claim-channel";

const WINDOW_MS = 8_000;

function setup(
  defaultHold: "speech" | { ms: number } = { ms: 60_000 },
  equals?: (a: string, b: string) => boolean,
) {
  const shown: string[] = [];
  const clear = vi.fn();
  const channel = createClaimChannel<string>({
    show: (value) => shown.push(value),
    clear,
    defaultHold,
    preSpeechWindowMs: WINDOW_MS,
    equals,
  });
  const claim = (
    source: string,
    value: string,
    priority: AvatarClaimPriority = "explicit",
    hold?: AvatarHold,
  ) => channel.claim({ source, value, priority, hold });
  return { channel, shown, clear, claim };
}

describe("claim channel", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("winner selection", () => {
    it("shows the highest priority whatever the order", () => {
      const { shown, claim } = setup();

      claim("a", "ambient-face", "ambient");
      claim("b", "reflex-face", "reflex");
      claim("c", "inferred-face", "inferred");
      claim("d", "explicit-face", "explicit");

      expect(shown).toEqual(["ambient-face", "reflex-face"]);
    });

    it("gives a tie to the newest claim", () => {
      const { shown, claim } = setup();

      claim("a", "first", "inferred");
      claim("b", "second", "inferred");

      expect(shown).toEqual(["first", "second"]);
    });

    it("lets a source replace its own claim, which then counts as the newest", () => {
      const { shown, claim } = setup();

      claim("a", "a1", "inferred");
      claim("b", "b1", "inferred");
      claim("a", "a2", "inferred");

      expect(shown).toEqual(["a1", "b1", "a2"]);
    });

    it("lets a source lower its own priority below another source", () => {
      const { shown, claim } = setup();

      claim("a", "a1", "reflex");
      claim("b", "b1", "explicit");
      claim("a", "a2", "ambient");

      expect(shown).toEqual(["a1", "b1"]);
    });

    it("does not call show again while the winning value is unchanged", () => {
      const { shown, claim } = setup();

      claim("a", "smile", "inferred");
      claim("a", "smile", "inferred");
      claim("b", "smile", "explicit");

      expect(shown).toEqual(["smile"]);
    });

    it("compares values with the equals option", () => {
      const { shown, claim } = setup(
        { ms: 60_000 },
        (a, b) => a.toLowerCase() === b.toLowerCase(),
      );

      claim("a", "Smile");
      claim("a", "smile");
      claim("a", "frown");

      expect(shown).toEqual(["Smile", "frown"]);
    });

    it("reports whether any claim is live", () => {
      const { channel, claim } = setup();

      expect(channel.isActive()).toBe(false);
      claim("a", "smile");
      expect(channel.isActive()).toBe(true);
    });
  });

  describe("timed and released holds", () => {
    it("on expiry shows the next live claim, then clears when none is left", () => {
      const { channel, shown, clear, claim } = setup();

      claim("low", "calm", "inferred", { ms: 5_000 });
      claim("high", "startled", "reflex", { ms: 1_500 });
      expect(shown).toEqual(["calm", "startled"]);

      vi.advanceTimersByTime(1_499);
      expect(shown).toEqual(["calm", "startled"]);

      vi.advanceTimersByTime(1);
      expect(shown).toEqual(["calm", "startled", "calm"]);
      expect(clear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3_500);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("an expired lower claim leaves the winner showing", () => {
      const { shown, clear, claim } = setup();

      claim("high", "startled", "reflex", { ms: 5_000 });
      claim("low", "calm", "inferred", { ms: 1_000 });
      vi.advanceTimersByTime(1_000);

      expect(shown).toEqual(["startled"]);
      expect(clear).not.toHaveBeenCalled();
    });

    it("uses a fixed default hold when the claim names none", () => {
      const { shown, clear, claim } = setup({ ms: 1_200 });

      claim("a", "left");
      vi.advanceTimersByTime(1_199);
      expect(clear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(shown).toEqual(["left"]);
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a repeated claim for the showing value refreshes the hold without a replay", () => {
      const { shown, clear, claim } = setup();

      claim("a", "smile", "explicit", { ms: 1_000 });
      vi.advanceTimersByTime(800);
      claim("a", "smile", "explicit", { ms: 1_000 });
      vi.advanceTimersByTime(800);

      expect(clear).not.toHaveBeenCalled();
      expect(shown).toEqual(["smile"]);

      vi.advanceTimersByTime(200);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it.each([0, -5, Number.NaN, Number.POSITIVE_INFINITY, 2_147_483_648])(
      "ignores a claim whose ms is %s and keeps the source's live claim",
      (ms) => {
        const { channel, shown, clear, claim } = setup();

        claim("a", "smile", "explicit", { ms: 1_000 });
        expect(claim("a", "frown", "reflex", { ms })).toBe(false);

        expect(shown).toEqual(["smile"]);
        expect(channel.isActive()).toBe(true);
        vi.advanceTimersByTime(1_000);
        expect(clear).toHaveBeenCalledTimes(1);
      },
    );

    it.each([
      ["a misspelled string", "until-released"],
      ["the internal speech default", "speech"],
      ["an empty object", {}],
      ["a string ms", { ms: "1000" }],
      ["a non-string performance id", { performance: 7 }],
      ["null", null],
    ])(
      "ignores a claim whose hold is %s and keeps the source's live claim",
      (_label, hold) => {
        const { channel, shown, clear, claim } = setup();

        claim("a", "smile", "explicit", { ms: 1_000 });
        expect(claim("a", "frown", "reflex", hold as AvatarHold)).toBe(false);

        expect(shown).toEqual(["smile"]);
        expect(channel.isActive()).toBe(true);
        vi.advanceTimersByTime(1_000);
        expect(clear).toHaveBeenCalledTimes(1);
        expect(vi.getTimerCount()).toBe(0);
      },
    );

    it("holds an until-release claim until its source is released", () => {
      const { channel, shown, clear, claim } = setup();

      claim("low", "calm", "inferred", { ms: 2_000 });
      claim("high", "startled", "reflex", "until-release");
      vi.advanceTimersByTime(60_000);
      expect(shown).toEqual(["calm", "startled"]);

      channel.release("high");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
    });

    it("release falls back to the next live claim", () => {
      const { channel, shown, clear, claim } = setup();

      claim("low", "calm", "inferred", "until-release");
      claim("high", "startled", "reflex", "until-release");
      channel.release("high");

      expect(shown).toEqual(["calm", "startled", "calm"]);
      expect(clear).not.toHaveBeenCalled();
    });

    it("a source's replaced claim does not come back on release", () => {
      const { channel, shown, clear, claim } = setup();

      claim("a", "a1", "inferred", "until-release");
      claim("b", "b1", "inferred", "until-release");
      claim("a", "a2", "inferred", "until-release");
      channel.release("a");

      expect(shown).toEqual(["a1", "b1", "a2", "b1"]);
      expect(clear).not.toHaveBeenCalled();
    });

    it("releasing a timed claim cancels its timer", () => {
      const { channel, clear, claim } = setup();

      claim("a", "smile", "explicit", { ms: 1_000 });
      channel.release("a");

      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releasing a source with no claim does nothing", () => {
      const { channel, shown, clear, claim } = setup();

      claim("a", "smile");
      channel.release("b");

      expect(shown).toEqual(["smile"]);
      expect(clear).not.toHaveBeenCalled();
    });
  });

  describe("span-tied holds", () => {
    it("expires a default-hold claim at the window when no speech starts", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile");
      vi.advanceTimersByTime(WINDOW_MS - 1);
      expect(clear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
    });

    it("holds a default-hold claim past the window when speech starts inside it", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile");
      vi.advanceTimersByTime(WINDOW_MS - 1);
      channel.spanStarted("line", { speech: true });
      vi.advanceTimersByTime(60_000);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("line");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("binds a default-hold claim made during speech to that span", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      claim("a", "smile");
      expect(vi.getTimerCount()).toBe(0);
      vi.advanceTimersByTime(60_000);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("line");
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("accepts a symbol as an anonymous span id", () => {
      const { channel, clear, claim } = setup("speech");
      const anonymous = Symbol("speech");

      channel.spanStarted(anonymous, { speech: true });
      claim("a", "smile");
      channel.spanEnded(anonymous);

      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a span's end releases only the claims bound to it", () => {
      const { channel, shown, clear, claim } = setup("speech");

      claim("app", "wave", "ambient", "until-release");
      channel.spanStarted("line", { speech: true });
      claim("director", "happy", "inferred");
      claim("game", "startled", "reflex", { ms: 1_500 });
      expect(shown).toEqual(["wave", "happy", "startled"]);

      channel.spanEnded("line");
      expect(shown).toEqual(["wave", "happy", "startled"]);

      vi.advanceTimersByTime(1_500);
      expect(shown).toEqual(["wave", "happy", "startled", "wave"]);
      expect(clear).not.toHaveBeenCalled();
    });

    it("a mid-line reflex falls back to the line's expression, then to the base", () => {
      const { channel, shown, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      claim("director", "happy", "inferred");
      claim("game", "startled", "reflex", { ms: 1_500 });
      vi.advanceTimersByTime(1_500);
      expect(shown).toEqual(["happy", "startled", "happy"]);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("line");
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a timed claim outlives an unrelated span", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile", "explicit", { ms: 3_000 });
      channel.spanStarted("line", { speech: true });
      channel.spanEnded("line");
      expect(clear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(3_000);
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a non-speech span binds no default-hold claim", () => {
      const { channel, clear, claim } = setup("speech");

      claim("before", "smile", "inferred");
      channel.spanStarted("gesture", { speech: false });
      claim("during", "wink", "explicit");

      vi.advanceTimersByTime(WINDOW_MS);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
    });

    it("a performance claim waits for its own start and ignores other spans", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile", "explicit", { performance: "p1" });
      channel.spanStarted("p2", { speech: true });
      vi.advanceTimersByTime(3_000);
      channel.spanStarted("p1", { speech: false });
      vi.advanceTimersByTime(60_000);
      channel.spanEnded("p2");
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("p1");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a performance claim made during its span is bound at once", () => {
      const { channel, clear, claim } = setup({ ms: 1_200 });

      channel.spanStarted("p1", { speech: true });
      claim("a", "left", "explicit", { performance: "p1" });
      vi.advanceTimersByTime(60_000);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("p1");
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a performance claim whose start never comes expires at the window", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile", "explicit", { performance: "p1" });
      vi.advanceTimersByTime(WINDOW_MS);

      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
    });

    it("a performance claim is released by its end even before its start", () => {
      const { channel, clear, claim } = setup("speech");

      claim("a", "smile", "explicit", { performance: "p1" });
      channel.spanEnded("p1");

      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("overlapping spans", () => {
    it("a claim made during overlapping speech spans binds to the newest", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("a", { speech: true });
      channel.spanStarted("b", { speech: true });
      claim("x", "smile");

      channel.spanEnded("a");
      expect(clear).not.toHaveBeenCalled();
      channel.spanEnded("b");
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a restarted span counts as the newest", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("a", { speech: true });
      channel.spanStarted("p1", { speech: true });
      channel.spanStarted("a", { speech: true });
      claim("x", "smile");

      channel.spanEnded("p1");
      expect(clear).not.toHaveBeenCalled();
      channel.spanEnded("a");
      expect(clear).toHaveBeenCalledTimes(1);
    });

    it("a waiting claim binds to the first span to start, a later claim to the newest", () => {
      const { channel, shown, clear, claim } = setup("speech");

      claim("waiting", "smile", "inferred");
      channel.spanStarted("a", { speech: true });
      channel.spanStarted("b", { speech: true });
      claim("during", "grin", "ambient");

      channel.spanEnded("a");
      expect(shown).toEqual(["smile", "grin"]);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("b");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("re-entrant callbacks", () => {
    it("a show callback that claims synchronously leaves a consistent winner", () => {
      const shown: string[] = [];
      const clear = vi.fn();
      const channel = createClaimChannel<string>({
        show: (value) => {
          shown.push(value);
          if (value === "startled") {
            channel.claim({
              source: "echo",
              value: "echo",
              priority: "reflex",
              hold: "until-release",
            });
          }
        },
        clear,
        defaultHold: { ms: 60_000 },
        preSpeechWindowMs: WINDOW_MS,
      });

      channel.claim({
        source: "game",
        value: "startled",
        priority: "reflex",
        hold: { ms: 1_000 },
      });
      expect(shown).toEqual(["startled", "echo"]);
      expect(vi.getTimerCount()).toBe(1);

      channel.release("echo");
      expect(shown).toEqual(["startled", "echo", "startled", "echo"]);

      channel.releaseAll();
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("a clear callback that claims synchronously shows the new claim and leaves only its timer", () => {
      const shown: string[] = [];
      let rested = false;
      const clear = vi.fn(() => {
        if (!rested) {
          rested = true;
          channel.claim({
            source: "idle",
            value: "rest",
            priority: "ambient",
            hold: { ms: 1_000 },
          });
        }
      });
      const channel = createClaimChannel<string>({
        show: (value) => shown.push(value),
        clear,
        defaultHold: { ms: 60_000 },
        preSpeechWindowMs: WINDOW_MS,
      });

      channel.claim({
        source: "game",
        value: "startled",
        priority: "reflex",
        hold: { ms: 500 },
      });
      vi.advanceTimersByTime(500);

      expect(shown).toEqual(["startled", "rest"]);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(true);
      expect(vi.getTimerCount()).toBe(1);

      vi.advanceTimersByTime(1_000);
      expect(clear).toHaveBeenCalledTimes(2);
      expect(channel.isActive()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });
  });

  describe("lifecycle", () => {
    it("spansLost puts every span-bound claim on the window timer", () => {
      const { channel, shown, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      channel.spanStarted("p1", { speech: false });
      claim("director", "happy", "inferred");
      claim("tool", "proud", "explicit", { performance: "p1" });
      vi.advanceTimersByTime(60_000);
      expect(vi.getTimerCount()).toBe(0);

      channel.spansLost();
      expect(vi.getTimerCount()).toBe(2);
      vi.advanceTimersByTime(WINDOW_MS - 1);
      expect(clear).not.toHaveBeenCalled();

      vi.advanceTimersByTime(1);
      expect(shown).toEqual(["happy", "proud"]);
      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
    });

    it("spansLost leaves timed and until-release claims alone", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      claim("a", "smile", "explicit", "until-release");
      claim("b", "wink", "ambient", { ms: 20_000 });
      channel.spansLost();
      vi.advanceTimersByTime(60_000);

      expect(clear).not.toHaveBeenCalled();
      expect(channel.isActive()).toBe(true);
    });

    it("after spansLost a claim waits for a new span as a fresh one would", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("old", { speech: true });
      claim("a", "smile");
      channel.spansLost();

      // The lost span is not open any more, so a new claim waits too.
      claim("b", "grin", "inferred");
      vi.advanceTimersByTime(2_000);
      channel.spanStarted("new", { speech: true });
      vi.advanceTimersByTime(60_000);
      expect(clear).not.toHaveBeenCalled();

      channel.spanEnded("new");
      expect(clear).toHaveBeenCalledTimes(1);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releaseAll calls clear once and leaves no claim and no timer", () => {
      const { channel, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      claim("a", "smile");
      claim("b", "wink", "reflex", { ms: 1_500 });
      claim("c", "wave", "ambient", "until-release");
      claim("d", "proud", "explicit", { performance: "p9" });

      channel.releaseAll();

      expect(clear).toHaveBeenCalledTimes(1);
      expect(channel.isActive()).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    });

    it("releaseAll with nothing showing calls no clear", () => {
      const { channel, clear } = setup("speech");

      channel.releaseAll();

      expect(clear).not.toHaveBeenCalled();
    });

    it("releaseAll keeps the open spans, so a later claim still binds to one", () => {
      const { channel, shown, clear, claim } = setup("speech");

      channel.spanStarted("line", { speech: true });
      claim("a", "smile");
      channel.releaseAll();
      claim("a", "smile");
      expect(shown).toEqual(["smile", "smile"]);
      expect(vi.getTimerCount()).toBe(0);

      channel.spanEnded("line");
      expect(clear).toHaveBeenCalledTimes(2);
    });
  });
});
