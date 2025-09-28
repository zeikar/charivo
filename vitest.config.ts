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
      "@charivo/render-live2d": resolvePackage(
        "packages/render-live2d/src/index.ts",
      ),
      "@charivo/render-stub": resolvePackage(
        "packages/render-stub/src/index.ts",
      ),
      "@charivo/shared": resolvePackage("packages/shared/src/index.ts"),
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
