import { defineConfig } from "vitest/config";
import path from "node:path";

const resolvePackage = (packagePath: string) =>
  path.resolve(__dirname, packagePath);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
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
    alias: {
      "@charivo/core": resolvePackage("packages/core/src/index.ts"),
      "@charivo/llm-core": resolvePackage("packages/llm-core/src/index.ts"),
      "@charivo/llm-client-openai": resolvePackage(
        "packages/llm-client-openai/src/index.ts",
      ),
      "@charivo/llm-client-remote": resolvePackage(
        "packages/llm-client-remote/src/index.ts",
      ),
      "@charivo/llm-client-stub": resolvePackage(
        "packages/llm-client-stub/src/index.ts",
      ),
      "@charivo/llm-provider-openai": resolvePackage(
        "packages/llm-provider-openai/src/index.ts",
      ),
      "@charivo/llm-provider-openclaw": resolvePackage(
        "packages/llm-provider-openclaw/src/index.ts",
      ),
      "@charivo/llm-client-openclaw": resolvePackage(
        "packages/llm-client-openclaw/src/index.ts",
      ),
      "@charivo/realtime-client-openai": resolvePackage(
        "packages/realtime-client-openai/src/index.ts",
      ),
      "@charivo/realtime-core": resolvePackage(
        "packages/realtime-core/src/index.ts",
      ),
      "@charivo/render-core": resolvePackage(
        "packages/render-core/src/index.ts",
      ),
      "@charivo/render-live2d": resolvePackage(
        "packages/render-live2d/src/index.ts",
      ),
      "@charivo/render-stub": resolvePackage(
        "packages/render-stub/src/index.ts",
      ),
      "@framework": resolvePackage(
        "packages/render-live2d/CubismSdkForWeb-5-r.4/Framework/src",
      ),
      "@charivo/shared": resolvePackage("packages/shared/src/index.ts"),
      "@charivo/stt-core": resolvePackage("packages/stt-core/src/index.ts"),
      "@charivo/stt-provider-openai": resolvePackage(
        "packages/stt-provider-openai/src/index.ts",
      ),
      "@charivo/stt-transcriber-openai": resolvePackage(
        "packages/stt-transcriber-openai/src/index.ts",
      ),
      "@charivo/stt-transcriber-remote": resolvePackage(
        "packages/stt-transcriber-remote/src/index.ts",
      ),
      "@charivo/stt-transcriber-web": resolvePackage(
        "packages/stt-transcriber-web/src/index.ts",
      ),
      "@charivo/tts-core": resolvePackage("packages/tts-core/src/index.ts"),
      "@charivo/tts-player-openai": resolvePackage(
        "packages/tts-player-openai/src/index.ts",
      ),
      "@charivo/tts-player-remote": resolvePackage(
        "packages/tts-player-remote/src/index.ts",
      ),
      "@charivo/tts-player-web": resolvePackage(
        "packages/tts-player-web/src/index.ts",
      ),
      "@charivo/tts-provider-openai": resolvePackage(
        "packages/tts-provider-openai/src/index.ts",
      ),
    },
  },
});
