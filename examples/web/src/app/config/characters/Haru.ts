import { defineCharacterConfig } from "./types";

export const HARU_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Haru",
  // Demo-only voice mapping chosen from currently supported OpenAI built-ins.
  // Revisit after listening tests if a better fit emerges.
  character: {
    id: "Haru",
    name: "Haru",
    description:
      "A bright and energetic character who brings warmth to every conversation",
    personality:
      "Cheerful, optimistic, and always ready to help. Speaks with enthusiasm and uses friendly, casual language. Loves to encourage others and share positive energy.",
    voice: { voiceId: "coral", rate: 1.1, pitch: 1.3, volume: 0.8 },
  },
  live2d: {
    modelPath: "/live2d/Haru/Haru.model3.json",
    // Affect only — these ride in the setExpression schema on every request, and
    // the model picks on feeling, not on how the mesh deforms. F01/F02/F05 and
    // F04/F08 overlap in kind, so each carries just enough to stay distinct.
    //
    // The meanings were established by rendering each expression in this demo and
    // reading the result, then cross-checking the .exp3.json deltas. There is NO
    // authoritative published source for Haru's F01..F08 — and the mapping that
    // circulates in Open-LLM-VTuber's docs is WRONG (it calls F04 "joy"; F04 is a
    // frown). Do not "correct" these from the web. Note also that F04 and F08 share
    // an identical ParamMouthForm: they differ in brows and eyes, not mouth.
    expressionDescriptions: {
      F01: "gentle smile",
      F02: "big laugh, excited",
      F03: "angry",
      F04: "sad",
      F05: "beaming, eyes closed",
      F06: "surprised",
      F07: "shy, blushing",
      F08: "unimpressed, deadpan",
    },
    // Established the same way as the expressions above: every motion was played
    // in this demo and watched. There is no authoritative published source for
    // the Cubism sample motion files -- do not "correct" these from the web.
    // Positional: index 0 describes motion index 0.
    //
    // All four TapBody entries carry a prerecorded Japanese voice clip. Those
    // are silenced when an AI tool call triggers the motion and audible on a
    // manual trigger, so the wording below describes what is SEEN.
    motionDescriptions: {
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
    },
  },
});
