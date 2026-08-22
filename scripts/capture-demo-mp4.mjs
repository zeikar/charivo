// Records the demo as an MP4 with sound, for places that play video.
//
//   pnpm demo:mp4 ["question"] [out.mp4]
//
// The GIF recorder next door films the same choreography and is the one the
// README uses; this exists because a GIF cannot carry the voice, and the voice
// is half of what a lip-sync demo is showing. The two are deliberately separate
// programs: capturing 30fps video plus an audio track shares almost nothing
// with grabbing PNGs one screenshot at a time. What they DO share is the
// choreography and the selectors below -- if the demo's composer or bubbles
// change, both files need the edit.
//
// How the two tracks are obtained, since neither is obvious:
//
//   - Video comes from CDP `Page.startScreencast`, not `page.screenshot()`. A
//     screenshot costs about 120ms round trip, which caps the GIF recorder near
//     8fps; the browser pushes screencast frames instead. It only pushes on
//     change, so frames arrive unevenly and every one is kept with its own
//     timestamp -- the concat list below turns those into real durations rather
//     than pretending the rate was constant.
//   - Audio is the remote WebRTC track, taken by patching `RTCPeerConnection`
//     before any page script runs. The realtime client never puts its <audio>
//     element in the DOM, so there is nothing to query for; intercepting the
//     peer connection is what is left. Nothing in the app or the library is
//     touched to make this work.
//
// The two are muxed at the end, offset by the difference between the first
// frame's timestamp and the moment the recorder actually started. Sync is the
// weak point of capturing them separately -- check the result before trusting
// it, because lip sync makes a small drift obvious.
//
// Needs: the demo serving with a working OPENAI_API_KEY, and `ffmpeg` on PATH.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const QUESTION =
  process.argv[2] ||
  "You're live on the internet right now -- say hi to everyone!";
const OUT_MP4 = resolve(
  process.argv[3] || join(PROJECT, "docs", "images", "demo.mp4"),
);

const FPS = Number(process.env.FPS || 30); // the encode rate; capture is variable
const WIDTH = Number(process.env.WIDTH || 1280);
const SPEAK_MS = Number(process.env.SPEAK_MS || 8_000);
const THINK_MS = Number(process.env.THINK_MS || 1200);
const CRF = process.env.CRF || "20";
// KEEP_WORK=1 leaves the JPEGs and the audio on disk, so the mux can be retried
// at another offset without paying for a second reply.
const KEEP_WORK = process.env.KEEP_WORK === "1";

// Shared with capture-demo-gif.mjs. See the note at the top before editing.
const REPLY_TEXT = ".z-10.pointer-events-none p.text-sm";
const COMPOSER = 'input[type="text"]';
const LISTENING = "Listening — speak or type";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Counts rendered replies. Caps at 3: MessageBubbles keeps the last three. */
const repliesIn = (selector) => document.querySelectorAll(selector).length;

/* global MediaRecorder, Blob, btoa, performance -- this function runs in the page */

/**
 * Runs before any page script. Wraps RTCPeerConnection so the remote audio
 * track can be recorded, and exposes start/stop hooks for the driver. A Proxy
 * rather than a plain function so `instanceof` and the prototype chain survive.
 */
function installAudioTap() {
  const Original = window.RTCPeerConnection;
  let remote = null;
  const waiting = [];

  window.RTCPeerConnection = new Proxy(Original, {
    construct(target, args) {
      const pc = Reflect.construct(target, args);
      pc.addEventListener("track", (event) => {
        if (event.track.kind !== "audio" || !event.streams[0]) {
          return;
        }
        remote = event.streams[0];
        for (const resolve of waiting.splice(0)) {
          resolve(remote);
        }
      });
      return pc;
    },
  });

  const remoteStream = () =>
    remote
      ? Promise.resolve(remote)
      : new Promise((resolve) => waiting.push(resolve));

  let recorder = null;
  const chunks = [];

  window.__charivoStartAudio = async () => {
    const stream = await remoteStream();
    recorder = new MediaRecorder(stream, {
      mimeType: "audio/webm;codecs=opus",
    });
    recorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        chunks.push(event.data);
      }
    };
    const started = new Promise((resolve) => {
      recorder.onstart = resolve;
    });
    recorder.start();
    await started;
    // Epoch milliseconds, to line up against the screencast frame timestamps.
    return performance.timeOrigin + performance.now();
  };

  window.__charivoStopAudio = async () => {
    if (!recorder) {
      return null;
    }
    const stopped = new Promise((resolve) => {
      recorder.onstop = resolve;
    });
    recorder.stop();
    await stopped;
    const bytes = new Uint8Array(
      await new Blob(chunks, { type: "audio/webm" }).arrayBuffer(),
    );
    let binary = "";
    for (const byte of bytes) {
      binary += String.fromCharCode(byte);
    }
    return btoa(binary);
  };
}

async function main() {
  const workDir = mkdtempSync(join(tmpdir(), "charivo-mp4-"));
  const silence = join(workDir, "silence.wav");
  writeSilentWav(silence);

  const browser = await chromium.launch({
    headless: false,
    args: [
      "--autoplay-policy=no-user-gesture-required",
      // Muting the speakers does not mute the track: MediaRecorder taps the
      // stream, so the reply is still recorded while the room stays quiet.
      "--mute-audio",
      "--hide-scrollbars",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${silence}`,
    ],
  });

  let captured = false;
  let muxed = false;
  try {
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    await page.addInitScript(installAudioTap);
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    await page
      .locator("canvas")
      .waitFor({ state: "attached", timeout: 30_000 });
    const composer = page.locator(COMPOSER);
    await composer.waitFor({ timeout: 30_000 });
    await sleep(2500);

    const placeholderReads = (want, timeout) =>
      page.waitForFunction(
        ({ selector, text }) =>
          document.querySelector(selector)?.placeholder === text,
        { selector: COMPOSER, text: want },
        { timeout },
      );

    // The call is placed before filming: connecting shows nothing worth
    // watching, and the audio track only exists once it is up.
    await page
      .getByRole("button", { name: "Start voice conversation" })
      .click();
    await placeholderReads(LISTENING, 60_000);

    // Frames arrive on change, each with the timestamp it was swapped at.
    const cdp = await context.newCDPSession(page);
    const frames = [];
    cdp.on("Page.screencastFrame", (frame) => {
      const file = join(
        workDir,
        `f${String(frames.length).padStart(5, "0")}.jpg`,
      );
      writeFileSync(file, Buffer.from(frame.data, "base64"));
      frames.push({ file, at: frame.metadata.timestamp });
      cdp
        .send("Page.screencastFrameAck", { sessionId: frame.sessionId })
        .catch(() => {}); // the session is gone once the run ends; harmless
    });

    const audioStartedAt = await page.evaluate(() =>
      window.__charivoStartAudio(),
    );
    await cdp.send("Page.startScreencast", {
      format: "jpeg",
      quality: 92,
      maxWidth: WIDTH,
      maxHeight: Math.round((WIDTH * 720) / 1280),
      everyNthFrame: 1,
    });

    // Beat 1 - idle, gaze following the cursor.
    for (const [x, y] of [
      [1000, 300],
      [520, 260],
      [760, 430],
    ]) {
      await page.mouse.move(x, y, { steps: 12 });
      await sleep(180);
    }

    // Beat 2 - the question is typed in.
    await composer.click();
    for (const ch of QUESTION) {
      await composer.type(ch, { delay: 0 });
      await sleep(20);
    }
    await sleep(400);

    // Beat 3 - one Enter only. The realtime path clears the composer after it
    // accepts the send, so a second press would ask the same question twice.
    const before = await page.evaluate(repliesIn, REPLY_TEXT);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      ({ selector }) => document.querySelector(selector)?.value === "",
      { selector: COMPOSER },
      { timeout: 15_000 },
    );
    await sleep(THINK_MS);

    // Beat 4 - the reply renders. Unlike the GIF, the wait is filmed: cutting
    // the video would cut the audio with it, and a gap is worse than a pause.
    await page.waitForFunction(
      ({ selector, n }) => document.querySelectorAll(selector).length > n,
      { selector: REPLY_TEXT, n: before },
      { timeout: 240_000 },
    );

    // Beat 5 - spoken, so the mouth moves. Ends when the session offers to
    // listen again, or at the ceiling, whichever comes first.
    const stillSpeaking =
      (await composer.getAttribute("placeholder")) !== LISTENING;
    const spoken = stillSpeaking
      ? await placeholderReads(LISTENING, SPEAK_MS).then(
          () => true,
          () => false,
        )
      : true;
    await sleep(400);

    await cdp.send("Page.stopScreencast");
    const audioB64 = await page.evaluate(() => window.__charivoStopAudio());
    captured = true;

    const reply = await page.evaluate(
      ({ selector }) =>
        (
          [...document.querySelectorAll(selector)].at(-1)?.textContent || ""
        ).trim(),
      { selector: REPLY_TEXT },
    );

    await browser.close();

    if (!frames.length) {
      throw new Error("the screencast produced no frames");
    }
    if (!audioB64) {
      throw new Error(
        "no audio was captured -- the remote track never arrived",
      );
    }

    const audioFile = join(workDir, "audio.webm");
    writeFileSync(audioFile, Buffer.from(audioB64, "base64"));

    // Audio started before the screencast did, so the offset is negative as
    // often as not; ffmpeg accepts either sign.
    const offset = audioStartedAt / 1000 - frames[0].at;
    const seconds = frames.at(-1).at - frames[0].at;

    console.log(`\nreply (${reply.length} chars): ${reply}`);
    console.log(
      `frames: ${frames.length} over ${seconds.toFixed(1)}s ` +
        `(${(frames.length / seconds).toFixed(1)}fps avg), ` +
        `audio offset ${(offset * 1000).toFixed(0)}ms` +
        (spoken ? "" : ", SPEAK_MS hit while still speaking"),
    );

    // Real per-frame durations, because the screencast rate is not constant.
    const listFile = join(workDir, "frames.txt");
    const lines = frames.map((frame, i) => {
      const next = frames[i + 1];
      const duration = next ? next.at - frame.at : 1 / FPS;
      return `file '${frame.file}'\nduration ${duration.toFixed(6)}`;
    });
    // The concat demuxer ignores the last entry's duration unless the file is
    // repeated, which would otherwise drop the final frame.
    lines.push(`file '${frames.at(-1).file}'`);
    writeFileSync(listFile, lines.join("\n"));

    mkdirSync(dirname(OUT_MP4), { recursive: true });
    execFileSync(
      "ffmpeg",
      [
        "-y",
        "-f",
        "concat",
        "-safe",
        "0",
        "-i",
        listFile,
        "-itsoffset",
        offset.toFixed(6),
        "-i",
        audioFile,
        "-map",
        "0:v",
        "-map",
        "1:a",
        "-c:v",
        "libx264",
        "-profile:v",
        "high",
        "-pix_fmt",
        "yuv420p",
        "-crf",
        CRF,
        "-r",
        String(FPS),
        "-c:a",
        "aac",
        "-b:a",
        "128k",
        "-shortest",
        "-movflags",
        "+faststart",
        OUT_MP4,
      ],
      { stdio: "inherit" },
    );
    muxed = true;
    console.log(`\nwrote ${OUT_MP4}`);
  } finally {
    await browser.close(); // no-op once the capture above has closed it
    if (KEEP_WORK || (captured && !muxed)) {
      console.log(`work kept at ${workDir}`);
    } else {
      rmSync(workDir, { recursive: true, force: true });
    }
  }
}

/**
 * Writes silence for Chromium's fake microphone to loop. Without a file it
 * plays a test tone, which server-side turn detection hears as a person
 * talking -- the model would answer the tone instead of the typed question.
 */
function writeSilentWav(path, seconds = 60) {
  const rate = 48_000;
  const bytes = seconds * rate * 2; // mono, 16-bit
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.alloc(bytes)]));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
