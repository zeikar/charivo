/**
 * TTS Player Type Detection Utilities
 */

export type TTSPlayerType = "web" | "openai" | "remote" | "unknown";

/**
 * TTS Player 타입을 클래스명으로부터 감지
 */
export function detectTTSPlayerType(player: any): TTSPlayerType {
  const playerName = player.constructor.name.toLowerCase();

  if (playerName.includes("web")) return "web";
  if (playerName.includes("openai")) return "openai";
  if (playerName.includes("remote")) return "remote";

  return "unknown";
}

/**
 * TTS Player 타입에 따른 MIME 타입 반환
 */
export function getMimeTypeForPlayer(playerType: TTSPlayerType): string {
  switch (playerType) {
    case "openai":
      return "audio/mp3";
    case "remote":
    case "web":
    default:
      return "audio/wav";
  }
}

/**
 * TTS Player가 generateAudio 메서드를 지원하는지 확인
 */
export function supportsGenerateAudio(player: any): boolean {
  return typeof player.generateAudio === "function";
}
