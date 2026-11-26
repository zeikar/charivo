import { describe, expect, it } from "vitest";

import type { DirectorLogEntry, Line } from "../../director";
import {
  appendToShowLog,
  buildTranscript,
  EMPTY_SHOW_LOG,
  type ShowLog,
} from "./show-log";

function line(id: string, source: Line["source"]): Line {
  return {
    id,
    source,
    priority: 2,
    input: { kind: "direction", text: `cue ${id}` },
    createdAt: 0,
  };
}

const cueLine = line("line-1", "segment");
const chatLine = line("line-2", "chat");
const agentLine = line("line-3", "agent");
const clearedLine = line("line-4", "chat");

const entries: DirectorLogEntry[] = [
  {
    kind: "decision",
    at: 0,
    event: {
      kind: "segment",
      index: 0,
      segment: { kind: "opening", title: "Hi", cue: "Open.", durationMs: 1 },
    },
    decision: { kind: "enqueue", line: cueLine },
  },
  { kind: "line-start", at: 0, line: cueLine },
  {
    kind: "decision",
    at: 1,
    event: { kind: "chat", viewer: "mika", text: "Hello!" },
    decision: { kind: "enqueue", line: chatLine },
  },
  {
    kind: "decision",
    at: 2,
    event: {
      kind: "agent",
      source: "game-agent",
      text: "Found diamonds",
      priority: "normal",
    },
    decision: { kind: "enqueue", line: agentLine },
  },
  {
    kind: "decision",
    at: 3,
    event: { kind: "chat", viewer: "mika", text: "Again" },
    decision: { kind: "ignore", reason: "viewer-cooldown" },
  },
  {
    kind: "line-end",
    at: 4,
    line: cueLine,
    result: { status: "completed", text: "Welcome in!" },
    leak: false,
  },
  { kind: "line-start", at: 5, line: chatLine },
  {
    kind: "decision",
    at: 6,
    event: { kind: "chat", viewer: "sora", text: "Hey", highlighted: true },
    decision: { kind: "enqueue", line: clearedLine },
  },
  { kind: "line-dropped", at: 7, line: agentLine, reason: "stale" },
  {
    kind: "line-end",
    at: 8,
    line: chatLine,
    result: { status: "cancelled", text: "Hi mi" },
    leak: false,
  },
];

const log: ShowLog = { entries, dropped: 0 };

describe("buildTranscript", () => {
  it("keeps viewer chat and the character's started lines, in log order", () => {
    expect(buildTranscript(log)).toEqual([
      expect.objectContaining({
        kind: "character",
        lineId: "line-1",
        status: "completed",
        text: "Welcome in!",
      }),
      expect.objectContaining({
        kind: "viewer",
        viewer: "mika",
        text: "Hello!",
        decision: { kind: "enqueue", line: chatLine },
      }),
      expect.objectContaining({
        kind: "viewer",
        viewer: "mika",
        text: "Again",
        decision: { kind: "ignore", reason: "viewer-cooldown" },
      }),
      expect.objectContaining({
        kind: "character",
        lineId: "line-2",
        status: "cancelled",
        text: "Hi mi",
      }),
      expect.objectContaining({
        kind: "viewer",
        viewer: "sora",
        highlighted: true,
      }),
    ]);
  });

  it("never shows cues, agent events, or unstarted lines", () => {
    const transcript = buildTranscript(log);
    const text = JSON.stringify(transcript);
    expect(text).not.toContain("Open.");
    expect(text).not.toContain("Found diamonds");
    const lineIds = transcript.flatMap((item) =>
      item.kind === "character" ? [item.lineId] : [],
    );
    expect(lineIds).toEqual(["line-1", "line-2"]);
  });

  it("shows a started line as speaking until it ends", () => {
    const partial = { entries: entries.slice(0, 7), dropped: 0 };
    expect(buildTranscript(partial).at(-1)).toEqual(
      expect.objectContaining({ lineId: "line-2", status: "speaking" }),
    );
  });

  it("settles a line still speaking as failed when the show fails", () => {
    const failed = appendToShowLog(
      { entries: entries.slice(0, 7), dropped: 0 },
      [{ kind: "error", at: 9, message: "could not stop the audio" }],
    );
    expect(buildTranscript(failed).at(-1)).toEqual(
      expect.objectContaining({ lineId: "line-2", status: "failed", text: "" }),
    );
  });

  it("leaves out a line whose line-start the cap dropped", () => {
    const capped = appendToShowLog(EMPTY_SHOW_LOG, entries, 3);
    expect(capped.dropped).toBe(7);
    expect(buildTranscript(capped)).toEqual([
      expect.objectContaining({ kind: "viewer", viewer: "sora", key: "7" }),
    ]);
  });
});

describe("appendToShowLog", () => {
  it("keeps the latest entries and counts the dropped ones", () => {
    const first = appendToShowLog(EMPTY_SHOW_LOG, entries.slice(0, 3), 4);
    const second = appendToShowLog(first, entries.slice(3, 6), 4);
    expect(second.entries).toEqual(entries.slice(2, 6));
    expect(second.dropped).toBe(2);
  });
});
