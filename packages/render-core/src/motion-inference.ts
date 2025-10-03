import { MotionType } from "@charivo/core";

/**
 * Infer motion type from message content
 */
export function inferMotionFromMessage(text: string): MotionType {
  if (text.includes("안녕") || text.toLowerCase().includes("hello"))
    return "greeting";
  if (text.includes("좋") || text.includes("기쁘")) return "happy";
  if (text.includes("어려") || text.includes("힘들")) return "thinking";
  return "talk";
}

/**
 * Motion inference utilities
 */
export const MotionInference = {
  inferFromMessage: inferMotionFromMessage,
};
