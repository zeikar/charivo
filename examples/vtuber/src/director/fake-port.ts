// A timer-driven CharacterPort for tests. Lines settle on setTimeout, so
// vi.useFakeTimers() controls exactly when each one ends.

import type { CharacterPort, LineInput, SpeakResult } from "./types";

export interface FakeSpeakCall {
  /** 0 for the first speak() call. */
  index: number;
  input: LineInput;
  startedAt: number;
  endedAt: number | null;
  result: SpeakResult | null;
}

export interface FakePortOptions {
  /**
   * How long a line plays before it settles, fixed or per call index.
   * Defaults to 1,000 ms.
   */
  durationMs?: number | ((index: number) => number);
  /**
   * How a line ends when nothing interrupts it, e.g. a `"failed"` result with
   * or without an `error`. Defaults to `"completed"` with a plain reply.
   */
  respond?: (call: FakeSpeakCall) => SpeakResult;
  /** When set, interrupt() rejects with it and leaves the line playing. */
  interruptError?: Error;
  /**
   * When set, interrupt() resolves at once and the cancelled speak() settles
   * this many ms later. By default the cancelled speak() settles first.
   */
  cancelSettlesAfterMs?: number;
}

export interface FakePort extends CharacterPort {
  readonly calls: readonly FakeSpeakCall[];
  /** The most speak() calls that were unsettled at the same time. */
  readonly peakUnsettled: number;
  readonly interruptCalls: number;
}

export function createFakePort(options: FakePortOptions = {}): FakePort {
  const { durationMs = 1_000, interruptError, cancelSettlesAfterMs } = options;
  const respond =
    options.respond ??
    ((call: FakeSpeakCall): SpeakResult => ({
      status: "completed",
      text: `Reply ${call.index + 1}.`,
    }));
  const calls: FakeSpeakCall[] = [];
  const unsettled = new Map<FakeSpeakCall, (result: SpeakResult) => void>();
  let peakUnsettled = 0;
  let interruptCalls = 0;

  return {
    calls,
    get peakUnsettled() {
      return peakUnsettled;
    },
    get interruptCalls() {
      return interruptCalls;
    },

    speak(input) {
      const call: FakeSpeakCall = {
        index: calls.length,
        input,
        startedAt: Date.now(),
        endedAt: null,
        result: null,
      };
      calls.push(call);
      return new Promise<SpeakResult>((resolve) => {
        const timer = setTimeout(
          () => settle(respond(call)),
          typeof durationMs === "function"
            ? durationMs(call.index)
            : durationMs,
        );
        function settle(result: SpeakResult) {
          clearTimeout(timer);
          unsettled.delete(call);
          call.endedAt = Date.now();
          call.result = result;
          resolve(result);
        }
        unsettled.set(call, settle);
        peakUnsettled = Math.max(peakUnsettled, unsettled.size);
      });
    },

    async interrupt() {
      interruptCalls++;
      if (interruptError) throw interruptError;
      const cancelled = [...unsettled.entries()];
      const cancel = () => {
        for (const [call, settle] of cancelled) {
          if (unsettled.has(call)) settle({ status: "cancelled", text: "" });
        }
      };
      if (cancelSettlesAfterMs === undefined) cancel();
      else setTimeout(cancel, cancelSettlesAfterMs);
    },
  };
}
