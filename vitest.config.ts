import { defineConfig } from "vitest/config";
import path from "node:path";

const resolvePackage = (packagePath: string) =>
  path.resolve(__dirname, packagePath);

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: ["./vitest.setup.ts"],
    coverage: {
      reporter: ["text", "json-summary", "html"],
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
