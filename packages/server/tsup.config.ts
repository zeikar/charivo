import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/openai/index.ts",
    "src/openclaw/index.ts",
    "src/gemini/index.ts",
  ],
  format: ["cjs", "esm"],
  // consumed by scripts/check-packages.mjs to prove @charivo/core stays external
  metafile: true,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
