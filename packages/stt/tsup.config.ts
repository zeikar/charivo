import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/remote/index.ts",
    "src/openai/index.ts",
    "src/gemini/index.ts",
    "src/openai-realtime/index.ts",
    "src/web/index.ts",
  ],
  format: ["cjs", "esm"],
  // consumed by scripts/check-packages.mjs to prove @charivo/core stays external
  metafile: true,
  dts: true,
  clean: true,
  target: "es2022",
});
