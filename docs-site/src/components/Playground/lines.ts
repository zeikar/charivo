import type { TTSPlayer } from "@charivo/core";

export interface VoiceLine {
  character: "Twin" | "Mint";
  /** A short pill label; `text` is what the recording says. */
  label: string;
  text: string;
  /** The AI pick a text director would make for this line. */
  expression: string;
  /** Under static/, so served from the site root. */
  file: string;
}

// Pre-recorded with Gemini TTS; each text is the transcript of its file.
export const LINES: VoiceLine[] = [
  {
    character: "Twin",
    label: "Hi, I'm Twin",
    text: "Hi! I'm Twin. Want to see what I can do?",
    expression: "smile",
    file: "/voice/twin-hello.m4a",
  },
  {
    character: "Twin",
    label: "Way funnier",
    text: "Okay, that was way funnier than it should have been.",
    expression: "laugh",
    file: "/voice/twin-laugh.m4a",
  },
  {
    character: "Twin",
    label: "My ice cream",
    text: "Oh no... I think I just dropped my ice cream.",
    expression: "sad",
    file: "/voice/twin-sad.m4a",
  },
  {
    character: "Twin",
    label: "I keep going",
    text: "Try pressing Startle while I'm talking. My face reacts, but I keep right on going, see?",
    expression: "smile",
    file: "/voice/twin-try.m4a",
  },
  {
    character: "Mint",
    label: "Hello, I'm Mint",
    text: "Hello there. I'm Mint. Nice to meet you.",
    expression: "smile",
    file: "/voice/mint-hello.m4a",
  },
  {
    character: "Mint",
    label: "A little embarrassed",
    text: "Honestly? I'm a little embarrassed that you're watching me.",
    expression: "shy",
    file: "/voice/mint-shy.m4a",
  },
  {
    character: "Mint",
    label: "Who keeps poking me?",
    text: "Hey! Who keeps poking me?",
    expression: "angry",
    file: "/voice/mint-angry.m4a",
  },
  {
    character: "Mint",
    label: "Interrupt me",
    text: "This one is long enough to interrupt. Go on, press a reaction. I'll keep talking right through it, and my mouth keeps moving even when my face changes.",
    expression: "smile",
    file: "/voice/mint-try.m4a",
  },
];

/**
 * A TTS player that "synthesizes" a line by downloading its recording, so the
 * TTS manager plays it and drives lip-sync from the real audio. `urlFor` maps
 * a line's file to a URL under the site's base.
 */
export function createLinePlayer(urlFor: (file: string) => string): TTSPlayer {
  return {
    playbackMode: "audio",
    audioMimeType: "audio/mp4",
    async generateAudio(text) {
      const line = LINES.find((l) => l.text === text);
      if (!line) {
        throw new Error(`No recording for "${text}"`);
      }
      const res = await fetch(urlFor(line.file));
      if (!res.ok) {
        throw new Error(`Failed to fetch ${line.file}: ${res.status}`);
      }
      return res.arrayBuffer();
    },
    // The manager plays "audio" mode itself, from generateAudio().
    speak: () =>
      Promise.reject(new Error("Lines play through generateAudio()")),
    stop: async () => {},
    setVoice: () => {},
    isSupported: () => true,
  };
}
