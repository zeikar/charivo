import { defineConfig, devices } from "@playwright/test";

// 4173 webrtc, 4174 voice, 4175 cascade, 4176 streaming-stt.
const baseURL = "http://127.0.0.1:4177";

export default defineConfig({
  testDir: "./tests/gemini-live-smoke",
  testMatch: ["**/*.spec.ts"],
  // Two live turns in one session, each gated on a real model reply.
  timeout: 180_000,
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
        // A fake device and muted output are the right instrument for the
        // plumbing this suite covers. They also remove the acoustic path
        // entirely, so echo and the convergence gate stay in the harness
        // README's hand-driven protocol.
        "--use-fake-ui-for-media-stream",
        "--use-fake-device-for-media-stream",
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
      "pnpm exec vite --config tests/gemini-live-smoke/vite.config.ts --host 127.0.0.1 --port 4177 --strictPort",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
