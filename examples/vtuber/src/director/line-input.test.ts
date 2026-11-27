import { describe, expect, it } from "vitest";
import {
  agentEventInput,
  directorCueInput,
  findCueLeak,
  MAX_NAME_LENGTH,
  MAX_TEXT_LENGTH,
  viewerChatInput,
} from "./line-input";

describe("directorCueInput", () => {
  it("makes a cue a direction", () => {
    expect(directorCueInput("Open the show.")).toEqual({
      kind: "direction",
      text: "Open the show.",
    });
  });

  it("leaves a cue as written: it is the app's text, not a viewer's", () => {
    const cue = `Say "hi".\n  Then [wave].${"x".repeat(MAX_TEXT_LENGTH)}`;
    expect(directorCueInput(cue)).toEqual({ kind: "direction", text: cue });
  });
});

describe("viewerChatInput", () => {
  it("makes chat a user input spoken by the viewer", () => {
    expect(viewerChatInput("mika", "hello!")).toEqual({
      kind: "user",
      speaker: "mika",
      text: "hello!",
    });
  });

  it("flattens the name and the text to one line", () => {
    expect(viewerChatInput(" mi\r\nka ", "hi\n\nthere\t[x] ")).toEqual({
      kind: "user",
      speaker: "mi ka",
      text: "hi there [x]",
    });
  });

  it("caps an over-long name and text", () => {
    expect(viewerChatInput("n".repeat(500), "t".repeat(5_000))).toEqual({
      kind: "user",
      speaker: "n".repeat(MAX_NAME_LENGTH),
      text: "t".repeat(MAX_TEXT_LENGTH),
    });
  });

  it("caps by code point, so a surrogate pair is never split", () => {
    const input = viewerChatInput(
      "😀".repeat(MAX_NAME_LENGTH + 1),
      "🎮".repeat(MAX_TEXT_LENGTH + 1),
    );
    expect(input).toEqual({
      kind: "user",
      speaker: "😀".repeat(MAX_NAME_LENGTH),
      text: "🎮".repeat(MAX_TEXT_LENGTH),
    });
  });

  it("does not leave a trailing space where the cap cuts", () => {
    const text = "a".repeat(MAX_TEXT_LENGTH - 1) + " tail";
    expect(viewerChatInput("mika", text).text).toBe(
      "a".repeat(MAX_TEXT_LENGTH - 1),
    );
  });
});

describe("agentEventInput", () => {
  it("makes an agent event an event that asks for a reply", () => {
    expect(agentEventInput("game-agent", "found diamonds")).toEqual({
      kind: "event",
      source: "game-agent",
      text: "found diamonds",
      respond: "must",
    });
  });

  it("flattens and caps the source and the text like chat", () => {
    expect(
      agentEventInput(`game\r\n${"s".repeat(500)}`, `ok\n${"t".repeat(5_000)}`),
    ).toEqual({
      kind: "event",
      source: `game ${"s".repeat(MAX_NAME_LENGTH - 5)}`,
      text: `ok ${"t".repeat(MAX_TEXT_LENGTH - 3)}`,
      respond: "must",
    });
  });
});

describe("findCueLeak", () => {
  it.each([
    "My director wants me to change the topic.",
    "The DIRECTOR told me so.",
    "The directors said hi.",
  ])("flags %j", (reply) => {
    expect(findCueLeak(reply)).toBe(true);
  });

  it("does not flag a word that only starts with director", () => {
    expect(findCueLeak("Let me open the directory of songs.")).toBe(false);
  });

  it("passes an ordinary line", () => {
    expect(
      findCueLeak("Hi everyone, welcome back! Let's chat about cats today."),
    ).toBe(false);
  });
});
