import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ExternalShowEvent } from "../../director";
import { createScriptedSource, type ScriptEntry } from "./scripted-source";

const hello: ExternalShowEvent = { kind: "chat", viewer: "mika", text: "Hi" };
const diamonds: ExternalShowEvent = {
  kind: "agent",
  source: "game-agent",
  text: "Found diamonds",
  priority: "normal",
};

const script: ScriptEntry[] = [
  { atMs: 1_000, event: hello },
  { atMs: 3_000, event: diamonds },
];

describe("createScriptedSource", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("emits each entry at its offset from start()", () => {
    const emit = vi.fn();
    createScriptedSource(script, () => true).start(emit);

    vi.advanceTimersByTime(999);
    expect(emit).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(emit.mock.calls).toEqual([[hello]]);
    vi.advanceTimersByTime(2_000);
    expect(emit.mock.calls).toEqual([[hello], [diamonds]]);
  });

  it("skips an entry whose turn comes while it is disabled", () => {
    let enabled = false;
    const emit = vi.fn();
    createScriptedSource(script, () => enabled).start(emit);

    vi.advanceTimersByTime(1_000);
    expect(emit).not.toHaveBeenCalled();
    enabled = true;
    vi.advanceTimersByTime(2_000);
    expect(emit.mock.calls).toEqual([[diamonds]]);
  });

  it("emits nothing after stop() and leaves no timer behind", () => {
    const emit = vi.fn();
    const source = createScriptedSource(script, () => true);
    source.start(emit);

    vi.advanceTimersByTime(1_000);
    source.stop();
    expect(vi.getTimerCount()).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(emit.mock.calls).toEqual([[hello]]);
  });
});
