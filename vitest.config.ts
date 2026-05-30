import { configDefaults, defineConfig } from "vitest/config";
import path from "node:path";
import { workspaceAliases } from "./test-aliases";
import type { Plugin } from "vite";

// vite-node 2.1.x normalizes "node:sqlite" to "sqlite" (stripping the
// prefix) because "sqlite" is not yet in Node's legacy builtinModules list.
// This plugin intercepts the bare "sqlite" id and provides the actual module
// content by requiring it via Node's module system.
const nodeSqliteShimPlugin: Plugin = {
  name: "node-sqlite-shim",
  enforce: "pre",
  resolveId(id) {
    if (id === "sqlite") {
      return "\0node-sqlite-shim";
    }
  },
  load(id) {
    if (id === "\0node-sqlite-shim") {
      // Re-export the node:sqlite built-in's named exports via a CommonJS
      // interop trick so vite-node can import DatabaseSync from it.
      return [
        `import { createRequire } from "node:module";`,
        `const _req = createRequire(import.meta.url);`,
        `const _sqlite = _req("node:sqlite");`,
        `export const DatabaseSync = _sqlite.DatabaseSync;`,
        `export const StatementSync = _sqlite.StatementSync;`,
      ].join("\n");
    }
  },
};

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
  plugins: [nodeSqliteShimPlugin],
  resolve: {
    alias: workspaceAliases,
  },
});
