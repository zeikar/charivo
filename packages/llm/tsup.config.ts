import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/remote/index.ts",
    "src/openai/index.ts",
    "src/openclaw/index.ts",
    "src/stub/index.ts",
  ],
  format: ["cjs", "esm"],
  // consumed by scripts/check-packages.mjs to prove @charivo/core stays external
  metafile: true,
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
