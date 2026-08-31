/**
 * Gemini Live spike harness.
 *
 * Deliberately imports nothing from charivo: the questions this answers have to
 * be answerable BEFORE a `RealtimeTransportClient` implementation exists, so
 * this is raw WebSocket + Web Audio and nothing else. It is a measurement
 * device, not a prototype of the transport — see README.md.
 */
type PlaybackRoute = "direct" | "loopback" | "gated";
type EchoMode = "true" | "all" | "false";

const INPUT_SAMPLE_RATE = 16000;
const OUTPUT_SAMPLE_RATE = 24000;
/** 20 ms at 16 kHz. No official chunk-size guidance exists; see README. */
const CAPTURE_FRAME_SAMPLES = 320;
const WS_BASE =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContentConstrained";

const KNOWN_MESSAGE_KEYS = new Set([
  "setupComplete",
  "serverContent",
  "toolCall",
  "toolCallCancellation",
  "goAway",
  "sessionResumptionUpdate",
  "usageMetadata",
]);

interface GeminiPart {
  text?: string;
  inlineData?: { data?: string; mimeType?: string };
}

interface GeminiServerMessage {
  setupComplete?: Record<string, unknown>;
  serverContent?: {
    modelTurn?: { parts?: GeminiPart[] };
    interrupted?: boolean;
    generationComplete?: boolean;
    turnComplete?: boolean;
    inputTranscription?: { text?: string };
    outputTranscription?: { text?: string };
  };
  toolCall?: { functionCalls?: Array<{ id?: string; name?: string }> };
  toolCallCancellation?: { ids?: string[] };
  goAway?: { timeLeft?: string };
  sessionResumptionUpdate?: { newHandle?: string; resumable?: boolean };
  usageMetadata?: Record<string, unknown>;
}

const CAPTURE_WORKLET_SOURCE = `
class CaptureProcessor extends AudioWorkletProcessor {
  constructor(options) {
    super();
    const targetRate = options.processorOptions.targetRate;
    const frameSamples = options.processorOptions.frameSamples;
    this.ratio = sampleRate / targetRate;
    this.frameSamples = frameSamples;
    this.position = 0;
    this.sum = 0;
    this.count = 0;
    this.pending = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel) {
      return true;
    }

    // Box-average decimation. Not a proper anti-alias filter, but far better
    // than picking every Nth sample, which folds speech harmonics back down.
    for (let i = 0; i < channel.length; i += 1) {
      this.sum += channel[i];
      this.count += 1;
      this.position += 1;
      if (this.position >= this.ratio) {
        this.position -= this.ratio;
        this.pending.push(this.count > 0 ? this.sum / this.count : 0);
        this.sum = 0;
        this.count = 0;
      }
    }

    while (this.pending.length >= this.frameSamples) {
      const chunk = this.pending.splice(0, this.frameSamples);
      const frame = new Int16Array(chunk.length);
      for (let i = 0; i < chunk.length; i += 1) {
        const clamped = Math.max(-1, Math.min(1, chunk[i]));
        frame[i] = clamped < 0 ? clamped * 0x8000 : clamped * 0x7fff;
      }
      this.port.postMessage(frame.buffer, [frame.buffer]);
    }

    return true;
  }
}

registerProcessor("capture-processor", CaptureProcessor);
`;

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) {
    throw new Error(`Missing #${id}`);
  }
  return node as T;
}

const routeSelect = el<HTMLSelectElement>("route-select");
const echoSelect = el<HTMLSelectElement>("echo-select");
const modelSelect = el<HTMLSelectElement>("model-select");
const voiceSelect = el<HTMLSelectElement>("voice-select");
const instructionInput = el<HTMLInputElement>("instruction-input");
const textInput = el<HTMLInputElement>("text-input");
const silentRun = el<HTMLInputElement>("silent-run");
const connectButton = el<HTMLButtonElement>("connect-button");
const disconnectButton = el<HTMLButtonElement>("disconnect-button");
const interruptButton = el<HTMLButtonElement>("interrupt-button");
const sendButton = el<HTMLButtonElement>("send-button");
const dumpButton = el<HTMLButtonElement>("dump-button");
const loopbackAudio = el<HTMLAudioElement>("loopback-audio");
const eventLog = el<HTMLPreElement>("event-log");
const transcriptText = el<HTMLPreElement>("transcript-text");
const micMeterFill = el<HTMLSpanElement>("mic-meter").firstElementChild;
const playbackMeterFill =
  el<HTMLSpanElement>("playback-meter").firstElementChild;

const logLines: string[] = [];

function log(message: string): void {
  const line = `${new Date().toISOString().slice(11, 23)} ${message}`;
  logLines.push(line);
  eventLog.textContent = logLines.slice(-400).join("\n");
  eventLog.scrollTop = eventLog.scrollHeight;
}

function setText(id: string, value: string): void {
  el(id).textContent = value;
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const stride = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += stride) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + stride));
  }
  return btoa(binary);
}

interface SchedulerCallbacks {
  onDrain(): void;
  onPlayingChange(playing: boolean): void;
}

/**
 * Owns every scheduled sample, which is the whole point: with the server out of
 * the playback business there is no authoritative "audio ended" event to wait
 * for, but there is exact bookkeeping — we know when the last thing we
 * scheduled finished.
 */
class PlaybackScheduler {
  private nextStartTime = 0;
  private generation = 0;
  private readonly active = new Set<AudioBufferSourceNode>();

  constructor(
    private readonly context: AudioContext,
    private readonly destination: AudioNode,
    private readonly callbacks: SchedulerCallbacks,
  ) {}

  enqueue(pcm: Uint8Array): void {
    const sampleCount = Math.floor(pcm.byteLength / 2);
    if (sampleCount === 0) {
      return;
    }

    const generation = this.generation;
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const buffer = this.context.createBuffer(
      1,
      sampleCount,
      OUTPUT_SAMPLE_RATE,
    );
    const channel = buffer.getChannelData(0);
    for (let i = 0; i < sampleCount; i += 1) {
      channel[i] = view.getInt16(i * 2, true) / 32768;
    }

    const source = this.context.createBufferSource();
    source.buffer = buffer;
    source.connect(this.destination);
    source.onended = () => {
      this.active.delete(source);
      if (generation !== this.generation || this.active.size > 0) {
        return;
      }
      this.callbacks.onPlayingChange(false);
      this.callbacks.onDrain();
    };

    const wasIdle = this.active.size === 0;
    const startAt = Math.max(this.context.currentTime, this.nextStartTime);
    this.active.add(source);
    source.start(startAt);
    this.nextStartTime = startAt + buffer.duration;

    if (wasIdle) {
      this.callbacks.onPlayingChange(true);
    }
  }

  flush(): void {
    this.generation += 1;
    const wasPlaying = this.active.size > 0;

    for (const source of this.active) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // Already finished between the size check and here; nothing to stop.
      }
    }

    this.active.clear();
    this.nextStartTime = 0;

    if (wasPlaying) {
      this.callbacks.onPlayingChange(false);
    }
  }
}

let socket: WebSocket | null = null;
let captureContext: AudioContext | null = null;
let playbackContext: AudioContext | null = null;
let micStream: MediaStream | null = null;
let micAnalyser: AnalyserNode | null = null;
let playbackAnalyser: AnalyserNode | null = null;
let scheduler: PlaybackScheduler | null = null;
let loopbackPeers: {
  local: RTCPeerConnection;
  remote: RTCPeerConnection;
} | null = null;
let meterFrame = 0;

let setupComplete = false;
/**
 * Anchor for the age of each interruption. An echo canceller has to converge on
 * the room before it works, so "how many" is the wrong question on its own —
 * early leaks that stop are a different verdict from leaks that keep coming.
 */
let sessionStartedAt = 0;
/**
 * When the character's voice actually became audible, cleared at `turnComplete`.
 * The anchor that separates the two explanations for an interruption: echo can
 * only be blamed while something is coming out of the speakers, so an
 * interruption logged with no playback in flight is not an echo at all.
 */
let speakingSince = 0;
let activeRoute: PlaybackRoute = "direct";

let interruptedCount = 0;
let falseInterruptCount = 0;
let inputTranscriptCount = 0;
let outputTranscriptCount = 0;
let discardedBytes = 0;
let flushedAt = 0;

let turnStartedAt = 0;
let generationCompleteAt = 0;
let turnCompleteAt = 0;

function resetTurnTiming(): void {
  turnStartedAt = 0;
  generationCompleteAt = 0;
  turnCompleteAt = 0;
}

function since(anchor: number, at: number): string {
  if (anchor === 0 || at === 0) {
    return "-";
  }
  return `+${Math.round(at - anchor)} ms`;
}

async function mintToken(model: string): Promise<string> {
  // Voice and instruction travel to the mint route, not into the setup frame:
  // the token's `bidiGenerateContentSetup` replaces whatever this page sends,
  // so the server is the only place the real session config can be built.
  const response = await fetch("/api/gemini-token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      voice: voiceSelect.value,
      instruction: instructionInput.value,
    }),
  });

  const payload = (await response.json()) as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(
      `Token mint failed (${response.status}): ${JSON.stringify(payload)}`,
    );
  }

  return payload.token as string;
}

function buildAudioConstraints(mode: EchoMode): MediaStreamConstraints {
  // `{ ideal: "all" }` is a newer constraint value than the DOM typings model,
  // so the cast is the honest way to request it. An engine that does not know
  // the value silently falls back to `true`, which is exactly the comparison
  // this harness exists to make.
  const echoCancellation = mode === "all" ? { ideal: "all" } : mode === "true";

  return {
    audio: {
      echoCancellation,
      noiseSuppression: true,
      autoGainControl: true,
    } as MediaTrackConstraints,
  };
}

async function buildPlaybackRoute(
  context: AudioContext,
  route: PlaybackRoute,
): Promise<AudioNode> {
  const gain = context.createGain();
  playbackAnalyser = context.createAnalyser();
  playbackAnalyser.fftSize = 512;
  gain.connect(playbackAnalyser);

  if (route !== "loopback") {
    gain.connect(context.destination);
    return gain;
  }

  // Route playback through a local RTCPeerConnection pair so the audio the user
  // hears arrives on a *remote* track. `echoCancellation: true` is only
  // guaranteed to cancel remote-sourced audio, so this is the difference
  // between relying on an implementation detail and relying on the spec.
  const destination = context.createMediaStreamDestination();
  gain.connect(destination);

  const local = new RTCPeerConnection();
  const remote = new RTCPeerConnection();
  loopbackPeers = { local, remote };

  local.onicecandidate = (event) => {
    if (event.candidate) {
      void remote.addIceCandidate(event.candidate);
    }
  };
  remote.onicecandidate = (event) => {
    if (event.candidate) {
      void local.addIceCandidate(event.candidate);
    }
  };
  remote.ontrack = (event) => {
    loopbackAudio.srcObject = event.streams[0];
    void loopbackAudio.play().catch((error: unknown) => {
      log(`loopback <audio>.play() rejected: ${String(error)}`);
    });
  };

  for (const track of destination.stream.getAudioTracks()) {
    local.addTrack(track, destination.stream);
  }

  const offer = await local.createOffer();
  await local.setLocalDescription(offer);
  await remote.setRemoteDescription(offer);
  const answer = await remote.createAnswer();
  await remote.setLocalDescription(answer);
  await local.setRemoteDescription(answer);

  log("loopback peer pair established");
  return gain;
}

function setMicEnabled(enabled: boolean): void {
  for (const track of micStream?.getAudioTracks() ?? []) {
    track.enabled = enabled;
  }
}

function updateMeters(): void {
  meterFrame = requestAnimationFrame(updateMeters);

  const paint = (analyser: AnalyserNode | null, fill: Element | null): void => {
    if (!analyser || !fill) {
      return;
    }
    const samples = new Uint8Array(analyser.fftSize);
    analyser.getByteTimeDomainData(samples);
    let sum = 0;
    for (let i = 0; i < samples.length; i += 1) {
      const centered = (samples[i] - 128) / 128;
      sum += centered * centered;
    }
    const rms = Math.sqrt(sum / samples.length);
    (fill as HTMLElement).style.width = `${Math.min(rms * 300, 100)}%`;
  };

  paint(micAnalyser, micMeterFill);
  paint(playbackAnalyser, playbackMeterFill);
}

function handleServerMessage(message: GeminiServerMessage): void {
  for (const key of Object.keys(message)) {
    if (!KNOWN_MESSAGE_KEYS.has(key)) {
      log(
        `UNKNOWN top-level key "${key}": ${JSON.stringify(message[key as keyof GeminiServerMessage])}`,
      );
    }
  }

  if (message.setupComplete) {
    setupComplete = true;
    sessionStartedAt = performance.now();
    log("setupComplete — streaming microphone");
    return;
  }

  if (message.goAway) {
    log(`goAway timeLeft=${message.goAway.timeLeft ?? "(none)"}`);
  }

  if (message.sessionResumptionUpdate) {
    const update = message.sessionResumptionUpdate;
    log(
      `sessionResumptionUpdate resumable=${String(update.resumable)} handle=${
        update.newHandle ? `${update.newHandle.slice(0, 12)}…` : "(none)"
      }`,
    );
  }

  if (message.toolCall?.functionCalls) {
    log(
      `toolCall x${message.toolCall.functionCalls.length}: ${message.toolCall.functionCalls
        .map((call) => `${call.name ?? "?"}#${call.id ?? "?"}`)
        .join(", ")}`,
    );
  }

  if (message.toolCallCancellation) {
    log(
      `toolCallCancellation: ${(message.toolCallCancellation.ids ?? []).join(", ")}`,
    );
  }

  if (message.usageMetadata) {
    log(`usageMetadata: ${JSON.stringify(message.usageMetadata)}`);
  }

  const content = message.serverContent;
  if (!content) {
    return;
  }

  if (content.inputTranscription?.text) {
    inputTranscriptCount += 1;
    setText("input-transcript-count", String(inputTranscriptCount));
    transcriptText.textContent += `\n[in ] ${content.inputTranscription.text}`;
  }

  if (content.outputTranscription?.text) {
    outputTranscriptCount += 1;
    setText("output-transcript-count", String(outputTranscriptCount));
    transcriptText.textContent += `\n[out] ${content.outputTranscription.text}`;
  }

  for (const part of content.modelTurn?.parts ?? []) {
    if (!part.inlineData?.data) {
      continue;
    }

    const bytes = base64ToBytes(part.inlineData.data);

    // Audio that keeps arriving after a local flush is exactly the waste Q2 is
    // about: the server has no documented "cancel" and does not stop.
    if (flushedAt > 0) {
      discardedBytes += bytes.byteLength;
      setText("discarded-bytes", String(discardedBytes));
      setText(
        "discarded-window",
        `${Math.round(performance.now() - flushedAt)} ms and counting`,
      );
      continue;
    }

    if (turnStartedAt === 0) {
      turnStartedAt = performance.now();
      log("first audio chunk of turn");
    }
    scheduler?.enqueue(bytes);
  }

  if (content.interrupted) {
    interruptedCount += 1;
    setText("interrupted-count", String(interruptedCount));
    const now = performance.now();
    const sessionAge =
      sessionStartedAt === 0
        ? "?"
        : `${((now - sessionStartedAt) / 1000).toFixed(1)}s`;
    const speechAge =
      speakingSince === 0
        ? "NOTHING WAS PLAYING — cannot be echo"
        : `${((now - speakingSince) / 1000).toFixed(1)}s after the voice started`;
    if (silentRun.checked) {
      falseInterruptCount += 1;
      setText("false-interrupt-count", String(falseInterruptCount));
      setText("last-false-interrupt", `${sessionAge} / ${speechAge}`);
      log(
        `interrupted (FALSE — silent run armed) #${falseInterruptCount} at ${sessionAge} into session, ${speechAge}`,
      );
    } else {
      log(
        `interrupted #${interruptedCount} at ${sessionAge} into session, ${speechAge}`,
      );
    }
    scheduler?.flush();
    resetTurnTiming();
  }

  if (content.generationComplete) {
    generationCompleteAt = performance.now();
    setText("delta-generation", since(turnStartedAt, generationCompleteAt));
    log("generationComplete");
  }

  if (content.turnComplete) {
    turnCompleteAt = performance.now();
    speakingSince = 0;
    setText("delta-turn", since(turnStartedAt, turnCompleteAt));
    log("turnComplete (server stopped sending — NOT playback end)");

    // The flushed turn is over, so stop discarding and let the next one play.
    // What the counter holds now is the answer to Q2: everything the server
    // kept producing for a turn the user had already cancelled.
    if (flushedAt > 0) {
      setText(
        "discarded-window",
        `${Math.round(turnCompleteAt - flushedAt)} ms (flush → turnComplete)`,
      );
      log(
        `discarded ${discardedBytes} bytes between flush and turnComplete (Q2)`,
      );
      flushedAt = 0;
    }
  }
}

function onDrain(): void {
  const drainedAt = performance.now();
  setText("delta-drain", since(turnStartedAt, drainedAt));
  setText(
    "delta-gap",
    turnCompleteAt === 0
      ? "(drained before turnComplete)"
      : since(turnCompleteAt, drainedAt),
  );
  log(
    turnCompleteAt === 0
      ? "playback drained BEFORE turnComplete — server still sending"
      : "playback drained — this is the real end of audio",
  );
  resetTurnTiming();
}

function onPlayingChange(playing: boolean): void {
  // Held across the spurious mid-turn drains, so it marks when the voice first
  // became audible rather than when the last buffer happened to start.
  if (playing && speakingSince === 0) {
    speakingSince = performance.now();
  }

  if (activeRoute === "gated") {
    setMicEnabled(!playing);
    log(`gated: mic ${playing ? "muted" : "live"}`);
  }
}

async function connect(): Promise<void> {
  connectButton.disabled = true;

  try {
    const model = modelSelect.value;
    const route = routeSelect.value as PlaybackRoute;
    activeRoute = route;

    const token = await mintToken(model);
    log(`token minted for ${model}`);

    micStream = await navigator.mediaDevices.getUserMedia(
      buildAudioConstraints(echoSelect.value as EchoMode),
    );
    const settings = micStream.getAudioTracks()[0]?.getSettings() ?? {};
    log(
      `mic settings: echoCancellation=${String(settings.echoCancellation)} sampleRate=${String(settings.sampleRate)}`,
    );

    captureContext = new AudioContext();
    log(`capture context at ${captureContext.sampleRate} Hz`);
    const workletUrl = URL.createObjectURL(
      new Blob([CAPTURE_WORKLET_SOURCE], { type: "application/javascript" }),
    );
    await captureContext.audioWorklet.addModule(workletUrl);
    URL.revokeObjectURL(workletUrl);

    const micSource = captureContext.createMediaStreamSource(micStream);
    micAnalyser = captureContext.createAnalyser();
    micAnalyser.fftSize = 512;
    micSource.connect(micAnalyser);

    const capture = new AudioWorkletNode(captureContext, "capture-processor", {
      processorOptions: {
        targetRate: INPUT_SAMPLE_RATE,
        frameSamples: CAPTURE_FRAME_SAMPLES,
      },
    });
    micSource.connect(capture);
    capture.port.onmessage = (event: MessageEvent<ArrayBuffer>) => {
      if (!setupComplete || socket?.readyState !== WebSocket.OPEN) {
        return;
      }
      socket.send(
        JSON.stringify({
          realtimeInput: {
            audio: {
              data: bytesToBase64(new Uint8Array(event.data)),
              mimeType: `audio/pcm;rate=${INPUT_SAMPLE_RATE}`,
            },
          },
        }),
      );
    };

    playbackContext = new AudioContext({ sampleRate: OUTPUT_SAMPLE_RATE });
    const destination = await buildPlaybackRoute(playbackContext, route);
    scheduler = new PlaybackScheduler(playbackContext, destination, {
      onDrain,
      onPlayingChange,
    });

    socket = new WebSocket(
      `${WS_BASE}?access_token=${encodeURIComponent(token)}`,
    );
    socket.onopen = () => {
      // A setup frame is still required, but it carries only the model: the
      // token already pins the real one, and anything else sent here is
      // discarded in favour of it.
      log("websocket open — sending setup");
      socket?.send(JSON.stringify({ setup: { model: `models/${model}` } }));
      disconnectButton.disabled = false;
      interruptButton.disabled = false;
      sendButton.disabled = false;
    };
    socket.onmessage = (event: MessageEvent) => {
      void (async () => {
        const raw =
          typeof event.data === "string"
            ? event.data
            : await (event.data as Blob).text();
        try {
          handleServerMessage(JSON.parse(raw) as GeminiServerMessage);
        } catch (error) {
          log(
            `failed to handle message: ${String(error)} :: ${raw.slice(0, 200)}`,
          );
        }
      })();
    };
    socket.onerror = () => {
      log("websocket error");
    };
    socket.onclose = (event) => {
      log(
        `websocket closed code=${event.code} reason="${event.reason}" clean=${String(event.wasClean)}`,
      );
      void disconnect();
    };

    meterFrame = requestAnimationFrame(updateMeters);
  } catch (error) {
    log(`connect failed: ${String(error)}`);
    await disconnect();
  }
}

async function disconnect(): Promise<void> {
  cancelAnimationFrame(meterFrame);
  scheduler?.flush();
  scheduler = null;

  if (socket && socket.readyState <= WebSocket.OPEN) {
    socket.onclose = null;
    socket.close();
  }
  socket = null;
  setupComplete = false;

  for (const track of micStream?.getAudioTracks() ?? []) {
    track.stop();
  }
  micStream = null;
  micAnalyser = null;
  playbackAnalyser = null;

  loopbackPeers?.local.close();
  loopbackPeers?.remote.close();
  loopbackPeers = null;
  loopbackAudio.srcObject = null;

  await captureContext?.close();
  captureContext = null;
  await playbackContext?.close();
  playbackContext = null;

  connectButton.disabled = false;
  disconnectButton.disabled = true;
  interruptButton.disabled = true;
  sendButton.disabled = true;
  log("disconnected");
}

connectButton.addEventListener("click", () => {
  void connect();
});

disconnectButton.addEventListener("click", () => {
  void disconnect();
});

function localFlush(): void {
  flushedAt = performance.now();
  discardedBytes = 0;
  scheduler?.flush();
  resetTurnTiming();
  log("local flush — watching for audio that keeps arriving (Q2)");
}

function sendText(text: string): void {
  if (socket?.readyState !== WebSocket.OPEN) {
    return;
  }
  flushedAt = 0;
  setText("discarded-window", "-");
  socket.send(
    JSON.stringify({
      clientContent: {
        turns: [{ role: "user", parts: [{ text }] }],
        turnComplete: true,
      },
    }),
  );
  log(`sent text: ${text}`);
}

interruptButton.addEventListener("click", localFlush);

sendButton.addEventListener("click", () => {
  sendText(textInput.value);
});

dumpButton.addEventListener("click", () => {
  const blob = new Blob([logLines.join("\n")], { type: "text/plain" });
  const anchor = document.createElement("a");
  anchor.href = URL.createObjectURL(blob);
  anchor.download = `gemini-live-spike-${Date.now()}.log`;
  anchor.click();
  URL.revokeObjectURL(anchor.href);
});

log("ready — pick a configuration, then Connect");
