import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/openai/index.ts", "src/openclaw/index.ts"],
  format: ["cjs", "esm"],
  dts: true,
  sourcemap: true,
  clean: true,
  treeshake: true,
});
