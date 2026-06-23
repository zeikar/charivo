/**
 * TTS Player Capability Utilities
 */
import type { TTSOptions, TTSPlaybackMode, TTSPlayer } from "@charivo/core";

/**
 * Resolve the playback mode used by the manager. Concrete players should
 * provide `playbackMode`. The default fallback is `"audio"`.
 */
export function getTTSPlaybackMode(player: TTSPlayer): TTSPlaybackMode {
  return player.playbackMode || "audio";
}

/**
 * Resolve the MIME type used when generated audio is wrapped in a Blob.
 */
export function getTTSAudioMimeType(player: TTSPlayer): string {
  return player.audioMimeType || "audio/wav";
}

/**
 * Check whether the TTS Player supports the generateAudio method
 */
export function supportsGenerateAudio(
  player: TTSPlayer,
): player is TTSPlayer & {
  generateAudio(text: string, options?: TTSOptions): Promise<ArrayBuffer>;
} {
  return typeof player.generateAudio === "function";
}
