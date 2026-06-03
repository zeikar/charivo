import { describe, it, expect } from "vitest";

import {
  WEEKDAYS,
  MONTHS,
  renderSituationalContext,
} from "./situational-context";

// ---------------------------------------------------------------------------
// Fixed Dates — never call new Date() with no args in assertions
// ---------------------------------------------------------------------------

// June 3 2026, 14:05 — a Wednesday (getDay() === 3)
const DATE_AFTERNOON = new Date(2026, 5, 3, 14, 5);
// June 3 2026, 23:00 — late night
const DATE_NIGHT_23 = new Date(2026, 5, 3, 23, 0);
// June 4 2026, 03:00 — early morning (still "late")
const DATE_EARLY_3 = new Date(2026, 5, 4, 3, 0);

// ---------------------------------------------------------------------------
// renderSituationalContext
// ---------------------------------------------------------------------------

describe("renderSituationalContext", () => {
  it("always includes the fact line with weekday, date, and zero-padded HH:MM", () => {
    const result = renderSituationalContext(DATE_AFTERNOON);
    const expectedWeekday = WEEKDAYS[DATE_AFTERNOON.getDay()]; // "Wednesday"
    expect(result).toContain(expectedWeekday);
    expect(result).toContain("3");
    expect(result).toContain(MONTHS[DATE_AFTERNOON.getMonth()]); // "June"
    expect(result).toContain("2026");
    expect(result).toContain("14:05");
  });

  it("fact line does NOT contain greeting or instruction wording", () => {
    const result = renderSituationalContext(DATE_AFTERNOON);
    // The fact line should be purely informational — no directives
    const factLine = result.split("\n")[0];
    expect(factLine).not.toContain("greet");
    expect(factLine).not.toContain("say");
    expect(factLine).not.toContain("should");
  });

  it("hour 23 → includes the night-nudge line", () => {
    const result = renderSituationalContext(DATE_NIGHT_23);
    expect(result).toContain(
      "It's late for them — keep your energy softer and calmer.",
    );
  });

  it("hour 3 → includes the night-nudge line", () => {
    const result = renderSituationalContext(DATE_EARLY_3);
    expect(result).toContain(
      "It's late for them — keep your energy softer and calmer.",
    );
  });

  it("hour 14 → excludes the night-nudge line", () => {
    const result = renderSituationalContext(DATE_AFTERNOON);
    expect(result).not.toContain("It's late for them");
  });

  it("determinism: identical Date produces identical output on repeated calls", () => {
    const first = renderSituationalContext(DATE_AFTERNOON);
    const second = renderSituationalContext(DATE_AFTERNOON);
    expect(first).toBe(second);
  });

  it("produces exact expected string for the Wednesday 14:05 case", () => {
    const result = renderSituationalContext(DATE_AFTERNOON);
    expect(result).toBe(
      "The user's local date and time: Wednesday, 3 June 2026, 14:05.",
    );
  });
});
