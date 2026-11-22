import type { ScriptEntry } from "./scripted-source";

// Spaced well past the 7 s line interval and the 10 s viewer cooldown, and
// clear of the segment starts at 1, 4 and 7 minutes, so each message gets its
// own turn instead of piling up behind a cue.
export const FAKE_VIEWER_SCRIPT: readonly ScriptEntry[] = [
  {
    atMs: 15_000,
    event: { kind: "chat", viewer: "mika", text: "Hi Haru! Just got here." },
  },
  {
    atMs: 40_000,
    event: {
      kind: "chat",
      viewer: "sora",
      text: "Evening! What are we chatting about today?",
    },
  },
  {
    atMs: 85_000,
    event: {
      kind: "chat",
      viewer: "ren",
      text: "What do you eat when you need cheering up?",
    },
  },
  {
    atMs: 130_000,
    event: {
      kind: "chat",
      viewer: "yui",
      text: "Here's a little something for the stream! Do you cook it yourself?",
      highlighted: true,
    },
  },
  {
    atMs: 200_000,
    event: {
      kind: "chat",
      viewer: "kaito",
      text: "Ramen on a rainy day is the best.",
    },
  },
  {
    atMs: 265_000,
    event: {
      kind: "chat",
      viewer: "mika",
      text: "Have you been anywhere fun lately?",
    },
  },
];
