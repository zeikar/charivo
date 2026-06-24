import { type STTTranscriber } from "@charivo/core";
import { WebSTTTranscriber } from "./web-stt-transcriber";

export function createWebSTTTranscriber(): STTTranscriber {
  return new WebSTTTranscriber();
}
