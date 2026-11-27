import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";
import { describe, expect, it, vi } from "vitest";

const esmPath = fileURLToPath(new URL("../dist/index.js", import.meta.url));
const cjsPath = fileURLToPath(new URL("../dist/index.cjs", import.meta.url));

function createBrain() {
  return {
    setBody: vi.fn(),
    setCharacter: vi.fn(),
    submit: vi.fn(),
    interrupt: vi.fn(async () => undefined),
    clearHistory: vi.fn(),
    getHistory: vi.fn(() => []),
  };
}

// The built entries only exist after `pnpm --filter @charivo/core build`.
describe.skipIf(!existsSync(esmPath) || !existsSync(cjsPath))(
  "brain ownership across the ESM and CommonJS entries",
  () => {
    it("refuses a brain the other format's body owns", async () => {
      const esm = await import(/* @vite-ignore */ pathToFileURL(esmPath).href);
      const cjs = createRequire(import.meta.url)(cjsPath);
      const brain = createBrain();
      new esm.Charivo().attachBrain(brain);

      expect(() => new cjs.Charivo().attachBrain(brain)).toThrow(
        /another Charivo instance/,
      );
    });
  },
);
