# Architecture

Timber app is a thin window over Timber and Git. This page says how it is put
together, where the line with Timber sits, what comes next, and what has
actually been run.

## Shape

```text
src/mainview   React interface, runs in the webview
      |        talks only to the Engine contract
src/shared     Engine contract, data model, typed bridge, pure parsers
      |
src/bun        Bun main process: the window, Git queries, later sessions
```

- **Interface (`src/mainview`).** React with plain CSS. It never touches Git,
  files, or processes. It asks an `Engine` (see `src/shared/engine.ts`).
- **Engine contract (`src/shared`).** The list of things the interface may ask
  for, the data model, and parsers with no side effects. Two engines answer the
  contract: the desktop one, over Electrobun's typed RPC, and a mock with
  sample data for browser work and tests.
- **Main process (`src/bun`).** Runs on Bun inside Electrobun. It owns the
  window and everything that touches the machine.

`bun run dev:web` runs the interface alone in a browser against the mock
engine. That loop needs no desktop toolchain and is the default for UI work.

### Two type checks

`bun run typecheck` is the everyday check. It needs no toolchain and applies
the full strict settings to this project's code, using a small stand-in for
the Electrobun browser SDK (`types/electrobun-web.d.ts`).

`bun run typecheck:desktop` checks the same code against the real SDK in
`.hutch/devkit`. Two things about `tsconfig.desktop.json` are deliberate:

- It lists the `electrobun/...` import paths itself instead of extending the
  devkit's own tsconfig, because that file sets `baseUrl`, which TypeScript 7
  no longer accepts. Add a line there when the app imports a new SDK entry.
- It turns `exactOptionalPropertyTypes` off, because the SDK ships as
  TypeScript source and its own files do not pass that setting.

## Boundary with Timber

Timber's safety logic must exist once. The app follows two rules:

1. **What Timber owns or changes goes through Timber's machine interface.**
   The worktree list is `timber ls --json`. New, open, rebase, and done run
   the `timber` command, and the interface shows the command before it runs.
2. **Git is asked directly only for read-only status that Timber does not
   report.** Today that is which repository a folder belongs to and how each
   branch stands against its upstream. Git is invoked as an executable plus an
   argument array.

Timber itself rules out GUI work, a daemon, and a local API inside its own
repository. That is why this is a separate repository, and why the app's
long-running parts (sessions, file watching) live here in the main process
instead of in a `timber serve` mode.

### The worktree list

The sidebar shows exactly the worktrees Timber lists, in Timber's order
(primary first, then by registered path).

- **Asking.** For each repository the main process runs `timber ls --json`
  with the repository's folder as the working directory
  (`src/bun/timber-ls.ts`), using the Timber found on start. Only standard
  output is read. The run is stopped after 10 seconds.
- **Accepting.** `src/shared/timber-ls.ts` reads the record, and is pure. A
  list is used only as a whole: the output must be one JSON record for `ls`
  with `schemaVersion` 1, the exit code in the record must be the exit code
  the process really had, and every worktree record must be readable.
  Anything else is a failure with a message, never a shorter list. Fields the
  app does not use, or that a later Timber adds within version 1, are ignored.
- **Mapping.** Each `WorktreeRecord` becomes a `Worktree` in
  `src/shared/model.ts`: branch, detached, primary, locked, prunable, whether
  the folder exists, and the changes, which are either known with their
  modified and untracked paths or unknown with Timber's reason. Ignored files
  are left out.
- **Identity.** A worktree's `id` is the common Git directory plus its
  canonical path, and the selection holds that, not a path or a branch.
  Timber gives a canonical path only for a folder it verified. For a missing
  or replaced folder the registered path stands in and is marked as such, so
  it never shares an identity with a verified folder. The registered `path`
  is kept verbatim as the exact selector for later Timber commands.
- **Upstream state.** Version 1 does not report ahead, behind, upstream gone,
  or local only. One read-only `git for-each-ref` per repository, run against
  the common Git directory from the record, gives it for every branch
  (`readBranchSync` in `src/bun/git-engine.ts`). A detached HEAD has none.
- **Failures.** A repository that Git can read but Timber could not list
  comes back with `failure` set to the diagnostic and no worktrees. The store
  keeps the worktrees it listed last, and the sidebar shows the diagnostic
  under the repository's header with the command that failed. The next read
  that works clears it. Whether a saved folder is a repository at all is
  still Git's answer, so a missing folder is unavailable, not a failure.

### Commands that report through a result file

New, open, done, and rebase say how they ended in a result file, not on
standard output. One helper runs all of them, so no dialog reads a result its
own way: `runTimberWithResultFile` in `src/bun/timber-run.ts`. No dialog calls
it yet; the New, Open, and Done dialogs are its first users.

- **The file.** Each run gets a fresh file name in a new folder that only
  this user can open, made in the system's temporary folder. Timber creates
  the file itself and refuses one that exists, so a retry never reuses a
  name. A temporary folder that turns out to lie inside the folder the
  command runs in is refused before anything runs.
- **Running.** Timber runs as an executable plus an argument array, with
  standard input closed and no time limit, because setup scripts take as long
  as they take. The file is read only after the process has ended, and the
  folder is removed whatever happened.
- **Accepting.** `src/shared/timber-result.ts` reads the file, and is pure.
  A result counts only when the file holds one `schemaVersion` 1 record for
  the command that ran, its exit code is the one the process really had, and
  outcome and exit code go together. A missing, empty, or malformed file is a
  failure even when the process exited with 0 and printed something that
  looks like success.
- **Outcomes.** Succeeded and cancelled always come from a checked record. A
  failure carries Timber's diagnostic and the record when there is one, so a
  dialog can tell "created, but setup failed" (`materialized`) from "nothing
  happened". With no usable record, what the command did is unknown: the
  message says so, and the caller reads the list again and never retries by
  itself.
- **Output.** Standard output and standard error are kept together in the
  order they arrive, but only the last 64 KiB, with terminal escape sequences
  removed (`src/shared/captured-output.ts`). It is never parsed. It is also
  private, because setup scripts can print anything: it goes to the person in
  the failure's details area and is never written to a log. Callers of the
  helper must not log it either.
- **The command shown.** `describeTimberCommand` words a command for the
  person, with `<temporary file>` where the result file goes, since its real
  name does not exist before the run. That text is for reading only.

### Finding Timber

Nothing that depends on Timber is offered until a usable one is found.

- On start the main process resolves `timber` from PATH and runs
  `timber --version`, as an executable plus an argument array
  (`src/bun/timber.ts`). It logs the result.
- The app requires Timber 0.1.1 or newer, the first release with the machine
  interface. The number and the comparison live in
  `src/shared/timber-version.ts`. A pre-release sorts before its release.
- The `Engine` contract reports one of three states: ready (path and version),
  not found, or too old (found and required versions). An executable that
  fails, or does not print a version, counts as not found.
- When Timber is not ready, the interface shows a full-window notice with
  install guidance instead of the worktree list. Retry looks again, so a Timber
  installed into a folder already on PATH is picked up without a restart. A
  change to PATH itself still needs a restart, because the app keeps the
  environment it was started with.
- For development, `TIMBER_APP_TIMBER_PATH` names the Timber executable to use.
  It takes precedence over PATH, and a broken value is reported instead of
  silently falling back.
- In `bun run dev:web`, add `?timber=not-found` or `?timber=too-old` to the
  address to see the notice.

## Saved repository list

The app keeps its own list of repositories, so it is the same after a restart.

- **Where.** One JSON file, `timber-app/settings.json`, in the per-user
  configuration directory: `$XDG_CONFIG_HOME` or `~/.config` on Linux,
  `~/Library/Application Support` on macOS, `%APPDATA%` on Windows
  (`src/bun/settings.ts`). The main process logs the path on start. Each entry
  holds the path of the primary checkout and the repository's common Git
  directory. Parsing and formatting are pure, in `src/shared/settings.ts`.
- **Saving.** The file is written whole to a temporary file beside it, flushed,
  and renamed into place, so a crash leaves the old file or the new one.
  Changes run one at a time, and memory changes only after a save worked.
- **A damaged file.** A file that is not valid settings never stops the app.
  It starts with an empty list, logs a warning, and first copies the file to
  `settings.json.damaged`, so the next save does not destroy it.
- **Adding.** "Add repository" opens the native folder picker in the main
  process (`src/bun/repository-list.ts`). Git says, read-only, whether the
  folder is inside a repository, and Timber's list names its primary
  checkout, so a linked worktree or a folder inside a checkout adds its
  repository. A folder outside any repository is refused with a message, and
  so is one that Timber cannot list, with Timber's diagnostic. The request has no time limit, because the picker stays
  open for as long as the person likes. The picker call blocks the main
  process, so other requests wait until it closes.
- **Duplicates.** Two folders are the same repository when Git reports the
  same common directory for them (`git rev-parse --git-common-dir`, with links
  resolved), whatever path was picked. Picking a listed repository again
  selects it and says so.
- **Removing.** Remove only takes the entry out of the settings file. No Git
  command runs and nothing in the repository or its folder is touched.
- **Unavailable.** A saved repository that Git cannot read at its saved path,
  because the folder is missing or is no longer a primary checkout, stays in
  the list marked unavailable, with Remove offered. It comes back on the next
  refresh once the folder does.
- **Development override.** When `TIMBER_APP_REPOS` is set (paths separated by
  `;` on Windows or `:` elsewhere), the app shows those repositories instead
  and leaves the saved list alone. Add and Remove then explain that the
  variable is set. Paths in it that are not repositories are skipped.
  A repository in it that Timber cannot list is shown under the given folder.

## Shared state and live updates

Every part of the interface reads one store, so the sidebar, the title bar,
and the workspace cannot disagree.

- **The store (`src/mainview/store`).** It holds Timber's status, the
  repositories with their worktrees, the selection, operations in progress,
  the latest reload error, and the toasts. `state.ts` is the data and the pure rules,
  `store.ts` talks to the engine, and `react.tsx` hands the store to
  components. Components call its actions and keep no copy of its data.
- **Pushed changes.** The main process reports a change by calling
  `repositoryChanges.announce(path)` in `src/bun/changes.ts`, where `path` is
  the repository's primary checkout. That becomes a `repositoryChanged`
  message over RPC, and the store reloads only that repository through
  `loadRepository`. A message for a repository that is not on screen is
  ignored. Nothing announces changes yet: deciding when a repository changed
  belongs to file watching and fetching.
- **Merging.** One reload per repository runs at a time. Reloads asked for
  meanwhile share a single follow-up reload, because the one in progress may
  have read its data before the change. The same holds for reloading
  everything.
- **Stale responses.** Each reload takes a ticket when it asks. A response is
  dropped when newer data for that repository is already on screen: a full
  list that answers late keeps a repository that was reloaded on its own
  since, and a single reload that answers after a newer full list is ignored.
- **Selection.** The selected worktree stays selected for as long as it
  exists. When it is gone the selection moves to the primary checkout of the
  same repository, and when that repository is gone too, to the first
  worktree in the list.
- **Failures.** A failed reload leaves the last good data and the selection
  alone and shows the error above the list. The next reload of the same thing
  that works clears it. A single reload that Git cannot answer counts as a
  failure, not as a removed repository; only reloading everything changes
  which repositories are listed. A repository whose worktrees Timber could
  not list is not a failed reload: see [the worktree list](#the-worktree-list).
- **Adding and removing.** After the engine adds or removes a repository the
  store reloads everything instead of patching its copy, so the screen shows
  what was saved. The added repository becomes the selection. When nothing
  changed, the reason is kept as a note below the list until it is dismissed
  or the next add or remove works.
- **Refresh.** The Refresh control reloads everything.

## Reporting outcomes

Every operation reports how it ended in the same way.

- **Toasts.** An operation that worked says so in a toast, for example
  "Added docs-site". The store holds the toasts and takes each one away after
  five seconds (`showToast` in `src/mainview/store/store.ts`); it can also be
  dismissed. Only successes are toasts. A failure stays where the person can
  act on it.
- **Dialogs.** Every dialog that runs a Timber command is an
  `OperationDialog` (`src/mainview/components`) driven by a submission
  (`src/mainview/store/submission.ts`, through `useSubmission`). The command
  is shown before it runs. While it runs, the fields and buttons are
  disabled, a progress bar shows, the dialog cannot be closed, and a second
  submission does nothing. When it worked, the dialog closes and the toast
  shows. When it failed, the dialog stays open with the failure, ready for a
  correction and a retry.
- **Failures.** A failed Timber command is always shown by
  `TimberFailureDetails`: the diagnostic, and a details area, closed at
  first, with the command and what it printed. The data is `TimberFailure` in
  `src/shared/model.ts`, which `failureOf` makes from a run of the helper
  above.
- **Trying it.** No real dialog exists yet. In `bun run dev:web`, add
  `?feedback=demo` to the address for a sample dialog that acts out
  `timber new` with a choice of endings and runs nothing. The desktop app
  never loads it.

In `bun run dev:web` the browser console has `timberMock` for acting out the
main process: `timberMock.setRepositories(list)`,
`timberMock.announceChange("/work/timber")`,
`timberMock.failReads("Git is busy")` (pass `null` to let reads work again),
`timberMock.failTimber("/work/timber", "Not a Git repository: /work/timber")`
to make Timber fail on one repository (`null` again to undo), and `timberMock.pickFolder("/some/folder")` to choose what "Add repository"
picks (`null` acts out a closed picker).

## Milestones

1. **Sidebar, read-only (this scaffold).** Repositories and the worktrees
   Timber lists, with branch status: commits to push and pull, never
   published, upstream deleted, modified and untracked counts.
2. **Sessions.** Agent and terminal panes. Each is a pseudo-terminal owned by
   the main process (`Bun.Terminal`), rendered by xterm.js. Several per
   worktree, and hidden panes keep running.
3. **Timber actions.** New and open, rebase with a base picker, done with the
   safe and "delete anyway" confirmations.
4. **Changes.** Diff against the base, the last commit, or a rebase backup.
5. **Settings.** Editor, coding assistant, scripts, layout.
6. **Background refresh.** File watching per worktree and periodic fetch.
   Detecting a force-push needs a fetch and the remote-tracking reflog.

## Open decisions

- **Timber's machine interface is experimental.** The app spawns the
  `timber` executable and reads version 1 of its JSON records, which keeps the
  two releasable apart. Timber calls that interface experimental, so a new
  schema version means a change here.
- **Rebase backups.** The design shows them, but Timber does not create backup
  branches today. Either Timber gains that, or the app creates them.
- **Application identifier.** `electrobun.config.ts` holds a placeholder.
- **Fonts.** The design uses Geist. The app should bundle it instead of
  falling back to system fonts.

## What has been verified

Record commands and results here as they are run. Do not claim more.

Run on Linux x64 with Bun 1.4.2 and Git 2.43 while writing the scaffold:

- `bun install --frozen-lockfile`: completed.
- `bun run typecheck`: no errors.
- `bun test`: 17 tests passed, including Git queries against a temporary
  repository with a linked worktree.
- `bun run build:web`: built, and the result rendered correctly in headless
  Chrome with the sample data.
- `src/bun/index.ts`, `src/shared/rpc.ts`, and the desktop engine type-check
  against the Electrobun 2.0.6 SDK sources.

Run on Windows with the Electrobun 2.0.6 toolchain:

- `bun run dev:web`: the interface opened in a browser with the sample data.
- `bun run dev`: the toolchain downloaded and the desktop window launched.
- `bun run dev:hmr` and `bun run build`: both completed.
- `bun run typecheck:desktop`: no errors against the real SDK, with
  TypeScript 7.

Run for finding Timber (issue 1), Linux x64 with Bun 1.4.2 and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 45 tests passed, including the three states and the override
  against real temporary executables.
- The CI workflow ran on the pull request for this change and passed.
- `findTimber` against the installed Timber: ready with its path and 0.1.1;
  not found with an empty PATH; ready through the override with an empty PATH.
- `bun run build:web`, and `bun run dev:web` in headless Chrome: the ready
  view and both notices rendered correctly.
- `bun run start` under WSLg (Ubuntu 24.04 on Windows): at first the window
  did not open, because the WebKitGTK runtime libraries were missing. After
  `sudo apt install libgtk-3-0 libwebkit2gtk-4.1-0 libayatana-appindicator3-1
  librsvg2-2` the window opened, found Timber, and listed this repository's
  worktree. Text fell back to a system font, because Geist is not bundled yet.

Run for the same change on Windows x64 with Bun 1.4.4, no Timber installed:

- `bun run typecheck` and `bun test`: no errors, 45 tests passed.
- `bun run start`: the window opened on the "Timber is not installed" notice.
  With a stand-in `timber.cmd` printing 0.1.0 placed on PATH, Retry showed
  "Timber is too old" with both versions. With it printing 0.1.1, Retry moved
  on to the normal view. No restart in between. A real Timber for Windows was
  not tested.

Run for shared state and live updates (issue 2), Linux x64 under WSL with Bun
1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 94 tests passed, including merged reloads, stale responses,
  selection fallback, failed reloads, and a reload against a real temporary
  repository that leaves refs, the index, and files untouched.
- `bun run build:web`, then the built interface driven in headless Chrome
  through `timberMock`: selecting a worktree updated the title bar, sidebar,
  and workspace together; an announced change refreshed that repository only
  and kept the selection; a failed Refresh kept all seven rows and showed the
  error; the next Refresh cleared it.
- `bun run start` under WSLg, with a temporary timer in the main process that
  announced changes (not committed): three announcements within 2 ms led to
  two `loadRepository` requests from the interface, a later single one led to
  one, an announcement for an unknown path led to none, and no full reload
  followed any of them. The window itself was not inspected by eye in this
  run.

Run for the saved repository list (issue 3), Linux x64 under WSL with Bun
1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 145 tests passed, including adding through a linked worktree, a
  nested folder, and a link, restarting on the same settings file, a missing
  folder, a damaged file, the override, and a check that adding, listing, and
  removing leave every file, ref, and index of the temporary repositories as
  they were.
- `bun run build:web`, and `bun run dev:web` driven in headless Chrome through
  `timberMock`: an added repository appeared and was selected, a second add
  through one of its worktrees reported it as already listed, a plain folder
  was refused with the message, the unavailable repository showed its note
  with Remove, and removing every repository left the empty state.
- `bun run start` under WSLg with `XDG_CONFIG_HOME` pointing at a temporary
  folder. The interface's own controls were clicked by a temporary script in
  the main process, and the picker was replaced by a fixed folder (neither is
  committed). Picking a linked worktree added its repository and wrote the
  settings file; picking it again answered already listed; after a restart
  the repository was listed again; a plain folder was refused; with the
  repository's folder moved away it was listed as unavailable, Remove emptied
  the saved list, and the files on disk were unchanged; a truncated settings
  file gave the warning, a `settings.json.damaged` copy, and a working app;
  with `TIMBER_APP_REPOS` set, Add answered that the list is overridden.
- The same run with the real picker: "Add repository" opened the native "Open
  File" dialog, which stayed open for 19 seconds until the app was stopped.
  Choosing a folder in that dialog by hand was not done in this run, and the
  window was not inspected by eye.

Run for the worktree list from `timber ls --json` (issue 4), Linux x64 under
WSL with Bun 1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 199 tests passed and 1 was skipped (it only runs in CI). They
  include the mapping and every failure case against output recorded from
  Timber 0.1.1, stand-in executables that replay that output with a chosen
  exit code, and the installed Timber on a temporary repository with a
  detached HEAD, a locked worktree, a missing folder, a replaced folder, and
  spaces and non-ASCII characters in paths, branches, and file names. That
  run compares the order with the table `timber ls` prints and checks that
  every file, ref, and index is left as it was.
- The same `bun test` with the v0.1.1 release installed by the command the CI
  workflow uses, a fresh home folder, and `CI=1`: 200 tests passed. With no
  Timber on PATH: 174 passed and 26 were skipped.
- `bun run build:web`, and `bun run dev:web` in headless Chrome: the sample
  data rendered with its missing-folder row marked. With two Timber failures
  acted out through `timberMock.failTimber` (by a temporary line, not
  committed), one repository showed the diagnostic above its last good rows
  and the other showed the diagnostic and no rows.
- `bun run start` under WSLg with `XDG_CONFIG_HOME` pointing at a temporary
  folder and a temporary log line in the main process (not committed): the
  interface asked for the list and got the seven worktrees of the temporary
  repository in the order `timber ls` prints them, with the detached HEAD,
  the locked worktree, the missing folder, the unknown status, and the
  non-ASCII path intact, this repository's own checkout, and a plain folder
  as unavailable. The window was not inspected by eye in this run.

Run for error and result feedback (issue 5), Linux x64 under WSL with Bun
1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 264 tests passed and 1 was skipped (it only runs in CI). They
  cover the helper against stand-in executables that write a result file as
  Timber does: success, failure, cancelled, a missing, an empty, and a cut
  result file with exit code 0, an exit code that differs from the record, a
  killed process, output beyond the limit, and that nothing is logged. After
  every one of them the temporary folder is empty and the repository folder
  is unchanged. Three tests run the installed Timber: `timber new` creates a
  real worktree and the record says so, the same command again fails with
  Timber's diagnostic, and arguments Timber refuses leave no result.
- `bun run build:web`, then the built interface with `?feedback=demo`, driven
  in headless Chrome 157 by a temporary script (not committed). While the
  sample command ran, the fields, Cancel, and the submit button were
  disabled, the progress bar showed, and a second submit, Escape, and Cancel
  changed nothing. The refused run left the dialog open with Timber's
  diagnostic and the details area closed. The run without a result file was
  reported as a failure. The run that worked closed the dialog and showed one
  toast, which was still there after 4.5 seconds and gone after 5.2. Removing
  a repository showed "Removed api-server from the list", and its dismiss
  button took it away. Screenshots of the running state, the failure with its
  details open, and the toast were looked at.

- `bun run start` under WSLg with `XDG_CONFIG_HOME` pointing at a temporary
  folder: the window opened and found Timber. Then the same with the sample
  dialog loaded in the desktop webview and driven by a temporary script
  (neither is committed): the dialog opened as a modal in the middle of the
  window, the running state disabled the fields and both buttons and held
  through a second submit, Escape, and Cancel, the refused run kept the
  dialog open with the diagnostic and closed details, and the run that
  worked closed the dialog and showed the toast in the bottom right corner,
  still there after 4.5 seconds and gone after 5.4. The window was not
  inspected by eye in this run.

Not run yet:

- The helper from inside the running desktop app. Nothing calls it yet.
- A toast after adding or removing a repository in the desktop window. Only
  the sample dialog's toast was run there.
- The stand-in executables of the helper's tests on Windows.
- Anything on macOS.
- A native Linux desktop session, on Wayland or X11. Only WSLg has been run.
