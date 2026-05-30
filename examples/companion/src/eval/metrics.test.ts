import { describe, it, expect } from "vitest";

import {
  precisionRecall,
  precisionAtK,
  deletionCompliance,
  crossScopeIsolation,
  temporalCorrectionAccuracy,
  injectedTokenCount,
} from "./metrics";
import { estimateTokens } from "../memory/scoring";

describe("precisionRecall", () => {
  it("perfect overlap → precision 1, recall 1", () => {
    const pr = precisionRecall(new Set(["a", "b"]), new Set(["a", "b"]));
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
    expect(pr.truePositives).toBe(2);
    expect(pr.falsePositives).toBe(0);
    expect(pr.falseNegatives).toBe(0);
  });

  it("a false positive lowers precision (recall stays 1)", () => {
    const pr = precisionRecall(new Set(["a", "b", "x"]), new Set(["a", "b"]));
    expect(pr.precision).toBeCloseTo(2 / 3);
    expect(pr.recall).toBe(1);
    expect(pr.falsePositives).toBe(1);
  });

  it("a false negative lowers recall (precision stays 1)", () => {
    const pr = precisionRecall(new Set(["a"]), new Set(["a", "b"]));
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(0.5);
    expect(pr.falseNegatives).toBe(1);
  });

  it("both empty → 1/1 (total convention)", () => {
    const pr = precisionRecall(new Set(), new Set());
    expect(pr.precision).toBe(1);
    expect(pr.recall).toBe(1);
  });

  it("empty actual against non-empty expected → recall 0", () => {
    const pr = precisionRecall(new Set(), new Set(["a"]));
    expect(pr.recall).toBe(0);
  });
});

describe("precisionAtK", () => {
  it("counts relevant ids within the top K", () => {
    expect(precisionAtK(["a", "b", "c"], new Set(["a", "c"]), 2)).toBe(0.5);
  });

  it("K larger than the list divides by the list length", () => {
    expect(precisionAtK(["a", "b"], new Set(["a", "b"]), 5)).toBe(1);
  });

  it("K ≤ 0 or empty list → 0", () => {
    expect(precisionAtK(["a"], new Set(["a"]), 0)).toBe(0);
    expect(precisionAtK([], new Set(["a"]), 2)).toBe(0);
  });
});

describe("deletionCompliance", () => {
  it("compliant when no retired id is still retrievable", () => {
    const r = deletionCompliance({
      retiredIds: ["x"],
      stillRetrievableIds: new Set(["a", "b"]),
    });
    expect(r.compliant).toBe(true);
    expect(r.leaked).toEqual([]);
  });

  it("detects a leaked retired id", () => {
    const r = deletionCompliance({
      retiredIds: ["x", "y"],
      stillRetrievableIds: new Set(["a", "x"]),
    });
    expect(r.compliant).toBe(false);
    expect(r.leaked).toEqual(["x"]);
  });
});

describe("crossScopeIsolation", () => {
  it("isolated when no foreign id is retrieved", () => {
    const r = crossScopeIsolation({
      foreignExpectedIds: new Set(["f"]),
      retrievedIds: new Set(["a", "b"]),
    });
    expect(r.isolated).toBe(true);
  });

  it("detects a leaked foreign id", () => {
    const r = crossScopeIsolation({
      foreignExpectedIds: new Set(["f"]),
      retrievedIds: new Set(["a", "f"]),
    });
    expect(r.isolated).toBe(false);
    expect(r.leaked).toEqual(["f"]);
  });
});

describe("temporalCorrectionAccuracy", () => {
  it("correct when active id present and retired id absent", () => {
    expect(
      temporalCorrectionAccuracy({
        expectedActiveId: "new",
        expectedRetiredId: "old",
        activeIds: new Set(["new"]),
      }).correct,
    ).toBe(true);
  });

  it("wrong when the active id is missing", () => {
    expect(
      temporalCorrectionAccuracy({
        expectedActiveId: "new",
        expectedRetiredId: "old",
        activeIds: new Set(["old"]),
      }).correct,
    ).toBe(false);
  });

  it("wrong when the retired id is still active", () => {
    expect(
      temporalCorrectionAccuracy({
        expectedActiveId: "new",
        expectedRetiredId: "old",
        activeIds: new Set(["new", "old"]),
      }).correct,
    ).toBe(false);
  });
});

describe("injectedTokenCount", () => {
  it("equals estimateTokens for the same text", () => {
    const text = "some rendered memory block text";
    expect(injectedTokenCount(text)).toBe(estimateTokens(text));
  });
});
