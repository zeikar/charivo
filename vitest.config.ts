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
      "tests/live-llm/**",
      "tests/webrtc-smoke/**",
      "tests/gemini-live-smoke/**",
      "tests/cascade-smoke/**",
      "tests/streaming-stt-smoke/**",
    ],
    coverage: {
      provider: "v8",
      all: true,
      include: ["packages/*/src/**/*.{ts,tsx}"],
      exclude: ["**/__tests__/**", "**/*.d.ts", "**/*.d.mts", "**/*.d.cts"],
      reporter: ["text", "json-summary", "html"],
      thresholds: {
        // Global thresholds are the repo-wide floor.
        statements: 60,
        branches: 75,
        functions: 80,
        lines: 60,
      },
    },
    environmentMatchGlobs: [
      ["packages/**/__tests__/**/*.dom.test.{ts,tsx}", "jsdom"],
    ],
  },
  resolve: {
    alias: workspaceAliases,
  },
  // The `examples/` tsconfigs say `jsx: "preserve"` because Next.js owns the
  // transform and uses the automatic runtime, so their components never import
  // React. Without this, esbuild reads those tsconfigs, falls back to the
  // classic transform, and every rendered component throws "React is not
  // defined".
  esbuild: {
    jsx: "automatic",
  },
});
