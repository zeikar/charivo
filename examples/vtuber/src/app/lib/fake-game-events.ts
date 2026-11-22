import type { ScriptEntry } from "./scripted-source";

const SOURCE = "game-agent";

// One agent, spaced past its 10 s cooldown and between the scripted viewers,
// with one entry at each priority.
export const FAKE_GAME_EVENT_SCRIPT: readonly ScriptEntry[] = [
  {
    atMs: 50_000,
    event: {
      kind: "agent",
      source: SOURCE,
      text: "It started raining in the game world.",
      priority: "low",
    },
  },
  {
    atMs: 110_000,
    event: {
      kind: "agent",
      source: SOURCE,
      text: "Found diamonds while mining.",
      priority: "normal",
    },
  },
  {
    atMs: 170_000,
    event: {
      kind: "agent",
      source: SOURCE,
      text: "Got hit by a zombie and lost half a heart.",
      priority: "high",
    },
  },
  {
    atMs: 230_000,
    event: {
      kind: "agent",
      source: SOURCE,
      text: "The sun is setting over the village.",
      priority: "low",
    },
  },
];
