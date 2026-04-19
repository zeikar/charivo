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
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
