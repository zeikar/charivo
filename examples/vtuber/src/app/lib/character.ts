import type { Character } from "@charivo/core";

export const HARU_CHARACTER: Character = {
  id: "Haru",
  name: "Haru",
  description:
    "The host of a cozy livestream, chatting with her viewers in a relaxed, welcoming way",
  personality:
    "Warm, cheerful, and easygoing, like a friend hosting a late-evening stream. Speaks in short, casual, natural sentences, keeps the conversation moving on her own, and answers viewers by name when she can. Never reads out stage directions or mentions being an AI unless asked.",
  // Gemini TTS ignores `rate` and `pitch`, so only the voice itself is set.
  voice: { voiceId: "Zephyr", volume: 0.8 },
};

export const HARU_MODEL_PATH = "/live2d/Haru/Haru.model3.json";

export const HARU_GAZE_ORIGIN = { x: 0.499, y: 0.143 };

// Affect only — these ride in the setExpression schema on every request, and
// the model picks on feeling, not on how the mesh deforms. F01/F02/F05 and
// F04/F08 overlap in kind, so each carries just enough to stay distinct.
//
// The meanings were established by rendering each expression in
// `examples/web` and reading the result, then cross-checking the .exp3.json
// deltas. There is NO authoritative published source for Haru's F01..F08 — and
// the mapping that circulates in Open-LLM-VTuber's docs is WRONG (it calls F04
// "joy"; F04 is a frown). Do not "correct" these from the web.
export const HARU_EXPRESSION_DESCRIPTIONS: Record<string, string> = {
  F01: "gentle smile",
  F02: "big laugh, excited",
  F03: "angry",
  F04: "sad",
  F05: "beaming, eyes closed",
  F06: "surprised",
  F07: "shy, blushing",
  F08: "unimpressed, deadpan",
};

// Established the same way as the expressions above: every motion was played
// and watched. Positional: index 0 describes motion index 0.
//
// All four TapBody entries carry a prerecorded Japanese voice clip. Those
// are silenced when an AI tool call triggers the motion, so the wording below
// describes what is SEEN.
export const HARU_MOTION_DESCRIPTIONS: Record<string, string[]> = {
  Idle: [
    "quiet standing rest, hands clasped in front, eyes forward",
    "quiet standing rest with the head dipping and the gaze lowering, a little more withdrawn",
  ],
  TapBody: [
    "arms unfold and hang open at her sides, ending on a closed-eye smile — an easy, welcoming settle",
    "both hands rise beside her face, palms open, with a bright smile — delighted, excited",
    "one hand lifts to her cheek while the other arm stays across her, face flat and attentive — a small 'oh?' or considering beat",
    "arms fold across her chest and stay folded with a calm closed-mouth smile — composed and reserved, a reaction to being touched rather than a greeting",
  ],
};
