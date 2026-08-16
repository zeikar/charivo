---
"@charivo/render-live2d": minor
---

Correct the published license declaration and carry the Live2D notices into the
package.

The manifest declared `MIT`, but the published bundle is a composite work: it
contains Live2D Cubism Core under the Live2D Proprietary Software License and
Cubism Framework / sample-derived code under the Live2D Open Software License.
Both are bundled as those licenses permit — `live2dcubismcore.min.js` is listed
as Redistributable Code in `Core/RedistributableFiles.txt` — but a consumer
reading `MIT` on npm was not seeing what they actually installed. The field is
now `SEE LICENSE IN LICENSE.md`, and a new package-level `LICENSE.md` states the
per-layer terms.

The bundle also lost its copyright notices at build time. The Open Software
License forbids removing or modifying license indications and copyright notices
(§5.1, §5.7), and the per-file headers in `src/cubism/` and `Framework/src/`
carry no `@license` or `@preserve` marker, so esbuild stripped them while
bundling. A `/*!`-marked banner now reaches `dist/renderer.js` and survives
downstream re-bundling; it reproduces the notices verbatim rather than
paraphrasing them, since a paraphrase would itself be a modification. Cubism
Core was already unaffected: it is loaded through the `.min.js` text loader, so
its banner travels inside a string literal.

In the same pass, two sample-derived sources under `src/cubism/` were restored
to the upstream notice: `lappdefine.ts` had lost its Live2D notice entirely and
`lappmodel.ts` carried a reworded one. Every sample-derived file in that
directory now reproduces the upstream notice verbatim.

The vendored license and notice files (`LICENSE.md`, `NOTICE.md`,
`Core/LICENSE.md`, `Core/RedistributableFiles.txt`, `Framework/LICENSE.md`) now
ship with the package rather than being excluded by `files: ["dist"]`, so the
terms reach distributors and end users as Proprietary §5.2.2 requires.

Marked `minor` rather than `patch`: the declared license string changes, which
downstream license scanners treat as a contract change.

No runtime behavior changes.
