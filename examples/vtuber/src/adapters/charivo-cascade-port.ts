// Connects the Director to a cascade brain: each line's typed input is one
// brain turn, and the turn's result says how the line ended. A turn settles
// once its reply has been spoken, cut or has failed, so a settled speak() is
// the end of the line.

import type { BrainTurnResult, ConversationBrain } from "@charivo/core";
import type { CharacterPort, SpeakResult } from "../director";

export interface CharivoCascadePort extends CharacterPort {
  /**
   * False for good once an interrupt() has rejected: audio may still be
   * playing, so no further line is started on this brain.
   */
  isUsable(): boolean;
}

const UNUSABLE_MESSAGE =
  "The character could not be stopped earlier, so no new line is started. Reload the page.";

const SILENT_MESSAGE = "The character gave no reply.";

function toSpeakResult(result: BrainTurnResult): SpeakResult {
  switch (result.status) {
    case "completed":
    case "cancelled":
      return { status: result.status, text: result.text };
    // Every line asks for a reply, so a turn that gave none did not do its job.
    case "silent":
      return { status: "failed", text: "", error: SILENT_MESSAGE };
    case "failed":
      return {
        status: "failed",
        text: result.text,
        error: result.error.message,
      };
  }
}

export function createCharivoCascadePort(
  brain: ConversationBrain,
): CharivoCascadePort {
  let usable = true;

  return {
    async speak(input): Promise<SpeakResult> {
      if (!usable)
        return { status: "failed", text: "", error: UNUSABLE_MESSAGE };
      return toSpeakResult(await brain.submit(input).done);
    },

    async interrupt() {
      try {
        await brain.interrupt();
      } catch (error) {
        usable = false;
        throw error;
      }
    },

    isUsable() {
      return usable;
    },
  };
}
