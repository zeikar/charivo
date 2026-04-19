import { defineConfig } from "tsup";

export default defineConfig({
  entry: [
    "src/index.ts",
    "src/remote/index.ts",
    "src/openai/index.ts",
    "src/web/index.ts",
  ],
  format: ["cjs", "esm"],
  dts: true,
  clean: true,
  target: "es2022",
});
