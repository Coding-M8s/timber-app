# Releasing

A release is one tag. Pushing a tag such as `v0.2.0` runs
`.github/workflows/release.yml`, which builds the app on Linux and Windows
and opens a draft GitHub Release with both installers, the update files,
and their checksums. A person checks the draft and publishes it. Installed
apps update to it once it is published (see
[updating the app](architecture.md#updating-the-app)).

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
   `linux-x64-Timber-Setup.tar.gz`, `win-x64-Timber-Setup.zip`, the update
   files (`stable-linux-x64-Timber.tar.zst`, `stable-linux-x64-update.json`,
   `stable-linux-x64-update-v2.json`, and the same three for `win`), and
   `SHA256SUMS.txt`. Its notes are `.github/release-notes.md` followed by
   the pull requests GitHub lists since the last release. Install each
   build on a clean machine and start it before publishing.
5. **Publish the draft, as the latest release and not as a pre-release.**
   Installed apps look only at the newest published release that is not a
   pre-release (`releases/latest/download`), so a pre-release, or a draft,
   is never offered to them. Within six hours of publishing, an installed
   app built with the update address is meant to find it, download it, and
   offer "Restart to update". An update from one published release to the
   next has not been run yet; record the first one in
   [verification](verification.md).

## What the workflow does

- **Builds on the platform it targets.** `build-linux` runs on Ubuntu 24.04
  and `build-windows` on Windows Server 2025. Each installs with the frozen
  lockfile, checks that the tag is `v` plus the version in `package.json`
  (`scripts/check-release-tag.ts`), runs `bun run typecheck` and `bun run test`,
  then `bun run build`. Linux also runs `bun run typecheck:desktop` and
  puts the pinned Timber on PATH, as CI does, so the tests that need Timber
  run there; on Windows they are skipped, as in CI.
- **Ships Timber inside the app.** `bun run build` downloads the Timber
  release pinned in `timber-pin.json` for the platform, checks each file's
  SHA-256 against the pin, and stops when one does not match, so no draft
  is made (see [the bundled Timber](architecture.md#the-bundled-timber)).
  Timber's `LICENSE` and `THIRD_PARTY_NOTICES.txt` go into the app beside
  it.
- **A failing check stops the release.** The release job needs both build
  jobs, so a failed check, test, or build on either platform leaves no
  draft. Fix it on `main`, then move the tag: `git push origin :v0.2.0`,
  tag again, and push.
- **Attaches what installed apps update from.** Each build checks with
  `ls` that its bundle and both update manifests are in `artifacts/`, and
  uploads them beside the installer. Their names are fixed: the updater
  asks for them by name under `release.baseUrl`. A missing one fails the
  build, and `sha256sum` fails the release job, so no draft lacks them.
- **Only the release job can write.** The workflow reads the repository;
  the release job alone gets `contents: write`, to create the draft. It
  writes `SHA256SUMS.txt` with `sha256sum` and calls
  `gh release create --draft --verify-tag`.
- **Actions are pinned to commits**, as in CI. A test checks this for every
  workflow, and that CI and the release test with the pinned Timber.
- **A pull request that changes the workflow, `package.json`, `bun.lock`,
  `timber-pin.json`, or `scripts/fetch-timber.ts` runs the builds** without the release job, so a version or a
  dependency that breaks a build shows before a tag does.

## Raising the bundled Timber

The app ships the Timber release named in `timber-pin.json`, and nothing
else names it. Raise it in a pull request of its own, reviewed like any
other change.

1. **Write the new pin.** Set `version` without the `v`, and copy each
   SHA-256 from the release's `SHA256SUMS` files: the four binaries
   (`timber-v<version>-linux-x64`, `-windows-x64.exe`, `-darwin-arm64`,
   `-darwin-x64`), `LICENSE`, and `THIRD_PARTY_NOTICES.txt`.

   ```bash
   gh release download v0.1.5 -R Coding-M8s/timber -p 'SHA256SUMS*' -D /tmp/timber-sums
   cat /tmp/timber-sums/SHA256SUMS*
   ```

2. **Check it builds.** `bun run fetch:timber` downloads the new files and
   fails on any checksum that does not match. Then run `bun run test`, which
   runs the pin tests, and `bun run build`.
3. **Read Timber's license again.** If `LICENSE` changed, update the
   license text in Settings, About (`AboutSection.tsx`).
4. **Try it in the built app**, with no other Timber on PATH and Settings,
   Timber, Executable on the bundled Timber: About shows the new version,
   bundled; then list a repository, create a worktree with New, open a
   branch with Open, rebase a worktree, and remove one with Done.
5. **Record what was run** in the pull request: the commands, the platform,
   and what each step showed.

The pull request also runs the release builds, because it changes
`timber-pin.json`.

## Not in a release yet

- **Signing.** The builds are unsigned for the beta, and the release notes
  say so. On Windows, SmartScreen is expected to warn about the unsigned
  installer ("Windows protected your PC"); "More info", then "Run anyway",
  installs it.
- **macOS.** Not built.
- **A canary channel.** It can follow later with `bun run build:canary`.
