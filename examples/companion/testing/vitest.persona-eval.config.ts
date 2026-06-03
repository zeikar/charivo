import { defineConfig } from "vitest/config";
import path from "node:path";

import { workspaceAliases } from "../../../test-aliases";

// Persona-eval vitest config. This config is SEPARATE from `vitest.eval.config.ts`
// so the memory eval glob (src/eval/**/*.eval.ts) never sweeps in the persona
// suite (distinct `*.persona-eval.ts` suffix + `persona/` subdir); the suite is
// opt-in and never EXECUTED by `pnpm verify` / CI.
//
// Invoked from the companion `eval:persona` script. `root` is the repo root so
// the aliases resolve identically to the root config.
export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    root: path.resolve(__dirname, "../../.."),
    include: ["examples/companion/src/eval/persona/**/*.persona-eval.ts"],
    passWithNoTests: true,
  },
  resolve: {
    alias: workspaceAliases,
  },
});
