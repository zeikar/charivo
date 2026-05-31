import { defineConfig } from "vitest/config";
import path from "node:path";

import { workspaceAliases } from "../../../test-aliases";

/**
 * Eval-only vitest config. Reuses the workspace aliases (identical to the root
 * test config), but `include`s ONLY `*.eval.ts` under `src/eval`, so the eval
 * suite runs separately from the coverage-gated `pnpm test` run (whose default
 * `*.test.ts` glob never matches `*.eval.ts`). Invoked from the companion
 * `eval:memory` script. `root` is the repo root so the aliases resolve
 * identically to the root config.
 */
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: path.resolve(__dirname, "../../.."),
    include: ["examples/companion/src/eval/**/*.eval.ts"],
  },
  resolve: {
    alias: workspaceAliases,
  },
});
