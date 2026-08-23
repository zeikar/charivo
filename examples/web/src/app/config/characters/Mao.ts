import { defineCharacterConfig } from "./types";

export const MAO_CHARACTER_CONFIG = defineCharacterConfig({
  id: "Mao",
  character: {
    id: "Mao",
    name: "Mao",
    description: "A playful and mischievous character with a sense of humor",
    personality:
      "Witty, playful, and sometimes teasing. Enjoys jokes and light-hearted banter. Speaks with a fun, casual tone and loves to make people smile.",
    voice: { voiceId: "shimmer", rate: 1.2, pitch: 1.1, volume: 0.9 },
  },
  live2d: {
    modelPath: "/live2d/Mao/Mao.model3.json",
    // Affect only — these ride in the setExpression schema on every request.
    // Identified by rendering each expression and cross-checking the .exp3.json
    // deltas; Mao's model has explicit params that make the reading unambiguous
    // (Cheek = blush, EyeEffect = eye sparkle, MouthAngry = angry mouth).
    expressionDescriptions: {
      exp_01: "neutral, no expression",
      exp_02: "happy, eyes closed in a smile",
      exp_03: "calm, eyes gently closed",
      exp_04: "delighted, sparkling eyes",
      exp_05: "sad, downcast",
      exp_06: "bashful, blushing",
      exp_07: "alarmed, wide-eyed dismay",
      exp_08: "annoyed, grumpy",
    },
    // Established the same way as the expressions above: every motion was played
    // in this demo and watched. There is no authoritative published source for
    // the Cubism sample motion files -- do not "correct" these from the web.
    // Positional: index 0 describes motion index 0.
    //
    // None of Mao's motions carry a prerecorded voice clip, so nothing here is
    // silenced on the tool-call path. Several drive particle effects, which is
    // most of what distinguishes them.
    motionDescriptions: {
      Idle: [
        "quiet stand holding the broom, an occasional blink",
        "quiet stand with a small smile, broom held at her side",
      ],
      TapBody: [
        "eyes close in a soft wink while a few green sparks drift up — a small pleased beat",
        "head dips and eyes close with a blue spark at her side — shy, or settling down",
        "one hand lifts beside her hat in a small greeting wave, smiling",
        "raises the wand and a cyan heart blooms above it before shading green — an affectionate charm",
        "a full-body sparkle burst washes her in green-white starlight, then fades — a big spell flourish",
        "raises the wand with eyes closed as a warm gold glow swells around her — a bright finishing spell",
      ],
    },
  },
});
