import { describe, it, expect, beforeEach, vi } from "vitest";

import { createWriteJobScheduler } from "./trigger";

// ---------------------------------------------------------------------------
// Deferred helper — a manually-resolved promise. Lets each test control
// exactly when a runJob "completes", so concurrency is fully deterministic
// (NO setTimeout, no real timers).
// ---------------------------------------------------------------------------

interface Deferred {
  promise: Promise<void>;
  resolve: () => void;
  reject: (err: unknown) => void;
}

function defer(): Deferred {
  let resolve!: () => void;
  let reject!: (err: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

// ---------------------------------------------------------------------------
// Gated runJob harness. Every invocation:
//   - records (sessionId, finalize) in `calls`,
//   - records enter/exit order in `order` (to prove no overlap),
//   - blocks on a per-call deferred the test resolves/rejects on demand.
// ---------------------------------------------------------------------------

interface Harness {
  runJob: (sessionId: string, opts: { finalize: boolean }) => Promise<void>;
  calls: Array<{ sessionId: string; finalize: boolean }>;
  order: string[];
  deferreds: Deferred[];
  /** Resolve the Nth (0-based) runJob invocation. */
  complete: (index: number) => void;
  /** Reject the Nth (0-based) runJob invocation. */
  fail: (index: number, err?: unknown) => void;
}

function makeHarness(): Harness {
  const calls: Array<{ sessionId: string; finalize: boolean }> = [];
  const order: string[] = [];
  const deferreds: Deferred[] = [];

  const runJob = (sessionId: string, opts: { finalize: boolean }) => {
    const index = calls.length;
    calls.push({ sessionId, finalize: opts.finalize });
    order.push(`enter#${index}(${opts.finalize})`);
    const d = defer();
    deferreds.push(d);
    return d.promise.then(
      () => {
        order.push(`exit#${index}(${opts.finalize})`);
      },
      (err) => {
        order.push(`exit#${index}(${opts.finalize})`);
        throw err;
      },
    );
  };

  return {
    runJob,
    calls,
    order,
    deferreds,
    complete: (index) => deferreds[index].resolve(),
    fail: (index, err = new Error("boom")) => deferreds[index].reject(err),
  };
}

/** Flush the microtask queue so chained .then/.finally callbacks settle. */
async function flush(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

const SID = "session-1";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("createWriteJobScheduler", () => {
  let h: Harness;

  beforeEach(() => {
    h = makeHarness();
  });

  it("onTurn schedules a finalize:false job exactly at each Nth turn and not between", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    // Turns 1..9 → nothing scheduled.
    for (let t = 1; t <= 9; t++) {
      await scheduler.onTurn(SID, t);
    }
    expect(h.calls).toHaveLength(0);

    // Turn 10 → one checkpoint job (finalize:false).
    const p = scheduler.onTurn(SID, 10);
    await flush();
    expect(h.calls).toEqual([{ sessionId: SID, finalize: false }]);

    h.complete(0);
    await p;
    await scheduler.drain(SID);

    // Turns 11..19 → still nothing new.
    for (let t = 11; t <= 19; t++) {
      await scheduler.onTurn(SID, t);
    }
    expect(h.calls).toHaveLength(1);

    // Turn 20 → second checkpoint.
    const p2 = scheduler.onTurn(SID, 20);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: false });

    h.complete(1);
    await p2;
  });

  it("respects a custom checkpointEveryTurns", async () => {
    const scheduler = createWriteJobScheduler({
      runJob: h.runJob,
      checkpointEveryTurns: 3,
    });

    await scheduler.onTurn(SID, 1);
    await scheduler.onTurn(SID, 2);
    expect(h.calls).toHaveLength(0);

    const p = scheduler.onTurn(SID, 3);
    await flush();
    expect(h.calls).toEqual([{ sessionId: SID, finalize: false }]);
    h.complete(0);
    await p;
  });

  it("two near-simultaneous fires run the job body without overlap and coalesce into one rerun", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    // Two checkpoints fired back-to-back before the first completes.
    const p1 = scheduler.onTurn(SID, 10);
    const p2 = scheduler.onTurn(SID, 20);
    await flush();

    // Only ONE run started (no overlap): the second is coalesced.
    expect(h.calls).toHaveLength(1);
    expect(h.order).toEqual(["enter#0(false)"]);

    // First run completes → coalesced rerun starts (exactly one more).
    h.complete(0);
    await flush();

    expect(h.calls).toHaveLength(2);
    // Strict ordering proves no interleave: enter#0, exit#0, then enter#1.
    expect(h.order).toEqual([
      "enter#0(false)",
      "exit#0(false)",
      "enter#1(false)",
    ]);

    h.complete(1);
    await Promise.all([p1, p2]);
    await scheduler.drain(SID);

    // No third run — the duplicate was coalesced, not multiplied.
    expect(h.calls).toHaveLength(2);
  });

  it("[B3] onSessionEnd records finalize:true; a checkpoint records finalize:false", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    const pc = scheduler.onTurn(SID, 10);
    await flush();
    expect(h.calls[0]).toEqual({ sessionId: SID, finalize: false });
    h.complete(0);
    await pc;
    await scheduler.drain(SID);

    const pe = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: true });
    h.complete(1);
    await pe;
  });

  it("[B2]+[B3] onSessionEnd during an in-flight checkpoint produces a second finalize:true run, neither dropped nor demoted", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    // Checkpoint starts and is in-flight.
    const pc = scheduler.onTurn(SID, 10);
    await flush();
    expect(h.calls).toEqual([{ sessionId: SID, finalize: false }]);

    // Session ends WHILE the checkpoint runs → coalesced as a pending final.
    const pe = scheduler.onSessionEnd(SID);
    await flush();
    // Still only one run in flight (no overlap).
    expect(h.calls).toHaveLength(1);

    // Checkpoint completes → the pending FINAL runs next.
    h.complete(0);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: true });
    expect(h.order).toEqual([
      "enter#0(false)",
      "exit#0(false)",
      "enter#1(true)",
    ]);

    // The checkpoint caller resolves, but onSessionEnd resolves only after
    // the finalize:true run completes.
    await pc;
    let endResolved = false;
    void pe.then(() => {
      endResolved = true;
    });
    await flush();
    expect(endResolved).toBe(false);

    h.complete(1);
    await pe;
    expect(endResolved).toBe(true);
  });

  it("a checkpoint fire arriving after a final is pending cannot demote it back to finalize:false", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    // Start an in-flight checkpoint.
    scheduler.onTurn(SID, 10);
    await flush();

    // End the session (final pending), then another checkpoint fires.
    const pe = scheduler.onSessionEnd(SID);
    scheduler.onTurn(SID, 20);
    await flush();
    expect(h.calls).toHaveLength(1);

    // First run completes → the single coalesced rerun must be FINAL.
    h.complete(0);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1].finalize).toBe(true);

    h.complete(1);
    await pe;
    await scheduler.drain(SID);
    expect(h.calls).toHaveLength(2);
  });

  it("onSessionEnd always triggers a finalize:true run even right after a checkpoint settled", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    const pc = scheduler.onTurn(SID, 10);
    await flush();
    h.complete(0);
    await pc;
    await scheduler.drain(SID);
    expect(h.calls).toEqual([{ sessionId: SID, finalize: false }]);

    const pe = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: true });
    h.complete(1);
    await pe;
  });

  it("[B5] after a successful final, a later Nth onTurn does not invoke runJob again", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    const pe = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls).toEqual([{ sessionId: SID, finalize: true }]);
    h.complete(0);
    await pe;

    // A later Nth turn must NOT schedule a checkpoint.
    const p = scheduler.onTurn(SID, 10);
    await flush();
    expect(h.calls).toHaveLength(1);
    expect(h.calls.some((c) => c.finalize === false)).toBe(false);
    await p; // resolves immediately, no run

    await scheduler.drain(SID);
    expect(h.calls).toHaveLength(1);
  });

  it("[B6] a finalize:true run that rejects leaves the session schedulable for a later onSessionEnd", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    const pe1 = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls).toEqual([{ sessionId: SID, finalize: true }]);

    // The final run REJECTS — must be caught, not crash, not finalize.
    h.fail(0);
    await pe1; // resolves (never rejects) despite the failure
    await scheduler.drain(SID);

    expect(errSpy).toHaveBeenCalled();

    // Session is still schedulable: a subsequent onSessionEnd fires again.
    const pe2 = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: true });
    h.complete(1);
    await pe2;

    errSpy.mockRestore();
  });

  it("a rejecting checkpoint does not throw out, still honors a pending final, and later fires still run", async () => {
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    // In-flight checkpoint, then session ends (pending final).
    const pc = scheduler.onTurn(SID, 10);
    const pe = scheduler.onSessionEnd(SID);
    await flush();
    expect(h.calls).toHaveLength(1);

    // The checkpoint REJECTS — the returned promise must still resolve and the
    // pending final must still run.
    h.fail(0);
    await pc; // resolves despite rejection
    await flush();

    expect(h.calls).toHaveLength(2);
    expect(h.calls[1]).toEqual({ sessionId: SID, finalize: true });

    h.complete(1);
    await pe;
    await scheduler.drain(SID);

    // A subsequent fire still runs (final completed → finalized; but a fresh
    // session id proves the scheduler is still alive and schedulable).
    const other = "session-2";
    const pp = scheduler.onSessionEnd(other);
    await flush();
    expect(h.calls).toHaveLength(3);
    expect(h.calls[2]).toEqual({ sessionId: other, finalize: true });
    h.complete(2);
    await pp;

    errSpy.mockRestore();
  });

  it("drain() with no argument awaits quiescence across all sessions", async () => {
    const scheduler = createWriteJobScheduler({ runJob: h.runJob });

    const pa = scheduler.onSessionEnd("a");
    const pb = scheduler.onSessionEnd("b");
    await flush();
    expect(h.calls).toHaveLength(2);

    let drained = false;
    const dp = scheduler.drain().then(() => {
      drained = true;
    });
    await flush();
    expect(drained).toBe(false);

    h.complete(0);
    await flush();
    expect(drained).toBe(false); // session "b" still running

    h.complete(1);
    await Promise.all([pa, pb, dp]);
    expect(drained).toBe(true);
  });
});
