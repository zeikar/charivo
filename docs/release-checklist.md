# Release Checklist

Run this from the repository root before publishing public packages.

## Verification

- `pnpm install`
- `pnpm verify`
- `pnpm pack:check`
- `pnpm build:web` if the demo app changed
- `pnpm changeset status` if package changes are expected to publish

## Versioning

- Add a changeset for any publishable package change that should reach npm.
- Skip changesets for docs-only or demo-only changes that should not publish packages.
- Use `minor` for public API or contract changes.
- Use `patch` for fixes, packaging corrections, and non-breaking updates.
- Confirm the generated changeset only includes the intended publishable packages.
- At the 1.0 cut, replace each internal `workspace:^` shorthand with an explicit floor matching that dependency's own current version — not a single literal such as `workspace:^1.0.0` applied everywhere, since siblings like `@charivo/render`, `@charivo/llm`, `@charivo/stt`, and `@charivo/tts` version independently and may still be pre-1.0. Find every site with `grep -rn 'workspace:\^' packages/*/package.json`.
- The `minor` guidance above is safe only through the current `0.x` phase, where a caret like `^0.20.0` spans just `>=0.20.0 <0.21.0` — patch upgrades within the `0.20.x` line are permitted, but the next minor (`0.21.0`) is excluded. From the 1.0 cut onward, breaking changes must bump MAJOR instead of `minor` — the `workspace:^` floors above only stay safe if that discipline holds, since `^1.0.0` spans every `1.x` release.
- `updateInternalDependencies` in `.changeset/config.json` is a no-op for every `workspace:`-protocol dependency in this repo: Changesets gates its `patch`/`minor` choice on `semver.satisfies(version, depVersionRange)`, but `depVersionRange` is the raw `workspace:^1.0.0` string, which `semver` cannot parse, so `satisfies()` returns false and Changesets takes the "left its range" path before the `patch`/`minor` setting is ever consulted. (A bare `workspace:^` is then skipped by a separate check, so today no rewrite happens at all; once explicit floors exist the floor is rewritten. Either way the `patch`/`minor` value is never read.) Because of this, when a dependent's code actually requires a specific patch of `@charivo/core` or a sibling, manually raise that dependent's explicit floor (for example, `workspace:^1.0.0` to `workspace:^1.0.1` on `@charivo/core`) in the same PR as the dependent's changeset — Changesets will not do it for you.

## Release PR Review

- Confirm only the intended publishable packages were bumped.
- Confirm bump levels match the actual change scope.
- Review generated changelog text for accuracy and overstatement.
- Confirm private or demo-only packages are not included in the release PR.
- Confirm no dependent needs its explicit `workspace:^` floor manually raised for a patch shipping in this release.

## Changeset Examples

- Public package fix: a runtime bug fix in `@charivo/tts` should include a changeset.
- Docs/demo-only change: README updates or `examples/web` UI copy changes should not include a changeset.
- Multi-package contract change: a typed contract update that affects `@charivo/core` and `@charivo/realtime` can ship in one changeset covering both packages.

## Docs

- Confirm the root README matches the current package map and architecture.
- Confirm `examples/web/README.md` matches the actual env vars and API routes.
- Confirm package READMEs describe the current public factories, config fields, and defaults.
- Remove stale package names, nonexistent endpoints, and outdated request examples.

## Packaging

- Verify root-entry packages have aligned `main`, `module`, `types`, and `exports`, and keep subpath-only packages on `exports` only.
- Keep publishable packages dual-format by default, and only keep a package ESM-only when it is browser-only or there is a clear technical reason.
- Review `npm pack --dry-run` output through `pnpm pack:check`.
- Check that runtime dependencies are still necessary.

## Publish Failure Checks

- Confirm every published package still trusts `zeikar/charivo` / `release.yml`
  (`npm trust list @charivo/<pkg>` shows `createPackage`); publishing runs on
  OIDC, and the workflow upgrades the runner's npm to 11 because trusted
  publishing needs 11.5.1+. `NPM_TOKEN` is only a fallback: to use it, pass it
  back into the changesets step's `env`.
- Confirm GitHub Actions is allowed to create pull requests.
- Confirm the target version does not already exist on npm.
- Confirm the release PR was merged, not just opened.
- Confirm `pnpm verify` and `pnpm pack:check` were green before retrying.

## Live2D

- Review the vendored Live2D Cubism SDK contents before release.
- Reconfirm the Live2D license notice is still correct for the version being shipped.

## Final Gate

- Check `git status` for unrelated or accidental generated files.
- Publish only after the verification steps are green.
