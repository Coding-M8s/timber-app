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
   Creating a worktree and opening an existing branch are built (see
   [creating and opening worktrees](#creating-and-opening-worktrees)).
2. **Git is asked directly only for read-only status that Timber does not
   report.** Today that is which repository a folder belongs to, how each
   branch stands against its upstream, and which branches there are to offer
   for picking. Git is invoked as an executable plus an argument array.

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
  A branch Git did not answer about has none either, and its row says "sync
  unknown" instead of looking up to date, and so does the workspace header.
  The counts are as of the last fetch, because the app does not fetch yet.
- **Row markers.** `describeRowMarkers` in `src/mainview/format.ts` is pure
  and turns one worktree into the markers its row shows, each with a kind, a
  short text, and a sentence in plain words. `WorktreeRow` only draws them.
  Beside the branch: a down arrow and an up arrow with counts, "local only",
  "upstream gone", or "sync unknown". Below it: "detached HEAD", "folder
  missing" or "status unknown", "locked", and "prunable". At the end: the
  counts, such as `3M` and `1U`. A clean worktree that is level with its
  upstream has no markers, and a status or upstream state that could not be
  read always has one, so an empty row never means "not known".
- **What the counts count.** They are the lengths of Timber's `modified` and
  `untracked` lists. `M` is one for each entry `git status` shows for a
  tracked file, staged or not: modified, added, deleted, renamed (once, under
  the new name), or in conflict. `U` counts untracked files one by one, as
  `git status --untracked-files=all` does, so a new folder with two files is
  `2U` where plain `git status` shows one line. Ignored files are left out.
- **Tooltips.** Each marker carries its sentence as a tooltip. A row is one
  button, so a marker cannot take focus or a role of its own. The markers are
  hidden from assistive technology, and the button is described
  (`aria-describedby`) by all of their sentences in a row. Its name stays the
  branch and the kind of checkout.
- **Failures.** A repository that Git can read but Timber could not list
  comes back with `failure` set to the diagnostic and no worktrees. The store
  keeps the worktrees it listed last, and the sidebar shows the diagnostic
  under the repository's header with the command that failed. The next read
  that works clears it. Whether a saved folder is a repository at all is
  still Git's answer, so a missing folder is unavailable, not a failure.

### Commands that report through a result file

New, open, done, and rebase say how they ended in a result file, not on
standard output. One helper runs all of them, so no dialog reads a result its
own way: `runTimberWithResultFile` in `src/bun/timber-run.ts`. Creating and
opening worktrees use it (see [below](#creating-and-opening-worktrees)), and
so does the Done dialog (see [removing a worktree](#removing-a-worktree)).

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
- **An approval file.** `timber __ide-done apply` also reads a file. The
  helper writes the bytes it is given, unchanged, to a new file beside the
  result file, in the same private folder, readable by this user only, and
  removes it with the folder. It is shown as `<approved preview>`.

### Removing a worktree

Done runs Timber's native cleanup approval: a preview that changes nothing,
then a removal that is tied to that one preview. The app never works out by
itself what is safe to delete. It shows what the preview says, and Timber
decides, both when it previews and again when it removes.

- **Entry.** The Done control in the workspace header opens the dialog for
  the selected worktree. For the primary checkout the control is disabled
  with the reason. Timber refuses the primary checkout anyway, and the main
  process does not rely on the interface's check.
- **Preview.** Opening the dialog runs
  `timber __ide-done preview [--keep-branch] [--keep-ignored] [--base=<ref>] -- <registered path>`
  in the primary checkout (`src/bun/done.ts`). It runs no script and removes
  nothing, and it is stopped after 30 seconds. Standard output is the
  preview, read by the pure `readDonePreview` in `src/shared/timber-done.ts`:
  one version 1 record with a snapshot, `expiresAt`, the repository, the
  worktree with its modified, untracked, and ignored files, and the options
  as Timber understood them. A refusal exits with 1 and says why on standard
  error, and that line is shown as it is. A preview for another path or other
  options than were asked for is not used.
- **Which worktrees.** Both commands act only on a repository in the app's
  list (`RepositoryList.find`) and on a path that `timber ls --json` lists
  for it at that moment. That registered path, verbatim, goes after `--`.
  Neither runs while Timber is not ready.
- **What is shown.** The exact folder and branch, every modified and
  untracked file, the ignored paths and how far the removal reaches for them,
  whether the local branch is deleted or kept, that nothing on a remote is
  touched, both commands, and until when the preview holds. The preview says
  nothing about commits, and the removal deletes a branch whose commits are
  nowhere else. So the dialog adds one sentence from what the list already
  shows: never published, upstream deleted, or commits to push.
- **Two wordings.** Modified or untracked files, or such commits, make it
  "Delete anyway?" with Keep. Otherwise it is a plain confirmation. This only
  chooses the words. In both, focus starts on the button that keeps the
  worktree, Enter in a field never removes, and the one Remove button is the
  only thing that does.
- **Options.** Keep branch, keep ignored files, and base are the preview's
  flags. Changing one takes the preview off the screen at once and asks for a
  new one. Every question takes a ticket, so an older answer never replaces a
  newer one (`src/mainview/store/done-session.ts`). Remove is possible only
  for a preview that is on screen, is for the options on screen, and has not
  expired.
- **Where the preview is kept.** In the main process. The interface gets the
  parsed preview to show and a name for it, never the text. On Remove it sends
  the name back, and the main process writes the bytes Timber printed,
  unchanged, to the approval file. So the interface cannot alter what is
  approved, and the name ties the approval to the one preview that was on
  screen. Timber itself compares only the snapshot, the expiry, the target,
  and the options, so an approval sent back by the interface could have had
  its file list rewritten unnoticed. A name is used up by one call, whatever
  came of it, and at most 16 previews are kept.
- **Remove.** `timber __ide-done apply --approval-file <approved preview>
  --result-file <temporary file> -- <same path>` through the helper above,
  with no time limit, because scripts that run before deletion take as long
  as they take. Timber refuses when the worktree no longer matches the
  snapshot, and when the preview is older than ten minutes. The dialog does
  not let an expired preview be submitted, and the main process refuses one
  before running anything.
- **After every outcome** the store reads the repository again before it
  answers (`applyDone` in `src/mainview/store/store.ts`), also after a
  failure and after an engine that could not answer, because the folder can
  be gone while the branch remains. Nothing is ever tried again by itself.
  After a failure the dialog shows Timber's diagnostic and a new preview,
  which needs a new press of Remove. When the worktree is no longer in the
  list, as after a partial failure, the dialog says so and offers only Close.
  The same holds when a worktree leaves the list for any other reason while
  its dialog is open.
- **Live sessions.** The app has no terminal or agent sessions yet, so there
  is nothing to warn about. The warning's place is `LiveSessionsWarning` in
  `src/mainview/components/DoneDialog.tsx`, which shows nothing today.

### Creating and opening worktrees

`timber new` and `timber open` are the `newWorktree` and `openWorktree`
capabilities of the `Engine` contract.

- **One source for the command.** `src/shared/worktree-commands.ts` builds the
  arguments from a request, and is pure. The interface words the command in a
  dialog's footer from that function, and the main process runs Timber from
  the same function with the real result file, so the command shown is the
  command that runs.
- **The arguments.** Options first, then `--`, then what the person typed as
  one argument: `new [--base <ref>] --result-file <path> --no-editor
  --no-agent -- <name>` and `open [--setup] --result-file <path> --no-editor
  --no-agent -- <selector>`. Text that starts with a dash is therefore never
  read as an option. Both launch flags are always passed, so an editor or an
  agent configured in Timber does not start.
- **Running.** `src/bun/worktree-commands.ts` runs the command in the
  repository's primary checkout. It refuses a request whose parts are not
  the text and flags the command is built from, refuses a path that is not a
  repository in the app's list, runs nothing while Timber is not ready, runs the
  commands of one repository one after another, and never logs what a
  command printed or what it answered. It checks nothing about a name, a
  base, or a folder: those rules are Timber's.
- **The answer.** A `WorktreeCommandResult` (`src/shared/model.ts`).
  Succeeded needs a checked record with exit code 0 that names a worktree.
  A failure says whether the worktree was created all the same
  (`materialized` in Timber's record) and which worktree Timber reported, by
  the same identity the list uses and with the exact path for a later
  command.
- **Afterwards.** The store's `newWorktree` and `openWorktree` ask the engine
  once, read that repository again after every outcome, including a request
  that threw, and select the reported worktree when the list has it, by its
  identity or else by its registered path in that repository. Nothing is
  retried.

The New worktree dialog (`src/mainview/components/NewWorktreeDialog.tsx`)
opens from the "+" on a repository's header and names that repository in its
title. It is a frame around modes (`components/worktree-modes`): each mode
brings its fields, the exact command it is about to run, and what running it
means, and the frame draws the selected one in one `OperationDialog`. The
switch between modes sits beside the title. Switching puts a failure away,
keeps what was typed in each mode, and is not possible while a command runs.

"New branch" is the first mode, with a name and an optional start point.

- A failure before anything was created keeps the form open with Timber's
  diagnostic, for example for a name or a base that is ambiguous.
- A failure after the worktree was created is reported as created, setup
  failed. The worktree is in the list and selected, the form is replaced by
  that news, and the dialog offers "Open with setup". That runs `timber open
  --setup` on the exact path Timber reported, shown in the footer before it
  runs like every other command. The dialog does not suggest creating again.
- What setup scripts printed is in the failure's details area and is never
  read by the app.
- Left out of the agreed mock on purpose: the checkboxes that start an agent
  or an editor, which are later tickets and would go against `--no-editor
  --no-agent`, and a line predicting the branch and the folder, which only
  Timber can know.

"Existing branch" is the second mode: `timber open` for a branch, a ticket
key, or a worktree path, with an optional "Rerun setup" that adds `--setup`.

- **The selector.** Typed, or picked from the list under the field. The
  spaces around it are left off, as for the name in "New branch", and nothing
  else about it is changed or checked: Timber alone decides what it means,
  and its own guidance is shown when it knows no match or several.
- **Branches to pick from.** The `listBranches` capability. One read-only
  `git for-each-ref` over `refs/heads` and `refs/remotes` (`readBranches` in
  `src/bun/git-engine.ts`, parsed by `parseBranchList`) lists local branches
  by name and remote-tracking branches as `<remote>/<branch>`, the form
  Timber itself names in its guidance. Only symbolic refs such as
  `origin/HEAD` are left out. A remote-tracking branch is listed even when a
  local branch of the same name exists, which Timber refuses to open by the
  remote name; its message says so. The list is a help and never the only
  way in: when it cannot be read, the field is plain text. It is read when
  the dialog opens and again whenever the repository was read again.
- **A worktree that was already there** is selected, nothing is created, and
  the toast says it was opened.
- **A failure that still names a worktree**, which is a setup step that
  failed, is reported as that, with the worktree selected in the list. The
  fields change to its exact path with "Rerun setup" ticked, so the next run
  the person starts cannot create anything.

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
  the latest reload error, the toasts, the layout, the tab that shows, and
  which dialog is open (`dialog`, one at a time, changed by `openDialog` and
  `closeDialog`, drawn by `components/Dialogs.tsx`). `state.ts` is the data and the pure rules,
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
- **Trying it.** In `bun run dev:web` the "+" on a repository opens the New
  worktree dialog against the mock engine, which acts out `timber new` and
  `timber open` and runs nothing; `timberMock.endCommands` below chooses how
  they end. In `/work/timber` the mock has a few branches without a worktree
  to open. The Done button in the workspace header opens the Done dialog,
  which the mock engine acts out as well. Adding `?feedback=demo` to the address still shows the older
  sample dialog. The desktop app never loads that one.

In `bun run dev:web` the browser console has `timberMock` for acting out the
main process: `timberMock.setRepositories(list)`,
`timberMock.announceChange("/work/timber")`,
`timberMock.failReads("Git is busy")` (pass `null` to let reads work again),
`timberMock.failTimber("/work/timber", "Not a Git repository: /work/timber")`
to make Timber fail on one repository (`null` again to undo), and `timberMock.pickFolder("/some/folder")` to choose what "Add repository"
picks (`null` acts out a closed picker).
`timberMock.endCommands(ending)` chooses how `timber new` and `timber open`
end from then on: `"succeeds"` (the start), `"refused"` (Timber refuses before
anything is created), `"ambiguous"` (Timber finds several matches for what
was typed and lists them), `"setup-fails"` (the worktree is created, then the setup
script fails), or `"no-result"` (exit code 0 and no result file). A name whose
branch is already checked out is refused whatever the ending, and so is text
for `timber open` that matches no worktree and no listed branch.
`timberMock.setBranches("/work/timber", list)` replaces the branches offered
for picking (`null` acts out a list that cannot be read).
`timberMock.failLayoutSaves("disk full")` makes saving the layout fail
(`null` again to undo).

## The shell and the saved layout

The window is a title bar over a sidebar and a workspace
(`src/mainview/components`). The words and keyboard rules of that frame are
pure functions in `src/mainview/shell.ts`.

- **Title bar.** The logo, a breadcrumb of the selected repository and
  worktree, and the command palette button.
- **Sidebar.** The filter and Refresh, one collapsible group per repository
  with a "+" for a new worktree, "Add repository" after the list, and the
  Settings cog fixed at the bottom. Its edge is a resize handle: drag it, or
  focus it and use the arrow keys, Home, and End. The width stays between 200
  and 480 pixels, and never above half the window.
- **Workspace.** A header for the selected worktree and two tabs, Workspace
  and Changes, as one tab list: the arrows, Home, and End move between tabs.
  Each tab shows an empty state until its own content exists. Which tab shows
  is in the store and is not remembered between runs.
- **Not built yet.** The palette button is disabled and says so in its
  tooltip. The "+" and the Settings cog only ask: each puts a `DialogRequest`
  in the store (`openDialog`), and the New dialog or the Settings dialog is
  what answers it.
- **Sidebar side.** The sidebar sits on the left or on the right, as chosen
  in Settings (see [preferences](#preferences-and-the-settings-dialog)). The
  window has no control for it. On the right the body is drawn workspace,
  edge, sidebar, in that order in the page itself, not by CSS, so Tab reaches
  the parts in the order they are seen. Each part keeps its key, so moving
  the sidebar keeps what it holds, such as the filter. On the right the edge
  follows the pointer the other way, and the arrow pointing at the workspace
  widens the sidebar (`sidebarWidthAfterKey` and `sidebarWidthAfterDrag` in
  `shell.ts`). Home and End still mean the narrowest and the widest. In the
  narrow layout, where the parts are stacked, a sidebar on the right goes
  below the workspace.
- **Long names.** The breadcrumb, the group headers, and the workspace header
  cut a long name short and carry the whole name in their `title`.
- **The saved layout.** The sidebar width and the collapsed groups, each
  named by the path of its primary checkout, are the `layout` part of the
  settings file (`Layout` in `src/shared/layout.ts`). The interface never
  keeps them itself: it reads them once through `loadLayout` and hands the
  whole layout to `saveLayout`. A file without a `layout` part is valid and
  means the defaults. A `layout` part that cannot be read falls back to the
  defaults part by part and never makes the file count as damaged, so it
  cannot cost the repository list.
- **One holder of the file.** The repository list and the layout save through
  the same `SettingsHolder` (`src/bun/settings.ts`), one change at a time,
  each building on what the last one saved. Removing a repository also
  forgets its collapsed group.
- **When it is saved.** Collapsing or opening a group saves at once. A resize
  shows at once and saves when the drag ends or the key is let go, never
  while it moves. One save runs at a time, and saves asked for meanwhile share
  one follow-up save of whatever is on screen by then.
- **When saving fails.** The window stays as the person arranged it. One note
  at the bottom of the sidebar says that the layout could not be saved and
  why, until it is dismissed or the next save works. It is not a toast, and
  repeated failures do not add more notes.

## Preferences and the Settings dialog

The app's own settings, such as the side of the sidebar, are chosen in the
Settings dialog and kept by the app. They are never Timber's configuration.

- **Where.** The `preferences` part of the same settings file
  (`Preferences` in `src/shared/preferences.ts`), saved through the same
  `SettingsHolder` as the repository list and the layout
  (`src/bun/preferences.ts`). A file without it is valid and means the
  defaults. A part that cannot be read falls back to its default and never
  makes the file count as damaged.
- **Kept apart from the layout.** The layout is saved whole and often,
  starting from the defaults when the person changes it before it was read.
  Preferences change only when a section is saved, so they are not part of it.
- **Saving.** `savePreferences` sends only the preferences one section
  changes. The main process merges them with what was saved last, in turn
  with every other change to the file, so one section's Save never undoes
  another's. The answer carries every preference as saved, and the store
  shows what the engine answered, never what it asked for. A failed save
  changes nothing on screen.
- **The dialog.** `src/mainview/components/SettingsDialog.tsx`, opened by the
  cog with `{ kind: "settings" }`, or at one section with `section`. The
  sections are listed down the side, in the order of `SETTINGS_SECTIONS`
  (`src/mainview/store/state.ts`), and each is one entry in `SECTION_VIEWS`.
  Each section is a `SettingsSection` with a Save of its own, as the design
  asks. Save is disabled until something differs from what is saved. What
  is applied changes when the save worked, without a restart. A failure stays
  in the section with the reason and what was chosen, ready to save again.
  Nothing in the dialog runs Timber, so it has no command footer.
- **Sections today.** Layout: the side of the sidebar, left by default.

In `bun run dev:web`, `timberMock.failPreferenceSaves("disk full")` makes
saving preferences fail (`null` again to undo).

For the Done dialog, with a worktree's path:
`timberMock.setChanges(path, { modified: ["a.ts"], untracked: ["b.ts"], ignored: ["dist/"] })`
makes a dirty worktree, and called while the dialog is open it is a change
between preview and Remove, which the removal refuses;
`timberMock.expirePreviewsAfter(5000)` makes previews expire after that many
milliseconds (`null` for ten minutes again);
`timberMock.failBranchDeletion(true)` acts out a partial failure, in which
the worktree leaves the list and the branch is not deleted; and
`timberMock.setDoneDelay(3000)` sets how long a removal takes.

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

Run for branch status in rows (issue 10), Linux x64 under WSL with Bun 1.4.2,
Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 302 tests passed and 1 was skipped (it only runs in CI). They
  cover the markers for each state, the rendered row with its tooltips, name,
  and description, and the installed Timber on a temporary repository with a
  remote. There the row's counts are compared with `git status --porcelain`
  for staged, unstaged, added, deleted, renamed, and untracked files, with
  spaces and non-ASCII characters in file names (11 and 5), and ahead and
  behind with `git rev-list --left-right --count` for branches that are
  ahead, behind, both, and level. A branch that was never pushed shows "local
  only", one whose upstream was deleted shows "upstream gone", and the clean
  primary checkout shows no markers. Every file, ref, and index is the same
  after reading as before.
- The same `bun test` with no Timber on PATH: 266 passed and 38 were skipped.
- `bun run build:web`, then the built interface in headless Chrome 133,
  driven by a temporary script (not committed): the 14 sample rows showed
  every marker, and screenshots of the sidebar were looked at. Chrome's
  accessibility tree gave each row button the branch and kind of checkout as
  its name and its markers' sentences as its description, and no marker as a
  node of its own.

Run for the New dialog (issue 6), Linux x64 under WSL with Bun 1.4.2, Git
2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 370 tests passed and 1 was skipped (it only runs in CI). The
  new ones cover the argument builders and the mapping of results, the main
  process module against stand-in executables, the store (one request, a
  reload after every outcome, selection), and the dialog in every state. Five
  run the installed Timber on temporary repositories:
  - The dialog's command and `timber new <name> --base develop --result-file
    <path> --no-editor --no-agent`, typed out and run in a twin repository,
    left the same folder, branch, and start commit, as `timber ls --json`
    and Git report them.
  - A repository that is not in the list was refused, and its worktrees and
    refs were unchanged.
  - A base found on two remotes failed with "Base branch shared is missing
    or ambiguous. Select an exact branch." and created nothing.
  - A setup script that exits with 7 gave a failure with the worktree
    created and listed, and its output in the result. `openWorktree` with
    that path and setup failed again while the script did, creating nothing,
    and succeeded in the same worktree once the script worked.
  - With an editor configured and enabled in `.timber.toml`, the dialog's
    command did not start it, and a plain `timber new` in the same
    repository did.
- By hand with the installed Timber in a temporary repository: the form with
  `--` behaved as the form in the ticket; `--base` took a value that starts
  with a dash as its value; a name that starts with a dash after `--` was
  judged as a name.
- `bun run build:web`, then the built interface driven in headless Chrome 157
  by a temporary script (not committed), against the mock engine. The "+"
  opened a modal dialog titled "New worktree in timber" with the focus in
  Name and the submit button disabled; the footer followed the fields. While
  the command ran, the fields and both buttons were disabled and a second
  submit, Escape, and Cancel changed nothing. A refused run kept the dialog
  open with the diagnostic, closed details, the typed name, and four rows. A
  run whose setup failed showed "Created fix-login-bug, setup failed", a
  fifth row that was selected, and "Open with setup" over the `timber open
  --setup` command; submitting that asked for the reported path with setup,
  closed the dialog, and showed "Setup finished in fix-login-bug". A run
  that worked closed the dialog, selected the new row, and showed "Created
  worktree fix-login-bug". Screenshots of the form, the running state, both
  failures, and the toast were looked at.

Run for the Open dialog (issue 7), on top of the New dialog, Linux x64 under
WSL with Bun 1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 426 tests passed and 1 was skipped (it only runs in CI). The
  new ones cover the branch list parser, and the branch list against a real
  temporary repository with two remotes and `origin/HEAD`, with refs, index,
  and files unchanged; a request of the wrong shape refused in the main
  process; the store finding a reported worktree by its registered path; and
  the "Existing branch" mode and both modes together on the mock engine.
  Nine run `timber open` with the installed Timber on a temporary repository:
  - A branch with no worktree got one, with the identity `timber ls --json`
    gives it. The same branch again came back as not created, with refs,
    worktrees, and folders unchanged.
  - `origin/feat/remote-only` from the branch list opened as
    `feat/remote-only`, following it.
  - With a `post_create` hook in `.timber.toml`, opening an existing worktree
    again did not run the hook, and its absolute path with `--setup` ran it a
    second time and created nothing.
  - A failing hook reported the worktree, as created on a new one and as not
    created on an existing one, with its output kept and not logged.
  - An unknown selector, and a name that two remotes have, failed with
    Timber's guidance and changed nothing. `--help`, `--setup`, and `-w`
    after `--` were judged as selectors.
  - A repository outside the list was refused and left as it was.
- By hand with the same Timber: `origin/<branch>` is refused when a local
  branch of that name exists ("Branch <branch> already exists. Use timber
  open instead.", or "is already checked out at" its worktree), while the
  plain name opens it. Timber does not trim a selector: `" name "` matched
  nothing, which is why the app leaves the spaces off.
- `bun run build:web`, then the built interface driven in headless Chrome by
  a temporary script (not committed), against the mock engine. The dialog
  opened in "New branch" with the switch beside the title. "Existing branch"
  put the focus in its field over the ten sample branches; typing narrowed
  the list, two presses of the down arrow marked the second match, and Enter
  put it in the field and the footer. Switching to "New branch" and back kept
  what was typed in both. Text with spaces around it was shown and sent
  without them. While the command ran, the fields, both buttons, and both
  sides of the switch were disabled, and Escape and a click on the switch
  changed nothing. It closed with "Created worktree chore/update-deps" and
  the new row selected; opening it again gave "Opened chore/update-deps. Its
  worktree was already there." with the same rows. An unknown selector kept
  the dialog open with the diagnostic, and switching modes put it away. The
  ambiguous ending showed Timber's two names on their own lines. A setup
  failure showed "The worktree was created, but setup failed", the new row
  selected, and the fields set to its path with "Rerun setup" ticked. With
  "New branch" at created, setup failed, "Existing branch" showed its own
  empty form, with the new branch in its list, and going back still offered
  "Open with setup". A list that cannot be read left a note and a working
  field, and at 420 pixels wide nothing overflowed sideways. No console
  errors. Screenshots of each of these were looked at.
- Before this change was put on top of the New dialog, and not repeated
  since: `bun run start` under WSLg with `XDG_CONFIG_HOME` pointing at a
  temporary folder whose settings list one temporary repository with a
  `post_create` hook, with the "Existing branch" fields driven by a temporary
  script in the main process (not committed). Over the real bridge and with
  the real Timber, opening `feat/new-one` showed the running state, which
  held through a second submit, Cancel, and Escape, then closed with a toast
  and the new row selected, and the hook had run once. Opening it again
  reported it as already there, and the hook had not run again.
  `no/such-branch` kept the dialog open with Timber's diagnostic. A branch
  whose hook fails gave "The worktree was created, but setup failed", its
  row selected, and the fields set to its path. `origin/feat/remote-only`,
  picked by a click in the list, opened as `feat/remote-only`. Nothing the
  hook printed was in the app's log. That run had one mode and no switch, an
  untrimmed selector, and the toast "Worktree created for feat/new-one". The
  window was not inspected by eye: a grab of the X display under WSLg came
  out black.

Run for the app shell (issue 9), Linux x64 under WSL with Bun 1.4.2, Git
2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 485 tests passed and 1 was skipped (it only runs in CI). They
  include the layout part of the settings file with an older file and a
  damaged layout part, saving it against a real temporary settings file
  together with adding and removing real temporary repositories, the store's
  layout, tabs, and dialog request, and the rendered shell.
- `bun run build:web`, then the built interface driven in headless Chrome 133
  by a temporary script (not committed), at 1280 by 820 and at 960 by 820.
  Selecting a worktree in the other repository changed the breadcrumb and the
  workspace header. Tab reached, in order, the filter, Refresh, each group's
  header, Remove, and "+", every row, "Add repository", the resize handle,
  the tab that shows, and the tab panel, each with the 2 pixel focus outline;
  the disabled palette button and Settings cog were skipped. On the tab list
  the right arrow showed Changes and moved focus to it, a second one wrapped
  to Workspace, and End and Home worked. On the resize handle five repeats of
  the right arrow widened the sidebar from 272 to 352 pixels with no save
  until the key was let go, then one; End gave 480 and Home 200. A pointer
  drag of 88 pixels gave 360 with no save while it moved and one on release,
  and drags far past either side stopped at 480 and 200. Collapsing a group
  by click and by Enter hid its rows and reached the mock engine. "+" opened
  nothing. With saves failing, three changes left one note and no toast. With
  very long names the breadcrumb, the group header, and at 960 wide the
  workspace header were cut short with the whole name in `title`, the page
  did not scroll sideways, and with the sidebar at its widest the workspace
  kept 479 pixels at 960 wide. The console stayed empty. Screenshots of the
  default view, both widths with long names, the focused handle, the Changes
  tab, and the note were looked at.
- `bun run start` under WSLg, twice, with `XDG_CONFIG_HOME` pointing at a
  temporary folder that held an older settings file with one repository and
  no layout, and a temporary script and log lines in the main process (not
  committed). The first run read the default layout, three right-arrow keys
  on the handle and a click on the group header led to two saves, and the
  file then held the repository and the layout with a width of 288 and the
  group collapsed. That width showed that keys sent in one go were counted
  from a stale width, which was then fixed. The second run read that layout
  back, the same keys gave 336, and the file held 336 with the group open
  and the repository still listed. The window was not inspected by eye in
  these runs.

Run for the Done dialog (issue 8), Linux x64 under WSL with Bun 1.4.2, Git
2.43, and Timber 0.1.1:

- `timber __ide-done preview` and `apply` by hand against temporary
  repositories, to learn what they really print: a clean worktree, modified,
  staged, renamed, untracked, and ignored files, an unpublished commit, a
  detached HEAD, a locked worktree, the primary checkout, every option, a
  change after the preview, an approval with altered options, an expired
  one, and a folder of refs made read-only so that deleting the branch
  fails. The output is recorded in `tests/fixtures/timber-done`.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 602 tests passed and 1 was skipped (it only runs in CI). With
  the installed Timber on temporary repositories they check that the preview
  lists the files `git status --porcelain` shows and leaves every file, ref,
  and index as it was; that Remove deletes the folder and the branch, and
  only the folder with keep branch; that a change after the preview, the
  primary checkout, a locked worktree, another repository, a path Timber
  does not list, a preview for another worktree, an expired preview, and an
  altered approval are all refused with nothing removed; that a real partial
  failure is reported with the folder gone and the branch in place; that the
  temporary folder is empty afterwards; and that nothing is logged. With no
  usable Timber (`TIMBER_APP_TIMBER_PATH` pointing nowhere): 333 passed and
  53 were skipped.
- `bun run build:web`, then the built interface with the mock engine, driven
  in headless Chrome 133 over its debugging protocol by a temporary script
  (not committed). Done was disabled on the primary checkout with the
  reason. A clean worktree got the plain confirmation, with focus on Cancel,
  and Enter there closed the dialog and removed nothing. Enter in the base
  field asked for a preview with `--base=main` and removed nothing, and
  Remove was disabled until that preview arrived. A dirty worktree got
  "Delete anyway?" with its files and focus on Keep. With a file added
  through `timberMock.setChanges` while the dialog was open, Remove showed
  the running state, during which Escape did nothing, and then Timber's
  refusal above a new preview that listed the new file, with the row still
  in the list and focus back on Keep. Remove on that preview closed the
  dialog, took the row away, and showed the toast. A partial failure showed
  Timber's diagnostic, the row gone, and only Close. A preview set to expire
  after 1.5 seconds disabled Remove until "Preview again". A worktree taken
  off the list while its dialog was open left only Close. The console had no
  errors or warnings. Screenshots of each state were looked at.

Run for the sidebar side (issue 11), Linux x64 with Bun 1.4.2 and Git 2.43.
The installed Timber was 0.1.0-dev.0, older than required, so the tests that
run Timber were skipped:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 567 tests passed, 80 were skipped, none failed. The new ones
  cover reading, merging, and writing preferences, an older settings file,
  a damaged preferences part, saving preferences against a real temporary
  settings file at the same time as adding a real temporary repository and
  saving the layout (all three parts kept, the repository unchanged), the
  store keeping only what the engine saved, a first read that answers after
  a save, the keys and the drag on either side, and the rendered order of
  the parts on either side.
- `bun run dev:web` in the built-in browser of the Claude desktop app,
  driven by hand and by short scripts in the page. With "feat" typed in the
  filter, Settings opened at Layout with Left chosen and Save disabled.
  Choosing Right and Save moved the sidebar to the right at once and showed
  "Saved", and the filter still held "feat". On the edge, two presses of the
  left arrow gave 304 pixels from 272, the right arrow then gave 288, and a
  pointer drag of 64 pixels to the left gave 352. Tab went from the
  Workspace tab to the tab panel, the edge, then the filter. With
  `timberMock.failPreferenceSaves("disk full")`, choosing Left and Save
  showed "Could not save" with "disk full", and the sidebar stayed on the
  right. At 600 pixels wide the workspace was on top and the sidebar below
  it, with nothing scrolling sideways. The console had no errors.
  Screenshots of each of these were looked at.

Not run yet:

- The sidebar side in the desktop window, and the side read back from the
  settings file after restarting the desktop app. Only the mock engine and
  the main process module in tests were run.
- Branch status rows in the desktop window, and a row read out by a screen
  reader. Tooltips were checked as `title` attributes, not seen on hover.
- The New worktree dialog with both modes in the desktop window. "New
  branch", and so `timber new` through the helper and the RPC bridge, was
  never run from inside the running desktop app, and "Existing branch" was
  run there only before the two were put together (see above).
- A ticket key as the selector of `timber open`. No tracker was configured
  in the test runs.
- An agent configured in Timber. It needs a terminal to start at all, so no
  test could show the difference `--no-agent` makes.
- A ticket name that is ambiguous across trackers or remotes, which needs a
  network. The ambiguous case that was run is the base.
- A pointer drag of the resize handle in the desktop window, and the shell's
  keyboard use there. Only headless Chrome was driven that way.
- The Done dialog in the desktop window, and so the helper from inside the
  running desktop app. The main process module was run by the tests only.
- A removal with scripts that run before deletion configured in Timber.
- A toast after adding or removing a repository in the desktop window. Only
  the sample dialog's toast was run there.
- The stand-in executables of the helper's tests on Windows.
- Anything on macOS.
- A native Linux desktop session, on Wayland or X11. Only WSLg has been run.
