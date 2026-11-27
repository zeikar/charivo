import { describe, expect, it } from "vitest";
import type { AffectMap } from "@charivo/core";
import { resolveAffect } from "../src/affect";

const map: AffectMap = {
  joy: { expressionId: "smile", motion: { group: "Happy", index: 1 } },
  anger: [
    { expressionId: "frown" },
    { expressionId: "scowl", minIntensity: 0.4 },
    { expressionId: "rage", minIntensity: 0.8 },
  ],
  shy: { expressionId: "blush", minIntensity: 0.7 },
};

describe("resolveAffect (A1)", () => {
  it("uses a string expression as an id, with or without a map", () => {
    expect(resolveAffect({ expression: "wink" }, null)).toEqual({
      expressionId: "wink",
    });
    expect(resolveAffect({ expression: "joy" }, map)).toEqual({
      expressionId: "joy",
    });
  });

  it("resolves a mapped label with one entry to its expression and motion", () => {
    expect(resolveAffect({ expression: { affect: "joy" } }, map)).toEqual({
      expressionId: "smile",
      motion: { group: "Happy", index: 1 },
    });
  });

  it("picks the entry with the highest minIntensity not above the intensity", () => {
    const anger = (intensity: number) =>
      resolveAffect({ expression: { affect: "anger", intensity } }, map)
        .expressionId;
    expect(anger(0.1)).toBe("frown");
    expect(anger(0.4)).toBe("scowl");
    expect(anger(0.79)).toBe("scowl");
    expect(anger(0.8)).toBe("rage");
  });

  it("picks by minIntensity, not by list order", () => {
    expect(
      resolveAffect(
        { expression: { affect: "anger", intensity: 0.9 } },
        {
          anger: [
            { expressionId: "rage", minIntensity: 0.8 },
            { expressionId: "scowl", minIntensity: 0.4 },
          ],
        },
      ),
    ).toEqual({ expressionId: "rage" });
  });

  it("defaults the intensity to 0.5", () => {
    expect(resolveAffect({ expression: { affect: "anger" } }, map)).toEqual({
      expressionId: "scowl",
    });
    expect(resolveAffect({ expression: { affect: "shy" } }, map)).toEqual({});
  });

  it("clamps the intensity to 0..1", () => {
    expect(
      resolveAffect({ expression: { affect: "anger", intensity: 7 } }, map),
    ).toEqual({ expressionId: "rage" });
    expect(
      resolveAffect(
        {
          expression: { affect: "anger", intensity: -3 },
        },
        { anger: [{ expressionId: "calm", minIntensity: 0 }] },
      ),
    ).toEqual({ expressionId: "calm" });
  });

  it("resolves a label with no qualifying entry to nothing", () => {
    expect(
      resolveAffect({ expression: { affect: "shy", intensity: 0.69 } }, map),
    ).toEqual({});
  });

  it("resolves an unknown label, or any label with no map, to nothing", () => {
    expect(resolveAffect({ expression: { affect: "grief" } }, map)).toEqual({});
    expect(resolveAffect({ expression: { affect: "toString" } }, map)).toEqual(
      {},
    );
    expect(resolveAffect({ expression: { affect: "joy" } }, null)).toEqual({});
  });

  it("resolves no cue to nothing", () => {
    expect(resolveAffect(undefined, map)).toEqual({});
  });

  it("takes the cue's own motion over the entry's", () => {
    expect(
      resolveAffect(
        {
          expression: { affect: "joy" },
          motion: { group: "Wave" },
        },
        map,
      ),
    ).toEqual({ expressionId: "smile", motion: { group: "Wave" } });
  });

  it("keeps the cue's motion when the label resolves to nothing or there is no expression", () => {
    expect(
      resolveAffect(
        {
          expression: { affect: "grief" },
          motion: { group: "Sigh", index: 0 },
        },
        map,
      ),
    ).toEqual({ motion: { group: "Sigh", index: 0 } });
    expect(resolveAffect({ motion: { group: "Nod" } }, null)).toEqual({
      motion: { group: "Nod" },
    });
  });
  it("treats a NaN intensity as the 0.5 default", () => {
    expect(
      resolveAffect({ expression: { affect: "anger", intensity: NaN } }, map),
    ).toEqual({ expressionId: "scowl" });
  });
});
