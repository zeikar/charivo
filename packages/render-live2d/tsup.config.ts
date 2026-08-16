import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/renderer.ts"],
  format: ["esm"],
  // Live2D Open Software License §5.1/§5.7 forbid removing *or modifying* license
  // and copyright notices in the redistributed code. The per-file headers in
  // src/cubism/ and Framework/src/ carry no @license/@preserve marker, so esbuild
  // strips them while bundling — this banner is what actually reaches the
  // published dist. It reproduces those notices verbatim rather than paraphrasing
  // them, since a paraphrase is itself a modification.
  // Marked /*! so downstream re-bundlers preserve it as a legal comment.
  banner: {
    js: `/*!
 * @charivo/render-live2d bundles Live2D Cubism SDK for Web components.
 * The notices below are reproduced verbatim from the bundled sources.
 *
 * Live2D Cubism Framework (Framework/src/) and the sample-derived code in
 * src/cubism/:
 *
 *   Copyright(c) Live2D Inc. All rights reserved.
 *
 *   Use of this source code is governed by the Live2D Open Software license
 *   that can be found at https://www.live2d.com/eula/live2d-open-software-license-agreement_en.html.
 *
 * Live2D Cubism Core (live2dcubismcore.min.js), whose own notice also travels
 * inside this bundle alongside the Core source:
 *
 *   Live2D Cubism Core
 *   (C) 2019 Live2D Inc. All rights reserved.
 *
 *   This file is licensed pursuant to the license agreement below.
 *   This file corresponds to the "Redistributable Code" in the agreement.
 *   https://www.live2d.com/eula/live2d-proprietary-software-license-agreement_en.html
 *
 * Do not remove or modify these notices. Shipping a product built on this code
 * may require a Live2D Publication License or Cubism SDK Release License —
 * see LICENSE.md in this package.
 */`,
  },
  // consumed by scripts/check-packages.mjs to prove @charivo/core stays external
  metafile: true,
  dts: false,
  clean: true,
  sourcemap: true,
  treeshake: true,
  tsconfig: "./tsconfig.json",
  esbuildOptions(options) {
    // Treat .min.js as raw text so it's not processed as an ESM module.
    // This is required for live2dcubismcore.min.js which relies on var declarations
    // being global scope (classic script behaviour), not module scope.
    options.loader = {
      ...options.loader,
      ".min.js": "text",
    };
  },
});
