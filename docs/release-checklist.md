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

## Release PR Review

- Confirm only the intended publishable packages were bumped.
- Confirm bump levels match the actual change scope.
- Review generated changelog text for accuracy and overstatement.
- Confirm private or demo-only packages are not included in the release PR.

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

- Confirm `NPM_TOKEN` is configured and has publish rights.
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
