import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve charivo packages and the render-iki adapter to their SOURCE — so this
// harness exercises the real adapter code with no build step. The Iki engine is
// an ordinary npm dependency and resolves normally. This page is local-only; it
// is never part of CI (`build:web` builds only examples/web).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@charivo/core": r("../../packages/core/src/index.ts"),
      "@charivo/render": r("../../packages/render/src/index.ts"),
      "@charivo/render-iki": r("../../packages/render-iki/src/renderer.ts"),
    },
  },
});
