import {
  getErrorMessage,
  type TTSOptions,
  type TTSPlayer,
} from "@charivo/core";

/**
 * Web Speech can leave `speak()` pending forever (an `end` or `error` event
 * that never fires, a voice that stalls), and the Director waits for each
 * line, so one stall would hold the whole show. Each speak gets a deadline:
 * a fixed 10 s for startup and slow voices, plus 150 ms per character, which
 * is about twice the time a slow voice (~13 characters a second) needs. It has
 * no cap of its own: the chat route already bounds a reply's length
 * (CHAT_REPLY_MAX_CHARS).
 */
export const SPEECH_BASE_MS = 10_000;
export const SPEECH_PER_CHAR_MS = 150;

export function speechDeadlineMs(text: string): number {
  return SPEECH_BASE_MS + text.length * SPEECH_PER_CHAR_MS;
}

/**
 * On timeout the speech is cancelled with the player's stop(), and only then
 * does speak() reject, so the line is reported failed and the next one cannot
 * overlap a voice that is still going. An explicit stop() disarms the active
 * utterance's deadline and resolves its speak(), so a stale timer can never
 * stop a later utterance.
 */
export function withSpeechDeadline(player: TTSPlayer): TTSPlayer {
  // The utterance whose deadline is armed; null when none is.
  let active: { disarm(): void } | null = null;

  return {
    playbackMode: player.playbackMode,
    setVoice: (voice) => player.setVoice(voice),
    isSupported: () => player.isSupported(),
    stop() {
      active?.disarm();
      return player.stop();
    },
    speak(text: string, options?: TTSOptions): Promise<void> {
      const deadlineMs = speechDeadlineMs(text);
      return new Promise<void>((resolve, reject) => {
        let settled = false;
        // Every way an utterance ends goes through here once: it clears the
        // deadline and the utterance's claim on `active`, then settles.
        const settle = (then: () => void) => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          if (active === utterance) active = null;
          then();
        };
        const utterance = { disarm: () => settle(resolve) };
        const timer = setTimeout(
          () =>
            settle(() => {
              const seconds = Math.round(deadlineMs / 1000);
              const timedOut = `Speech timed out after ${seconds} s without finishing`;
              player.stop().then(
                () => reject(new Error(timedOut)),
                (stopError: unknown) =>
                  reject(
                    new Error(
                      `${timedOut}; stopping it failed: ${getErrorMessage(stopError)}`,
                    ),
                  ),
              );
            }),
          deadlineMs,
        );
        active = utterance;
        player.speak(text, options).then(
          () => settle(resolve),
          (error: unknown) => settle(() => reject(error)),
        );
      });
    },
  };
}
