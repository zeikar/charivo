import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4176";

// Reuse the realtime voice fixture: a canned WAV fed into Chromium's fake
// microphone so the streaming transcriber has deterministic speech to stream.
//
// Unlike the server-VAD suites, this one deliberately LOOPS the fixture (no
// `%noloop`): the transcription session runs with `turn_detection: null`, so no
// server VAD needs the trailing silence, and stop is driven by our own single
// commit. Looping keeps speech available whenever session setup finishes, which
// removes the setup-vs-speech race instead of merely narrowing it.
const wavPath = fileURLToPath(
  new URL("tests/webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);

export default defineConfig({
  testDir: "./tests/streaming-stt-smoke",
  testMatch: ["**/*.spec.ts"],
  timeout: 120_000,
  expect: {
    timeout: 30_000,
  },
  fullyParallel: false,
  retries: 0,
  use: {
    ...devices["Desktop Chrome"],
    baseURL,
    permissions: ["microphone"],
    launchOptions: {
      args: [
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
        `--use-file-for-fake-audio-capture=${wavPath}`,
        "--autoplay-policy=no-user-gesture-required",
        "--mute-audio",
      ],
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        browserName: "chromium",
      },
    },
  ],
  webServer: {
    command:
      "pnpm exec vite --config tests/streaming-stt-smoke/vite.config.ts --host 127.0.0.1 --port 4176 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
