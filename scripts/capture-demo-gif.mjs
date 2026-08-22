// Records the README demo GIF by driving the web demo in a real browser.
//
//   pnpm demo:gif ["question"] [out.gif]
//
// It films the realtime route, not the chat route: it opens the voice call and
// then types, because a realtime session starts speaking almost the moment the
// text lands. Chaining an LLM to a TTS pass answers the same question several
// seconds later, and those seconds are the whole difference between a demo that
// looks alive and one that looks like it is buffering.
//
// The demo has to be serving already: `pnpm dev:web` in another terminal, or
// BASE_URL pointed somewhere else (the deployed demo works too). Playwright
// drives the page, frames are grabbed as PNGs, and ImageMagick assembles them.
// Four things are worth knowing before editing:
//
//   - The browser is headed on purpose. The character is WebGL, and a real GPU
//     draws her the way a visitor sees her; headless falls back to SwiftShader.
//   - The call needs a microphone even though nobody speaks into it -- the
//     realtime client always opens one. Chromium's stand-in plays a test tone,
//     and with server-side turn detection the model would answer that tone, so
//     it is fed a silent WAV instead. The only input is the typed question.
//   - "Listening -- speak or type" in the composer is the session's own ready
//     signal, and nothing before it proves the session is up. Wait for it, then
//     press Enter once: the realtime path clears the composer only after the
//     send is accepted, so a second Enter would ask the same question twice.
//   - "Has the reply arrived" counts the <p> inside the message bubbles, not
//     the bubbles themselves: the typing indicator is a bubble too, one holding
//     three bouncing dots and no <p> at all. The realtime draft bubble carries
//     a <p>, so the streaming reply is what ends the wait.
//
// Needs: the demo serving against a working OPENAI_API_KEY -- the realtime
// session is billed for audio -- and `magick` on PATH.
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
// Given a moment, not an instruction. Naming the expression makes the model
// shop the setExpression menu -- "with a big smile" lands F02, a broad laugh
// that reads as ambiguous once the mesh deforms -- and a merely pleasant
// question lands F01, a gentle smile that barely reads at this size. The demo's
// own session instructions ask it to "favor subtle reactions ... unless the
// moment clearly calls for emphasis", so the line has to supply that moment.
const QUESTION =
  process.argv[2] ||
  "You're live on the internet right now -- say hi to everyone!";
const OUT_GIF = resolve(
  process.argv[3] || join(PROJECT, "docs", "images", "demo.gif"),
);

const FPS = Number(process.env.FPS || 8); // ~8 is the ceiling; a screenshot costs ~120ms
const WIDTH = Number(process.env.WIDTH || 900); // GIF width; frames come in at 2x for retina
// A hard ceiling on the speaking beat. A GIF does not owe anyone the whole
// answer, so a long reply is cut off mid-word on purpose -- five seconds is
// plenty to read the lip sync and the expression, and the README image is
// cheaper for it. Filming also stops early when the reply finishes first, which
// only ever shortens the result: a short answer should not leave a still
// character on screen.
const SPEAK_MS = Number(process.env.SPEAK_MS || 5_000);
// How long the gap after send is filmed before the capture cuts away. A
// realtime session normally starts answering well inside this, so the cut
// usually never happens; it only exists so a slow session cannot pad the GIF.
const THINK_MS = Number(process.env.THINK_MS || 1200);
// The page is a smooth gradient behind a character, which 256 colours band into
// visible rings. Dithering trades those rings for noise -- and that noise lands
// on the chat bubbles too, where it eats letters. Riemersma reads nearly as
// clean as no dithering on text, rings far less, and is the smallest of the
// three. Hence the default.
const DITHER = process.env.DITHER || "Riemersma";
// How near two pixels must be to count as unchanged between frames. This is the
// single biggest lever on file size, because it lets the static marketing
// column stop being redrawn every frame.
const FUZZ = process.env.FUZZ || "3%";
// KEEP_FRAMES=1 leaves the PNGs on disk and prints the path, so the assembly
// can be retried at other settings without paying for another reply.
const KEEP_FRAMES = process.env.KEEP_FRAMES === "1";
// MessageBubbles is the only `z-10 pointer-events-none` box on the page (the
// Live2D loading overlay is pointer-events-none but sits below z-10), and only
// its real replies carry a <p>.
const REPLY_TEXT = ".z-10.pointer-events-none p.text-sm";
// The composer is the page's only text input. Addressing it by placeholder
// would not survive the call: the placeholder becomes the session status.
const COMPOSER = 'input[type="text"]';
// Exactly the "listening" state. The button's label cannot stand in for it --
// it flips to "End voice conversation" on the error state too.
const LISTENING = "Listening \u2014 speak or type";

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Counts rendered replies. Caps at 3: MessageBubbles keeps the last three. */
const repliesIn = (selector) => document.querySelectorAll(selector).length;

/**
 * Writes silence for Chromium's fake microphone to loop. Without a file it
 * plays a test tone, which server-side turn detection hears as a person
 * talking -- the model would answer the tone instead of the typed question.
 */
function writeSilentWav(path, seconds = 30) {
  const rate = 48_000;
  const bytes = seconds * rate * 2; // mono, 16-bit
  const header = Buffer.alloc(44);
  header.write("RIFF", 0);
  header.writeUInt32LE(36 + bytes, 4);
  header.write("WAVE", 8);
  header.write("fmt ", 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20); // PCM
  header.writeUInt16LE(1, 22); // channels
  header.writeUInt32LE(rate, 24);
  header.writeUInt32LE(rate * 2, 28);
  header.writeUInt16LE(2, 32);
  header.writeUInt16LE(16, 34);
  header.write("data", 36);
  header.writeUInt32LE(bytes, 40);
  writeFileSync(path, Buffer.concat([header, Buffer.alloc(bytes)]));
}

async function main() {
  const frameDir = mkdtempSync(join(tmpdir(), "charivo-frames-"));

  const silence = join(frameDir, "silence.wav");
  writeSilentWav(silence);
  // That WAV shares the directory with the frames, so frames are counted by
  // extension rather than by how many entries the directory holds.
  const frameCount = () =>
    readdirSync(frameDir).filter((name) => name.endsWith(".png")).length;

  const browser = await chromium.launch({
    headless: false,
    args: [
      // The character speaks without anyone clicking play, and the recording
      // machine should not have to hear it.
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "--hide-scrollbars",
      "--use-fake-device-for-media-stream",
      `--use-file-for-fake-audio-capture=${silence}`,
    ],
  });

  let captured = false;
  let assembled = false;
  try {
    // 1280x720 at 2x lands on 900x506 once the frames are resized down.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
      // Granted up front: a permission prompt would both stall the call and
      // land in frame.
      permissions: ["microphone"],
    });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    await page
      .locator("canvas")
      .waitFor({ state: "attached", timeout: 30_000 });
    const composer = page.locator(COMPOSER);
    await composer.waitFor({ timeout: 30_000 });
    await sleep(2500); // let the model load and settle into its idle loop

    // Beat 0 - the call is placed before any filming. Connecting takes a few
    // seconds and shows nothing worth watching, and every step below is only
    // meaningful once the session is actually up.
    /** Resolves once the composer's placeholder reads `want`. */
    const placeholderReads = (want, timeout) =>
      page.waitForFunction(
        ({ selector, text }) =>
          document.querySelector(selector)?.placeholder === text,
        { selector: COMPOSER, text: want },
        { timeout },
      );

    await page
      .getByRole("button", { name: "Start voice conversation" })
      .click();
    await placeholderReads(LISTENING, 60_000);

    let frame = 0;
    let capturing = false;
    let pump = null;
    const start = () => {
      capturing = true;
      pump = (async () => {
        const interval = 1000 / FPS;
        while (capturing) {
          const began = Date.now();
          await page.screenshot({
            path: join(frameDir, `f${String(frame++).padStart(4, "0")}.png`),
          });
          const rest = interval - (Date.now() - began);
          if (rest > 0) {
            await sleep(rest);
          }
        }
      })();
      // Nothing awaits the pump between start() and stop(), and an unhandled
      // rejection aborts the process outright -- skipping the cleanup below. The
      // swallow only defers: stop() still awaits pump and rethrows.
      pump.catch(() => {});
    };
    const stop = async () => {
      capturing = false;
      await pump;
    };

    start();

    // Beat 1 - idle, with the gaze following the cursor. Kept to three moves over
    // the stage: a GIF that loops wants to reach the point quickly, and the gaze
    // reads in about two seconds.
    for (const [x, y] of [
      [1000, 300],
      [520, 260],
      [760, 430],
    ]) {
      await page.mouse.move(x, y, { steps: 12 });
      await sleep(180);
    }

    // Beat 2 - the question is typed in. The per-character pause is small because
    // the concurrent screenshot pump already stretches this beat.
    await composer.click();
    for (const ch of QUESTION) {
      await composer.type(ch, { delay: 0 });
      await sleep(12);
    }
    await sleep(400);

    // Beat 3 - send, then hold. Exactly one Enter: the realtime path clears the
    // composer only once the send has been accepted, so pressing again while
    // that is in flight asks the same question twice. The wait for "listening"
    // above is what makes one press enough.
    const before = await page.evaluate(repliesIn, REPLY_TEXT);
    await page.keyboard.press("Enter");
    await page.waitForFunction(
      ({ selector }) => document.querySelector(selector)?.value === "",
      { selector: COMPOSER },
      { timeout: 15_000 },
    );
    await sleep(THINK_MS);

    // Beat 4 - whatever is left of the wait is not filmed.
    await stop();
    const cut = frame;
    const waitStarted = Date.now();
    await page.waitForFunction(
      ({ selector, n }) => document.querySelectorAll(selector).length > n,
      { selector: REPLY_TEXT, n: before },
      { timeout: 240_000 },
    );
    const cutMs = Date.now() - waitStarted;

    // Beat 5 - the reply is on screen and being spoken, so the mouth moves.
    // Filmed until the composer offers to listen again, which is the session
    // reporting that playback finished. Reading the placeholder once settles
    // whether there is anything left to film at all: beat 4 only returns after
    // the reply has begun rendering, so "listening" here means a reply short
    // enough to have finished already, not one that has yet to start.
    start();
    const stillSpeaking =
      (await composer.getAttribute("placeholder")) !== LISTENING;
    const spoken = stillSpeaking
      ? await placeholderReads(LISTENING, SPEAK_MS).then(
          () => true,
          () => false,
        )
      : true;
    await sleep(400); // land on stillness rather than cut on the last phoneme
    await stop();
    captured = true;

    const reply = await page.evaluate(
      ({ selector }) =>
        (
          [...document.querySelectorAll(selector)].at(-1)?.textContent || ""
        ).trim(),
      { selector: REPLY_TEXT },
    );

    await browser.close();

    console.log(`\nreply (${reply.length} chars): ${reply}`);
    console.log(
      `frames: ${frameCount()}, ${cutMs}ms of waiting cut at frame ${cut}` +
        (spoken ? "" : `, SPEAK_MS hit while still speaking`),
    );

    mkdirSync(dirname(OUT_GIF), { recursive: true });
    execFileSync(
      "magick",
      [
        "-delay",
        String(Math.round(100 / FPS)),
        "-loop",
        "0",
        join(frameDir, "f*.png"),
        "-resize",
        String(WIDTH),
        "-dither",
        DITHER,
        "-colors",
        "256",
        "-fuzz",
        FUZZ,
        "-layers",
        "Optimize",
        OUT_GIF,
      ],
      { stdio: "inherit" },
    );
    assembled = true;
    console.log(`\nwrote ${OUT_GIF}`);
  } finally {
    await browser.close(); // no-op once the capture above has closed it
    // Frames are worth keeping only when they hold a reply that was paid for:
    // either KEEP_FRAMES asked for them, or the capture finished and only the
    // assembly failed -- a missing `magick` -- which can be retried off these
    // frames. A run that died before the reply leaves nothing to reassemble.
    if ((KEEP_FRAMES || (captured && !assembled)) && frameCount() > 0) {
      console.log(`frames kept at ${frameDir}`);
    } else {
      rmSync(frameDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
