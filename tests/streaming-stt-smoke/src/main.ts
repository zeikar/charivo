import { Charivo } from "@charivo/core";
import { createSTTManager } from "@charivo/stt";
import {
  createGeminiLiveSTTTranscriber,
  type GeminiLiveTranscriptionBootstrapFn,
} from "@charivo/stt/gemini-live";
import {
  createOpenAIRealtimeSTTTranscriber,
  type OpenAIRealtimeTranscriptionBootstrapFn,
} from "@charivo/stt/openai-realtime";
import type {
  StreamingSTTHarnessApi,
  StreamingSTTSnapshot,
  StreamingSTTStatus,
} from "../streaming-stt-harness-types";

// Package-level browser harness for the live streaming STT transcribers.
// This page is test infrastructure, not product UI. It drives the public path:
// @charivo/stt/openai-realtime or @charivo/stt/gemini-live → STTManager →
// Charivo events, so the spec observes `stt:partial` / `stt:stop` /
// `stt:error` rather than the transcriber's own callbacks. The `provider`
// query parameter picks the transcriber; everything below it is shared.

type StreamingSTTWindow = Window & {
  __charivoStreamingStt?: StreamingSTTHarnessApi;
};

const OPENAI_BOOTSTRAP_ENDPOINT = "/api/realtime-transcription";
const GEMINI_BOOTSTRAP_ENDPOINT = "/api/stt-gemini-live";

let status: StreamingSTTStatus = "idle";
let partials: string[] = [];
let partialsBeforeStop = 0;
let final: string | null = null;
let error: string | null = null;

// The app owns credentials; neither transcriber ever sees a key. The Vite
// middlewares in vite.config.ts back both endpoints.
async function postBootstrap(
  endpoint: string,
  request: unknown,
): Promise<{ payload: Record<string, unknown>; rawBody: string }> {
  const response = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });

  const rawBody = await response.text();
  let payload: Record<string, unknown> = {};
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

  return { payload, rawBody };
}

const openAIBootstrap: OpenAIRealtimeTranscriptionBootstrapFn = async (
  request,
) => {
  const { payload, rawBody } = await postBootstrap(
    OPENAI_BOOTSTRAP_ENDPOINT,
    request,
  );

  if (typeof payload.answerSdp !== "string") {
    throw new Error(
      `bootstrap returned no answerSdp: ${rawBody.slice(0, 400)}`,
    );
  }

  return { answerSdp: payload.answerSdp };
};

const geminiBootstrap: GeminiLiveTranscriptionBootstrapFn = async (request) => {
  const { payload } = await postBootstrap(GEMINI_BOOTSTRAP_ENDPOINT, request);

  if (typeof payload.url !== "string" || typeof payload.token !== "string") {
    // The body is never quoted here, unlike the OpenAI branch above: a 2xx
    // from this route carries the ephemeral token.
    throw new Error("bootstrap returned no websocket url or token");
  }

  return { url: payload.url, token: payload.token };
};

const provider = new URLSearchParams(window.location.search).get("provider");
const sttManager = createSTTManager(
  provider === "gemini"
    ? createGeminiLiveSTTTranscriber({ bootstrap: geminiBootstrap })
    : createOpenAIRealtimeSTTTranscriber({ bootstrap: openAIBootstrap }),
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
  status = "starting";
  partials = [];
  partialsBeforeStop = 0;
  final = null;
  error = null;

  // Reaching `recording` is what tells the spec its record window can begin:
  // start() resolves only after the transcriber has gone live, so bootstrap,
  // handshake, and worklet load fall outside the window rather than eating it.
  void sttManager.start().then(() => {
    status = "recording";
  }, fail);
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
