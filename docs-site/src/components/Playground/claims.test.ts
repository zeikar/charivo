import { describe, expect, it } from "vitest";
import {
  addClaim,
  endSpeech,
  pruneExpired,
  rankClaims,
  releaseSource,
  speechHold,
  startSpeech,
  type SentClaim,
} from "./claims";

const smile = {
  source: "director",
  priority: "inferred",
  expressionId: "smile",
  hold: { kind: "until-release" },
} as const;
const startle = (now: number) =>
  ({
    source: "reaction",
    priority: "reflex",
    expressionId: "surprised",
    hold: { kind: "ms", endsAt: now + 1500 },
  }) as const;

const ids = (claims: SentClaim[]) =>
  rankClaims(claims).map((c) => c.expressionId);

describe("claims readout", () => {
  it("ranks a reflex over a held inferred pick, then falls back when it expires", () => {
    let claims = addClaim([], smile);
    claims = addClaim(claims, startle(0));
    expect(ids(claims)).toEqual(["surprised", "smile"]);
    expect(ids(pruneExpired(claims, 1499))).toEqual(["surprised", "smile"]);
    expect(ids(pruneExpired(claims, 1500))).toEqual(["smile"]);
  });

  it("breaks a priority tie in favour of the newest claim", () => {
    let claims = addClaim([], { ...smile, source: "a" });
    claims = addClaim(claims, { ...smile, source: "b", expressionId: "sad" });
    expect(ids(claims)).toEqual(["sad", "smile"]);
  });

  it("keeps one claim per source, the new one counting as newest", () => {
    let claims = addClaim([], smile);
    claims = addClaim(claims, {
      ...smile,
      source: "other",
      expressionId: "sad",
    });
    claims = addClaim(claims, { ...smile, expressionId: "laugh" });
    expect(ids(claims)).toEqual(["laugh", "sad"]);
  });

  it("drops only the released source", () => {
    let claims = addClaim([], smile);
    claims = addClaim(claims, startle(0));
    expect(ids(releaseSource(claims, "director"))).toEqual(["surprised"]);
  });

  it("expires a speech-scoped claim no speech picked up within the window", () => {
    const claims = addClaim([], {
      source: "app",
      priority: "explicit",
      expressionId: "laugh",
      hold: speechHold(0, false),
    });
    expect(ids(pruneExpired(claims, 7999))).toEqual(["laugh"]);
    expect(ids(pruneExpired(claims, 8000))).toEqual([]);
  });

  it("binds a speech-scoped claim to the next speech and ends it with that speech", () => {
    let claims = addClaim([], {
      source: "app",
      priority: "explicit",
      expressionId: "laugh",
      hold: speechHold(0, false),
    });
    claims = startSpeech(claims, 5000);
    expect(ids(pruneExpired(claims, 20000))).toEqual(["laugh"]);
    expect(ids(endSpeech(claims))).toEqual([]);
  });

  it("binds a claim made mid-speech to that speech", () => {
    const claims = addClaim([], {
      source: "app",
      priority: "explicit",
      expressionId: "laugh",
      hold: speechHold(0, true),
    });
    expect(ids(pruneExpired(claims, 20000))).toEqual(["laugh"]);
    expect(ids(endSpeech(claims))).toEqual([]);
  });

  it("leaves timed and held claims alone when speech ends", () => {
    let claims = addClaim([], smile);
    claims = addClaim(claims, startle(0));
    expect(ids(endSpeech(claims))).toEqual(["surprised", "smile"]);
  });
});
