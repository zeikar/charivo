import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  RealtimeSessionBootstrap,
  RealtimeSessionRequest,
} from "@charivo/core";
import { GEMINI_LIVE_ADAPTER } from "@charivo/core";
import type { RealtimeTransportEvent } from "@charivo/realtime";
import { GeminiLiveClient } from "../../src/gemini/client";
import {
  CONVERGENCE_GATE_MS,
  OUTPUT_SAMPLE_RATE,
} from "../../src/gemini/defaults";

// The lip-sync analyzer is private on the class and owns an `AudioContext` of
// its own; this is a standalone view of the members the tests stub out.
type GeminiClientTestInternals = {
  lipSyncAnalyzer: {
    prepare: () => Promise<void>;
    attachMediaStream: (stream: MediaStream) => void;
    resume: () => void;
    pause: () => void;
  };
};

class MockWebSocket {
  static instances: MockWebSocket[] = [];
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readyState: number = MockWebSocket.CONNECTING;
  onopen: (() => void) | null = null;
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: (() => void) | null = null;
  onclose: ((event: CloseEvent) => void) | null = null;
  readonly sent: string[] = [];
  send = vi.fn((payload: string) => {
    this.sent.push(payload);
  });
  close = vi.fn(() => {
    this.readyState = MockWebSocket.CLOSED;
  });

  constructor(readonly url: string) {
    MockWebSocket.instances.push(this);
  }

  /** The browser's open event; the client answers it with the setup frame. */
  open(): void {
    this.readyState = MockWebSocket.OPEN;
    this.onopen?.();
  }

  /** One server frame, delivered the way the browser delivers it. */
  deliver(data: unknown): void {
    this.onmessage?.({ data } as MessageEvent);
  }

  serverClose(code: number, reason = ""): void {
    this.readyState = MockWebSocket.CLOSED;
    this.onclose?.({ code, reason, wasClean: false } as unknown as CloseEvent);
  }

  emitError(): void {
    this.onerror?.();
  }
}

class MockAudioNode {
  connect = vi.fn();
  disconnect = vi.fn();
}

class MockBufferSource extends MockAudioNode {
  buffer: { duration: number; getChannelData(): Float32Array } | null = null;
  onended: (() => void) | null = null;
  start = vi.fn((_when?: number) => undefined);
  stop = vi.fn(() => undefined);
}

class MockStreamDestination extends MockAudioNode {
  readonly stream = { getTracks: () => [] } as unknown as MediaStream;
}

class MockAudioContext {
  static instances: MockAudioContext[] = [];

  state: AudioContextState = "running";
  currentTime = 0;
  destination = new MockAudioNode();
  readonly sampleRate: number;
  readonly sources: MockBufferSource[] = [];
  readonly audioWorklet = { addModule: vi.fn(async () => undefined) };

  createGain = vi.fn(() => new MockAudioNode());
  createMediaStreamDestination = vi.fn(() => new MockStreamDestination());
  createMediaStreamSource = vi.fn(() => new MockAudioNode());
  createBuffer = vi.fn(
    (_channels: number, length: number, sampleRate: number) => ({
      duration: length / sampleRate,
      getChannelData: () => new Float32Array(length),
    }),
  );
  createBufferSource = vi.fn(() => {
    const source = new MockBufferSource();
    this.sources.push(source);
    return source;
  });
  resume = vi.fn(async () => undefined);
  close = vi.fn(async () => undefined);

  constructor(options?: AudioContextOptions) {
    this.sampleRate = options?.sampleRate ?? 48000;
    MockAudioContext.instances.push(this);
  }

  /** Playback is the only context created at the model's output rate. */
  get isPlayback(): boolean {
    return this.sampleRate === OUTPUT_SAMPLE_RATE;
  }
}

class MockAudioWorkletNode extends MockAudioNode {
  static instances: MockAudioWorkletNode[] = [];

  onprocessorerror: (() => void) | null = null;
  readonly port = {
    onmessage: null as ((event: MessageEvent<ArrayBuffer>) => void) | null,
    postMessage: vi.fn(),
    close: vi.fn(),
  };

  constructor(
    readonly context: MockAudioContext,
    readonly processorName: string,
    readonly options?: AudioWorkletNodeOptions,
  ) {
    super();
    MockAudioWorkletNode.instances.push(this);
  }

  /** One decimated capture frame, the way the audio thread posts it. */
  emitFrame(byteLength = 640): void {
    this.port.onmessage?.({
      data: new ArrayBuffer(byteLength),
    } as MessageEvent<ArrayBuffer>);
  }
}

class MockMediaTrack {
  stop = vi.fn(() => undefined);
}

const SOCKET_URL = "wss://generativelanguage.example/ws";
// Every reserved character the query parameter has to survive. Built through
// `URL.searchParams`, which form-encodes, so the space becomes `+` rather than
// `%20` — one of six characters (space, `!`, `'`, `(`, `)`, `~`) where that
// differs from `encodeURIComponent`, and none of them can appear in an
// `auth_tokens/<id>` token.
const TOKEN = "tok en/+&";
const ENCODED_TOKEN = "tok+en%2F%2B%26";

const originalFetch = globalThis.fetch;
const originalWebSocket = globalThis.WebSocket;
const originalAudioContext = globalThis.AudioContext;
const originalWorkletNode = globalThis.AudioWorkletNode;
const originalNow = performance.now.bind(performance);
const originalMediaDevices = navigator.mediaDevices;

/** The mocked `performance.now()` the convergence gate is measured against. */
let now = 0;
const at = (ms: number) => {
  now = ms;
};

let microphoneTracks: MockMediaTrack[] = [];

beforeEach(() => {
  now = 0;
  microphoneTracks = [];
  MockWebSocket.instances = [];
  MockAudioContext.instances = [];
  MockAudioWorkletNode.instances = [];

  Object.defineProperty(globalThis, "WebSocket", {
    value: MockWebSocket,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: MockAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    value: MockAudioWorkletNode,
    configurable: true,
  });
  Object.defineProperty(performance, "now", {
    value: () => now,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: {
      getUserMedia: vi.fn(async () => {
        const track = new MockMediaTrack();
        microphoneTracks.push(track);
        return { getTracks: () => [track] } as unknown as MediaStream;
      }),
    },
    configurable: true,
  });
});

afterEach(() => {
  vi.useRealTimers();
  globalThis.fetch = originalFetch;
  Object.defineProperty(globalThis, "WebSocket", {
    value: originalWebSocket,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioContext", {
    value: originalAudioContext,
    configurable: true,
  });
  Object.defineProperty(globalThis, "AudioWorkletNode", {
    value: originalWorkletNode,
    configurable: true,
  });
  Object.defineProperty(performance, "now", {
    value: originalNow,
    configurable: true,
    writable: true,
  });
  Object.defineProperty(navigator, "mediaDevices", {
    value: originalMediaDevices,
    configurable: true,
  });
  vi.restoreAllMocks();
});

/** Let the message pump's promise chain run to completion. */
async function flushPump(): Promise<void> {
  for (let tick = 0; tick < 16; tick += 1) {
    await Promise.resolve();
  }
}

/** The nth websocket the client opens, once `connect()` gets that far. */
async function nextSocket(index: number): Promise<MockWebSocket> {
  for (let tick = 0; tick < 200; tick += 1) {
    const socket = MockWebSocket.instances[index];
    if (socket) {
      return socket;
    }
    await Promise.resolve();
  }

  throw new Error(`websocket ${index} was never opened`);
}

function createBootstrap() {
  return vi.fn(
    async (
      _request: RealtimeSessionRequest,
    ): Promise<RealtimeSessionBootstrap> => ({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: SOCKET_URL,
      token: TOKEN,
    }),
  );
}

function stubLipSync(client: GeminiLiveClient): void {
  const internals = client as unknown as GeminiClientTestInternals;
  vi.spyOn(internals.lipSyncAnalyzer, "prepare").mockResolvedValue(undefined);
  vi.spyOn(internals.lipSyncAnalyzer, "attachMediaStream").mockImplementation(
    () => undefined,
  );
  vi.spyOn(internals.lipSyncAnalyzer, "resume").mockImplementation(
    () => undefined,
  );
  vi.spyOn(internals.lipSyncAnalyzer, "pause").mockImplementation(
    () => undefined,
  );
}

interface Session {
  client: GeminiLiveClient;
  events: RealtimeTransportEvent[];
  bootstrap: ReturnType<typeof createBootstrap>;
  socket: MockWebSocket;
}

function createClient() {
  const bootstrap = createBootstrap();
  const events: RealtimeTransportEvent[] = [];
  const client = new GeminiLiveClient({ sessionBootstrap: bootstrap });
  client.onEvent((event) => events.push(event));
  stubLipSync(client);

  return { client, events, bootstrap };
}

async function startSession(): Promise<Session> {
  const { client, events, bootstrap } = createClient();
  const index = MockWebSocket.instances.length;
  const connected = client.connect({ provider: "gemini" });
  const socket = await nextSocket(index);
  socket.open();
  socket.deliver(JSON.stringify({ setupComplete: {} }));
  await connected;

  return { client, events, bootstrap, socket };
}

/** Reconnect the way `RealtimeManager` does, driving the replacement socket. */
async function recoverSession(session: Session): Promise<void> {
  const index = MockWebSocket.instances.length;
  const recovered = session.client.recover();
  const socket = await nextSocket(index);
  socket.open();
  socket.deliver(JSON.stringify({ setupComplete: {} }));
  await recovered;
  session.socket = socket;
}

/** One server frame, applied through the pump the client actually uses. */
async function fromServer(
  session: Session,
  payload: Record<string, unknown>,
): Promise<void> {
  session.socket.deliver(JSON.stringify(payload));
  await flushPump();
}

function playbackContexts(): MockAudioContext[] {
  return MockAudioContext.instances.filter((context) => context.isPlayback);
}

function currentPlayback(): MockAudioContext {
  const context = playbackContexts().at(-1);
  if (!context) {
    throw new Error("no playback context was created");
  }
  return context;
}

function currentWorklet(): MockAudioWorkletNode {
  const worklet = MockAudioWorkletNode.instances.at(-1);
  if (!worklet) {
    throw new Error("no capture worklet was created");
  }
  return worklet;
}

/** Every scheduled source finishes, in order, as the browser would report it. */
function drainPlayback(): void {
  for (const source of currentPlayback().sources) {
    const handler = source.onended;
    source.onended = null;
    handler?.();
  }
}

function pcmBase64(sampleCount: number): string {
  return btoa("\u0001".repeat(sampleCount * 2));
}

const audioFrame = (sampleCount = 240) => ({
  serverContent: {
    modelTurn: {
      parts: [
        {
          inlineData: {
            data: pcmBase64(sampleCount),
            mimeType: `audio/pcm;rate=${OUTPUT_SAMPLE_RATE}`,
          },
        },
      ],
    },
  },
});

const textFrame = (text: string) => ({
  serverContent: { outputTranscription: { text } },
});

const TURN_COMPLETE = { serverContent: { turnComplete: true } };
const INTERRUPTED = { serverContent: { interrupted: true } };

const countOf = (events: RealtimeTransportEvent[], type: string) =>
  events.filter((event) => event.type === type).length;

const deltaTexts = (events: RealtimeTransportEvent[]) =>
  events.flatMap((event) =>
    event.type === "assistant.text.delta" ? [event.text] : [],
  );

const completions = (events: RealtimeTransportEvent[]) =>
  events.flatMap((event) =>
    event.type === "assistant.response.completed" ? [event.text] : [],
  );

const audioSequence = (events: RealtimeTransportEvent[]) =>
  events
    .map((event) => event.type)
    .filter(
      (type) =>
        type === "audio.output.started" || type === "audio.output.ended",
    );

/** Frames the capture path actually put on the wire. */
const realtimeInputCount = (socket: MockWebSocket) =>
  socket.sent.filter(
    (frame) =>
      (JSON.parse(frame) as { realtimeInput?: unknown }).realtimeInput !==
      undefined,
  ).length;

/** Post one capture frame from the audio thread and report where it went. */
function emitCaptureFrame(socket: MockWebSocket): "sent" | "dropped" {
  const before = realtimeInputCount(socket);
  currentWorklet().emitFrame();
  return realtimeInputCount(socket) > before ? "sent" : "dropped";
}

describe("GeminiLiveClient connect lifecycle", () => {
  it("asks the session endpoint for a websocket bootstrap", async () => {
    const fetchMock = vi.fn(
      async () =>
        new Response(
          JSON.stringify({
            adapter: GEMINI_LIVE_ADAPTER,
            transport: "websocket",
            url: SOCKET_URL,
            token: TOKEN,
          }),
          { headers: { "Content-Type": "application/json" } },
        ),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const client = new GeminiLiveClient({ apiEndpoint: "/api/gemini-token" });
    stubLipSync(client);
    const connected = client.connect({ provider: "gemini", voice: "Kore" });
    const socket = await nextSocket(0);
    socket.open();
    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await connected;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/gemini-token");
    expect(JSON.parse(String(init.body))).toEqual({
      transport: "websocket",
      session: { provider: "gemini", voice: "Kore" },
    });
  });

  it("carries the ephemeral token as an encoded query parameter", async () => {
    const session = await startSession();

    expect(session.socket.url).toBe(
      `${SOCKET_URL}?access_token=${ENCODED_TOKEN}`,
    );
  });

  it("appends the token to a bootstrap url that already carries a query string", async () => {
    const { client, bootstrap } = createClient();
    bootstrap.mockResolvedValue({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: `${SOCKET_URL}?session=abc`,
      token: TOKEN,
    });

    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();
    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await connected;

    const built = new URL(socket.url);
    expect(built.searchParams.get("session")).toBe("abc");
    expect(built.searchParams.get("access_token")).toBe(TOKEN);
  });

  // MockWebSocket takes any string, so this and the scheme case below only
  // prove the client refuses the url itself — nothing here exercises what a
  // browser would do with one.
  it("rejects a bootstrap url that does not parse, before opening a socket", async () => {
    const { client, bootstrap } = createClient();
    bootstrap.mockResolvedValue({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: "not a valid url",
      token: TOKEN,
    });

    await expect(client.connect()).rejects.toThrow(
      "Bootstrap url is not a valid websocket URL",
    );
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("rejects a bootstrap url whose scheme is not ws: or wss:, before opening a socket", async () => {
    const { client, bootstrap } = createClient();
    bootstrap.mockResolvedValue({
      adapter: GEMINI_LIVE_ADAPTER,
      transport: "websocket",
      url: "https://generativelanguage.example/ws",
      token: TOKEN,
    });

    await expect(client.connect()).rejects.toThrow(
      "Bootstrap url must use ws: or wss:",
    );
    expect(MockWebSocket.instances).toHaveLength(0);
  });

  it("scrubs the token from a websocket the browser refuses to construct", async () => {
    // The built URL is a credential, and the native constructor error quotes
    // it. This is the one path where that string could reach app code.
    Object.defineProperty(globalThis, "WebSocket", {
      value: class {
        constructor(url: string) {
          throw new Error(`Failed to construct 'WebSocket': ${url} is invalid`);
        }
      },
      configurable: true,
    });

    const { client } = createClient();
    const failure = await client
      .connect()
      .catch((error: unknown) => (error as Error).message);

    expect(failure).toBe("Failed to open the Gemini Live websocket");
    expect(failure).not.toContain(TOKEN);
    expect(failure).not.toContain(ENCODED_TOKEN);
  });

  it("sends nothing but the setup frame, and starts the session only at setupComplete", async () => {
    const { client, events } = createClient();
    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();
    await flushPump();

    expect(socket.sent).toHaveLength(1);
    expect(JSON.parse(socket.sent[0]!)).toEqual({
      setup: { model: "models/gemini-3.1-flash-live-preview" },
    });
    expect(countOf(events, "session.started")).toBe(0);

    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await connected;

    expect(countOf(events, "session.started")).toBe(1);
    expect(socket.sent).toHaveLength(1);
  });

  it("sends the model the session config asked for", async () => {
    const { client } = createClient();
    const connected = client.connect({ model: "gemini-3.1-pro-live-preview" });
    const socket = await nextSocket(0);
    socket.open();
    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await connected;

    expect(JSON.parse(socket.sent[0]!)).toEqual({
      setup: { model: "models/gemini-3.1-pro-live-preview" },
    });
  });

  it("rejects a pending connect when the socket closes before setup, without waiting out the timeout", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();

    const rejection = expect(connected).rejects.toThrow(
      "Gemini Live websocket closed (code 1011: Token has been used too many times)",
    );
    socket.serverClose(1011, "Token has been used too many times");

    await rejection;
    // No timer was advanced to get here, and the setup timeout is gone.
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects a pending connect when disconnect() lands before setup", async () => {
    vi.useFakeTimers();
    const { client } = createClient();
    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();

    const rejection = expect(connected).rejects.toThrow(
      "Gemini Live session ended before setup completed",
    );
    await client.disconnect();

    await rejection;
    expect(vi.getTimerCount()).toBe(0);
    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(microphoneTracks[0]?.stop).toHaveBeenCalledTimes(1);
  });

  it("refuses mid-session reconfiguration", async () => {
    const session = await startSession();

    await expect(
      session.client.updateSession({ voice: "Puck" }),
    ).rejects.toThrow(
      "updateSession() is not supported on an open Gemini Live session",
    );
  });
});

describe("GeminiLiveClient audio output endings", () => {
  it("does not end the audio on a drain that lands before turnComplete", async () => {
    const session = await startSession();

    await fromServer(session, audioFrame());
    drainPlayback();

    expect(countOf(session.events, "audio.output.started")).toBe(1);
    expect(countOf(session.events, "audio.output.ended")).toBe(0);
  });

  it("ends the audio at the drain once turnComplete has been seen", async () => {
    const session = await startSession();

    await fromServer(session, audioFrame());
    await fromServer(session, TURN_COMPLETE);
    expect(countOf(session.events, "audio.output.ended")).toBe(0);

    drainPlayback();
    expect(countOf(session.events, "audio.output.ended")).toBe(1);
  });

  it("ends the audio at turnComplete when playback is already idle", async () => {
    const session = await startSession();

    await fromServer(session, audioFrame());
    drainPlayback();
    expect(countOf(session.events, "audio.output.ended")).toBe(0);

    await fromServer(session, TURN_COMPLETE);
    expect(countOf(session.events, "audio.output.ended")).toBe(1);
  });

  // The other half of "an ending is still owed": a turn that carried no audio
  // owes none, and saying otherwise hands the *next* turn's opening drain —
  // measured 3 ms in — to the turn that has already finished.
  it("does not carry a silent turn's turnComplete into the next turn's drain", async () => {
    const session = await startSession();

    await fromServer(session, textFrame("text only"));
    await fromServer(session, TURN_COMPLETE);

    await fromServer(session, audioFrame());
    drainPlayback();

    expect(countOf(session.events, "audio.output.started")).toBe(1);
    expect(countOf(session.events, "audio.output.ended")).toBe(0);
  });

  // The measured sequence in full: the opening chunk drains 3 ms in, audio
  // resumes, and `turnComplete` lands ~3 ms before the real final drain. A
  // sticky "has drained" flag ends the turn while the character is still
  // talking.
  it("ends the turn once, at the final drain, across the spurious opening drain", async () => {
    const session = await startSession();

    await fromServer(session, audioFrame());
    drainPlayback();
    await fromServer(session, audioFrame());
    await fromServer(session, TURN_COMPLETE);

    expect(countOf(session.events, "audio.output.ended")).toBe(0);

    drainPlayback();

    expect(audioSequence(session.events)).toEqual([
      "audio.output.started",
      "audio.output.ended",
    ]);
  });
});

// `hasStartedAudioOutput` has four writers, so the pairing is asserted for
// every ending path rather than for the happy one.
describe("GeminiLiveClient audio start/end balance", () => {
  const scenarios: Array<{
    name: string;
    pairs: number;
    drive: (session: Session) => Promise<void>;
  }> = [
    {
      name: "a turn that plays out and completes",
      pairs: 1,
      drive: async (session) => {
        await fromServer(session, audioFrame());
        await fromServer(session, TURN_COMPLETE);
        drainPlayback();
      },
    },
    {
      name: "a turn whose opening chunk drains before its successor arrives",
      pairs: 1,
      drive: async (session) => {
        await fromServer(session, audioFrame());
        drainPlayback();
        await fromServer(session, audioFrame());
        await fromServer(session, TURN_COMPLETE);
        drainPlayback();
      },
    },
    {
      name: "a turn cut short by a local interrupt",
      pairs: 1,
      drive: async (session) => {
        await fromServer(session, audioFrame());
        await session.client.interrupt();
        await fromServer(session, TURN_COMPLETE);
      },
    },
    {
      name: "a turn the server interrupts",
      pairs: 1,
      drive: async (session) => {
        await fromServer(session, audioFrame());
        await fromServer(session, INTERRUPTED);
        await fromServer(session, TURN_COMPLETE);
      },
    },
    {
      name: "a turn that carries no audio at all",
      pairs: 0,
      drive: async (session) => {
        await fromServer(session, textFrame("text only"));
        await fromServer(session, TURN_COMPLETE);
      },
    },
    {
      name: "a turn whose turnComplete lands after the final drain",
      pairs: 1,
      drive: async (session) => {
        await fromServer(session, audioFrame());
        drainPlayback();
        await fromServer(session, TURN_COMPLETE);
      },
    },
  ];

  for (const scenario of scenarios) {
    it(`pairs every audio start with one end for ${scenario.name}`, async () => {
      const session = await startSession();

      await scenario.drive(session);

      expect(audioSequence(session.events)).toEqual(
        Array.from({ length: scenario.pairs }, () => [
          "audio.output.started",
          "audio.output.ended",
        ]).flat(),
      );
    });
  }
});

describe("GeminiLiveClient transcription", () => {
  it("accumulates output transcription fragments into one response", async () => {
    const session = await startSession();

    await fromServer(session, textFrame("안녕"));
    await fromServer(session, textFrame("하세요"));
    await fromServer(session, TURN_COMPLETE);

    expect(countOf(session.events, "assistant.response.started")).toBe(1);
    expect(deltaTexts(session.events)).toEqual(["안녕", "하세요"]);
    expect(session.events).toContainEqual({
      type: "assistant.response.completed",
      text: "안녕하세요",
      usage: undefined,
    });
  });

  it("emits each finalized input transcription straight through", async () => {
    const session = await startSession();

    await fromServer(session, {
      serverContent: { inputTranscription: { text: "첫 번째 질문." } },
    });
    await fromServer(session, {
      serverContent: { inputTranscription: { text: "두 번째 질문." } },
    });

    expect(
      session.events.filter((event) => event.type === "user.transcript"),
    ).toEqual([
      { type: "user.transcript", text: "첫 번째 질문." },
      { type: "user.transcript", text: "두 번째 질문." },
    ]);
  });

  it("ignores interim input transcription", async () => {
    const session = await startSession();
    const before = session.events.length;

    await fromServer(session, {
      serverContent: { interimInputTranscription: { text: "안녕하" } },
    });

    expect(session.events.slice(before)).toEqual([]);
  });

  it("reports the turn's usage with its completion", async () => {
    const session = await startSession();

    await fromServer(session, { usageMetadata: { totalTokenCount: 42 } });
    await fromServer(session, textFrame("hi"));
    await fromServer(session, TURN_COMPLETE);

    expect(session.events).toContainEqual({
      type: "assistant.response.completed",
      text: "hi",
      usage: { totalTokenCount: 42 },
    });
  });
});

describe("GeminiLiveClient message pump", () => {
  // A malformed frame corrupts session state while the socket still looks
  // healthy, so it is protocol-fatal. Vitest fails the run on an unhandled
  // rejection, which is what covers the pump's own catch staying attached.
  it("treats a malformed frame after setup as a lost connection", async () => {
    const session = await startSession();

    session.socket.deliver("{ not json");
    await flushPump();

    const lost = session.events.find(
      (event) => event.type === "connection.lost",
    );
    expect(lost).toEqual({
      type: "connection.lost",
      cause: "connection-failed",
      error: expect.any(Error),
    });
    expect(session.socket.close).toHaveBeenCalledTimes(1);
    // A transient reset, not a teardown: the playback context was warmed inside
    // a user gesture, and the automatic reconnect that follows this event
    // cannot build a replacement outside one.
    expect(playbackContexts()).toHaveLength(1);
    expect(currentPlayback().close).not.toHaveBeenCalled();
    // Not a half-updated session behind an open socket: the transport is down.
    await expect(session.client.sendText("hello")).rejects.toThrow(
      "Gemini Live session is not ready to send",
    );
  });

  it("rejects a pending connect when the first frame is malformed", async () => {
    const { client } = createClient();
    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();

    const rejection = expect(connected).rejects.toThrow(
      "Failed to handle a Gemini Live message",
    );
    socket.deliver("{ not json");

    await rejection;
  });

  it("applies Blob payloads in arrival order when their text() settles out of order", async () => {
    const session = await startSession();
    let releaseFirst = () => undefined as void;
    const firstSettled = new Promise<void>((resolve) => {
      releaseFirst = () => resolve();
    });

    // The second payload can already be read; the first cannot yet.
    session.socket.deliver({
      text: async () => {
        await firstSettled;
        return JSON.stringify(textFrame("first"));
      },
    });
    session.socket.deliver({
      text: async () => JSON.stringify(textFrame(" second")),
    });
    await flushPump();
    expect(deltaTexts(session.events)).toEqual([]);

    releaseFirst();
    await flushPump();

    expect(deltaTexts(session.events)).toEqual(["first", " second"]);
    await fromServer(session, TURN_COMPLETE);
    expect(completions(session.events)).toEqual(["first second"]);
  });

  it("drops a Blob payload whose text() resolves after a reconnect", async () => {
    const session = await startSession();
    let release = () => undefined as void;
    const settled = new Promise<void>((resolve) => {
      release = () => resolve();
    });

    session.socket.deliver({
      text: async () => {
        await settled;
        return JSON.stringify(textFrame("stale"));
      },
    });
    await recoverSession(session);

    release();
    await flushPump();

    expect(deltaTexts(session.events)).toEqual([]);
  });
});

describe("GeminiLiveClient interruption", () => {
  it("ends the audio at a server interruption and still completes the turn once", async () => {
    const session = await startSession();

    await fromServer(session, textFrame("partial"));
    await fromServer(session, audioFrame());
    await fromServer(session, INTERRUPTED);

    expect(countOf(session.events, "audio.output.ended")).toBe(1);
    expect(currentPlayback().sources[0]!.stop).toHaveBeenCalledTimes(1);

    await fromServer(session, TURN_COMPLETE);

    expect(completions(session.events)).toEqual(["partial"]);
    expect(countOf(session.events, "audio.output.ended")).toBe(1);
  });

  it("drops the condemned turn's tail and lets the next turn through", async () => {
    const session = await startSession();

    await fromServer(session, textFrame("condemned"));
    await fromServer(session, audioFrame());
    await session.client.interrupt();

    // The voice stops at the interrupt, not at the condemned turnComplete.
    expect(audioSequence(session.events)).toEqual([
      "audio.output.started",
      "audio.output.ended",
    ]);

    const scheduledBefore = currentPlayback().sources.length;
    await fromServer(session, textFrame(" tail"));
    await fromServer(session, audioFrame());
    // Replacement input says nothing about whether the condemned turn ended.
    await session.client.sendText("never mind");
    await fromServer(session, TURN_COMPLETE);

    expect(deltaTexts(session.events)).toEqual(["condemned"]);
    expect(completions(session.events)).toEqual([]);
    expect(currentPlayback().sources).toHaveLength(scheduledBefore);

    await fromServer(session, textFrame("fresh"));
    await fromServer(session, TURN_COMPLETE);

    expect(completions(session.events)).toEqual(["fresh"]);
  });

  // Condemning with nothing open would swallow the *next* turn's completion and
  // strand the manager's send lock for good.
  it("condemns nothing when interrupt() lands with no turn in flight", async () => {
    const session = await startSession();

    await session.client.interrupt();
    await fromServer(session, textFrame("innocent"));
    await fromServer(session, TURN_COMPLETE);

    expect(completions(session.events)).toEqual(["innocent"]);
  });

  // A server interruption is not always followed by `turnComplete`; if it left
  // the turn standing, the next `interrupt()` would suppress an innocent turn.
  it("leaves no turn in flight after a server interruption with no turnComplete", async () => {
    const session = await startSession();

    await fromServer(session, audioFrame());
    await fromServer(session, INTERRUPTED);

    await session.client.interrupt();
    await fromServer(session, textFrame("innocent"));
    await fromServer(session, TURN_COMPLETE);

    expect(completions(session.events)).toEqual(["innocent"]);
  });
});

describe("GeminiLiveClient convergence gate", () => {
  it("holds capture frames back inside the window and forwards them after it", async () => {
    const session = await startSession();

    at(100);
    expect(emitCaptureFrame(session.socket)).toBe("sent");

    at(1_000);
    await fromServer(session, audioFrame());

    at(1_000 + CONVERGENCE_GATE_MS - 1);
    expect(emitCaptureFrame(session.socket)).toBe("dropped");

    at(1_000 + CONVERGENCE_GATE_MS);
    expect(emitCaptureFrame(session.socket)).toBe("sent");
    expect(
      JSON.parse(session.socket.sent.at(-1)!) as Record<string, unknown>,
    ).toEqual({
      realtimeInput: {
        audio: {
          data: btoa("\u0000".repeat(640)),
          mimeType: "audio/pcm;rate=16000",
        },
      },
    });
  });

  it("stays armed after a clean turn shorter than the exposure threshold", async () => {
    const session = await startSession();

    at(0);
    await fromServer(session, audioFrame());
    at(CONVERGENCE_GATE_MS - 100);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();

    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(session.socket)).toBe("dropped");
  });

  it("disarms once a clean turn has banked the exposure threshold", async () => {
    const session = await startSession();

    at(0);
    await fromServer(session, audioFrame());
    at(CONVERGENCE_GATE_MS + 100);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();

    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(session.socket)).toBe("sent");
  });

  it("banks an interrupted turn's exposure without disarming on it", async () => {
    const session = await startSession();

    // Killed turn: past the threshold on its own, and still not disarming.
    at(0);
    await fromServer(session, audioFrame());
    at(CONVERGENCE_GATE_MS + 50);
    await fromServer(session, INTERRUPTED);
    await fromServer(session, TURN_COMPLETE);

    at(1_000);
    await fromServer(session, audioFrame());
    at(1_100);
    expect(emitCaptureFrame(session.socket)).toBe("dropped");

    // A clean 400 ms, which only clears the threshold on top of what the
    // killed turn banked.
    at(1_400);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();

    at(2_000);
    await fromServer(session, audioFrame());
    at(2_100);
    expect(emitCaptureFrame(session.socket)).toBe("sent");
  });

  // Only playing -> not-playing intervals count. `turnComplete` is paced from
  // the *first* chunk, so a burst-delivered turn sits silent for seconds.
  it("banks nothing while a drained turn waits for its turnComplete", async () => {
    const session = await startSession();

    at(0);
    await fromServer(session, audioFrame());
    at(300);
    drainPlayback();
    at(9_000);
    await fromServer(session, TURN_COMPLETE);

    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(session.socket)).toBe("dropped");
  });

  it("banks nothing across a mid-turn underrun and keeps the turn's original anchor", async () => {
    const session = await startSession();

    at(0);
    await fromServer(session, audioFrame());
    at(200);
    drainPlayback();

    // Audio resumes 5 s later: a new sounding stretch, not a new turn.
    at(5_000);
    await fromServer(session, audioFrame());
    at(5_100);
    // The window is anchored at the turn's first audible moment, not here.
    expect(emitCaptureFrame(session.socket)).toBe("sent");

    at(5_300);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();
    expect(countOf(session.events, "audio.output.started")).toBe(1);

    // 200 ms + 300 ms of exposure: the 4.8 s gap banked nothing.
    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(session.socket)).toBe("dropped");
  });

  it("banks the stretch that resumes after a mid-turn underrun", async () => {
    const session = await startSession();

    at(0);
    await fromServer(session, audioFrame());
    at(200);
    drainPlayback();

    at(5_000);
    await fromServer(session, audioFrame());
    at(5_550);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();

    // 200 ms and 550 ms, neither of which clears the threshold alone: the
    // resumed stretch opens a span of its own or the total never gets there.
    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(session.socket)).toBe("sent");
  });

  it("disarms on a locally interrupted turn but not on a server interrupted one", async () => {
    const local = await startSession();
    at(0);
    await fromServer(local, audioFrame());
    at(CONVERGENCE_GATE_MS + 100);
    await local.client.interrupt();
    await fromServer(local, TURN_COMPLETE);

    at(10_000);
    await fromServer(local, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(local.socket)).toBe("sent");

    const server = await startSession();
    at(0);
    await fromServer(server, audioFrame());
    at(CONVERGENCE_GATE_MS + 100);
    await fromServer(server, INTERRUPTED);
    await fromServer(server, TURN_COMPLETE);

    at(10_000);
    await fromServer(server, audioFrame());
    at(10_100);
    expect(emitCaptureFrame(server.socket)).toBe("dropped");

    // It banked all the same: a 200 ms clean turn now clears the threshold.
    at(10_200);
    await fromServer(server, TURN_COMPLETE);
    drainPlayback();
    at(20_000);
    await fromServer(server, audioFrame());
    at(20_100);
    expect(emitCaptureFrame(server.socket)).toBe("sent");
  });
});

describe("GeminiLiveClient tool calls", () => {
  const toolCallFrame = {
    toolCall: {
      functionCalls: [
        { id: "call-1", name: "wave", args: { intensity: 3 } },
        { id: "call-2", name: "blink" },
      ],
    },
  };

  it("fans a tool frame out one event per call", async () => {
    const session = await startSession();

    await fromServer(session, toolCallFrame);

    expect(
      session.events.filter((event) => event.type === "tool.call"),
    ).toEqual([
      {
        type: "tool.call",
        name: "wave",
        args: { intensity: 3 },
        callId: "call-1",
      },
      { type: "tool.call", name: "blink", args: {}, callId: "call-2" },
    ]);
  });

  it("answers a call with its id and name, once", async () => {
    const session = await startSession();
    await fromServer(session, toolCallFrame);

    await session.client.sendToolResult("call-1", { ok: true });

    expect(JSON.parse(session.socket.sent.at(-1)!)).toEqual({
      toolResponse: {
        functionResponses: [
          { id: "call-1", name: "wave", response: { ok: true } },
        ],
      },
    });
    await expect(
      session.client.sendToolResult("call-1", { ok: true }),
    ).rejects.toThrow('Unknown Gemini Live tool call "call-1"');
  });

  it("drops a call the server cancelled", async () => {
    const session = await startSession();
    await fromServer(session, toolCallFrame);

    await fromServer(session, { toolCallCancellation: { ids: ["call-2"] } });

    await expect(
      session.client.sendToolResult("call-2", { ok: true }),
    ).rejects.toThrow('Unknown Gemini Live tool call "call-2"');
  });

  it("leaves the call answerable when the send throws", async () => {
    const session = await startSession();
    await fromServer(session, toolCallFrame);

    session.socket.send.mockImplementationOnce(() => {
      throw new Error("socket write failed");
    });
    await expect(
      session.client.sendToolResult("call-1", { ok: true }),
    ).rejects.toThrow("socket write failed");

    await session.client.sendToolResult("call-1", { ok: true });

    expect(JSON.parse(session.socket.sent.at(-1)!)).toEqual({
      toolResponse: {
        functionResponses: [
          { id: "call-1", name: "wave", response: { ok: true } },
        ],
      },
    });
  });

  // Reported rather than trusted or dropped in silence: a session that runs on
  // while the model waits for an answer it will never get fails invisibly.
  it("partitions a mixed frame, reporting the unusable entry without killing the socket", async () => {
    const session = await startSession();

    await fromServer(session, {
      toolCall: {
        functionCalls: [
          { id: "call-1", name: "wave", args: { intensity: 3 } },
          { name: "sing", args: { lyrics: "hunter2" } },
          { id: "call-3", name: "blink" },
        ],
      },
    });

    const types = session.events.map((event) => event.type);
    expect(types.filter((type) => type === "tool.call")).toHaveLength(2);
    expect(types.lastIndexOf("tool.call")).toBeLessThan(types.indexOf("error"));
    expect(countOf(session.events, "error")).toBe(1);
    expect(countOf(session.events, "connection.lost")).toBe(0);
    expect(session.socket.close).not.toHaveBeenCalled();
    expect(session.socket.readyState).toBe(MockWebSocket.OPEN);

    const reported = session.events.find((event) => event.type === "error");
    const message =
      reported?.type === "error" ? reported.error.message : "no error emitted";
    expect(message).toContain("keys received: {name, args}");
    expect(message).not.toContain("hunter2");

    // The well-formed siblings survived the malformed one.
    await session.client.sendToolResult("call-3", { ok: true });
    expect(JSON.parse(session.socket.sent.at(-1)!)).toEqual({
      toolResponse: {
        functionResponses: [
          { id: "call-3", name: "blink", response: { ok: true } },
        ],
      },
    });
  });
});

describe("GeminiLiveClient recovery", () => {
  it("re-mints the session and keeps the gesture-warmed playback context", async () => {
    const session = await startSession();
    const playback = currentPlayback();

    await recoverSession(session);

    expect(session.bootstrap).toHaveBeenCalledTimes(2);
    expect(playbackContexts()).toHaveLength(1);
    expect(currentPlayback()).toBe(playback);
    expect(playback.close).not.toHaveBeenCalled();

    await session.client.disconnect();
    expect(playback.close).toHaveBeenCalledTimes(1);
  });

  it("drops tool calls belonging to the session that ended", async () => {
    const session = await startSession();
    await fromServer(session, {
      toolCall: { functionCalls: [{ id: "call-1", name: "wave" }] },
    });

    session.socket.emitError();
    await recoverSession(session);

    await expect(
      session.client.sendToolResult("call-1", { ok: true }),
    ).rejects.toThrow('Unknown Gemini Live tool call "call-1"');
  });

  it("drops the condemned turn along with the session it belonged to", async () => {
    const session = await startSession();
    await fromServer(session, textFrame("condemned"));
    await session.client.interrupt();

    session.socket.emitError();
    await recoverSession(session);

    await fromServer(session, textFrame("fresh"));
    await fromServer(session, TURN_COMPLETE);

    expect(completions(session.events)).toEqual(["fresh"]);
  });

  it("re-arms the convergence gate with a zeroed exposure total", async () => {
    const session = await startSession();
    at(0);
    await fromServer(session, audioFrame());
    at(CONVERGENCE_GATE_MS + 100);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();

    await recoverSession(session);

    // Re-armed: the canceller adapted to a stream that has been stopped.
    at(10_000);
    await fromServer(session, audioFrame());
    at(10_100);
    currentWorklet().emitFrame();
    expect(realtimeInputCount(session.socket)).toBe(0);

    // And starting from zero: 400 ms is not enough to disarm again.
    at(10_400);
    await fromServer(session, TURN_COMPLETE);
    drainPlayback();
    at(20_000);
    await fromServer(session, audioFrame());
    at(20_100);
    currentWorklet().emitFrame();
    expect(realtimeInputCount(session.socket)).toBe(0);
  });
});

describe("GeminiLiveClient unready send paths", () => {
  it("refuses caller frames and drops capture frames before setup completes", async () => {
    const { client } = createClient();
    const connected = client.connect();
    const socket = await nextSocket(0);
    socket.open();

    await expect(client.sendText("hello")).rejects.toThrow(
      "Gemini Live session is not ready to send",
    );
    // No `toolCall` frame can have arrived this early, so a dead id fails as a
    // dead id rather than as a socket that is not ready.
    await expect(client.sendToolResult("call-1", {})).rejects.toThrow(
      'Unknown Gemini Live tool call "call-1"',
    );
    expect(() => currentWorklet().emitFrame()).not.toThrow();
    expect(realtimeInputCount(socket)).toBe(0);

    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await connected;
  });

  it("reports the reconnect rather than the ids it dropped while recovering", async () => {
    const session = await startSession();
    await fromServer(session, {
      toolCall: { functionCalls: [{ id: "call-1", name: "wave" }] },
    });

    const index = MockWebSocket.instances.length;
    const recovered = session.client.recover();
    const socket = await nextSocket(index);
    socket.open();

    await expect(session.client.sendText("hello")).rejects.toThrow(
      "Realtime transport reconnecting",
    );
    await expect(
      session.client.sendToolResult("call-1", { ok: true }),
    ).rejects.toThrow("Realtime transport reconnecting");
    expect(() => currentWorklet().emitFrame()).not.toThrow();
    expect(realtimeInputCount(socket)).toBe(0);

    socket.deliver(JSON.stringify({ setupComplete: {} }));
    await recovered;
  });

  it("refuses caller frames and drops capture frames after the socket closes", async () => {
    const session = await startSession();
    await fromServer(session, {
      toolCall: { functionCalls: [{ id: "call-1", name: "wave" }] },
    });
    // Held from before the close, the way a frame the audio thread already
    // posted outlives the session it belonged to.
    const queuedFrame = currentWorklet().port.onmessage;

    session.socket.serverClose(1006);
    await flushPump();

    await expect(session.client.sendText("hello")).rejects.toThrow(
      "Gemini Live session is not ready to send",
    );
    // The reset dropped the call along with the session that asked for it.
    await expect(
      session.client.sendToolResult("call-1", { ok: true }),
    ).rejects.toThrow('Unknown Gemini Live tool call "call-1"');
    expect(() =>
      queuedFrame?.({
        data: new ArrayBuffer(640),
      } as MessageEvent<ArrayBuffer>),
    ).not.toThrow();
    expect(realtimeInputCount(session.socket)).toBe(0);
  });

  it("warns instead of sending when a caller pushes raw audio", async () => {
    const session = await startSession();
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await session.client.sendAudio(new ArrayBuffer(8));

    expect(warn).toHaveBeenCalledTimes(1);
    expect(session.socket.sent).toHaveLength(1);
  });
});
