// Records the README demo GIF by driving the web demo in a real browser.
//
//   pnpm demo:gif ["question"] [out.gif]
//
// The demo has to be serving already: `pnpm dev:web` in another terminal, or
// BASE_URL pointed somewhere else (the deployed demo works too). Playwright
// drives the page, frames are grabbed as PNGs, and ImageMagick assembles them.
// Three things are worth knowing before editing:
//
//   - The browser is headed on purpose. The character is WebGL, and a real GPU
//     draws her the way a visitor sees her; headless falls back to SwiftShader.
//   - The reply wait is only partly filmed. The hold after send (THINK_MS)
//     shows the typing indicator, and the remote chat route usually answers
//     inside it. Anything slower -- the OpenClaw route, a cold model -- stops
//     the capture and resumes when the reply renders, because no GIF should sit
//     through a 20s wait.
//   - "Has the reply arrived" counts the <p> inside the message bubbles, not
//     the bubbles themselves: the typing indicator is a bubble too, one holding
//     three bouncing dots and no <p> at all.
//
// Needs: the demo serving against a working OPENAI_API_KEY -- it pays for both
// the reply and the speech -- and `magick` on PATH.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";

const PROJECT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BASE_URL = process.env.BASE_URL || "http://localhost:3000";
const QUESTION =
  process.argv[2] || "Hi! Introduce yourself in one line, with a big smile!";
const OUT_GIF = resolve(
  process.argv[3] || join(PROJECT, "docs", "images", "demo.gif"),
);

const FPS = Number(process.env.FPS || 8); // ~8 is the ceiling; a screenshot costs ~120ms
const WIDTH = Number(process.env.WIDTH || 900); // GIF width; frames come in at 2x for retina
const SPEAK_MS = Number(process.env.SPEAK_MS || 10_000);
// How long the typing indicator is filmed before the capture cuts away. The
// remote chat route answers inside this often enough that the cut usually costs
// nothing, and when it does not, it is the difference between an 11s GIF and a
// 30s one.
const THINK_MS = Number(process.env.THINK_MS || 2500);
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

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Counts rendered replies. Caps at 3: MessageBubbles keeps the last three. */
const repliesIn = (selector) => document.querySelectorAll(selector).length;

async function main() {
  const frameDir = mkdtempSync(join(tmpdir(), "charivo-frames-"));

  const browser = await chromium.launch({
    headless: false,
    args: [
      // The character speaks without anyone clicking play, and the recording
      // machine should not have to hear it.
      "--autoplay-policy=no-user-gesture-required",
      "--mute-audio",
      "--hide-scrollbars",
    ],
  });

  let captured = false;
  let assembled = false;
  try {
    // 1280x720 at 2x lands on 900x506 once the frames are resized down.
    const context = await browser.newContext({
      viewport: { width: 1280, height: 720 },
      deviceScaleFactor: 2,
    });
    const page = await context.newPage();
    await page.goto(BASE_URL, { waitUntil: "domcontentloaded" });

    await page
      .locator("canvas")
      .waitFor({ state: "attached", timeout: 30_000 });
    const composer = page.getByPlaceholder("Type your message...");
    await composer.waitFor({ timeout: 30_000 });
    await sleep(2500); // let the model load and settle into its idle loop

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

    // Beat 3 - send, then hold on the typing indicator. The canvas and the
    // composer both render before the Charivo instance finishes initializing, and
    // until it does the demo's send handler returns without doing anything -- no
    // request, no typing indicator, and the composer still holding the question.
    // A single Enter can therefore be swallowed whole, and the capture would then
    // spend the full reply timeout waiting on an answer nobody asked for. The
    // cleared composer is the demo's own signal that a send actually landed, so
    // press until it clears. Re-pressing is safe: a swallowed send changes no
    // state, and once one lands the composer never refills.
    const before = await page.evaluate(repliesIn, REPLY_TEXT);
    const landedWithin = async (ms) => {
      for (let waited = 0; waited < ms; waited += 50) {
        if ((await composer.inputValue()) === "") {
          return true;
        }
        await sleep(50);
      }
      return false;
    };
    await page.keyboard.press("Enter");
    if (!(await landedWithin(500))) {
      // Still initializing. The retries are not filmed, for the same reason the
      // reply wait below is not: a cold start can take tens of seconds, and a
      // GIF that loops cannot afford to sit on a composer nobody is answering.
      await stop();
      let sent = false;
      for (let attempt = 0; attempt < 40 && !sent; attempt++) {
        await page.keyboard.press("Enter");
        sent = await landedWithin(500);
      }
      if (!sent) {
        throw new Error(
          "the composer never cleared -- the demo never accepted the question",
        );
      }
      start();
    }
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
    start();
    await sleep(SPEAK_MS);
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
      `frames: ${readdirSync(frameDir).length}, ${cutMs}ms of waiting cut at frame ${cut}`,
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
    if (
      (KEEP_FRAMES || (captured && !assembled)) &&
      readdirSync(frameDir).length > 0
    ) {
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
