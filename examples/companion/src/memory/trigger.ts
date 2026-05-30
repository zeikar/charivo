/**
 * Idempotent write-job scheduler: the "fire-once owner" that decides WHEN to
 * invoke the (idempotent) promotion job for a session and threads the
 * checkpoint-vs-final distinction.
 *
 * This module is pure, in-memory and framework-agnostic — no React, no Next,
 * no store. The side-effecting promotion call (`runJob`) is INJECTED; in
 * production it wraps `promoteSession({ ..., finalize })`, in tests it is a spy.
 * Subtask 04+ owns wiring this into `useRealtimeSession`/the route; here we only
 * build the mechanism.
 *
 * Concurrency contract (one in-flight run per session):
 *   - No two runs for the same session ever overlap ([B2]).
 *   - A fire that arrives while a run is in flight is COALESCED into a single
 *     pending rerun — never dropped. `pendingFinalize` is MONOTONIC: once a
 *     final is pending a later checkpoint can never demote it back ([B3]).
 *   - Once a session is finalized (a `finalize: true` run completed
 *     successfully), later checkpoint fires are ignored ([B5]).
 *   - `runJob` rejections are caught (never crash the caller) and dev-logged;
 *     a failed run does NOT mark the session finalized, so onSessionEnd can
 *     still advance it ([B6]). All returned promises (and `drain`) RESOLVE,
 *     never reject.
 */

interface SessionState {
  /** The currently-running promotion, or null when the session is idle. */
  inFlight: Promise<void> | null;
  /** A fire arrived during the in-flight run and must run exactly once after. */
  rerunPending: boolean;
  /** Finalize flag for the pending rerun. Monotonic: never demoted to false. */
  pendingFinalize: boolean;
  /** True only after a `finalize: true` run COMPLETED SUCCESSFULLY. */
  finalized: boolean;
  /** Resolved when the CURRENT in-flight run settles (the fire it satisfies). */
  inFlightWaiters: Array<() => void>;
  /** Resolved when the PENDING rerun settles; promoted to inFlight on start. */
  rerunWaiters: Array<() => void>;
  /** Resolved whenever a finalize:true run settles (onSessionEnd callers). */
  finalWaiters: Array<() => void>;
  /** Resolved when the session reaches quiescence (drain callers). */
  drainWaiters: Array<() => void>;
}

export function createWriteJobScheduler(args: {
  runJob: (sessionId: string, opts: { finalize: boolean }) => Promise<void>;
  checkpointEveryTurns?: number;
}) {
  const { runJob } = args;
  const checkpointEveryTurns = args.checkpointEveryTurns ?? 10;

  const sessions = new Map<string, SessionState>();

  function getState(sessionId: string): SessionState {
    let state = sessions.get(sessionId);
    if (!state) {
      state = {
        inFlight: null,
        rerunPending: false,
        pendingFinalize: false,
        finalized: false,
        inFlightWaiters: [],
        rerunWaiters: [],
        finalWaiters: [],
        drainWaiters: [],
      };
      sessions.set(sessionId, state);
    }
    return state;
  }

  function resolveAll(waiters: Array<() => void>): void {
    for (const resolve of waiters) resolve();
  }

  /** A session is quiescent when nothing is running and no rerun is queued. */
  function settleDrain(state: SessionState): void {
    if (state.inFlight === null && !state.rerunPending) {
      const waiters = state.drainWaiters;
      state.drainWaiters = [];
      resolveAll(waiters);
    }
  }

  /**
   * Run the job exactly once for `sessionId`, then (in finally) either chain
   * the coalesced rerun or go idle. Resolves — never rejects — so the
   * scheduler never crashes its caller.
   */
  function runOnce(
    state: SessionState,
    sessionId: string,
    finalize: boolean,
  ): Promise<void> {
    return runJob(sessionId, { finalize })
      .then(() => {
        // Only a SUCCESSFUL finalize run marks the session finalized.
        if (finalize) {
          state.finalized = true;
        }
      })
      .catch((err: unknown) => {
        // Catch so the run/drain promise resolves and the scheduler survives.
        // A failed run is NOT marked finalized — the session stays schedulable
        // so a retry / onSessionEnd can still advance it ([B6]).
        if (process.env.NODE_ENV !== "production") {
          console.error(
            `[write-job-scheduler] runJob failed for session ${sessionId} (finalize=${finalize})`,
            err,
          );
        }
      })
      .finally(() => {
        // The fire(s) tied to THIS run are now satisfied (it settled, success
        // or failure). Resolve them before chaining any coalesced rerun.
        const settledWaiters = state.inFlightWaiters;
        state.inFlightWaiters = [];

        // A finalize run settling resolves onSessionEnd callers regardless of
        // success (the returned promise always resolves, never rejects).
        const settledFinalWaiters = finalize ? state.finalWaiters : [];
        if (finalize) state.finalWaiters = [];

        if (state.rerunPending) {
          state.rerunPending = false;
          const nextFinalize = state.pendingFinalize;
          state.pendingFinalize = false;
          // Promote the coalesced waiters to the next run's in-flight waiters.
          state.inFlightWaiters = state.rerunWaiters;
          state.rerunWaiters = [];
          state.inFlight = runOnce(state, sessionId, nextFinalize);
        } else {
          state.inFlight = null;
        }

        resolveAll(settledWaiters);
        resolveAll(settledFinalWaiters);
        settleDrain(state);
      });
  }

  /**
   * Schedule a job for `sessionId`. Returns a promise that resolves when the
   * fire is satisfied — i.e. when the specific run it folds into settles. For a
   * finalize fire the promise resolves only after a `finalize: true` run has
   * settled (tracked via finalWaiters), so an interleaved checkpoint never
   * resolves it early.
   */
  function schedule(sessionId: string, finalize: boolean): Promise<void> {
    const state = getState(sessionId);

    // [B5] Once finalized, a checkpoint fire is a no-op. A redundant finalize
    // fire is also harmless (promoteSession would no-op) → short-circuit it.
    if (state.finalized) {
      return Promise.resolve();
    }

    if (finalize) {
      // onSessionEnd: resolve only when a finalize:true run settles.
      const pending = new Promise<void>((resolve) => {
        state.finalWaiters.push(resolve);
      });
      if (state.inFlight === null) {
        state.inFlight = runOnce(state, sessionId, finalize);
      } else {
        state.rerunPending = true;
        state.pendingFinalize = true; // monotonic escalation to final
      }
      return pending;
    }

    // Checkpoint fire: resolve when the run that satisfies this fire settles.
    if (state.inFlight === null) {
      const pending = new Promise<void>((resolve) => {
        state.inFlightWaiters.push(resolve);
      });
      state.inFlight = runOnce(state, sessionId, false);
      return pending;
    }

    // A run is in flight: coalesce into the single pending rerun. Do not start
    // a second concurrent run. `pendingFinalize` is monotonic — a checkpoint
    // never demotes an already-pending final.
    const pending = new Promise<void>((resolve) => {
      state.rerunWaiters.push(resolve);
    });
    state.rerunPending = true;
    state.pendingFinalize = state.pendingFinalize || false;
    return pending;
  }

  return {
    /**
     * Called once per conversation turn. Schedules a CHECKPOINT (finalize:false)
     * at each Nth turn; otherwise resolves immediately. Ignored once finalized.
     */
    onTurn(sessionId: string, turnCount: number): Promise<void> {
      const state = sessions.get(sessionId);
      if (state?.finalized) {
        return Promise.resolve(); // [B5] no post-final checkpoint
      }
      const due = turnCount > 0 && turnCount % checkpointEveryTurns === 0;
      if (!due) {
        return Promise.resolve();
      }
      return schedule(sessionId, false);
    },

    /**
     * Called when a session ends. Schedules a FINAL (finalize:true) run and
     * resolves once a finalize:true run for this session has settled.
     */
    onSessionEnd(sessionId: string): Promise<void> {
      return schedule(sessionId, true);
    },

    /**
     * Resolves when no run and no pending rerun remain — for `sessionId`, or
     * for ALL sessions when omitted. Lets tests await quiescence deterministically.
     */
    drain(sessionId?: string): Promise<void> {
      if (sessionId !== undefined) {
        const state = sessions.get(sessionId);
        if (!state || (state.inFlight === null && !state.rerunPending)) {
          return Promise.resolve();
        }
        return new Promise<void>((resolve) => {
          state.drainWaiters.push(resolve);
        });
      }

      const pending: Array<Promise<void>> = [];
      for (const state of sessions.values()) {
        if (state.inFlight !== null || state.rerunPending) {
          pending.push(
            new Promise<void>((resolve) => {
              state.drainWaiters.push(resolve);
            }),
          );
        }
      }
      return Promise.all(pending).then(() => undefined);
    },
  };
}
