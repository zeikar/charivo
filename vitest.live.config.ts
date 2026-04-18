import { defineConfig } from "vitest/config";
import path from "node:path";
import { workspaceAliases } from "./test-aliases";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    setupFiles: [path.resolve(__dirname, "vitest.setup.ts")],
    include: ["tests/live-realtime/**/*.test.ts"],
    testTimeout: 30_000,
  },
  resolve: {
    alias: workspaceAliases,
  },
});
