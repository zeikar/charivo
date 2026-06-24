import { type STTTranscriber } from "@charivo/core";
import {
  WebSTTTranscriber,
  getSpeechRecognitionConstructor,
} from "./web-stt-transcriber";

export function createWebSTTTranscriber(): STTTranscriber {
  return new WebSTTTranscriber();
}

export function isWebSTTSupported(): boolean {
  return !!getSpeechRecognitionConstructor();
}
