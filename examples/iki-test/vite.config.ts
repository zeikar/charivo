import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

// Resolve charivo packages, the render-iki adapter, AND the sibling iki engine
// to their SOURCE — so this harness exercises the real adapter code with no
// build step. This page is local-only; it is never part of CI (`build:web`
// builds only examples/web).
const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@charivo/core": r("../../packages/core/src/index.ts"),
      "@charivo/render": r("../../packages/render/src/index.ts"),
      "@charivo/render-iki": r("../../packages/render-iki/src/renderer.ts"),
      "@iki/engine": r("../../../iki/packages/engine/src/index.ts"),
      "@iki/format": r("../../../iki/packages/format/src/index.ts"),
    },
  },
});
