import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { workspaceAliases } from "./test-aliases";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    exclude: [
      ...configDefaults.exclude,
      "tests/live-realtime/**",
      "tests/webrtc-smoke/**",
    ],
    coverage: {
      provider: "v8",
      all: true,
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.d.ts", "**/*.d.mts", "**/*.d.cts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        // Global thresholds are the repo-wide floor. Package globs are ratcheted
        // from current measured coverage and should only move upward as tests improve.
        statements: 60,
        branches: 75,
        functions: 80,
        lines: 60,
        "packages/core/src/**/*.{ts,tsx}": {
          statements: 79,
          branches: 77,
          functions: 58,
          lines: 79,
        },
        "packages/llm-client-openai/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/llm-client-openclaw/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/llm-client-remote/src/**/*.{ts,tsx}": {
          statements: 92,
          branches: 69,
          functions: 81,
          lines: 92,
        },
        "packages/llm-client-stub/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/llm-core/src/**/*.{ts,tsx}": {
          statements: 96,
          branches: 79,
          functions: 98,
          lines: 96,
        },
        "packages/llm-provider-openai/src/**/*.{ts,tsx}": {
          statements: 86,
          branches: 68,
          functions: 78,
          lines: 86,
        },
        "packages/llm-provider-openclaw/src/**/*.{ts,tsx}": {
          statements: 82,
          branches: 66,
          functions: 73,
          lines: 82,
        },
        "packages/realtime-client-openai/src/**/*.{ts,tsx}": {
          statements: 73,
          branches: 61,
          functions: 73,
          lines: 73,
        },
        "packages/realtime-core/src/**/*.{ts,tsx}": {
          statements: 82,
          branches: 70,
          functions: 82,
          lines: 82,
        },
        "packages/render-core/src/**/*.{ts,tsx}": {
          statements: 86,
          branches: 72,
          functions: 94,
          lines: 86,
        },
        "packages/render-live2d/src/**/*.{ts,tsx}": {
          statements: 35,
          branches: 63,
          functions: 82,
          lines: 35,
        },
        "packages/render-stub/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/shared/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/stt-core/src/**/*.{ts,tsx}": {
          statements: 98,
          branches: 97,
          functions: 98,
          lines: 98,
        },
        "packages/stt-provider-openai/src/**/*.{ts,tsx}": {
          statements: 91,
          branches: 97,
          functions: 78,
          lines: 91,
        },
        "packages/stt-transcriber-openai/src/**/*.{ts,tsx}": {
          statements: 86,
          branches: 97,
          functions: 81,
          lines: 86,
        },
        "packages/stt-transcriber-remote/src/**/*.{ts,tsx}": {
          statements: 86,
          branches: 73,
          functions: 73,
          lines: 86,
        },
        "packages/stt-transcriber-web/src/**/*.{ts,tsx}": {
          statements: 90,
          branches: 86,
          functions: 81,
          lines: 90,
        },
        "packages/tts-core/src/**/*.{ts,tsx}": {
          statements: 85,
          branches: 73,
          functions: 82,
          lines: 85,
        },
        "packages/tts-player-openai/src/**/*.{ts,tsx}": {
          statements: 77,
          branches: 97,
          functions: 58,
          lines: 77,
        },
        "packages/tts-player-remote/src/**/*.{ts,tsx}": {
          statements: 88,
          branches: 84,
          functions: 73,
          lines: 88,
        },
        "packages/tts-player-web/src/**/*.{ts,tsx}": {
          statements: 82,
          branches: 68,
          functions: 79,
          lines: 82,
        },
        "packages/tts-provider-openai/src/**/*.{ts,tsx}": {
          statements: 86,
          branches: 85,
          functions: 83,
          lines: 86,
        },
      },
    },
    environmentMatchGlobs: [
      ["packages/**/__tests__/**/*.dom.test.{ts,tsx}", "jsdom"],
    ],
  },
  resolve: {
    alias: workspaceAliases,
  },
});
