import type { AvatarClaimPriority } from "@charivo/core";

// A readout of the expression claims this page has sent, not a mirror of
// RenderManager's state. The page is the face's only writer, so applying the
// documented rules (docs/guide/rendering.md, "Claims And Arbitration") to its
// own emits shows what the manager is showing: one claim per source, the
// highest priority wins, a tie goes to the newest, `{ ms }` holds expire,
// `avatar:release` drops a source, and a claim with no hold lasts for the
// speech it binds to (the one in progress, else the next within 8 s).

export const SPEECH_WINDOW_MS = 8000;

export type ClaimHold =
  | { kind: "ms"; endsAt: number }
  | { kind: "until-release" }
  | { kind: "speech"; bound: boolean; windowEndsAt: number };

export interface SentClaim {
  source: string;
  priority: AvatarClaimPriority;
  expressionId: string;
  hold: ClaimHold;
  /** Emit order, for the newest-wins tie-break. */
  seq: number;
}

const RANK: Record<AvatarClaimPriority, number> = {
  reflex: 3,
  explicit: 2,
  inferred: 1,
  ambient: 0,
};

/** The hold an `avatar:expression` with no `hold` gets. */
export function speechHold(now: number, speaking: boolean): ClaimHold {
  return {
    kind: "speech",
    bound: speaking,
    windowEndsAt: now + SPEECH_WINDOW_MS,
  };
}

export function addClaim(
  claims: SentClaim[],
  claim: Omit<SentClaim, "seq">,
): SentClaim[] {
  const seq = Math.max(0, ...claims.map((c) => c.seq)) + 1;
  return [...releaseSource(claims, claim.source), { ...claim, seq }];
}

export function releaseSource(
  claims: SentClaim[],
  source: string,
): SentClaim[] {
  return claims.filter((c) => c.source !== source);
}

export function startSpeech(claims: SentClaim[], now: number): SentClaim[] {
  return claims.map((c) =>
    c.hold.kind === "speech" && !c.hold.bound && c.hold.windowEndsAt > now
      ? { ...c, hold: { ...c.hold, bound: true } }
      : c,
  );
}

export function endSpeech(claims: SentClaim[]): SentClaim[] {
  return claims.filter((c) => !(c.hold.kind === "speech" && c.hold.bound));
}

export function pruneExpired(claims: SentClaim[], now: number): SentClaim[] {
  return claims.filter((c) => {
    if (c.hold.kind === "ms") {
      return c.hold.endsAt > now;
    }
    if (c.hold.kind === "speech" && !c.hold.bound) {
      return c.hold.windowEndsAt > now;
    }
    return true;
  });
}

/** Winner first. */
export function rankClaims(claims: SentClaim[]): SentClaim[] {
  return [...claims].sort(
    (a, b) => RANK[b.priority] - RANK[a.priority] || b.seq - a.seq,
  );
}
