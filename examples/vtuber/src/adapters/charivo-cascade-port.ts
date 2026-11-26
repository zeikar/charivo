// Connects the Director to a cascade Charivo (LLM -> TTS) through userSay().
// userSay() awaits the TTS speak(), which resolves when the utterance ends,
// so a settled userSay() is the end of the line; Charivo's events say how it
// ended.

import { getErrorMessage, type Character, type Charivo } from "@charivo/core";
import {
  SHOW_PROTOCOL_INSTRUCTIONS,
  type CharacterPort,
  type SpeakResult,
} from "../director";

export interface CharivoCascadePort extends CharacterPort {
  /**
   * False for good once an interrupt() has rejected: audio may still be
   * playing, so no further line is started on this Charivo.
   */
  isUsable(): boolean;
  /** Removes the port's listeners from the Charivo instance. Do not use the port after this. */
  dispose(): void;
}

const UNUSABLE_MESSAGE =
  "The character could not be stopped earlier, so no new line is started. Reload the page.";

interface Turn {
  id: string | null;
  reply: string;
  cancelled: boolean;
  error: string | null;
}

export function createCharivoCascadePort(charivo: Charivo): CharivoCascadePort {
  let usable = true;
  const turns = new Map<string, Turn>();
  // Set only while userSay() runs synchronously, which is when it emits
  // message:sent, so that event names the turn this speak() started.
  let starting: Turn | null = null;
  // Stale turns emit nothing more, so turn-scoped events without an id come
  // from the most recently started turn. That holds only while this port is
  // the only caller of userSay() on this Charivo instance.
  let latest: Turn | null = null;

  const onSent = ({ message }: { message: { id: string } }) => {
    if (!starting) return;
    starting.id = message.id;
    turns.set(message.id, starting);
    latest = starting;
  };
  const onSpeak = ({ text }: { text: string }) => {
    if (latest) latest.reply = text;
  };
  const onCancelled = ({ turnId }: { turnId: string }) => {
    const turn = turns.get(turnId);
    if (turn) turn.cancelled = true;
  };
  // Charivo reports a TTS failure as an event and still resolves userSay().
  // A failed pre-turn stop inside userSay() lands here too: the line may still
  // play, but it is reported failed, since the stop error is worth surfacing.
  const onTTSError = ({ error }: { error: Error }) => {
    if (latest && latest.error === null) latest.error = getErrorMessage(error);
  };
  charivo.on("message:sent", onSent);
  charivo.on("character:speak", onSpeak);
  charivo.on("turn:cancelled", onCancelled);
  charivo.on("tts:error", onTTSError);

  return {
    async speak(prompt): Promise<SpeakResult> {
      if (!usable)
        return { status: "failed", text: "", error: UNUSABLE_MESSAGE };
      const turn: Turn = { id: null, reply: "", cancelled: false, error: null };
      starting = turn;
      const saying = charivo.userSay(prompt);
      starting = null;
      try {
        await saying;
      } catch (error) {
        turn.error = getErrorMessage(error);
      } finally {
        if (turn.id !== null) turns.delete(turn.id);
      }
      if (turn.cancelled) return { status: "cancelled", text: turn.reply };
      if (turn.error !== null) {
        return { status: "failed", text: turn.reply, error: turn.error };
      }
      return { status: "completed", text: turn.reply };
    },

    async interrupt() {
      try {
        await charivo.interrupt();
      } catch (error) {
        usable = false;
        throw error;
      }
    },

    isUsable() {
      return usable;
    },

    dispose() {
      charivo.off("message:sent", onSent);
      charivo.off("character:speak", onSpeak);
      charivo.off("turn:cancelled", onCancelled);
      charivo.off("tts:error", onTTSError);
    },
  };
}

/**
 * Appends SHOW_PROTOCOL_INSTRUCTIONS to the personality, the part of the
 * character the LLM manager puts in the system prompt, so the model knows the
 * envelope tags before the first input arrives.
 */
export function applyShowProtocol(character: Character): Character {
  const personality = character.personality
    ? `${character.personality}\n\n${SHOW_PROTOCOL_INSTRUCTIONS}`
    : SHOW_PROTOCOL_INSTRUCTIONS;
  return { ...character, personality };
}
