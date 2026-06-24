import type { Renderer } from "@charivo/core";
import { ConsoleRenderer } from "./console-renderer";

export function createConsoleRenderer(): Renderer {
  return new ConsoleRenderer();
}
