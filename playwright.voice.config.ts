import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4174";
const wavPath = fileURLToPath(
  new URL("tests/webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);

export default defineConfig({
  testDir: "./tests/webrtc-smoke",
  testMatch: ["**/realtime-voice-*.spec.ts"],
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
        // Loop the canned WAV (no %noloop): the realtime session can take >2.5s
        // to go active, and the fixture's speech is at ~0.6-2.5s. Playing once
        // let the speech finish before audio streamed to the server, so server
        // VAD never heard a turn and no response came. Looping guarantees a
        // speech window lands after the session is active.
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
      "pnpm exec vite --config tests/webrtc-smoke/vite.config.ts --host 127.0.0.1 --port 4174 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
