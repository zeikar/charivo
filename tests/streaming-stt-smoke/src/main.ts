import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt";
import {
  createOpenAIRealtimeSTTTranscriber,
  type OpenAIRealtimeTranscriptionBootstrapFn,
} from "@charivo/stt/openai-realtime";
import type {
  StreamingSTTHarnessApi,
  StreamingSTTSnapshot,
  StreamingSTTStatus,
} from "../streaming-stt-harness-types";

// Package-level browser harness for the live streaming STT transcriber.
// This page is test infrastructure, not product UI. It drives the public path:
// @charivo/stt/openai-realtime → STTManager → Charivo events, so the spec
// observes `stt:partial` / `stt:stop` / `stt:error` rather than the
// transcriber's own callbacks.

type StreamingSTTWindow = Window & {
  __charivoStreamingStt?: StreamingSTTHarnessApi;
};

const BOOTSTRAP_ENDPOINT = "/api/realtime-transcription";

let status: StreamingSTTStatus = "idle";
let partials: string[] = [];
let partialsBeforeStop = 0;
let final: string | null = null;
let error: string | null = null;

// The app owns credentials and the SDP exchange; the transcriber never sees a
// key. The Vite middleware in vite.config.ts backs this endpoint.
const bootstrap: OpenAIRealtimeTranscriptionBootstrapFn = async (request) => {
  const response = await fetch(BOOTSTRAP_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const rawBody = await response.text();
  let payload: { answerSdp?: unknown; error?: unknown } = {};
  try {
    payload = JSON.parse(rawBody);
  } catch {
    // Leave payload empty; the raw body goes into the error below.
  }

  if (!response.ok) {
    throw new Error(
      typeof payload.error === "string"
        ? payload.error
        : `bootstrap failed with ${response.status}: ${rawBody.slice(0, 400)}`,
    );
  }

  if (typeof payload.answerSdp !== "string") {
    throw new Error(
      `bootstrap returned no answerSdp: ${rawBody.slice(0, 400)}`,
    );
  }

  return { answerSdp: payload.answerSdp };
};

const sttManager = createSTTManager(
  createOpenAIRealtimeSTTTranscriber({ bootstrap }),
);
const charivo = new Charivo();
charivo.attachSTT(sttManager);

charivo.on("stt:partial", (data) => {
  partials.push(data.text);
});
charivo.on("stt:stop", (data) => {
  final = data.text;
});
charivo.on("stt:error", (data) => {
  error = data.error.message;
});

function fail(cause: unknown): void {
  error ??= cause instanceof Error ? cause.message : String(cause);
  status = "error";
}

function start(): void {
  status = "recording";
  partials = [];
  partialsBeforeStop = 0;
  final = null;
  error = null;

  void sttManager.start().catch(fail);
}

function stop(): void {
  // Sampled synchronously: everything counted here arrived while the session
  // was still streaming, before the commit that stop() sends.
  partialsBeforeStop = partials.length;
  status = "stopping";

  void sttManager.stop().then(() => {
    status = "done";
  }, fail);
}

function getSnapshot(): StreamingSTTSnapshot {
  return {
    status,
    partials: [...partials],
    partialsBeforeStop,
    final,
    error,
  };
}

const api: StreamingSTTHarnessApi = { start, stop, getSnapshot };
(window as StreamingSTTWindow).__charivoStreamingStt = api;
