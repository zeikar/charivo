// Single instruction-composition seam (persona + demo guidance today; memory block inserted by later subtask)
export function composeInstructions(
  blocks: Array<string | null | undefined>,
): string {
  return blocks.filter(Boolean).join("\n");
}
