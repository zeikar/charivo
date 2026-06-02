import { defineConfig, devices } from "@playwright/test";
import { fileURLToPath } from "node:url";

const baseURL = "http://127.0.0.1:4175";

// Reuse the realtime voice fixture: a canned WAV fed into Chromium's fake
// microphone so the STT step has deterministic speech to transcribe.
const wavPath = fileURLToPath(
  new URL("tests/webrtc-smoke/fixtures/voice-smoke-input.wav", import.meta.url),
);

export default defineConfig({
  testDir: "./tests/cascade-smoke",
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
        `--use-file-for-fake-audio-capture=${wavPath}%noloop`,
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
      "pnpm exec vite --config tests/cascade-smoke/vite.config.ts --host 127.0.0.1 --port 4175 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
