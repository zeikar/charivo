// SITUATIONAL context (date/time) — separate from relationship state, UNGATED.
// Pure; owns ONLY the late-night hour check (NO daypart bucketing — the injected
// exact time covers greetings). Does NOT import hearth-theme.ts.

/** Local hours >= LATE_HOUR_START or < LATE_HOUR_END are considered "late". */
export const LATE_HOUR_START = 22;
export const LATE_HOUR_END = 6;

/** Weekday names indexed by Date.getDay() (0 = Sunday). */
export const WEEKDAYS = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** Month names indexed by Date.getMonth() (0 = January). */
export const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/**
 * Render a situational context block from a caller-supplied local Date.
 * No new Date() / Date.now() inside — the caller owns the clock.
 */
export function renderSituationalContext(localDate: Date): string {
  const weekday = WEEKDAYS[localDate.getDay()];
  const day = localDate.getDate();
  const month = MONTHS[localDate.getMonth()];
  const year = localDate.getFullYear();
  const hour = localDate.getHours();
  const hh = String(hour).padStart(2, "0");
  const mm = String(localDate.getMinutes()).padStart(2, "0");

  const factLine = `The user's local date and time: ${weekday}, ${day} ${month} ${year}, ${hh}:${mm}.`;

  const isLate = hour >= LATE_HOUR_START || hour < LATE_HOUR_END;

  if (isLate) {
    return `${factLine}\nIt's late for them — keep your energy softer and calmer.`;
  }

  return factLine;
}
