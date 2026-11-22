import type { Character } from "@charivo/core";

export interface Live2DConfig {
  modelPath: string;
  expressionDescriptions?: Record<string, string>;
  /** Keyed by motion group; array position is the zero-based motion index. */
  motionDescriptions?: Record<string, string[]>;
}

/**
 * An Iki model needs no descriptions here: the `.iki` file declares its own
 * expressions and motions with theirs, and `@charivo/render-iki` reads them.
 */
export interface IkiConfig {
  modelPath: string;
  /**
   * What to frame instead of the model's own `canvas` box: centre and size in
   * model units, `y` up. A full body whose raised arm leaves its box needs a
   * wider one.
   */
  view?: { x: number; y: number; width: number; height: number };
  /**
   * Width / height of what is framed: `view`, or the model's `canvas`. The
   * demo gives its canvas element this shape and stands it on the panel's
   * bottom edge, so a bust in a taller panel (a phone) does not float with its
   * cut-off edge in mid-air.
   */
  canvasAspect: number;
}

export type CharacterVoiceProvider = "openai" | "gemini";

/** Which renderer draws a character; each needs a canvas of its own. */
export type CharacterEngine = "live2d" | "iki";

export type CharacterConfig<TId extends string = string> = {
  id: TId;
  character: Character & { id: TId };
  // character.voice.voiceId stays the OpenAI id so default behaviour is
  // unchanged; voices is what the demo resolves per provider.
  voices: Record<CharacterVoiceProvider, string>;
  /**
   * The point between the eyes, as fractions of the model's own canvas (0, 0
   * its top-left corner; 1, 1 its bottom-right), handed to the renderer's
   * `setGazeOrigin`, the same call for either engine. The mouse gaze is
   * measured from it, so a pointer on the face looks straight ahead; from the
   * canvas's centre instead, a full body reads it as above the waist and looks
   * up. Left out, the renderer keeps the centre.
   *
   * An Iki value is the midpoint of the file's `eye_L` / `eye_R` parts, which
   * a test checks. A Live2D value was measured once from the `.moc3` (the
   * meshes that move with `ParamEyeBallX`, their bounding box's centre at
   * rest) and no test recomputes it, so check it again after a model refresh.
   */
  gazeOrigin?: { x: number; y: number };
} & (
  | { live2d: Live2DConfig; iki?: undefined }
  | { iki: IkiConfig; live2d?: undefined }
);

export function defineCharacterConfig<TId extends string>(
  config: CharacterConfig<TId>,
): CharacterConfig<TId> {
  return config;
}
