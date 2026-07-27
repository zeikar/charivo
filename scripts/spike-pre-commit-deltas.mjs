#!/usr/bin/env node
/**
 * Spike: does `gpt-realtime-whisper` emit transcript deltas BEFORE a commit?
 * GA Realtime transcription session over WebSocket (no beta header/shape).
 *
 * It streams a WAV via input_audio_buffer.append at ~1x real-time WITHOUT
 * committing, waits a grace window, and reports whether any
 * *.input_audio_transcription.delta arrived BEFORE the commit.
 *   PRE-COMMIT DELTAS: YES -> simplify to single-commit-at-stop
 *   PRE-COMMIT DELTAS: NO  -> the plan's PERIODIC-commit design is required
 * WebSocket is used only for Node simplicity; the delta-timing it observes is a
 * property of the model/session and applies to the WebRTC path too.
 *
 *   OPENAI_API_KEY=sk-... node scripts/spike-pre-commit-deltas.mjs <audio.wav>
 * Env: REALTIME_MODEL (default gpt-realtime-whisper), GRACE_MS (default 4000)
 */

import fs from "node:fs";
import WebSocket from "ws";

const API_KEY = process.env.OPENAI_API_KEY;
const WAV_PATH = process.argv[2];
const MODEL = process.env.REALTIME_MODEL || "gpt-realtime-whisper";
const TARGET_RATE = 24000;
const CHUNK_MS = 100;
const GRACE_MS = Number(process.env.GRACE_MS || 4000);
const COMPLETE_TIMEOUT_MS = 15000;

const WS_URL =
  process.env.REALTIME_URL ||
  "wss://api.openai.com/v1/realtime?intent=transcription";
// GA: raw key via header, NO OpenAI-Beta header.
const HEADERS = { Authorization: `Bearer ${API_KEY}` };

// GA transcription session.update candidates (tried in order on a config error).
const gaConfig = (format) => ({
  type: "session.update",
  session: {
    type: "transcription",
    audio: {
      input: {
        ...(format ? { format } : {}),
        transcription: { model: MODEL },
        turn_detection: null,
      },
    },
  },
});
const CANDIDATES = [
  gaConfig({ type: "audio/pcm", rate: TARGET_RATE }),
  gaConfig("pcm16"),
  gaConfig(null),
];

if (!API_KEY) fail("Set OPENAI_API_KEY in the environment.");
if (!WAV_PATH)
  fail("Usage: node scripts/spike-pre-commit-deltas.mjs <audio.wav>");

const t0 = Date.now();
const ts = () => `+${String(Date.now() - t0).padStart(6)}ms`;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let commitSentAt = null;
let firstDeltaAt = null;
let firstDeltaBeforeCommit = null;
let candIdx = -1;
let streamed = false;
let finished = false;

const ws = new WebSocket(WS_URL, { headers: HEADERS });

ws.on("open", () => console.log(ts(), "WS open ->", WS_URL));

ws.on("message", (raw) => {
  let ev;
  try {
    ev = JSON.parse(raw.toString());
  } catch {
    console.log(ts(), "non-JSON:", raw.toString().slice(0, 200));
    return;
  }
  const type = ev.type || "(no type)";

  if (type === "session.created" || type === "transcription_session.created") {
    console.log(ts(), type, "-> sending session config");
    sendCandidate(0);
    setTimeout(() => maybeStream(), 4000); // stream even if no explicit .updated
    return;
  }
  if (type.endsWith("session.updated")) {
    console.log(ts(), "session configured:", type);
    maybeStream();
    return;
  }
  if (type.includes("input_audio_transcription.delta")) {
    if (firstDeltaAt === null) {
      firstDeltaAt = Date.now();
      firstDeltaBeforeCommit = commitSentAt === null;
      console.log(
        ts(),
        `*** FIRST DELTA -> ${
          firstDeltaBeforeCommit
            ? "BEFORE commit  (pre-commit deltas EXIST)"
            : "after commit"
        }`,
      );
    }
    console.log(ts(), "delta:", JSON.stringify(ev.delta ?? ev));
    return;
  }
  if (type.includes("input_audio_transcription.completed")) {
    console.log(ts(), "completed:", JSON.stringify(ev.transcript ?? ev));
    finish();
    return;
  }
  if (type.includes("input_audio_transcription.failed")) {
    console.log(ts(), "transcription failed:", JSON.stringify(ev.error ?? ev));
    finish();
    return;
  }
  if (type === "error") {
    console.log(ts(), "ERROR event:", JSON.stringify(ev.error ?? ev, null, 2));
    // advance to the next config candidate while still in the config phase
    if (
      firstDeltaAt === null &&
      commitSentAt === null &&
      candIdx < CANDIDATES.length - 1
    ) {
      sendCandidate(candIdx + 1);
    }
    return;
  }
  console.log(ts(), type);
});

ws.on("error", (e) => {
  console.error(ts(), "WS error:", e.message);
  process.exit(1);
});
ws.on("close", (code, reason) => {
  console.log(ts(), "WS close", code, reason.toString().slice(0, 200));
  if (!finished) process.exit(1);
});

function sendCandidate(i) {
  candIdx = i;
  ws.send(JSON.stringify(CANDIDATES[i]));
  const fmt = CANDIDATES[i].session.audio.input.format;
  console.log(
    ts(),
    `sent session.update candidate #${i} (model=${MODEL}, format=${JSON.stringify(fmt) ?? "default"})`,
  );
}

async function maybeStream() {
  if (streamed) return;
  streamed = true;
  await streamAudio();
}

async function streamAudio() {
  const { fmt, samples } = loadWav(WAV_PATH);
  console.log(
    ts(),
    `WAV: ${fmt.sampleRate}Hz ${fmt.channels}ch ${fmt.bitsPerSample}bit -> ${TARGET_RATE}Hz mono`,
  );
  const mono = resample(
    toMono(samples, fmt.channels),
    fmt.sampleRate,
    TARGET_RATE,
  );
  const perChunk = (TARGET_RATE * CHUNK_MS) / 1000;
  const totalMs = Math.round((mono.length / TARGET_RATE) * 1000);
  console.log(
    ts(),
    `streaming ~${totalMs}ms of audio in ${CHUNK_MS}ms chunks, NO commit yet...`,
  );
  for (let start = 0; start < mono.length; start += perChunk) {
    const end = Math.min(start + perChunk, mono.length);
    ws.send(
      JSON.stringify({
        type: "input_audio_buffer.append",
        audio: int16ToBase64(mono, start, end),
      }),
    );
    await sleep(CHUNK_MS);
  }
  console.log(
    ts(),
    `done appending. Waiting ${GRACE_MS}ms WITHOUT commit to watch for pre-commit deltas...`,
  );
  await sleep(GRACE_MS);
  console.log(
    ts(),
    firstDeltaAt === null
      ? "...no deltas yet (pre-commit). Sending commit now."
      : "...(deltas already seen pre-commit). Sending commit now.",
  );
  commitSentAt = Date.now();
  ws.send(JSON.stringify({ type: "input_audio_buffer.commit" }));
  console.log(ts(), "sent input_audio_buffer.commit");
  setTimeout(finish, COMPLETE_TIMEOUT_MS);
}

function finish() {
  if (finished) return;
  finished = true;
  console.log("\n===== VERDICT =====");
  if (firstDeltaAt === null) {
    console.log(
      "No transcription deltas were received before completion/timeout.",
    );
    console.log(
      "If a `completed` arrived, the model transcribes on commit but streamed no deltas this run;",
    );
    console.log(
      "if nothing arrived, check the ERROR events above (session shape / model / URL).",
    );
  } else if (firstDeltaBeforeCommit) {
    console.log("PRE-COMMIT DELTAS: YES  ->  deltas stream BEFORE commit.");
    console.log(
      "=> You can use the simpler SINGLE-commit-at-stop design (no periodic commits, no word-splitting).",
    );
  } else {
    console.log("PRE-COMMIT DELTAS: NO  ->  deltas only started AFTER commit.");
    console.log(
      "=> The plan's PERIODIC-commit design is required for live text.",
    );
  }
  try {
    ws.close();
  } catch {
    // already closed / closing — the verdict is printed, nothing left to do
  }
  setTimeout(() => process.exit(0), 250);
}

// ---------- WAV helpers ----------
function loadWav(path) {
  const buf = fs.readFileSync(path);
  if (
    buf.toString("ascii", 0, 4) !== "RIFF" ||
    buf.toString("ascii", 8, 12) !== "WAVE"
  )
    fail("Not a RIFF/WAVE file.");
  let off = 12,
    fmt = null,
    dataOff = -1,
    dataLen = 0;
  while (off + 8 <= buf.length) {
    const id = buf.toString("ascii", off, off + 4);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === "fmt ") {
      fmt = {
        audioFormat: buf.readUInt16LE(body),
        channels: buf.readUInt16LE(body + 2),
        sampleRate: buf.readUInt32LE(body + 4),
        bitsPerSample: buf.readUInt16LE(body + 14),
      };
    } else if (id === "data") {
      dataOff = body;
      dataLen = size;
    }
    off = body + size + (size % 2);
  }
  if (!fmt || dataOff < 0) fail("Missing fmt/data chunk.");
  if (fmt.audioFormat !== 1)
    fail(
      `Only PCM WAV supported (got format ${fmt.audioFormat}). Convert: ffmpeg -i in -ar 24000 -ac 1 -c:a pcm_s16le out.wav`,
    );
  if (fmt.bitsPerSample !== 16)
    fail(`Only 16-bit PCM supported (got ${fmt.bitsPerSample}-bit).`);
  const data = buf.subarray(
    dataOff,
    dataOff + Math.min(dataLen, buf.length - dataOff),
  );
  const samples = new Int16Array(data.length >> 1);
  for (let i = 0; i < samples.length; i++) samples[i] = data.readInt16LE(i * 2);
  return { fmt, samples };
}

function toMono(samples, channels) {
  if (channels <= 1) return samples;
  const frames = Math.floor(samples.length / channels);
  const out = new Int16Array(frames);
  for (let i = 0; i < frames; i++) {
    let acc = 0;
    for (let c = 0; c < channels; c++) acc += samples[i * channels + c];
    out[i] = Math.max(-32768, Math.min(32767, Math.round(acc / channels)));
  }
  return out;
}

function resample(int16, srcRate, dstRate) {
  if (srcRate === dstRate) return int16;
  const ratio = dstRate / srcRate;
  const outLen = Math.floor(int16.length * ratio);
  const out = new Int16Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const pos = i / ratio;
    const i0 = Math.floor(pos);
    const i1 = Math.min(i0 + 1, int16.length - 1);
    const frac = pos - i0;
    out[i] = Math.round(int16[i0] * (1 - frac) + int16[i1] * frac);
  }
  return out;
}

function int16ToBase64(int16, start, end) {
  const b = Buffer.alloc((end - start) * 2);
  for (let i = start; i < end; i++) b.writeInt16LE(int16[i], (i - start) * 2);
  return b.toString("base64");
}

function fail(msg) {
  console.error("ERROR:", msg);
  process.exit(1);
}
