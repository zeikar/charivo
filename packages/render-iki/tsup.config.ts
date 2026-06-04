import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { defineConfig } from "tsup";

// bundle the unpublished sibling so the output is self-contained
const here = dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  entry: ["src/renderer.ts"],
  format: ["esm"],
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  tsconfig: "./tsconfig.json",
  noExternal: [/^@iki\//],
  esbuildOptions(options) {
    options.alias = {
      "@iki/engine": resolve(
        here,
        "../../../iki/packages/engine/dist/index.mjs",
      ),
      "@iki/format": resolve(
        here,
        "../../../iki/packages/format/dist/index.mjs",
      ),
    };
  },
});
