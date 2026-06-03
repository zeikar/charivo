import { describe, it, expect } from "vitest";

import { buildSessionInstructions } from "./build-session-instructions";

// Distinct sentinels per slot so block ORDER is directly assertable.
const FULL = {
  persona: "PERSONA",
  userNameBlock: "USERNAME",
  demoGuidance: "DEMO",
  avatarBlock: "AVATAR",
  memoryBlock: "MEMORY",
  relationshipBlock: "RELATIONSHIP",
  situationalBlock: "SITUATIONAL",
};

describe("buildSessionInstructions", () => {
  it("composes all blocks in the canonical order, newline-joined", () => {
    expect(buildSessionInstructions(FULL)).toBe(
      [
        "PERSONA",
        "USERNAME",
        "DEMO",
        "AVATAR",
        "MEMORY",
        "RELATIONSHIP",
        "SITUATIONAL",
      ].join("\n"),
    );
  });

  it("keeps relationship before situational, with situational last", () => {
    const out = buildSessionInstructions(FULL);
    expect(out.indexOf("RELATIONSHIP")).toBeLessThan(
      out.indexOf("SITUATIONAL"),
    );
    expect(out.endsWith("SITUATIONAL")).toBe(true);
  });

  it("drops a null user-name block (filter-drop path)", () => {
    const out = buildSessionInstructions({ ...FULL, userNameBlock: null });
    expect(out).not.toContain("USERNAME");
    expect(out).toBe(
      [
        "PERSONA",
        "DEMO",
        "AVATAR",
        "MEMORY",
        "RELATIONSHIP",
        "SITUATIONAL",
      ].join("\n"),
    );
  });

  it("drops an undefined persona block (config yields no instructions)", () => {
    const out = buildSessionInstructions({ ...FULL, persona: undefined });
    expect(out).not.toContain("PERSONA");
    expect(out.startsWith("USERNAME")).toBe(true);
  });

  it("drops empty memory + relationship blocks (first-meeting shape) but keeps the ungated situational block", () => {
    const out = buildSessionInstructions({
      ...FULL,
      memoryBlock: "",
      relationshipBlock: "",
    });
    expect(out).not.toContain("MEMORY");
    expect(out).not.toContain("RELATIONSHIP");
    expect(out).toContain("SITUATIONAL");
    expect(out).toBe(
      ["PERSONA", "USERNAME", "DEMO", "AVATAR", "SITUATIONAL"].join("\n"),
    );
  });
});
