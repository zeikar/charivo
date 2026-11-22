import {
  DEFAULT_DIRECTOR_CONFIG,
  type DirectorConfig,
  type ShowPlan,
} from "../../director";

// The opening and topic durations add up to at least ten minutes, so the
// ending cannot start before 600,000 ms however fast the lines go.
export const DEFAULT_SHOW_PLAN: ShowPlan = {
  segments: [
    {
      kind: "opening",
      title: "Hello, everyone",
      cue: "The stream is starting. Greet the viewers warmly, introduce yourself, and tell them it is a cozy chat stream today.",
      durationMs: 60_000,
    },
    {
      kind: "topic",
      title: "Favorite foods",
      cue: "Move on to food. Talk about a dish you love and what makes it a comfort food for you.",
      durationMs: 180_000,
    },
    {
      kind: "topic",
      title: "A recent trip",
      cue: "Change the topic to a short trip you took recently. Share one place you visited and one small moment you remember.",
      durationMs: 180_000,
    },
    {
      kind: "topic",
      title: "Cozy games",
      cue: "Switch over to cozy games. Talk about a relaxing game you have been playing and why it helps you unwind.",
      durationMs: 180_000,
    },
    {
      kind: "ending",
      title: "Goodbye",
      cue: "The stream is ending. Thank the viewers for hanging out and say a warm goodbye until next time.",
    },
  ],
};

export const SHOW_DIRECTOR_CONFIG: DirectorConfig = {
  ...DEFAULT_DIRECTOR_CONFIG,
  // Show pacing: a line every 7 s, and 14 s after a failed one. That also
  // keeps the chat route's rate modest, since one line makes one to four chat
  // requests through the avatar tool loop. These space lines; they do not
  // count or limit requests.
  minLineIntervalMs: 7_000,
  failedLineBackoffMs: 14_000,
};

/** "Topic 2 of 3: A recent trip" — topics are counted apart from the opening and ending. */
export function describeSegment(plan: ShowPlan, index: number): string {
  const segment = plan.segments[index];
  if (segment.kind === "opening") return `Opening: ${segment.title}`;
  if (segment.kind === "ending") return `Ending: ${segment.title}`;
  const topics = plan.segments.filter((s) => s.kind === "topic").length;
  const number = plan.segments
    .slice(0, index + 1)
    .filter((s) => s.kind === "topic").length;
  return `Topic ${number} of ${topics}: ${segment.title}`;
}
