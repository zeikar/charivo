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

## Docs

- Confirm the root README matches the current package map and architecture.
- Confirm `examples/web/README.md` matches the actual env vars and API routes.
- Confirm package READMEs describe the current public factories, config fields, and defaults.
- Remove stale package names, nonexistent endpoints, and outdated request examples.

## Packaging

- Verify every publishable package has aligned `main`, `module`, `types`, and `exports`.
- Review `npm pack --dry-run` output through `pnpm pack:check`.
- Check that runtime dependencies are still necessary.

## Live2D

- Review the vendored Live2D Cubism SDK contents before release.
- Reconfirm the Live2D license notice is still correct for the version being shipped.

## Final Gate

- Check `git status` for unrelated or accidental generated files.
- Publish only after the verification steps are green.
