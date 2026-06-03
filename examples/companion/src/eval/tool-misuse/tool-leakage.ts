// Pure narration-leakage detector for the tool-misuse eval. detectToolLeakage(text) returns true
// when spoken-text output leaks a tool call (literal tool name, JSON-ish args, or a bracketed/
// parenthetical action note). No model, no network, no scenario knowledge. Derived from the
// 2026-04 avatar-prompt experiments' DIRECTION (a short client-layer strip was recommended there,
// not this exact pattern). Eval-only today: it has no runtime consumer; it could LATER guard the
// assistant-text display path, but that is a future option, not a current property.

const patterns: RegExp[] = [
  // literal tool names - catches "Let me playMotion the wave."
  /\b(setExpression|playMotion|lookAt)\b/,
  // JSON-ish arg fragments - catches 'I will set { "expressionId": "Smile" } now.'
  /"?(expressionId|group|index)"?\s*[:=]/,
  // bracketed action notes - catches "[looks left] Over there."
  // the looks? etc. plural forms are REQUIRED - \blook\b alone FAILS on "looks" because the word boundary sits before the s
  /\[[^\]]*\b(looks?|smiles?|waves?|gaz(?:e|es|ing)|glanc(?:e|es|ing)|motions?|expressions?)\b[^\]]*\]/i,
  // parenthetical action notes - catches "(calls playMotion) here we go" and "(setExpression: Smile) Hello."
  /\((?:calls?|sets?|plays?|setExpression|playMotion|lookAt)\b[^)]*\)/i,
];

export function detectToolLeakage(text: string): boolean {
  return patterns.some((p) => p.test(text));
}
