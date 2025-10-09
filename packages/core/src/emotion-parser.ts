import { Emotion } from "./types";

/**
 * Result of parsing emotion tags from text
 */
export interface ParsedEmotion {
  /** The cleaned text with emotion tags removed */
  text: string;
  /** The detected emotion (if any) */
  emotion?: Emotion;
}

/**
 * Regular expression to match emotion tags in format [emotion] or [EMOTION]
 * Examples: [happy], [HAPPY], [sad]
 */
const EMOTION_TAG_REGEX = /\[([a-zA-Z]+)\]/g;

/**
 * Map of emotion keywords to standard Emotion enum
 * Supports various aliases and common variations
 */
const EMOTION_KEYWORD_MAP: Record<string, Emotion> = {
  // Neutral
  neutral: Emotion.NEUTRAL,
  normal: Emotion.NEUTRAL,
  calm: Emotion.NEUTRAL,

  // Happy
  happy: Emotion.HAPPY,
  joy: Emotion.HAPPY,
  joyful: Emotion.HAPPY,
  cheerful: Emotion.HAPPY,
  smile: Emotion.HAPPY,

  // Sad
  sad: Emotion.SAD,
  unhappy: Emotion.SAD,
  depressed: Emotion.SAD,
  down: Emotion.SAD,
  cry: Emotion.SAD,

  // Angry
  angry: Emotion.ANGRY,
  mad: Emotion.ANGRY,
  furious: Emotion.ANGRY,
  annoyed: Emotion.ANGRY,

  // Surprised
  surprised: Emotion.SURPRISED,
  shock: Emotion.SURPRISED,
  shocked: Emotion.SURPRISED,
  amazed: Emotion.SURPRISED,
  wow: Emotion.SURPRISED,

  // Thinking
  thinking: Emotion.THINKING,
  wonder: Emotion.THINKING,
  curious: Emotion.THINKING,
  hmm: Emotion.THINKING,

  // Excited
  excited: Emotion.EXCITED,
  energetic: Emotion.EXCITED,
  hyper: Emotion.EXCITED,
  enthusiastic: Emotion.EXCITED,

  // Shy
  shy: Emotion.SHY,
  embarrassed: Emotion.SHY,
  blush: Emotion.SHY,
  timid: Emotion.SHY,
};

/**
 * Parse emotion tags from text and return cleaned text with detected emotion
 *
 * @param text - The text containing potential emotion tags (e.g., "Hello! [happy] How are you?")
 * @returns ParsedEmotion object with cleaned text and detected emotion
 *
 * @example
 * ```typescript
 * parseEmotion("Hello! [happy] Nice to meet you!")
 * // Returns: { text: "Hello! Nice to meet you!", emotion: Emotion.HAPPY }
 *
 * parseEmotion("I'm feeling [sad] today...")
 * // Returns: { text: "I'm feeling today...", emotion: Emotion.SAD }
 *
 * parseEmotion("Just a normal message")
 * // Returns: { text: "Just a normal message", emotion: undefined }
 * ```
 */
export function parseEmotion(text: string): ParsedEmotion {
  let detectedEmotion: Emotion | undefined;
  let cleanedText = text;

  // Find all emotion tags
  const matches = Array.from(text.matchAll(EMOTION_TAG_REGEX));

  // Process each match (use the last one if multiple)
  for (const match of matches) {
    const keyword = match[1].toLowerCase();
    const emotion = EMOTION_KEYWORD_MAP[keyword];

    if (emotion) {
      detectedEmotion = emotion;
    } else {
      console.warn(`⚠️ [Emotion] Unknown keyword: [${match[1]}]`);
    }

    // Remove the tag from text
    cleanedText = cleanedText.replace(match[0], "");
  }

  // Clean up extra spaces
  cleanedText = cleanedText.replace(/\s+/g, " ").trim();

  if (detectedEmotion) {
    console.log(`🎭 [Emotion] ${detectedEmotion} → "${cleanedText}"`);
  }

  return {
    text: cleanedText,
    emotion: detectedEmotion,
  };
}

/**
 * Check if text contains any emotion tags
 *
 * @param text - The text to check
 * @returns true if text contains emotion tags
 */
export function hasEmotionTag(text: string): boolean {
  return EMOTION_TAG_REGEX.test(text);
}

/**
 * Get all supported emotion keywords
 *
 * @returns Array of supported emotion keywords
 */
export function getSupportedEmotionKeywords(): string[] {
  return Object.keys(EMOTION_KEYWORD_MAP);
}
