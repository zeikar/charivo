import { Charivo, type Character, type Renderer } from "@charivo/core";
import { createLLMManager } from "@charivo/llm";
import { createRemoteLLMClient } from "@charivo/llm/remote";
import { createSTTManager } from "@charivo/stt";
import { createRemoteSTTTranscriber } from "@charivo/stt/remote";
import { createTTSManager } from "@charivo/tts";
import { createRemoteTTSPlayer } from "@charivo/tts/remote";
import { createRenderManager } from "@charivo/render";
import type {
  CascadeEvent,
  CascadeHarnessApi,
  CascadeSnapshot,
  CascadeStatus,
  CascadeTimings,
} from "../cascade-harness-types";

// Package-level browser harness for the cascading STT → LLM → TTS chain.
// This page is test infrastructure, not product UI. It wires the recommended
// remote-client + server-provider path: the Vite middleware in vite.config.ts
// backs /api/stt, /api/chat, /api/tts with @charivo/server/openai.

type CascadeWindow = Window & { __charivoCascade?: CascadeHarnessApi };

const TEST_CHARACTER: Character = {
  id: "cascade-smoke-hiyori",
  name: "Hiyori",
  personality: "Gentle and attentive. Answers in one short, warm sentence.",
};

const DEFAULT_RECORD_MS = 3500;

let status: CascadeStatus = "idle";
let transcript: string | null = null;
let assistantText: string | null = null;
let ttsAudioStarted = false;
let ttsAudioEnded = false;
let lipsyncRmsUpdates = 0;
let maxRms = 0;
let lastError: string | null = null;
let rendererReady = false;
const timings: CascadeTimings = {
  recordMs: null,
  sttMs: null,
  turnMs: null,
  totalMs: null,
};
const events: CascadeEvent[] = [];

function record(type: string, payload: unknown): void {
  events.push({ type, payload, at: Date.now() });
}

function reset(): void {
  status = "idle";
  transcript = null;
  assistantText = null;
  ttsAudioStarted = false;
  ttsAudioEnded = false;
  lipsyncRmsUpdates = 0;
  maxRms = 0;
  lastError = null;
  timings.recordMs = null;
  timings.sttMs = null;
  timings.turnMs = null;
  timings.totalMs = null;
  events.length = 0;
}

// Minimal renderer that records realtime lip-sync RMS so the spec can assert
// the browser audio→lip-sync path actually drove the renderer during playback.
const lipSyncRecordingRenderer: Renderer = {
  async initialize() {},
  async destroy() {},
  async render() {},
  setRealtimeLipSync(enabled: boolean) {
    record("renderer:setRealtimeLipSync", { enabled });
  },
  updateRealtimeLipSyncRms(rms: number) {
    lipsyncRmsUpdates += 1;
    if (rms > maxRms) {
      maxRms = rms;
    }
  },
};

const charivo = new Charivo();
const renderManager = createRenderManager(lipSyncRecordingRenderer);
charivo.attachRenderer(renderManager);
charivo.attachLLM(
  createLLMManager(createRemoteLLMClient({ apiEndpoint: "/api/chat" })),
);
charivo.attachTTS(
  createTTSManager(createRemoteTTSPlayer({ apiEndpoint: "/api/tts" })),
);
const sttManager = createSTTManager(
  createRemoteSTTTranscriber({ apiEndpoint: "/api/stt" }),
);
charivo.attachSTT(sttManager);
charivo.setCharacter(TEST_CHARACTER);

charivo.on("stt:start", (data) => record("stt:start", data));
charivo.on("stt:stop", (data) => record("stt:stop", data));
charivo.on("stt:error", (data) => {
  lastError = data.error.message;
  record("stt:error", { message: data.error.message });
});
charivo.on("message:received", (data) => {
  assistantText = data.message.content;
  record("message:received", { content: data.message.content });
});
charivo.on("tts:start", (data) => record("tts:start", data));
charivo.on("tts:audio:start", (data) => {
  ttsAudioStarted = true;
  record("tts:audio:start", { hasAudioElement: Boolean(data.audioElement) });
});
charivo.on("tts:audio:end", () => {
  ttsAudioEnded = true;
  record("tts:audio:end", {});
});
charivo.on("tts:end", (data) => record("tts:end", data));
charivo.on("tts:error", (data) => {
  lastError = data.error.message;
  record("tts:error", { message: data.error.message });
});

const delay = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

async function ensureRendererReady(): Promise<void> {
  if (!rendererReady) {
    await renderManager.initialize();
    rendererReady = true;
  }
  // Resume the AudioContext used by lip-sync analysis. The Chromium autoplay
  // flag (see playwright.cascade.config.ts) lets this run without a gesture.
  await renderManager.prepareAudio();
}

async function runTurn(recordMs = DEFAULT_RECORD_MS): Promise<void> {
  reset();
  const startedAt = performance.now();

  try {
    await ensureRendererReady();

    status = "recording";
    await sttManager.start();
    await delay(recordMs);
    const recordedAt = performance.now();
    timings.recordMs = Math.round(recordedAt - startedAt);

    status = "transcribing";
    transcript = await sttManager.stop();
    const transcribedAt = performance.now();
    timings.sttMs = Math.round(transcribedAt - recordedAt);

    if (transcript.trim().length === 0) {
      throw new Error("STT returned an empty transcript");
    }

    // userSay orchestrates the rest: LLM (message:received) then TTS playback
    // (tts:audio:start → lip-sync RMS updates → tts:audio:end). It resolves
    // after the synthesized audio finishes playing.
    status = "responding";
    await charivo.userSay(transcript);
    const finishedAt = performance.now();
    timings.turnMs = Math.round(finishedAt - transcribedAt);
    timings.totalMs = Math.round(finishedAt - startedAt);

    status = "done";
  } catch (error) {
    lastError = error instanceof Error ? error.message : String(error);
    status = "error";
    record("error", { message: lastError });
  }
}

function getSnapshot(): CascadeSnapshot {
  return {
    status,
    transcript,
    assistantText,
    ttsAudioStarted,
    ttsAudioEnded,
    lipsyncRmsUpdates,
    maxRms,
    lastError,
    timings: { ...timings },
    events: [...events],
  };
}

const api: CascadeHarnessApi = { runTurn, getSnapshot, reset };
(window as CascadeWindow).__charivoCascade = api;
record("harness:ready", { character: TEST_CHARACTER.id });
