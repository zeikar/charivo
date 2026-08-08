import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/renderer.ts"],
  format: ["esm"],
  // consumed by scripts/check-packages.mjs to prove @charivo/core stays external
  metafile: true,
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  tsconfig: "./tsconfig.json",
  esbuildOptions(options) {
    // Treat .min.js as raw text so it's not processed as an ESM module.
    // This is required for live2dcubismcore.min.js which relies on var declarations
    // being global scope (classic script behaviour), not module scope.
    options.loader = {
      ...options.loader,
      ".min.js": "text",
    };
  },
});
