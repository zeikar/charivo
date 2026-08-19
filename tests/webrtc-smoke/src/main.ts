import {
  Charivo,
  type AvatarControlCatalog,
  type Character,
  type EventMap,
} from "@charivo/core";
import { createRemoteRealtimeClient } from "@charivo/realtime/remote";
import {
  SET_EXPRESSION_TOOL_NAME,
  buildAvatarControlInstructions,
  createAvatarResultProjector,
  createAvatarControlTools,
} from "@charivo/avatar";
import {
  buildRealtimeSessionConfig,
  createRealtimeManager,
} from "@charivo/realtime";
import type {
  HarnessMode,
  HarnessSnapshot,
  SmokeHarnessApi,
} from "../harness-types";

type SmokeWindow = Window & {
  __charivoSmoke?: SmokeHarnessApi;
};

type RealtimeManagerDebug = {
  client?: unknown;
};

type RemoteRealtimeClientDebug = {
  transportClient?: unknown;
};

type AgentsTransportDebug = {
  peerConnection?: RTCPeerConnection | null;
  emitConnectionLost?: (cause: "connection-failed") => void;
};

type RawTransportDebug = {
  pc?: RTCPeerConnection | null;
  dc?: RTCDataChannel | null;
  emitConnectionLost?: (cause: "connection-failed") => void;
};

const TEST_CHARACTER: Character = {
  id: "webrtc-smoke-hiyori",
  name: "Hiyori",
  personality: "Gentle, attentive, and expressive in small moments.",
};

const HARNESS_MODE = resolveHarnessMode();

const AVATAR_MOTIONS = {
  Emphasis: 3,
  // Separate greeting-style motion group so pairing probes have a plausible
  // expression + motion choice instead of only a generic emphasis motion.
  Wave: 1,
};

// The smoke stays deterministic: one self-describing expression ID, which
// SMOKE_TEST_INSTRUCTIONS names verbatim.
const SMOKE_AVATAR_CATALOG = {
  expressions: ["Smile"],
  motions: AVATAR_MOTIONS,
} satisfies AvatarControlCatalog;

// The evaluation modes instead use OPAQUE IDs (`F01`..`F08`) carrying meaning
// only through `expressionDescriptions` — the shape a real Cubism model ships
// (Haru's expressions are named exactly this in the demo app, with the same
// meanings). That makes the description channel observable over a live realtime
// session: with the descriptions removed the model has nothing to choose on but
// the bare enum. No spec asserts a specific ID, so this only sharpens them.
const AVATAR_CATALOG = {
  expressions: ["F01", "F02", "F03", "F04", "F05", "F06", "F07", "F08"],
  expressionDescriptions: {
    F01: "gentle smile",
    F02: "big laugh, excited",
    F03: "angry",
    F04: "sad",
    F05: "beaming, eyes closed",
    F06: "surprised",
    F07: "shy, blushing",
    F08: "unimpressed, deadpan",
  },
  motions: AVATAR_MOTIONS,
} satisfies AvatarControlCatalog;

const ALL_TEST_TOOLS = createAvatarControlTools(AVATAR_CATALOG);

// Keep the smoke deterministic by exposing only setExpression.
const SMOKE_TEST_TOOLS = createAvatarControlTools(SMOKE_AVATAR_CATALOG).filter(
  (tool) => tool.definition.name === SET_EXPRESSION_TOOL_NAME,
);

const SMOKE_TEST_INSTRUCTIONS = [
  "You are Hiyori.",
  "Stay fully in character.",
  'When the user asks you to smile, call setExpression exactly once with expressionId "Smile".',
  "After the tool returns, continue with one short spoken reply and do not call the tool again unless the user asks again.",
  "Do not call any other tool.",
  "Reply in one short sentence.",
].join(" ");

const ACTIVE_TOOLS =
  HARNESS_MODE === "avatar-prompt-eval" || HARNESS_MODE === "voice-e2e"
    ? ALL_TEST_TOOLS
    : HARNESS_MODE === "voice-baseline"
      ? []
      : SMOKE_TEST_TOOLS;

const state: HarnessSnapshot = {
  mode: HARNESS_MODE,
  sessionStatus: "idle",
  connection: "idle",
  assistantStatus: "idle",
  assistantCompletions: 0,
  assistantText: "",
  lastError: null,
  sessionInstructions: null,
  registeredTools: ACTIVE_TOOLS.map((tool) => tool.definition.name),
  toolCalls: [],
  usageEvents: [],
  avatarEvents: [],
  voiceLatency: {
    sessionStartAt: null,
    firstAssistantEventAt: null,
    deltaMs: null,
  },
  lipSync: {
    audioStarts: 0,
    audioEnds: 0,
    activeSamples: 0,
  },
  events: [],
};

const charivo = new Charivo();
const realtimeClient = createRemoteRealtimeClient({
  apiEndpoint: "/api/realtime",
});
const realtimeManager = createRealtimeManager(realtimeClient, {
  tools: ACTIVE_TOOLS,
  resultProjectors: [createAvatarResultProjector()],
});

charivo.attachRealtime(realtimeManager);
charivo.setCharacter(TEST_CHARACTER);

const connectButton = requiredElement<HTMLButtonElement>("connect-button");
const disconnectButton =
  requiredElement<HTMLButtonElement>("disconnect-button");
const sendButton = requiredElement<HTMLButtonElement>("send-button");
const messageInput = requiredElement<HTMLInputElement>("message-input");
const sessionStatusElement = requiredElement<HTMLSpanElement>("session-status");
const assistantStatusElement =
  requiredElement<HTMLSpanElement>("assistant-status");
const lastErrorElement = requiredElement<HTMLSpanElement>("last-error");
const assistantTextElement = requiredElement<HTMLPreElement>("assistant-text");
const eventLogElement = requiredElement<HTMLPreElement>("event-log");

const subscriptions = [
  "realtime:session:start",
  "realtime:session:end",
  "realtime:state",
  "realtime:assistant:start",
  "realtime:assistant:delta",
  "realtime:assistant:done",
  "tool:call",
  "tool:result",
  "tool:error",
  "realtime:reconnect:attempt",
  "realtime:reconnect:success",
  "realtime:reconnect:exhausted",
  "realtime:usage",
  "avatar:expression",
  "avatar:motion",
  "avatar:gaze",
  "realtime:error",
] as const satisfies ReadonlyArray<keyof EventMap>;

/**
 * `charivo.on` types its payload from the event name alone, so subscribing in a
 * loop widens it to every `EventMap` value at once and the switch below cannot
 * narrow it. Re-pairing each payload with the name it arrived under rebuilds a
 * discriminated union, which the destructured switch does narrow.
 */
type HarnessEvent = {
  [K in (typeof subscriptions)[number]]: { event: K; payload: EventMap[K] };
}[(typeof subscriptions)[number]];

for (const eventName of subscriptions) {
  charivo.on(eventName, (payload) => {
    recordEvent(eventName, payload);
    handleHarnessEvent({ event: eventName, payload } as HarnessEvent);
  });
}

// Subscribed outside the loop above on purpose: lip-sync updates arrive at
// frame rate and would bury the event log they share with everything else.
charivo.on("tts:audio:start", () => {
  state.lipSync.audioStarts += 1;
});
charivo.on("tts:audio:end", () => {
  state.lipSync.audioEnds += 1;
});
charivo.on("tts:lipsync:update", ({ rms }) => {
  if (rms > 0) {
    state.lipSync.activeSamples += 1;
  }
});

function handleHarnessEvent(harnessEvent: HarnessEvent): void {
  const { event: eventName, payload } = harnessEvent;

  switch (eventName) {
    case "realtime:session:start":
    case "realtime:session:end":
    case "realtime:state": {
      const realtimeState = payload.state;
      state.sessionStatus = realtimeState.session.status;
      state.connection = realtimeState.connection;
      state.assistantStatus = realtimeState.response.status;
      state.sessionInstructions =
        realtimeState.session.config?.instructions ?? null;
      if (realtimeState.response.text) {
        state.assistantText = realtimeState.response.text;
      }
      if (
        (HARNESS_MODE === "voice-e2e" || HARNESS_MODE === "voice-baseline") &&
        eventName === "realtime:session:start" &&
        state.voiceLatency.sessionStartAt === null
      ) {
        state.voiceLatency.sessionStartAt = Date.now();
      }
      break;
    }

    case "realtime:assistant:start":
      state.assistantStatus = "responding";
      state.assistantText = "";
      if (
        (HARNESS_MODE === "voice-e2e" || HARNESS_MODE === "voice-baseline") &&
        state.voiceLatency.firstAssistantEventAt === null &&
        state.voiceLatency.sessionStartAt !== null
      ) {
        state.voiceLatency.firstAssistantEventAt = Date.now();
        state.voiceLatency.deltaMs =
          state.voiceLatency.firstAssistantEventAt -
          state.voiceLatency.sessionStartAt;
      }
      break;

    case "realtime:assistant:delta":
      state.assistantText += payload.text;
      break;

    case "realtime:assistant:done":
      state.assistantStatus = "completed";
      state.assistantCompletions += 1;
      state.assistantText = payload.text;
      break;

    case "tool:call":
      state.toolCalls.push({ name: payload.name, callId: payload.callId });
      break;

    case "realtime:usage":
      state.usageEvents.push(payload);
      break;

    case "avatar:expression":
      state.avatarEvents.push({
        type: "expression",
        expressionId: payload.expressionId,
      });
      break;

    case "avatar:motion":
      state.avatarEvents.push({
        type: "motion",
        group: payload.group,
        index: payload.index,
      });
      break;

    case "avatar:gaze":
      state.avatarEvents.push({
        type: "gaze",
        x: payload.x,
        y: payload.y,
      });
      break;

    case "tool:error":
    case "realtime:error":
      state.lastError = payload.error.message;
      break;

    default:
      break;
  }

  render();
}

connectButton.addEventListener("click", () => {
  void startSession();
});
disconnectButton.addEventListener("click", () => {
  void stopSession();
});
sendButton.addEventListener("click", () => {
  void sendPrompt();
});

async function startSession(): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.startSession(buildSessionConfigForMode(HARNESS_MODE));
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
  }
}

function buildSessionConfigForMode(mode: HarnessMode) {
  if (mode === "avatar-prompt-eval") {
    return {
      provider: "openai" as const,
      toolChoice: "auto" as const,
      instructions: buildAvatarPromptEvalInstructions(),
    };
  }

  if (mode === "voice-e2e") {
    // Exercises the full voice path end-to-end including tool selection, so
    // the e2e spec can assert on realistic tool calls and avatar events.
    return {
      provider: "openai" as const,
      toolChoice: "auto" as const,
      instructions: buildAvatarPromptEvalInstructions(),
    };
  }

  if (mode === "voice-baseline") {
    // No tools and no custom instructions — we want a clean audio/VAD/model
    // latency signal without tool-selection variability contaminating it.
    return {
      provider: "openai" as const,
      toolChoice: "none" as const,
    };
  }

  return {
    provider: "openai" as const,
    toolChoice: "auto" as const,
    instructions: SMOKE_TEST_INSTRUCTIONS,
  };
}

function buildAvatarPromptEvalInstructions(): string {
  const baseInstructions = buildRealtimeSessionConfig({
    character: TEST_CHARACTER,
  }).instructions;

  return [
    baseInstructions,
    buildAvatarControlInstructions(AVATAR_CATALOG),
  ].join("\n");
}

async function stopSession(): Promise<void> {
  try {
    await realtimeManager.stopSession();
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
  }
}

async function updateSession(
  config?: Parameters<typeof realtimeManager.updateSession>[0],
): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.updateSession(config);
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
  }
}

async function forceReconnectOutage(): Promise<void> {
  const transport = getActiveTransportClient();

  if (!transport) {
    throw new Error("Realtime transport not active");
  }

  if ("peerConnection" in transport) {
    const agentsTransport = transport as AgentsTransportDebug;
    agentsTransport.peerConnection?.close();
    agentsTransport.emitConnectionLost?.("connection-failed");
    return;
  }

  if ("pc" in transport) {
    const rawTransport = transport as RawTransportDebug;
    rawTransport.dc?.close();
    rawTransport.pc?.close();
    rawTransport.emitConnectionLost?.("connection-failed");
    return;
  }

  throw new Error("Unsupported realtime transport for forced reconnect smoke");
}

async function sendPrompt(text = messageInput.value): Promise<void> {
  state.lastError = null;
  render();

  try {
    await realtimeManager.sendMessage(text);
  } catch (error) {
    state.lastError =
      error instanceof Error ? error.message : String(error ?? "Unknown error");
    render();
    throw error;
  }
}

function recordEvent<K extends keyof EventMap>(
  type: K,
  payload: EventMap[K],
): void {
  state.events.push({
    type,
    payload,
    at: Date.now(),
  });
}

function render(): void {
  sessionStatusElement.textContent = `${state.connection}/${state.sessionStatus}`;
  assistantStatusElement.textContent = state.assistantStatus;
  lastErrorElement.textContent = state.lastError ?? "-";
  assistantTextElement.textContent = state.assistantText || "(empty)";
  eventLogElement.textContent = JSON.stringify(state, null, 2);

  connectButton.disabled =
    state.sessionStatus === "active" || state.connection === "connecting";
  disconnectButton.disabled =
    state.sessionStatus !== "active" && state.connection !== "connecting";
  sendButton.disabled = state.sessionStatus !== "active";
}

function requiredElement<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) {
    throw new Error(`Missing required element #${id}`);
  }

  return element as T;
}

function resolveHarnessMode(): HarnessMode {
  const mode = new URL(window.location.href).searchParams.get("mode");

  if (
    mode === "avatar-prompt-eval" ||
    mode === "voice-e2e" ||
    mode === "voice-baseline"
  ) {
    return mode;
  }

  return "smoke";
}

function getActiveTransportClient():
  | AgentsTransportDebug
  | RawTransportDebug
  | null {
  const managerDebug = realtimeManager as typeof realtimeManager &
    RealtimeManagerDebug;
  const managerClient = managerDebug.client;

  if (!managerClient || typeof managerClient !== "object") {
    return null;
  }

  const remoteClient = managerClient as RemoteRealtimeClientDebug;
  const transportClient = remoteClient.transportClient;

  if (!transportClient || typeof transportClient !== "object") {
    return null;
  }

  return transportClient as AgentsTransportDebug | RawTransportDebug;
}

const smokeWindow = window as SmokeWindow;
smokeWindow.__charivoSmoke = {
  forceReconnectOutage,
  startSession,
  updateSession,
  sendPrompt,
  stopSession,
  getSnapshot: () => structuredClone(state),
};

window.addEventListener("beforeunload", () => {
  void stopSession();
});

render();
