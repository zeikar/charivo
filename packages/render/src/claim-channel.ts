import type { AvatarClaimPriority, AvatarHold } from "@charivo/core";

const PRIORITY_RANK: Record<AvatarClaimPriority, number> = {
  reflex: 3,
  explicit: 2,
  inferred: 1,
  ambient: 0,
};

/** A performance id, or a symbol for a speech span nobody reported as a performance. */
export type SpanId = string | symbol;

export interface ClaimChannelOptions<V> {
  show(value: V): void;
  clear(): void;
  /**
   * The hold of a claim that names none. `"speech"` binds it to the speech
   * span in progress, else to the next one that starts within the pre-speech
   * window, else it expires at the end of that window.
   */
  defaultHold: "speech" | { ms: number };
  /** How long a span-tied claim waits for its span to start. */
  preSpeechWindowMs: number;
  /** Defaults to `===`. */
  equals?: (a: V, b: V) => boolean;
}

export interface ClaimRequest<V> {
  source: string;
  priority: AvatarClaimPriority;
  value: V;
  hold?: AvatarHold;
  claimId?: string;
}

export interface ClaimChannel<V> {
  /**
   * Returns `false` when the claim is ignored: a `hold` that is not one of the
   * {@link AvatarHold} shapes, or a `hold.ms` that is not a positive finite
   * number of at most 2,147,483,647 (the `setTimeout` limit). The source's live claim stays in place.
   */
  claim(request: ClaimRequest<V>): boolean;
  /**
   * Ends `source`'s live claim. With `claimId`, only when that claim was
   * accepted with the same id, so a stale release never ends a newer claim.
   */
  release(source: string, claimId?: string): void;
  /** Drops every claim; `clear` is called once if something was showing. */
  releaseAll(): void;
  spanStarted(id: SpanId, span: { speech: boolean }): void;
  spanEnded(id: SpanId): void;
  /**
   * The open spans can no longer end (the bus they were heard on is gone),
   * so every claim bound to one goes back to waiting on the window timer.
   */
  spansLost(): void;
  isActive(): boolean;
}

type SpanTie = { speech: true } | { id: SpanId };

interface Claim<V> {
  priority: AvatarClaimPriority;
  value: V;
  claimId?: string;
  seq: number;
  timer?: ReturnType<typeof setTimeout>;
  /** Set when the hold follows a span: any speech span, or one performance. */
  tie?: SpanTie;
  /** The open span the claim is held by; unset while it waits for one. */
  boundTo?: SpanId;
}

// Holds arrive on public events that plain JavaScript may emit, so a typo
// such as "until-released" is rejected rather than read as some other hold.
// setTimeout fires immediately for a delay above this (a 32-bit signed limit).
const MAX_HOLD_MS = 2_147_483_647;

function isValidHold(hold: unknown): hold is AvatarHold {
  if (hold === "until-release") {
    return true;
  }
  if (typeof hold !== "object" || hold === null) {
    return false;
  }
  if ("ms" in hold) {
    return (
      typeof hold.ms === "number" &&
      Number.isFinite(hold.ms) &&
      hold.ms > 0 &&
      hold.ms <= MAX_HOLD_MS
    );
  }
  return "performance" in hold && typeof hold.performance === "string";
}

/**
 * One held avatar channel (expression or gaze): keeps at most one live claim
 * per source and shows the winner, the highest priority with ties going to
 * the newest claim.
 */
export function createClaimChannel<V>(
  options: ClaimChannelOptions<V>,
): ClaimChannel<V> {
  const equals = options.equals ?? ((a: V, b: V) => a === b);
  const claims = new Map<string, Claim<V>>();
  // Insertion order is start order, so the last speech entry is the newest.
  const openSpans = new Map<SpanId, { speech: boolean }>();
  let showing: { value: V } | undefined;
  let nextSeq = 0;

  function winner(): Claim<V> | undefined {
    let best: Claim<V> | undefined;
    for (const claim of claims.values()) {
      if (
        !best ||
        PRIORITY_RANK[claim.priority] > PRIORITY_RANK[best.priority] ||
        (claim.priority === best.priority && claim.seq > best.seq)
      ) {
        best = claim;
      }
    }
    return best;
  }

  // The renderer hears only about changes to the winning value, so a
  // repeated claim refreshes its hold without replaying the expression.
  function update(): void {
    const best = winner();
    if (best) {
      if (!showing || !equals(showing.value, best.value)) {
        showing = { value: best.value };
        options.show(best.value);
      }
    } else if (showing) {
      showing = undefined;
      options.clear();
    }
  }

  function drop(source: string): void {
    const claim = claims.get(source);
    if (!claim) {
      return;
    }
    clearTimeout(claim.timer);
    claims.delete(source);
  }

  function expireAfter(source: string, claim: Claim<V>, ms: number): void {
    claim.timer = setTimeout(() => {
      claims.delete(source);
      update();
    }, ms);
  }

  function matches(tie: SpanTie, id: SpanId, speech: boolean): boolean {
    return "speech" in tie ? speech : tie.id === id;
  }

  function openSpanFor(tie: SpanTie): SpanId | undefined {
    let found: SpanId | undefined;
    for (const [id, span] of openSpans) {
      if (matches(tie, id, span.speech)) {
        found = id;
      }
    }
    return found;
  }

  return {
    claim({ source, priority, value, hold, claimId }) {
      if (hold !== undefined && !isValidHold(hold)) {
        return false;
      }
      const resolved = hold ?? options.defaultHold;

      drop(source);
      const claim: Claim<V> = { priority, value, claimId, seq: nextSeq++ };
      claims.set(source, claim);
      if (resolved === "speech") {
        claim.tie = { speech: true };
      } else if (typeof resolved === "object" && "performance" in resolved) {
        claim.tie = { id: resolved.performance };
      } else if (typeof resolved === "object") {
        expireAfter(source, claim, resolved.ms);
      }
      if (claim.tie) {
        claim.boundTo = openSpanFor(claim.tie);
        if (claim.boundTo === undefined) {
          expireAfter(source, claim, options.preSpeechWindowMs);
        }
      }
      update();
      return true;
    },
    release(source, claimId) {
      if (claimId !== undefined && claims.get(source)?.claimId !== claimId) {
        return;
      }
      drop(source);
      update();
    },
    releaseAll() {
      for (const source of [...claims.keys()]) {
        drop(source);
      }
      update();
    },
    spanStarted(id, span) {
      // Re-inserting moves a restarted span to the end, making it the newest.
      openSpans.delete(id);
      openSpans.set(id, span);
      for (const claim of claims.values()) {
        if (
          claim.tie &&
          claim.boundTo === undefined &&
          matches(claim.tie, id, span.speech)
        ) {
          clearTimeout(claim.timer);
          claim.timer = undefined;
          claim.boundTo = id;
        }
      }
    },
    spanEnded(id) {
      openSpans.delete(id);
      for (const [source, claim] of claims) {
        // A performance claim still waiting for its start ends here too.
        if (
          claim.boundTo === id ||
          (claim.tie && "id" in claim.tie && claim.tie.id === id)
        ) {
          drop(source);
        }
      }
      update();
    },
    spansLost() {
      openSpans.clear();
      for (const [source, claim] of claims) {
        if (claim.boundTo !== undefined) {
          claim.boundTo = undefined;
          expireAfter(source, claim, options.preSpeechWindowMs);
        }
      }
    },
    isActive: () => claims.size > 0,
  };
}
