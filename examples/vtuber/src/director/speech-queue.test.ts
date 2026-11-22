import { describe, expect, it } from "vitest";
import { createSpeechQueue } from "./speech-queue";
import type { Line } from "./types";

function line(id: string, overrides: Partial<Line> = {}): Line {
  return {
    id,
    source: "chat",
    priority: 1,
    prompt: `[CHAT] v: ${id}`,
    createdAt: 0,
    ...overrides,
  };
}

function ids(lines: Line[]): string[] {
  return lines.map((l) => l.id);
}

describe("createSpeechQueue", () => {
  it("starts empty", () => {
    const queue = createSpeechQueue();
    expect(queue.snapshot()).toEqual([]);
    expect(queue.shift(0)).toEqual({ line: null, dropped: [] });
  });

  it("serves higher priority first and arrival order within a priority", () => {
    const queue = createSpeechQueue();
    queue.push(line("low-1", { priority: 1 }));
    queue.push(line("high-1", { priority: 3 }));
    queue.push(line("low-2", { priority: 1 }));
    queue.push(line("mid-1", { priority: 2 }));
    queue.push(line("high-2", { priority: 3 }));

    expect(ids(queue.snapshot())).toEqual([
      "high-1",
      "high-2",
      "mid-1",
      "low-1",
      "low-2",
    ]);

    const served: string[] = [];
    for (let next = queue.shift(0).line; next; next = queue.shift(0).line) {
      served.push(next.id);
    }
    expect(served).toEqual(["high-1", "high-2", "mid-1", "low-1", "low-2"]);
    expect(queue.snapshot()).toEqual([]);
  });

  it("skips expired lines at shift and returns them as dropped", () => {
    const queue = createSpeechQueue();
    queue.push(
      line("stale-1", { source: "agent", priority: 2, expiresAt: 10 }),
    );
    queue.push(
      line("stale-2", { source: "agent", priority: 2, expiresAt: 19 }),
    );
    queue.push(line("chat", { priority: 2 }));
    queue.push(line("fresh", { source: "agent", priority: 1, expiresAt: 100 }));

    const result = queue.shift(20);

    expect(result.line?.id).toBe("chat");
    expect(ids(result.dropped)).toEqual(["stale-1", "stale-2"]);
    expect(ids(queue.snapshot())).toEqual(["fresh"]);
  });

  it("keeps a line whose expiry is exactly now", () => {
    const queue = createSpeechQueue();
    queue.push(line("edge", { source: "agent", expiresAt: 20 }));

    expect(queue.shift(20)).toEqual({
      line: expect.objectContaining({ id: "edge" }),
      dropped: [],
    });
  });

  it("returns no line when every queued line has expired", () => {
    const queue = createSpeechQueue();
    queue.push(line("a", { source: "agent", expiresAt: 1 }));
    queue.push(line("b", { source: "agent", expiresAt: 2 }));

    const result = queue.shift(5);

    expect(result.line).toBeNull();
    expect(ids(result.dropped)).toEqual(["a", "b"]);
    expect(queue.snapshot()).toEqual([]);
  });

  it("removes matching lines and returns them", () => {
    const queue = createSpeechQueue();
    queue.push(line("idle-1", { source: "idle", priority: 0 }));
    queue.push(line("chat-1", { priority: 2 }));
    queue.push(line("idle-2", { source: "idle", priority: 0 }));

    const removed = queue.removeWhere((l) => l.source === "idle");

    expect(ids(removed)).toEqual(["idle-1", "idle-2"]);
    expect(ids(queue.snapshot())).toEqual(["chat-1"]);
  });

  it("counts pending lines per source", () => {
    const queue = createSpeechQueue();
    queue.push(line("c1"));
    queue.push(line("c2"));
    queue.push(line("a1", { source: "agent" }));

    expect(queue.pendingCounts(0)).toEqual({
      chat: 2,
      agent: 1,
      idle: 0,
      segment: 0,
    });
  });

  it("leaves expired lines out of the counts, by the same rule as shift", () => {
    const queue = createSpeechQueue();
    queue.push(line("gone", { source: "agent", expiresAt: 19 }));
    queue.push(line("edge", { source: "agent", expiresAt: 20 }));
    queue.push(line("c1"));

    expect(queue.pendingCounts(20)).toEqual({
      chat: 1,
      agent: 1,
      idle: 0,
      segment: 0,
    });
  });

  it("returns a snapshot the caller cannot use to change the queue", () => {
    const queue = createSpeechQueue();
    queue.push(line("a"));

    queue.snapshot().pop();

    expect(ids(queue.snapshot())).toEqual(["a"]);
  });
});
