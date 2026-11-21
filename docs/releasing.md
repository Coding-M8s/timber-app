# Releasing

A release is one tag. Pushing a tag such as `v0.2.0` runs
`.github/workflows/release.yml`, which builds the app on Linux and Windows
and opens a draft GitHub Release with both installers and their checksums.
A person checks the draft and publishes it.

## Steps

1. **Set the version.** Change `version` in `package.json`, the one place it
   is written (see [app identity](architecture.md#app-identity)), in a pull
   request, and merge it.
2. **Tag the merged commit and push the tag.**

   ```bash
   git fetch origin
   git tag v0.2.0 origin/main
   git push origin v0.2.0
   ```

3. **Wait for the workflow.** Under Actions, "Release" runs one build job
   per platform, then the release job.
4. **Check the draft.** Under Releases, the draft "Timber v0.2.0" holds
   `linux-x64-Timber-Setup.tar.gz`, `win-x64-Timber-Setup.zip`, and
   `SHA256SUMS.txt`. Its notes are `.github/release-notes.md` followed by
   the pull requests GitHub lists since the last release. Install each
   build on a clean machine and start it before publishing.
5. **Publish the draft.**

## What the workflow does

- **Builds on the platform it targets.** `build-linux` runs on Ubuntu 24.04
  and `build-windows` on Windows Server 2025. Each installs with the frozen
  lockfile, checks that the tag is `v` plus the version in `package.json`
  (`scripts/check-release-tag.ts`), runs `bun run typecheck` and `bun test`,
  then `bun run build`. Linux also runs `bun run typecheck:desktop` and
  installs the same Timber as CI, so the tests that need Timber run there; on
  Windows they are skipped, as in CI.
- **A failing check stops the release.** The release job needs both build
  jobs, so a failed check, test, or build on either platform leaves no
  draft. Fix it on `main`, then move the tag: `git push origin :v0.2.0`,
  tag again, and push.
- **Only the release job can write.** The workflow reads the repository;
  the release job alone gets `contents: write`, to create the draft. It
  writes `SHA256SUMS.txt` with `sha256sum` and calls
  `gh release create --draft --verify-tag`.
- **Actions are pinned to commits**, as in CI. A test checks this for every
  workflow, and that CI and the release install the same Timber.
- **A pull request that changes the workflow runs the builds** without the
  release job, so a broken build shows before a tag does.

## Not in a release yet

- **Signing.** The builds are unsigned for the beta, and the release notes
  say so. On Windows, SmartScreen is expected to warn about the unsigned
  installer ("Windows protected your PC"); "More info", then "Run anyway",
  installs it.
- **Update bundles.** `bun run build` also writes the `.tar.zst` bundle and
  the `update.json` files that Electrobun's updater reads. They are not
  attached; automatic updates (issue 32) will add them.
- **macOS.** Not built.
- **A canary channel.** It can follow later with `bun run build:canary`.
