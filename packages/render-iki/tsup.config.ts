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
});
