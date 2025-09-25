import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/renderer.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
});
