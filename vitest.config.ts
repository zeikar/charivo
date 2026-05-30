import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { workspaceAliases } from "./test-aliases";
// Test-only workaround owned by examples/companion (the sole node:sqlite
// consumer); see that file for why vite-node needs it.
import { viteNodeSqlitePlugin } from "./examples/companion/testing/vite-node-sqlite-plugin.mjs";

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
  plugins: [viteNodeSqlitePlugin()],
  resolve: {
    alias: workspaceAliases,
  },
});
