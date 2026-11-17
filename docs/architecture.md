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
src/bun        Bun main process: the window, Git queries, terminal sessions,
               watching for changes, fetching
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

### Desktop development commands

Three commands run the desktop app from source. They differ in what is left
when the window closes, and that is deliberate.

- **`bun run start`** builds the interface once and runs the app. Closing
  the window ends the app and the command.
- **`bun run dev`** builds the interface once and runs `electrobun dev
  --watch`. Closing the window ends the app, but the watcher keeps running,
  and a later change to a watched file (such as `src/bun/index.ts`) rebuilds
  and relaunches the app with a new window. The watcher prints nothing when
  the app exits, so the terminal looks idle. Stop it with Ctrl+C. This is
  kept because it is how a watch loop is expected to behave, and because
  `electrobun dev` has no option to end with the app: its usage lists only
  `--env`, `--watch`, and the `--inspect` flags.
- **`bun run dev:hmr`** runs the Vite dev server and `bun run start` side by
  side. Nothing relaunches the app there, so when either of them ends, the
  other is stopped too (`concurrently --kill-others`; only the app ending
  first was run). Closing the window ends the whole command. It succeeds
  when the one that ended first, usually the app, exited with 0
  (`--success first`).

With a terminal session running, closing the window first asks "Quit
Timber?", so the app and the command stay until Quit.

What each of the three leaves behind was observed on Linux only.

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
   branch stands against its upstream, which branches there are to offer
   for picking, the changed files and diffs of the Changes tab (see
   [the Changes tab](#the-changes-tab)), and the status of the selected
   worktree for the background check (see
   [watching for changes](#watching-for-changes)). Git is invoked as an
   executable plus an argument array.

One thing is not read-only and does not go through Timber: **fetching** (see
[fetching](#fetching)). It writes only remote-tracking refs (`refs/remotes/`),
which Timber neither owns nor checks, and never a local branch, a tag, the
index, or a working tree. Timber has no fetch of its own to call. Everything
else that writes still goes through Timber.

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

New, open, done, rebase, and saving Timber's settings (`config`) say how they ended in a result file, not on
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
- **An input file.** `timber __ide-done apply` and `timber __app-config
  apply` also read a file. The helper writes the bytes it is given,
  unchanged, to a new file beside the result file, in the same private
  folder, readable by this user only (mode 0600), and removes it with the
  folder. It is shown as `<approved preview>` or `<settings draft>`.

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
- **Live sessions.** When a terminal runs in the worktree, the dialog says
  that removing the worktree ends it (`LiveSessionsWarning` in
  `src/mainview/components/DoneDialog.tsx`). Once Timber says the worktree is
  removed, the store closes that terminal (`applyDone` in
  `src/mainview/store/store.ts`). A failed removal leaves it running.

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
- Left out of the agreed mock on purpose: the checkbox that starts an editor,
  which is a later ticket and would go against `--no-editor`, and a line
  predicting the branch and the folder, which only Timber can know.

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

Both modes share an **Agent** field under their own fields: the agents from
Settings, Agents, in menu order, the first one picked, then None. With no
saved agents it offers only None and points to Settings. Timber still runs
with `--no-agent`. The app starts the picked agent itself
(`src/mainview/components/worktree-modes/agent-choice.ts`).

- **When it starts.** Only after a run worked and the worktree is one this
  dialog created: `timber new` that worked, `timber open` that Timber says
  created the worktree, or "Open with setup" (or Existing branch run again
  with "Rerun setup" on the kept path) that finished setup in a worktree an
  earlier run of this dialog created. A failed run starts nothing, and a
  worktree that was already there never gets an agent. A run in between
  that names no worktree, such as a refusal, does not forget that the
  dialog created it; an edit to the Existing branch fields does.
- **How it starts.** Each mode's `run` reports the worktree it created, and
  `runWithAgent` hands it to the store's `startAgentIn` without waiting. The
  dialog's controller (`worktree-modes/dialog-controller.ts`) holds the
  selected mode and the pick, takes the agent as picked when the person
  submits, and runs the submission; the component only draws it, so the
  tests drive the same wiring. That
  selects the worktree, shows the Workspace tab, and calls `openTerminal`
  with the agent's name, so the main process takes the command from the
  saved Settings, never from the dialog. The session starts at 80 by 24 and
  the pane fits it once it shows. An agent that cannot start is shown in the
  worktree's pane as for the "+" menu, never as a failure of the dialog: the
  worktree stays, and the toast still says it was created. When the list
  does not have the worktree, for example because reading it again failed,
  there is no pane, so nothing starts and the toast says so.
- **The footer.** Under the Timber command, a note and the agent's command on
  a line of their own ("Command that will start next"), never joined to the
  Timber command. Existing branch says "if this creates a worktree", because
  only Timber knows whether the text names one that is already there.

### Finding Timber

Nothing that depends on Timber is offered until a usable one is found.

- On start the main process resolves `timber` from PATH and runs
  `timber --version`, as an executable plus an argument array
  (`src/bun/timber.ts`). It logs the result.
- The app requires Timber 0.1.2 or newer, the first release with the machine
  interface including `timber __app-config` for Settings. The number and the comparison live in
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
  ignored. What announces a change is described in
  [watching for changes](#watching-for-changes).
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

## Watching for changes

The sidebar and the Changes tab follow what happens outside the app, such as
a commit in a terminal or a file saved in an editor, without a press of
Refresh. Everything here is in the main process and only reads. What it
finds becomes a `repositoryChanged` message, so the interface reloads one
repository through the path described [above](#shared-state-and-live-updates).

- **What is watched (`src/bun/repository-watcher.ts`).** For each repository
  in the list, its common Git directory: the folder itself (HEAD, the index,
  `packed-refs`, `config`), `refs` and `worktrees` recursively (each linked
  worktree keeps its HEAD and index in `worktrees/<name>`), and `reftable`
  when there is one. Working trees are never watched, so a dependency install
  or a build costs nothing here. `src/shared/git-watch.ts` decides, purely,
  which names count: lock files, logs, objects, and the scratch files of a
  commit, merge, or rebase in progress do not.
- **Which repositories.** `RepositoryList.watchTargets` gives each primary
  checkout with its common Git directory, from the saved list without asking
  Timber (or from the repositories the `TIMBER_APP_REPOS` override lists).
  The watches follow the list on start, after adding or removing a
  repository, and whenever the window comes back.
- **Grouping.** Events for one repository are reported once nothing more
  happened for 300 ms, and at the latest 2 seconds after the first, so a
  rebase or a burst of new branches is one reload, or one every 2 seconds
  while it lasts.
- **Folders that come and go.** `worktrees` exists only while there are
  linked worktrees, and its watch stops working when it is removed. Its
  appearing or going in the common directory starts the watch again. A
  folder that is not there is not an error. The common directory's own
  watch is started again the same way when the repository is removed and
  made again in place. A watch that cannot start for another reason, such
  as the system's limit on watches, is reported once as a warning with the
  folder and the reason, and tried again whenever the watches follow the
  list (see above). Until then changes in that folder are missed; the
  check of the selected worktree, getting the focus back, and Refresh
  still work.
- **Edits in the working tree (`src/bun/worktree-stamp.ts`).** Saving a file
  touches no Git metadata, so while the window shows, the selected worktree
  is checked every 4 seconds, never sooner than ten times as long as the last
  check took. The check reads `git status` with the Changes tab's options,
  plus the size and modification time of the first 200 files it lists, so
  editing a file that was already modified counts too. A different answer
  from the last one is reported as a change of that worktree's repository.
  A check that fails, or does not answer within 10 seconds, counts as not
  read and keeps the last answer to compare with.
  It runs without Timber, so it first checks that the repository is in the
  list and that Git names the repository's own common directory for the
  folder. Nothing it reads leaves the main process or is logged.
- **The window (`src/bun/refresh-policy.ts`).** The interface tells the
  engine through `attend` whether the window shows, whether it has the
  focus, and which worktree is selected, whenever one of them changes
  (`src/mainview/window-state.ts` follows the page's `visibilitychange`,
  `focus`, and `blur`). While the window is hidden nothing is reported and
  nothing is checked; repositories that changed meanwhile are reported once
  when it shows again. Showing it again, or giving it the focus back,
  also reports the selected worktree's repository, at most once in 2
  seconds. Until the window has said anything it counts as shown, so a
  webview that never sends these events still gets every change.
- **No double reloads.** Before the selected worktree's repository is
  reported, its stamp is read again, and the next check compares against
  that. So a commit is reloaded once, by the watcher, and not again by the
  check.
- **No locks.** Every read here runs Git with `GIT_OPTIONAL_LOCKS=0`, as the
  other status reads do, and Timber's `timber ls` does the same for its own
  Git calls. So the app never takes the index lock from a Git command the
  person runs, and its own reads do not rewrite the index, which would
  otherwise wake the watcher again. The check also turns `core.fsmonitor`
  off, so a background read never starts a monitor from the repository's
  configuration.
- **Not done here.** Fetching, which moves ahead and behind counts, is
  described [next](#fetching). An already open diff updates when the status
  of the worktree changes or the window gets the focus back.

## Fetching

Ahead and behind counts, "upstream gone", and "force-pushed" are only as
good as the last fetch. So the app fetches every repository in the list, in
the background and when asked, without anyone fetching by hand. This is the
one place where the app writes to a repository without Timber, and it
writes only remote-tracking refs.

- **When (`src/bun/fetcher.ts`).** Each repository is fetched about 10
  seconds after the app starts or the repository is added, 5 seconds apart
  from the next, then once per interval from the end of the last fetch. The
  interval is the Fetching section of Settings (`fetch` in the preferences,
  `src/shared/fetch-setting.ts`): 5 minutes unless something else is saved,
  any whole number of minutes from 1 to 1440, and background fetching can be
  turned off. Nothing is fetched in the background until the preferences
  were read, and with background fetching off nothing reaches the network
  until Fetch now. While the window is hidden, background fetches wait, and
  what came due runs once it shows again (the `attend` message says so).
- **One at a time.** A repository is fetched once at a time: Fetch now while
  a fetch runs waits for that one. At most two repositories are fetched at
  the same time.
- **After a failure** the next background fetch waits twice as long each
  time (10, 20, 40 minutes from a 5 minute interval), up to an hour, or up to
  the interval when that is longer. The first fetch that works puts it back.
  So being offline costs one quick failure now and then, never rapid
  retries.
- **What is fetched.** Only remotes that some local branch tracks, read from
  `git for-each-ref refs/heads` with each branch's upstream, so a remote
  nobody tracks never fails a fetch. Each is fetched with its own refspecs
  from `remote.<name>.fetch`, keeping only those that write `refs/remotes/`
  (and negative ones). They are given on the command line with an empty
  `--refmap`, so a refspec that would write a local branch or a tag is never
  used, configured or not. The command is `git --git-dir <common dir> -c
  credential.interactive=false fetch --prune --no-prune-tags --no-tags
  --no-write-fetch-head --recurse-submodules=no --no-auto-gc --refmap= --
  <remote> <refspecs>`. `--prune` removes only remote-tracking refs whose
  branch is gone from the remote, which is how "upstream gone" shows. It
  never pulls, merges, rebases, or touches a local branch, a tag, the index,
  the stash, or a working tree, and it writes no `FETCH_HEAD`, so a fetch
  that brings nothing new changes no file the watcher hears.
- **Never asking (`src/bun/fetch-git.ts`).** Git runs in a session of its
  own with nothing on standard input, so neither Git nor SSH has a terminal
  to ask on, with `GIT_TERMINAL_PROMPT=0`, `GIT_ASKPASS`, `SSH_ASKPASS`
  empty, `SSH_ASKPASS_REQUIRE=never`, and `GCM_INTERACTIVE=never`. When
  neither the environment nor the repository's `core.sshCommand` names an
  SSH command, SSH runs with `BatchMode=yes` and a 20 second connect limit.
  Stored credentials still work: credential helpers, and SSH keys without a
  passphrase or held by an agent. What a helper or an agent shows on its own
  (a keyring to unlock, a key to touch, an agent asking to approve a key) is
  up to it and cannot be turned off from here. An HTTP transfer that stalls
  for 30 seconds is given up, and a fetch is stopped after 10 minutes:
  asked to stop first, so it can remove its lock files, and killed 5
  seconds later. Quitting the app stops a running fetch the same way. Once
  Git has ended, what it printed is read for at most 2 more seconds, so a
  process it started in a session of its own cannot hold the fetch open.
- **Failures.** What Git printed is read as offline (the remote cannot be
  reached), authentication (credentials missing or refused), or failed
  (`readFetchFailure` in `src/shared/git-fetch.ts`), with any password in a
  link taken out. It shows as a quiet grey word beside the repository's
  name, "offline", "sign-in needed", or "fetch failed", with the reason in
  its tooltip. Never a dialog. It is shown, never logged, and the next fetch
  that works takes it away.
- **Force-pushed.** Before and after each fetch the app reads every
  remote-tracking ref. When the upstream of a local branch moved, `git
  merge-base --is-ancestor` asks whether its previous commit is an ancestor
  of the new one. When it is not, the branch is marked force-pushed. The
  window gets the mark on the branch's sync state (`forcePushed` in
  `SyncState`), and the row says "force-pushed" in red, with words. The mark
  stays until the person has seen it: its worktree was selected while the
  window showed and had the focus, and then the selection moved on. A mark
  that arrives on the selected worktree stays until the selection moves on.
  The interface then sends `forcePushSeen` with the mark's time, so a newer
  rewrite stays marked. A mark also goes when it is no longer true: the
  branch is gone, tracks another upstream, its upstream is gone, the
  branch is level with its upstream, or the branch moved since the rewrite
  (a pull, a reset, a rebase) and is no longer behind. The mark keeps the commit the branch was at, so a rewind
  (the upstream reset to an older commit, which leaves the branch ahead
  and not behind) stays marked: pushing would bring back what was dropped.
  A read forgets a mark only when it is the same mark (same time) that was
  there before the read began, so a fetch that marks a branch while a
  slower read runs is never undone by it. A repository that leaves the
  list while its fetch runs keeps no marks from that fetch, and one added
  again waits for it, so it is still fetched once at a time. A fetch that
  waits its turn behind two others does not run when its repository left
  the list meanwhile, nor, unless the person asked for it, when background
  fetching was turned off. A fetch of several remotes also stops before
  its next remote once its repository left the list, and a background
  fetch nobody asked for stops the same way once background fetching was
  turned off. One cut short like this does not count as a fetch that
  worked. Marks are kept in the settings file (`forcePushes`,
  `src/bun/force-pushes.ts`), so a restart keeps the ones nobody saw.
  Only fetches by the app are compared, so a person's own `push --force`
  is not marked, unless it lands while the app's fetch is on the network:
  the comparison cannot tell who moved the ref. Such a mark goes as soon
  as the branch is level with its upstream, which a push leaves it.
- **Reporting.** A fetch that moved a remote-tracking ref, or a mark, reports
  its repository through the refresh policy, so the window reloads it as for
  any other change, and a hidden window catches up when it returns. The
  watcher usually hears the same refs move; the store merges the two
  reloads. Where fetching stands (running, when it last worked, and the
  latest failure) goes to the window directly as `fetchChanged`, without a
  reload. "Fetch now" on a repository's header runs a fetch whether or not
  background fetching is on; one that worked says so in a toast.

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
`timberMock.announceChange("/work/timber")`, `timberMock.attention()` (what
the interface last said through `attend`; the mock watches nothing),
`timberMock.endFetches("offline")` (or `"authentication"`, `"failed"`, and
`"fetches"` again) to choose how Fetch now ends (the mock fetches nothing in
the background), `timberMock.forcePush("/work/timber", "main")` to act out a
fetch that found that branch's upstream rewritten, and
`timberMock.seenForcePushes()` for what the interface said was seen,
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
  Workspace holds the terminal and Changes the diff (see
  [the Changes tab](#the-changes-tab)). Which tab shows is in the store and
  is not remembered between runs.
- **Not built yet.** The palette button is disabled and says so in its
  tooltip. The "+" and the Settings cog only ask: each puts a `DialogRequest`
  in the store (`openDialog`), and the New dialog or the Settings dialog is
  what answers it.
- **Sidebar side.** The sidebar sits on the left or on the right, as chosen
  in Settings (see [preferences](#preferences-and-the-settings-dialog)). The
  window has no control for it. On the right the body is drawn workspace,
  edge, sidebar, in that order in the page itself, not by CSS, so Tab reaches
  the parts in the order they are seen. Each part keeps its key, so moving
  the sidebar keeps its React state, such as the filter. The browser still
  moves the parts in the page, which resets their scroll position, and
  would reload a frame inside one. On the right the edge
  follows the pointer the other way, and the arrow pointing at the workspace
  widens the sidebar (`sidebarWidthAfterKey` and `sidebarWidthAfterDrag` in
  `shell.ts`). Home and End still mean the narrowest and the widest. In the
  narrow layout, where the parts are stacked, a sidebar on the right goes
  below the workspace.
- **Long names.** The breadcrumb, the group headers, and the workspace header
  cut a long name short and carry the whole name in their `title`.
- **The saved layout.** The sidebar width, the collapsed groups, and the
  dismissed setup prompts (see [first-run setup](#first-run-setup)), each
  repository named by the path of its primary checkout, are the `layout` part of the
  settings file (`Layout` in `src/shared/layout.ts`). The interface never
  keeps them itself: it reads them once through `loadLayout` and hands the
  whole layout to `saveLayout`. A file without a `layout` part is valid and
  means the defaults. A `layout` part that cannot be read falls back to the
  defaults part by part and never makes the file count as damaged, so it
  cannot cost the repository list.
- **One holder of the file.** The repository list and the layout save through
  the same `SettingsHolder` (`src/bun/settings.ts`), one change at a time,
  each building on what the last one saved. Removing a repository also
  forgets its collapsed group and its dismissed setup prompt.
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
  makes the file count as damaged. The Fetching part keeps a readable
  "background fetching off" even when its interval cannot be read, so a
  file that says off never turns fetching on. A part this version does not know is left
  out, so it is lost on the next save, for example after going back to an
  older build.
- **One table.** Every preference is one entry in `PREFERENCE_PARTS`, which
  says how it is read, compared, and written. Reading the file, merging a
  change, comparing, and writing all go through it, so a new preference
  cannot be left out of one of them.
- **Kept apart from the layout.** The layout is saved whole and often,
  starting from the defaults when the person changes it before it was read.
  Preferences change only when a section is saved, so they are not part of it.
- **Saving.** `savePreferences` sends only the preferences one section
  changes. The main process merges them with what was saved last, in turn
  with every other change to the file, so one section's Save never undoes
  another's. The answer carries every preference as saved, and the store
  shows what the engine answered, never what it asked for. A change with a
  part that cannot be read saves nothing and is a failure that names it. A
  failed save changes nothing on screen. Each save takes a ticket, so an
  older answer that arrives last never replaces a newer one.
- **The dialog.** `src/mainview/components/SettingsDialog.tsx`, opened by the
  cog with `{ kind: "settings" }`, or at one section with `section`. The
  sections are listed down the side, in the order of `SETTINGS_SECTIONS`
  (`src/mainview/store/state.ts`), named in `SETTINGS_SECTION_LABELS`
  (`shell.ts`), and each is one entry in `SECTION_VIEWS`. Focus starts on the
  section that shows. Every section stays mounted and only the chosen one
  shows, so what was typed in one is still there after looking at another.
  Each section is a `SettingsSection` with a Save of its own, as the design
  asks. Save is marked unavailable, not disabled, until something differs
  from what is saved, so focus stays on it after a save. What is applied
  changes when the save worked, without a restart. While a section saves,
  Close, Escape, and the other sections do nothing, so its answer is never
  lost. A failure stays in the section with the reason and what was chosen,
  ready to save again. Saved preferences that could not be read on start are
  reported at the top of the dialog. Nothing in the dialog runs Timber, so it
  has no command footer.
- **Sections today.** Layout: the side of the sidebar, left by default.
  Editor: the editor that "Open in editor" starts (see
  [opening a worktree in an editor](#opening-a-worktree-in-an-editor)).
  Agents: the coding agents the "+" menu starts (see
  [agent sessions](#agent-sessions)). Fetching: whether the app fetches in
  the background and how often (see [fetching](#fetching)). Under a
  "Timber" heading, Machine and Repository edit Timber's own settings
  through Timber (see
  [Timber's settings](#timbers-settings-in-the-settings-dialog)).

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

## Timber's settings in the Settings dialog

Timber's own settings are read, saved, and checked in Settings through
Timber's settings commands for app consumers, `timber __app-config` (version
1, in `docs/ide-contract.md` of the Timber repository). The app never reads
or writes Timber's files or its credential stores itself, so validation,
change detection, atomic writing, the Git exclusion of `.timber.toml`, and
the private login stores stay Timber's.

- **Two scopes.** Machine is Timber's machine defaults (`--scope global`),
  run in the home folder. Repository is `.timber.toml` in the primary
  checkout of one repository from the list (`--scope repository`), run in
  that checkout and picked in the section, starting with the repository of
  the selected worktree. A repository not in the app's list is refused
  before anything runs. Each section names the file Timber reported.
- **The capabilities.** `readTimberSettings`, `saveTimberSettings`, and
  `checkTimberConnection` on the `Engine`, answered by
  `src/bun/timber-settings.ts`. The arguments, the shapes Timber answers
  with, and the checks on what the window sends live in
  `src/shared/timber-config.ts`, which is pure. A read or a check that takes
  longer than 30 seconds is stopped. A save has no time limit, because
  Timber may wait on its lock.
- **Groups, each with its own Save.** Editor, Coding assistant (program,
  arguments as separate entries, whether Timber starts it by itself, Orca
  terminals, wait for setup), Branch and remote and folder, Scripts (setup
  and pre-done, each script one entry that may span lines), and Issue
  tracking (default tracker, Jira site and cloud ID, Jira and Linear
  logins). The presets of `timber setup` fill the fields, which stay
  editable. A table can inherit, be off (`false`), or be set here. A group
  is held in the window as typed (`src/mainview/timber-settings-format.ts`)
  and saved as the whole scope: its own keys replaced in the settings as last
  read, every other key sent back as it was read. Named workflows and arena
  presets are not edited: they are left out of the draft and Timber carries
  them over from the file as it is at save time, so a change made to them
  outside the app is a conflict, not a refused field.
- **The command first.** Every group shows the exact save command, and every
  "Test connection" its check command, before they run, with
  `<settings draft>` and `<temporary file>` for the private files.
- **Outcomes.** Saved reads the scope again and shows "Saved". Invalid puts
  each of Timber's `invalidFields` messages at the field it names (for
  example `hooks.post_create.1` at the second setup script), the rest at the
  group, and nothing is written. Conflict says the file changed outside the
  app and offers Read again; what was typed is kept. Refused and failed show
  Timber's diagnostic and what it printed, in a details area that starts
  closed.
- **A tracked file.** When Git tracks the repository's `.timber.toml`, the
  section says so and Save is held back until "Change the tracked file with
  the next save" is ticked. Then `--edit-tracked` is passed and shown. The
  box clears after every save, so each save asks again.
- **Logins.** A Jira email and token and a Linear key are typed only to save
  or check them. They go to the main process in the request and on to
  Timber only inside the private input file, never as arguments, and are
  never logged. The fields are password fields, never filled in, and
  cleared once a save went through. The section shows only what Timber
  reports: whether a login is saved, whether its store is unreadable, and
  whether an environment variable replaces it. A saved login can be removed.
  Timber stores no GitHub token: GitHub uses the GitHub CLI login or
  `GH_TOKEN`/`GITHUB_TOKEN`.
- **Test connection.** Runs `timber __app-config check` with the drafted
  settings, so a Jira site not yet saved is the one checked, and with a
  login typed but not saved when there is one. It reports success or
  Timber's safe diagnostic and saves nothing.
- **A file Timber cannot read.** Timber's diagnostic is shown, nothing can be
  changed, and Read again tries again. Fix such a file in an editor.

In `bun run dev:web` the machine sets an agent that starts by itself and the
editor off; timber has a tracked `.timber.toml` with scripts, a workflow,
and a Jira site; api-server has none. `timberMock.setTimberConfig(file,
values)` acts out a change made outside the app, `timberMock.breakTimberConfig(file,
diagnostic)` a file Timber cannot read, and `timberMock.setConnection(ok)`
how a login check ends (`null` for the sample answers).

## Opening a worktree in an editor

The app has no editor of its own. "Open in editor" starts the person's editor
on a worktree's folder, and nothing else in the app ever starts one: New and
Open always pass `--no-editor` to Timber (see
[creating and opening worktrees](#creating-and-opening-worktrees)).

- **The setting.** `editor` in the preferences: one command line and
  whether the editor runs in a terminal, or null when none is chosen. It is
  one entry of `PREFERENCE_PARTS` (`src/shared/preferences.ts`), with its
  reader, comparer, and writer in `src/shared/editor.ts`. In the settings
  file a value that is not a readable command falls back to "not set" and
  never costs the file; in a save it is refused. The Editor section of
  Settings offers None, VS Code (`code`), Zed (`zed`), Neovim (`nvim`, in a
  terminal), and Other command. A preset fills the command field, which can
  be edited freely. The section shows the exact command for an example
  folder with spaces. Save is disabled while the command cannot be read, and
  while Other is chosen with nothing typed: only None removes the editor. A
  known terminal editor (`nvim`, `vim`, `vi`, `hx`, `nano`, `micro`, `emacs
  -nw`) without "Runs in a terminal" gets a warning.
- **The command.** `splitCommandLine` (`src/shared/command-line.ts`) splits
  the setting without a shell: spaces, tabs, line breaks, and no-break
  spaces separate words, single or double quotes group them, a backslash is
  an ordinary character, nothing is expanded, and a quote that is never
  closed is an error. `editorCommand` (`src/shared/editor.ts`) adds the
  worktree's registered path as one last argument, or puts it where the
  command has `{path}`, taking every character of the path as it is
  (`$&` and the like included). The tooltip, the
  toast, and every failure show this command, worded by the same function
  the main process runs from.
- **The capability.** `openInEditor({ repository, worktree })` on the
  `Engine` contract. The request names only the worktree. The command comes
  from the saved setting in the main process (`src/bun/editor.ts`), never
  from the interface. Like Done, it acts only on a repository in the app's
  list and a full path that `timber ls --json` lists for it at that moment,
  and only when that folder is there. These checks come first, so no answer
  ever carries a command built from a path that was not listed. The request
  may also name a `file`, relative to the worktree as Git reports it, which
  the Changes tab does. The editor then gets that file's full path in place
  of the folder (`editorTarget` in `src/shared/editor.ts`). A path that is
  absolute or steps out with `..` is refused, and so is a file that is not
  there.
- **Starting.** The executable is looked for on the PATH the app was started
  with (`Bun.which`), or taken as a full path. A relative path is refused.
  It is started with `Bun.spawn` as an executable plus arguments, in the
  worktree's folder, detached in a session of its own, with no standard input
  or output, and then let go (`unref`). So closing the app does not close the
  editor. The main process waits half a second to hear whether it stopped
  right away with an error, as a launcher that cannot find its editor does. A
  launcher that hands over and exits with 0 counts as opened. On Windows a
  `.cmd` or `.bat` file, which cmd.exe would read again, is refused: VS
  Code's `code` is one, and launching on Windows is not tested yet.
- **Answers.** Opened, not configured, a terminal editor, not listed, not
  found, or failed (`OpenInEditorResult` in `src/shared/model.ts`). Not found
  names the command and the PATH the app was started with. A change to PATH
  needs a restart, as for Timber.
- **In the window.** The control sits beside each worktree row, not inside
  it, because the row is itself a button. It shows when the row is pointed at,
  reached by keyboard, or selected, and the row then keeps room for it, so it
  never covers the branch markers. The workspace header has it too. The
  tooltip is the exact command. With no editor set it opens Settings at
  Editor. With an editor that runs in a terminal, or a worktree whose folder
  is missing, it is disabled with the reason: starting a terminal editor in
  the worktree's terminal is a later step. A started editor is a toast. Any
  other answer is a note under the workspace header that names the command,
  until it is dismissed or the next open works (`editorProblem` in the store).
- **Trying it.** In `bun run dev:web` the mock engine acts it out and starts
  nothing. `timberMock.endEditorLaunches("not-found")` or `("fails")` chooses
  how it ends from then on, and `("opens")` goes back to the start.

## The Changes tab

The Changes tab shows what changed in the selected worktree, as `git status`
and `git diff` see it. It is read-only: nothing in it stages, discards, or
commits. Comparing against the base or a rebase backup is a later step.

- **The capabilities.** `readFileChanges({ repository, worktree })` and
  `readFileDiff({ repository, worktree, file })` on the `Engine` contract.
  The types and pure parsers are in `src/shared/file-changes.ts`, and the
  main process side is `src/bun/file-changes.ts`. Both act only on a
  worktree Timber lists, in a repository in the app's list, whose folder is
  there (`findListedWorktree`), as "Open in editor" does.
- **The list.** `git status --porcelain=v2 -z --untracked-files=all`. Each
  untracked file is listed on its own, not its folder, so it can show its
  content. A file with staged and unstaged changes is listed once in each
  group. Groups show conflicts first, then staged, then unstaged (untracked
  included). Kinds: modified, added, deleted, renamed, copied, type changed,
  untracked, and conflicted. At most 5,000 files are listed, with a note
  when there are more.
- **A diff.** Staged changes are `git diff --cached -- <path>`, unstaged
  ones `git diff -- <path>`, both paths for a rename or a copy, and an
  untracked file is `git diff --no-index -- /dev/null <path>`, so every line
  is an addition. A conflicted file is Git's combined diff. The request names
  the file by group and path. The main process reads that file's status
  again and builds the command from what Git says now, so a path from the
  interface never reaches Git unchecked; one that is absolute or steps out
  with `..` is refused first. A file that is no longer changed there says so.
- **Read-only for real.** Every query runs with `GIT_OPTIONAL_LOCKS=0`.
  Without it, both `git status` and `git diff` rewrite the index to refresh
  file times, which a test showed. Paths are literal (`--literal-pathspecs`),
  so a file named `*` means that file. Diffs run with `--no-color
  --no-ext-diff --no-textconv`, so the person's diff configuration cannot
  start a program or change the text, and with `LC_ALL=C`, so Git's "Binary
  files ... differ" is in English for the parser.
- **Large and binary.** Git's output is read up to 512 KiB, and Git is
  stopped beyond that. A diff of more than 5,000 lines is not drawn. Either
  way, and for a binary file, a notice shows instead, with the Git command
  to run in a terminal. Git is stopped after 20 seconds.
- **In the window.** The file list sits beside the diff. Each file shows its
  name, its folder, and Git's letter (M, A, D, R, C, T, U, and ! for a
  conflict). The first file is selected, and the selection stays on a file
  for as long as it is listed. The arrows, Home, and End move through the
  list. The diff shows old and new line numbers and Git's own header lines,
  such as `rename from`. "Open in editor" opens the selected file, and is not
  offered for a deleted one.
- **Refreshing.** The tab reads the list again whenever the worktree's
  status on screen is read again, which is whenever its repository reloads:
  the sidebar's Refresh, the tab's own Refresh, or a reported change. The
  selected file's diff is read again with it. The view is in the store
  (`changes`), and the latest read wins.
- **Trying it.** In `bun run dev:web` the billing worktree feat/tax-rules
  shows every kind of change. `timberMock.failFileChanges("Git is busy")`
  makes reads fail (`null` to undo), and `timberMock.setFileChanges(path,
  files)` sets what a worktree lists.

## Terminal sessions

A worktree can have any number of terminal sessions: each is the person's
shell, running in its folder, drawn in the Workspace tab under a chip of its
own. Every session keeps running while another one, or another worktree,
shows, and coming back shows it as it was.

- **Who owns it.** The main process (`src/bun/terminals.ts`). Each session is
  a pseudo terminal from `Bun.Terminal`, started with `SHELL` when that is a
  full path to an executable, otherwise `/bin/sh`, in the worktree's
  registered path, with the app's environment and `TERM=xterm-256color`. The
  shell leads a process session of its own.
- **Which worktrees.** As for "Open in editor": only a repository in the
  app's list and a full path that `timber ls --json` lists for it at that
  moment, whose folder is there (`findListedWorktree` in
  `src/bun/listed-worktree.ts`, shared with `src/bun/editor.ts`). Each
  `openTerminal` starts one more session beside the ones the worktree has.
- **Kinds and names.** A session has a kind and a name. The kind is
  `terminal` for the shell, or `agent` for a coding agent, which starts the
  agent's command instead of the shell (see [agent sessions](#agent-sessions)).
  The main process names a new session after the shell or the agent,
  "Terminal" or "Codex", then "Terminal 2" and on, the first name no
  session of that worktree has, exited ones included. It picks the name with
  no wait between reading the names and keeping the session, so two sessions
  that start at once get different names. `renameTerminal` gives a session
  another name, kept in the main process so it survives a reload of the
  window. A name is cleaned up first (`cleanSessionName` in
  `src/shared/terminal.ts`): control characters and runs of white space
  become one space, it is trimmed and cut to 40 characters, and a name with
  nothing left is refused. Names may repeat.
- **The contract.** `openTerminal`, `listTerminals`, `readTerminal`,
  `renameTerminal`, `writeTerminal`, `resizeTerminal`, `drawnTerminal`,
  `closeTerminal`, and the listeners `onTerminalOutput` and
  `onTerminalChanged` on the `Engine`.
  Typing, resizing, and saying what was drawn are RPC messages with no
  answer. Output comes as messages too. The data is in
  `src/shared/terminal.ts`.
- **Output.** Gathered for 4 ms, or until 64 KiB, and sent in parts numbered
  per session. The main process keeps the last 512 KiB (`SCROLLBACK_LIMIT`)
  so the interface can draw a session again, for example after the window
  reloads. The window says which parts it drew. When more than 1 MiB it has
  not drawn is on its way, the main process keeps output without sending it,
  and once the window caught up sends what it kept in one part that starts
  the screen afresh. So a program that prints without end cannot bury the
  window, and Ctrl+C still gets through. What a terminal prints is private,
  like what a command prints: it is never logged.
- **Drawing.** xterm.js 6.0.0 with the fit and web links addons, pinned
  exactly, and loaded the first time a terminal shows
  (`src/mainview/terminal-view.ts`). Each session's drawn terminal lives
  outside React for as long as the session does; a pane borrows it while it
  shows, so its scrollback and screen survive switching worktrees. A pane
  that shows for the first time draws what the main process kept, then
  every new part once (`src/mainview/terminal-feed.ts`, pure). What was kept
  can start in the middle of a full-screen program's picture, so when it
  leaves the alternate screen on, the size is changed for a moment and the
  program draws itself again. The pane's size goes to the shell after it
  has rested for 50 ms, never while a drag moves. A pane takes the keyboard
  only when nothing else has it, so moving through the sidebar keeps it
  there.
- **Chips.** Above the pane, one chip per session of the selected worktree,
  in the order they started, with the kind, the name, a filled blue dot
  while it runs, a hollow dot and its exit code once it ended, and a ring
  when it printed since it was last on screen. The kind shows as `>_` for a
  terminal and a star for an agent. "+" at their end is a menu of what can
  start: Terminal, every agent from Settings with its exact command, and
  "Set up agents", which opens Settings at Agents. The arrows, Home, and End
  move through it and wrap, Escape closes it and gives the keyboard back to
  "+", and Tab or a click elsewhere puts it away. What starts shows at once. The chips are
  a tab list: one tab stop, the arrows, Home, and End show another session
  at once, and the focus stays on the chips. Click, Enter, or Space shows a
  session and puts the keyboard in its terminal. Delete closes the session
  on the focused chip and F2 renames it, as for closable tabs; a double
  click renames too. The close control on a chip is for the pointer; on the
  keyboard the session bar has Rename and Close. In the rename field Enter
  and leaving the field save, and Escape keeps the name. Closing the chip
  that shows shows the one after it, or else the one before, skipping any
  that are being closed. A chip being closed is dimmed until its processes
  ended, which can take two seconds. Tab belongs to
  the program in a terminal, so Ctrl+PageUp and Ctrl+PageDown (Cmd+Shift+[
  and ] on macOS) show the previous and next session from inside one, and
  Ctrl+Shift+S (Cmd+Shift+S) puts the focus on the chips. Which chip shows
  in each worktree, and which sessions printed unseen, are the interface's
  own (`shownSessions` and `unseenSessions` in
  `src/mainview/store/state.ts`): after the window reloads, each worktree
  shows its first session and nothing is marked. A session counts as seen
  whenever it is on screen: its chip shows in the selected worktree while
  the Workspace tab shows. A program that keeps redrawing, such as a
  spinner, keeps its chip marked.
- **The sidebar.** A worktree's row shows how many of its sessions run, in
  blue with the count, and says so in the row's description, such as "2
  sessions running". Exited sessions are not counted.
- **Copy, paste, links.** Ctrl+Shift+C and Ctrl+Shift+V on Linux and
  Windows, Cmd+C and Cmd+V on macOS, through the system clipboard in the
  main process (`writeClipboard`, `readClipboard`), so Ctrl+C and Ctrl+V stay
  the program's. Pasting marks the text as pasted for programs that ask. A
  link opens with Ctrl+click, or Cmd+click on macOS, and only an `http` or
  `https` link with no spaces or control characters in it, in the person's
  browser (`openLink`, `src/bun/open-link.ts`). The link goes, as the URL
  parser writes it out, as the one argument of `xdg-open` on Linux or `open`
  on macOS, never through a shell, because it is whatever a program printed.
  Elsewhere nothing opens yet. The bar above the
  terminal says so. Fonts and colors come from the design tokens; the ANSI
  colors are muted to sit on the dark surface.
- **Ending.** Closing a session hangs up its terminal and sends SIGHUP to
  every process in the shell's session, waits until all of them ended or two
  seconds passed, kills what is still there, and answers once the shell has
  ended. Every process in the session is found through `/proc` on Linux
  (`src/bun/process-session.ts`); elsewhere the shell's process group stands
  in while the shell runs, which misses jobs in groups of their own. Once
  the shell ended, its session id can go to another process when the
  session is empty, so from then on only the processes left right when it
  ended are ever signalled. Only a program that started a session of its own, as a daemon
  does on purpose, outlives it. When the shell ends by itself, what it left
  is hung up on, as a terminal does when it closes, and the session stays
  with its exit code until it is dismissed. A program started with `nohup`
  then goes on, and dismissing the session ends it.
- **Worktrees that go.** After a list read, the store ends every session of
  a worktree that a full read no longer lists, such as one removed from
  inside its own terminal, or of a repository that left the app's list, with
  one toast per worktree. Done warns with the number of running sessions and
  ends all of them after a removal. A repository whose worktrees Timber could not list, or whose folder
  Git cannot read, keeps its terminals.
- **Quitting.** While a terminal runs, the main process says no to
  Electrobun's `before-quit` and to the window's `will-close`, and asks the
  window to show the question (`src/bun/quit-guard.ts`,
  `src/mainview/components/QuitDialog.tsx`). Quit ends every session, then
  quits; Keep running and Escape keep everything. The window must say
  within two seconds that it shows the question. When it does not, nobody
  can be asked, so every session is ended and the app quits. That is what
  happens on SIGTERM: Electrobun's native side stops its GTK event loop by
  itself, so the window no longer draws or answers, and holding the app
  back would leave it running with a window that cannot close (it went
  white before this was fixed). A native dialog is no way out, because it
  needs the same event loop. SIGINT and SIGTERM cannot be told from the
  person quitting in any other way: the app's code runs in a Worker, where
  signal listeners never run. SIGKILL ends the app without
  asking; the terminals then hang up, which ends the shells and what runs
  in front, but not what ignores a hang-up.
- **Windows.** `Bun.Terminal` exists on Linux and macOS only, so on Windows
  `openTerminal` answers that terminals are not supported there yet, and
  nothing starts.
- **Not built.** Split views showing two sessions side by side, keeping
  sessions after a restart, and starting a terminal editor in a session.

In `bun run dev:web` the mock engine acts out a shell that echoes what is
typed and knows `pwd`, `clear`, and `exit`. `timberMock.requestQuit()` acts
out quitting, `timberMock.endTerminal(id, code)` a shell that exits by
itself, and `timberMock.failTerminals({ outcome: "unsupported", message })`
a terminal that cannot start (`null` to undo).

## Agent sessions

A coding agent, such as Claude Code or Codex, runs in a session of a
worktree beside its terminals. An agent session is a terminal session that
starts the agent's command in the worktree's folder instead of the shell.
The app only hosts it: it never reads, parses, or answers what an agent
prints, which is handled as any terminal's output.

- **The setting.** `agents` in the preferences (`AgentSetting` in
  `src/shared/agent.ts`): a list of a name and a command, in menu order.
  Claude Code (`claude`) and Codex (`codex`) until a list is saved; a saved
  empty list stays empty. Settings, Agents edits it row by row, offers the
  presets missing by name as one click each, shows the exact command of each
  row, and saves with its own Save. A name is cleaned up as a session name,
  must differ from the others ignoring case, and may not be "Terminal", the
  shell's entry in the same menu. The list holds 20 agents at most, and a
  command 1000 characters. The list is read whole: one entry in the file that
  cannot be read puts the presets back, and the next save of the section
  writes them.
- **The command.** Split by `splitCommandLine`, never by a shell, as for the
  editor: quotes group words, nothing is expanded. Nothing is added to it,
  and it starts in the worktree's folder. The executable is looked for on
  the PATH the app was started with, or is a full path; a relative path is
  refused (`findExecutable` in `src/bun/find-executable.ts`, shared with
  "Open in editor"). An app started from a desktop launcher can have a
  shorter PATH than a terminal, so an agent that a terminal finds may need
  its full path here.
- **Starting.** `openTerminal` with `agent` set to the agent's name. The main
  process takes the command from the saved preferences only, never from the
  request. A name that is not saved starts nothing, not even a shell. The
  session's `shell` is the executable as found and `command` the whole line,
  shown in the session bar's tooltip. The "+" menu, the buttons of a
  worktree with no session, and the Agent field of the New worktree dialog
  start an agent, all through `openTerminal`. Timber's `new` and `open`
  never do: they always run with `--no-agent` (see
  [creating and opening worktrees](#creating-and-opening-worktrees)).
- **When it cannot start.** An executable that is not found starts nothing
  and keeps no session, so the other sessions are not touched. The pane
  shows why, with the command that failed, until it is dismissed or a session
  starts there. An agent that starts and stops at once, such as a script
  whose interpreter is missing, is an exited session with what it printed
  and its exit code.
- **Ending.** As for a terminal: closing its chip hangs up on the agent and
  everything it started, and kills what is still there after two seconds.

In `bun run dev:web` the mock engine acts out an agent as the pretend shell,
and `timberMock.missingExecutables(["codex"])` acts out an agent whose
executable is not on the PATH (`[]` to undo).

## First-run setup

A repository that was never set up for Timber works as any other: Timber
lists its worktrees and runs its commands with built-in defaults. The app
offers setup instead of leaving the person to meet those defaults by
surprise, and never insists on it.

- **Detecting it (`src/bun/setup-state.ts`).** Each read of a repository
  also says which Timber settings apply to it (`Repository.setup`):
  `repository` when its primary checkout has a `.timber.toml`, `machine`
  when only the machine defaults exist, `none` when neither does, and
  `unknown` when that could not be checked, or the repository is unavailable
  or Timber could not list it. The machine defaults are where Timber reads
  them: `config.toml` in `timber` under `XDG_CONFIG_HOME` when it is an
  absolute path, otherwise under `.config` in the home folder, with the
  environment Timber lists with. Only whether the files are there is read,
  never what is in them and never through Timber: `timber ls` already
  validates both, and reports a file it cannot read as the repository's
  failure. A `.timber.toml` in a linked worktree does not count, because
  Timber does not read it there. Machine defaults count as set up: Timber
  itself offers `timber setup --global` as the alternative, and steers there
  when a repository's ignore rules or a tracked config get in the way.
- **The prompt (`SetupPrompt.tsx`).** Between the workspace header and the
  tabs, for a selected worktree of a repository whose setup is `none` and
  whose prompt was not dismissed (`showsSetupPrompt` in
  `src/shared/timber-setup.ts`): one sentence that Timber's defaults work
  and setup is optional, the command it runs, `timber setup`, "Set up
  Timber", and "Not now". It is an offer, styled as one, never as an error.
- **Set up Timber.** Timber's guided `timber setup` for the repository
  (`timberSetup` in `OpenTerminalRequest`, with the `repository` scope): a
  session of kind `timber`, named "Timber setup", in the repository's
  primary checkout, which becomes selected, with the Workspace tab showing.
  The main process runs the Timber it found, never a command from the
  request. Settings does not start setup: it saves through Timber's
  settings commands (see
  [Timber's settings](#timbers-settings-in-the-settings-dialog)). A primary checkout whose folder is missing disables the
  button, and the prompt says why (`timberSetupTarget`). When the session
  cannot start, for example without a usable Timber or on Windows, that
  worktree's sessions say why, as for any session. While a Timber setup
  session of the repository runs, the button reads "Show setup" and shows
  that session instead of starting another.
- **When it goes.** `timber setup` ends with exit code 0 whether it saved or
  was cancelled, and what it writes, `.timber.toml` or the machine defaults
  and an entry in Git's `info/exclude`, is something the watcher ignores. So
  when a Timber setup session ends or is closed while it runs, the store
  reads every repository again, since machine defaults set up all of them at once, and
  the prompt goes once `setup` is no longer `none`. A setup that ended while
  the window was reloading counts too, once the sessions are listed.
  Settings saved some other way, such as from a terminal outside the app,
  show on the next read, for example when the window gets the focus back.
- **Not now.** Remembered per repository in the saved layout
  (`setupDismissed`), so the prompt stays away after a restart, and
  forgotten when the repository leaves the list. Nothing else changes: the
  worktrees, terminals, and Timber commands work as before. There is no way
  back to the prompt in the app yet; `timber setup` in a terminal still sets
  the repository up.
- **The empty state.** With no repository in the list, the workspace says
  so and makes "Add repository" the first step, mentioning that a repository
  new to Timber gets the offer to set it up.
- **Later.** Settings can be saved through Timber now, so a step-by-step
  wizard in the app can replace the terminal session, with the same
  choices. It is not built.

In `bun run dev:web` the mock engine's folder picker adds `docs-site`, which
was never set up. A Timber setup session there asks one question: `save`
acts out saving the settings, the repository's or with `--global` the
machine's, and `cancel` or `exit` acts out cancelling.

## Installing the Linux build

`bun run build` does not produce an app that runs in place. Its output in
`build/stable-linux-x64/Timber/` is an installer: Electrobun's self-extractor
in `bin/launcher`, the app as a compressed archive in `Resources/`, and the
menu entry template `Timber.desktop`. `artifacts/` holds the same installer
packed as `linux-x64-Timber-Setup.tar.gz`, plus the update bundles. To run
the app from the checkout without installing it, use `bun run dev`.

Running `bin/launcher` installs without asking. With Electrobun 2.0.6 it
writes, under the user's home folder (with `XDG_DATA_HOME` set, that folder
replaces `~/.local/share` below; the desktop shortcut stays in `~/Desktop`):

- `~/.local/share/com.codingm8s.timber/stable/app/`: the app itself. The
  folder name is `app.identifier` and the channel from `electrobun.config.ts`.
  The identifier is a placeholder (see [open decisions](#open-decisions)),
  and changing it installs to a new folder and leaves the old one behind.
- `~/.local/share/com.codingm8s.timber/stable/uninstall`, with
  `.electrobun-uninstall.json` beside it recording the entries below, and a
  `self-extraction/` folder of install state.
- `~/.local/share/applications/Timber.desktop`: the menu entry. The
  installer also refreshes `mimeinfo.cache` in that folder.
- `~/Desktop/Timber.desktop`: a copy of the menu entry as a desktop
  shortcut. The installer then asks `gio` to mark it trusted, which some
  desktops do not support.

Both entries point at the installed launcher. They have no `Icon=` line, so
menus show a generic icon, and their `Comment=` repeats the name. The icon
belongs to the app's identity, issue 27. A trial build for issue 62 showed
the settings that fix both: with `build.linux.icon` set, the build copies
that PNG to `app/Resources/appIcon.png` and both entries get its absolute
path as `Icon=`, and `app.description` becomes `Comment=`.

**The desktop shortcut.** Electrobun 2.0.6 has no setting to skip it, and
neither does the configuration of 2.0.7-beta.24, the latest on 2026-11-16.
The extractor makes it when `~/Desktop` exists, and skips it when that
folder is missing. It looks only at `~/Desktop` and ignores
`XDG_DESKTOP_DIR`, so a desktop folder under another name gets no shortcut.
Deleting the shortcut is safe, but running the installer again puts it back.
Whether an update does too was not tried. The shortcut is accepted for now,
and is listed under
[open decisions](#open-decisions) to look at again before a first release.

**Removing it.** `~/.local/share/com.codingm8s.timber/stable/uninstall
--quiet` removes the app folder, both entries, and the install records.
It was run only with `--quiet`.

## Display server on Linux

The window is an X11 window on every Linux session, and on Wayland it runs
through XWayland. This comes from Electrobun, not from this app: the native
wrapper's `initializeGTK()` calls `setenv("GDK_BACKEND", "x11", 1)` just
before `gtk_init`, with overwrite on. The rest of the wrapper is built on
X11 too (`XInitThreads`, its own X11 windows, global shortcuts through an
X11 display, `gdk_x11_*` calls).

- `GDK_BACKEND=wayland` is not honoured. It is replaced before GTK reads it.
- XWayland is a requirement on Wayland. Without an X display the app stops
  with `cannot open display` and exit code 1. There is no Wayland fallback.
- Electrobun 2.0.6 and the 2.0.7 betas behave the same, both the WebKitGTK
  and the CEF wrapper. A native Wayland window needs a change upstream,
  tracked in
  [blackboardsh/electrobun#568](https://github.com/blackboardsh/electrobun/issues/568).
  Reports there say XWayland costs sharpness with fractional scaling and
  smooth resizing at high resolutions and refresh rates. Neither was seen
  here, and neither was looked for.

See the issue 63 run under [what has been verified](#what-has-been-verified).

## Milestones

1. **Sidebar, read-only (this scaffold).** Repositories and the worktrees
   Timber lists, with branch status: commits to push and pull, never
   published, upstream deleted, modified and untracked counts.
2. **Sessions.** Agent and terminal panes. Each is a pseudo-terminal owned by
   the main process (`Bun.Terminal`), rendered by xterm.js. Several per
   worktree, and hidden panes keep running. Built: several terminals and
   agents per worktree (see [terminal sessions](#terminal-sessions) and
   [agent sessions](#agent-sessions)).
3. **Timber actions.** New and open, rebase with a base picker, done with the
   safe and "delete anyway" confirmations.
4. **Changes.** Diff against the base, the last commit, or a rebase backup.
   The working tree against the index and the last commit is built (see
   [the Changes tab](#the-changes-tab)).
5. **Settings.** Editor, agents, scripts, layout. Built: layout, editor,
   agents, and Timber's settings, edited and saved through Timber's
   settings commands (issue 22).
6. **Background refresh.** File watching per worktree and periodic fetch.
   Built: watching the Git metadata and checking the selected worktree (see
   [watching for changes](#watching-for-changes)), and fetching with
   force-push detection, which compares the remote-tracking refs before and
   after each fetch instead of reading their reflogs (see
   [fetching](#fetching)).

## Open decisions

- **Timber's machine interface is experimental.** The app spawns the
  `timber` executable and reads version 1 of its JSON records, which keeps the
  two releasable apart. Timber calls that interface experimental, so a new
  schema version means a change here.
- **Rebase backups.** The design shows them, but Timber does not create backup
  branches today. Either Timber gains that, or the app creates them.
- **Application identifier.** `electrobun.config.ts` holds a placeholder.
  It also names the Linux install folder.
- **Linux desktop shortcut.** Electrobun's installer adds one to `~/Desktop`
  without asking, and offers no way to turn that off (see
  [installing the Linux build](#installing-the-linux-build)). Accepted for
  now. Revisit before a first release.
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
- `bun test`: 572 tests passed, 80 were skipped, none failed. The new ones
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
- After review, the same page with saving made to take 1.5 seconds by a
  script in the page: Settings opened with focus on Layout; Tab, the down
  arrow, and Enter chose Right and saved; Escape right after did not close
  the dialog, Close was disabled, and Save read "Saving". When the save
  ended, focus was on Save, the status said "Saved", and the sidebar was on
  the right. Escape then closed the dialog.

Run for opening a worktree in an editor (issue 12), Linux x64 (Pop!_OS
24.04, natively, not WSL) with Bun 1.4.2, Git 2.43, and Timber 0.1.0-dev.0, which is older
than the app requires, so the tests that need the installed Timber skipped:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 591 tests passed and 80 were skipped (before rebasing on the
  sidebar side, see the end of this entry). New ones cover the
  command line splitter, building the command with paths with spaces and
  `{path}`, the editor preference in the settings file, the store, and the
  rendered controls and Settings section. `tests/editor-launch.test.ts` runs
  `src/bun/editor.ts` with stand-in editors, shell scripts in a folder with a
  space in its name that write their folder and each argument on a line of
  their own: the worktree path arrives as one argument, a path holding quotes
  and `$(...)` is not read by a shell, a missing executable names the
  command and the PATH, and nothing starts for a worktree Timber does not
  list. One test starts a helper Bun process that leads its own process
  group, has it open a stand-in editor, and kills the whole group: the
  editor went on and finished, and a child the helper started the ordinary
  way was killed. With `detached` turned off for a moment, that test failed.
- That New and Open never start an editor is shown by
  `tests/worktree-commands-parse.test.ts` ("the launchers are always switched
  off"), which checks that both always pass `--no-editor`.
- `bun run build:web`: built. In `bun run dev:web` (on another port) in the
  app's built-in browser: with no editor set, Open in editor opened Settings
  at Editor; Neovim showed the note about terminal sessions and the example
  command; after saving VS Code, the header and row tooltips showed
  `code /work/timber`, pressing it gave the toast, and with
  `timberMock.endEditorLaunches("not-found")` a row's control gave the note
  with the command. Screenshots were looked at.
- `grep -rn $'\u2014' src tests docs README.md`: nothing.
- With the real VS Code 1.146.0 (`/usr/bin/code`) under a Wayland session: a
  short Bun script called `createEditorLauncher` from `src/bun/editor.ts`
  with the setting `code`, the process's own environment, and a stand-in for
  the list (the installed Timber is too old to list), on a temporary
  repository whose linked worktree is at `.../my repo-worktrees/feat login`.
  It answered opened after 501 ms (the half-second watch) and exited. VS
  Code kept running in a session of its own, with the folder as its one
  argument and the user's systemd as its parent, and its own window state
  then listed a window for exactly that folder.
- After review, rebased on the sidebar side (issue 11), with the fixes:
  - `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  - `bun test`: 640 tests passed, 80 were skipped, none failed. Added since:
    dollar signs in the path where `{path}` stands (one through a stand-in
    editor), a worktree path that is not a full path, a batch file refused
    on Windows (acted out with `platform: "win32"` on Linux), no terminal
    answer for an unlisted worktree, line breaks and no-break spaces in the
    command, Other with nothing typed, the terminal editor warning, an
    unreadable editor refused in a save, the Editor panel mounted and hidden
    while Layout shows, and the mock's answer for an unavailable repository.
  - `bun run dev:web` in the built-in browser: `vim -p` typed under Editor
    showed the terminal editor warning; after switching to Layout and back
    the field still held `vim -p` with Other chosen. On a hovered row and
    the selected row the branch markers ended at 217 pixels and the editor
    control started at 223.
  - VS Code again, the same way, after closing the window above (its
    process was sent SIGTERM; nothing else of VS Code was running). Setting
    `code --new-window {path}`, worktree `.../my repo-worktrees/cash$&x $$ it`.
    It answered opened after 505 ms and the script exited. VS Code ran as
    `code --new-window <that exact path>` in a session of its own, and made
    its workspace storage for exactly that folder. Its process was then sent
    SIGTERM and it closed, recording that folder as its last window. The
    windows were not looked at by a person.

Run for terminal sessions (issue 13), Linux x64 (Pop!_OS 24.04, natively,
Wayland) with Bun 1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 762 tests passed and 1 was skipped (it only runs in CI). New
  ones in `tests/terminals.test.ts` run real shells in pseudo terminals in a
  temporary repository with a linked worktree whose path has a space: the
  shell starts in the worktree's folder with `TERM=xterm-256color`; one
  session per worktree, also for two requests at once; a path Timber does
  not list, a repository not in the list, and a relative path start
  nothing; `stty size` follows a resize, and a size out of range is clamped;
  a script that switches to the alternate screen and reads one raw key gets
  it; parts are numbered and a snapshot holds them; `exit 3` leaves the
  session with exit code 3 until it is closed; closing ends every process in
  the shell's session, a background `sleep` and a program that ignores
  SIGHUP included, and leaves `git status` and the refs as they were;
  a program that needs 0.3 seconds after SIGHUP to clean up gets to;
  a `nohup` job outlives a shell that exits by itself and ends when the
  session is dismissed; killing all sessions at once leaves nothing; a
  window that catches up while output is still being gathered gets it all
  in the fresh start; a link reaches a stand-in `xdg-open` as one argument
  that no shell reads; a window that draws nothing
  stops getting parts and then gets one part that starts afresh with the
  end of the output; and on Windows nothing starts. `tests/terminal-parse.test.ts`
  covers the pure rules, the feed, the keys, and the quit guard;
  `tests/terminal-store.test.tsx` the store and the rendered pane against
  the mock engine.
- `bun run build:web`: built, with xterm.js in a chunk of its own.
- `bun run dev:web` (on another port) in the app's built-in browser: Open
  terminal showed the mock shell, `pwd` answered, selecting another worktree
  and coming back showed the same screen, `timberMock.requestQuit()` showed
  "Quit Timber?" with focus on Keep running, Escape closed it, `exit`
  showed "Exited with code 0" with Dismiss, and Dismiss brought back Open
  terminal. No console errors. Screenshots were looked at.
- `bun run start` with `XDG_CONFIG_HOME` pointing at a temporary folder,
  `TIMBER_APP_REPOS` naming a temporary repository with a linked worktree
  at `.../my repo-worktrees/feat term`, and a temporary driver in the main
  process (not committed) that clicked the interface and evaluated script
  in the window over Electrobun's RPC. Text went in through the clipboard
  and Ctrl+Shift+V, which is the same path as typing (xterm.js `onData`,
  the RPC message, the pseudo terminal), and Enter and `q` as key events:
  - Open terminal started bash in the worktree's folder; `pwd` printed it
    and `stty size` said 24 125. After the window was made 900 by 600,
    `stty size` said 18 77 and the earlier lines were wrapped again.
  - `less /etc/os-release` drew its full screen, and `q` brought back the
    prompt and the lines before it.
  - A text put on the system clipboard and pasted with Ctrl+Shift+V ran
    (`pasted-42`).
  - Selecting the primary checkout showed Open terminal; selecting the
    worktree again showed the same screen.
  - With a background `sleep` and a program that ignores SIGHUP in front,
    the close control ended all four processes of the session.
  - With a terminal running, quitting (`Utils.quit()`) did not quit and the
    window showed "Quit Timber?". Keep running closed it with the processes
    alive. Quitting again and Quit ended all four processes, and the app
    exited with 0.
  - SIGTERM to the app process alone showed the same question, and Quit
    ended both processes. At first SIGTERM was meant to quit without
    asking, through a signal listener; it never ran, because the app's code
    runs in a Worker, where Bun does not run signal listeners. That was
    taken out.
  - SIGTERM to the whole process group, as `timeout` sends it to `bun run
    start`, stopped Electrobun's GTK event loop (`[stopEventLoop]` in the
    log). With a terminal running, the app then stayed alive with a window
    that no longer answered and went white once it was closed again. After
    the fix the window did not answer within two seconds, the app ended the
    terminal's processes, and it exited; no window was left.
  - A close request sent to the window over X11 (`WM_DELETE_WINDOW`, the
    same `delete-event` the close button gives) showed the question; Keep
    running kept the session running, a cancel event (what Escape sends)
    closed the question, a second
    close request showed it again, and Quit exited with 0. Screenshots of
    the window (`import -window`) before, during, and after were looked at.
  The window was not looked at by a person in these runs.
- After review, ending a session was changed to wait for every process in
  it, not only the shell, to signal only what was left once the shell
  ended, and to send held output in the right order; links now open through
  `xdg-open` without a shell. These changes ran in the tests above only, not
  in the desktop window.

Run for the Changes tab (issue 16), Linux x64 (Omarchy, Hyprland on Wayland,
natively) with Bun 1.4.4, Git 2.56.1, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 821 passed, 1 failed. The failure is the terminal test
  "closing a session ends everything it started", which fails the same way
  on `main` without this change. Once, under the full suite, the
  installed-Timber test "an editor configured in Timber does not start"
  failed too; alone it passed three times out of three.
- The new tests read real temporary repositories with every kind of change:
  modified, staged and then edited again, deleted, staged deletion, staged
  rename, binary, a link turned into a file, untracked files in a new
  folder and with non-ASCII names, an empty file, a file of more than 5,000
  lines, one of more than 512 KiB, a `*` in a file name, a merge conflict,
  and a repository with no commit yet. The list equals what `git status
  --porcelain=v1 -uall` lists, and diffs equal `git diff` and `git diff
  --cached`. After every list and diff, with the index's file times made
  stale, files, refs, and the index bytes were unchanged. Without
  `GIT_OPTIONAL_LOCKS=0` that test fails, because Git rewrites the index.
- `bun run build:web`, and `bun run dev:web` driven in headless Chromium
  over the DevTools protocol: every kind in the billing sample showed, the
  binary and large notices showed instead of lines, ArrowDown moved the
  selection and the focus, and at 600 pixels wide the page did not scroll
  sideways. Screenshots were looked at.
- `bun run start` with `TIMBER_APP_REPOS` naming a temporary repository with
  a linked worktree at `.../repo-worktrees/feat changes`, and a temporary
  driver in the main process (not committed) that clicked the window and
  logged what the RPC calls answered: the list came back as Git's status
  (2 staged, 6 unstaged), and the diffs as text, binary, and too large as
  expected. The index's SHA-256 and `git status` were the same afterwards.
  Screenshots of the window (`grim`) were looked at. A first try loaded the
  browser build, because `bun run dev:web` was still serving port 5173.

Run for several sessions per worktree (issue 14), Linux x64 (Pop!_OS, natively)
with Bun 1.4.2 and Git 2.43:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 846 tests passed and 1 was skipped, after merging the Changes
  tab from `main` (786 before). With a real shell in a
  temporary repository: three sessions in one worktree, two of them started
  at once, got "Terminal", "Terminal 2", and "Terminal 3", each printed only
  what was typed into it, closing the second left the other two running and
  answering, and the next one took "Terminal 2" again. Renaming cleaned up
  the name, kept the order, refused an empty name, and survived the shell
  exiting. In the store and the rendered app: the newest session shows,
  switching chips leaves every session running with its output unchanged,
  closing the chip that shows shows the next one, output to a session that
  is not on screen marks its chip until it shows (also across worktrees and
  the Changes tab), the sidebar count follows the running sessions, Done and
  a worktree that left the list end every session with one toast, and the
  chips render as a tablist with one tab stop.
- `bun run build:web`: built.
- `bun run dev:web` in the built-in browser of the Claude desktop app, driven
  by clicks, typing, and short scripts in the page. Three sessions ran in one
  worktree. Ctrl+Shift+S from inside a terminal put the focus on its chip;
  the left arrow showed the session before it with the focus kept on the
  chips; F2, typing, and Enter renamed it and put the focus back on its chip;
  Escape in the field kept the name. A click on the chip that shows put the
  keyboard in its terminal. Delete closed the session that showed and moved
  the focus to the chip that now showed; closing the last one put it on
  "Open terminal". An exited session showed a hollow dot and "exit 1", a
  session that printed while hidden showed the ring, and the sidebar row
  showed 2 for two running sessions. Ctrl+PageDown dispatched to the
  terminal showed the next session with the keyboard in it; a real
  Ctrl+PageUp key press did not reach the page there, because the browser
  pane takes it, so it is unverified in the desktop window.
- Not run: the desktop window (`bun run start`), so neither the keys nor
  several real shells through the RPC bridge were tried there.

Run for agent sessions (issue 15), Linux x64 (Pop!_OS 24.04, natively) with
Bun 1.4.2 and Git 2.43:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 878 tests passed and 1 was skipped (846 before). With pretend
  agents (shell scripts on the sessions' PATH) in a temporary repository: an
  agent started in the worktree's folder under its own name with the
  executable as found; `fake-codex --model "big one" --sandbox=workspace-write`
  got exactly those three arguments; two agents and a terminal ran in one
  worktree at once, each with only its own output, and a second Codex took
  "Codex 2"; a missing executable, a missing full path, and a relative path
  started nothing, kept no session, sent no change, named the command and
  the PATH searched, and left the running agent and terminal answering; an
  agent name not in the settings started nothing, not even a shell; closing
  an agent ended its process. In the store and the rendered app: agents
  start only through `openTerminal` with an agent, New and Open start no
  session, the pane shows the failed command, and the Agents section
  validates names and saves only the agents.
- `bun run build:web`: built.
- `bun run dev:web` in the built-in browser of the Claude desktop app: Start
  Claude Code from an empty worktree; "+" opened the menu with Terminal,
  Claude Code, Codex, and Set up agents; the arrows and Enter started Codex
  with the keyboard in its terminal; with `claude` acted out as missing, the
  pane said "Claude Code did not start" with the PATH and the command while
  both sessions kept running; End and Enter opened Settings at Agents, and
  an agent added there with arguments was saved. With ten chips, "+" sat at
  the window's right edge and the menu opened to its left, inside the
  window. Tab from the menu closed it and moved on from "+". Adding an
  agent put the focus in the new row's name, and removing one on the next
  row's Remove.
- The real Claude Code 2.1.325 and Codex CLI 0.169.0 were started through
  `createTerminalSessions` in a temporary repository, as agents with the
  commands `claude --version` and `codex --version`: both were found on the
  PATH, printed their versions in the pseudo terminal, and exited with 0.
- Not run: the desktop window (`bun run start`), so the menu and agents
  through the RPC bridge, and an interactive agent session, were not tried
  there.

Run for watching for changes (issue 24), Linux x64 (Pop!_OS 24.04, natively,
COSMIC on Wayland) with Bun 1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 923 tests passed and 1 was skipped, after merging agent
  sessions from `main` (891 before). New ones cover which file
  names count; grouping with a stand-in clock (one report after 300 ms of
  quiet, one every 2 seconds during a long burst); a missing `worktrees`
  folder, one that goes and comes back, a watch that cannot start and one
  that breaks; the policy while hidden, shown, and refocused, the order of
  stamp and report, the longer wait after a slow check, a change seen
  across a failed check, and a check that never answers; the store's
  `attend` calls; and, against real temporary repositories, a commit, a
  nested branch, a checkout, adding and removing linked worktrees, a
  checkout inside one, and staging a file in a repository removed and made
  again in place each reported, file edits and the app's own status check
  reported nothing, the stamp changed with an edit, a second edit of the
  same file, and a new file, and reading it left every file, ref, and the
  index as they were (with `GIT_OPTIONAL_LOCKS=0` taken out, that test
  fails, because Git then rewrites the index). The real-repository tests
  were run three times in a row without a failure.
- `bun run start` with `TIMBER_APP_REPOS` set to a temporary repository and
  `XDG_CONFIG_HOME` to a temporary folder, with a temporary log line in the
  main process for each report and each `attend` (not committed). This ran
  before the review fixes (re-watching a common directory made again in
  place, keeping the last stamp across a failed check, the 10 second limit
  on a check, and one watch update at a time), which were run in the tests
  only. The window sent `attend` with the selected worktree once the list
  loaded. From a
  terminal: a commit was reported after 347 ms, `git worktree add` after
  351 ms, editing a file after 4.0 s, and editing it again after 3.0 s; 200
  new branches and 20 commits within 435 ms were reported once; 12 idle
  seconds brought no report. Over 20 idle seconds the main process used 9
  ticks of CPU at 100 per second (under half a percent of one core) with
  one repository. No lock errors appeared.
- Not run: hiding or minimizing the desktop window, so whether its webview
  sends `visibilitychange` there is unverified; the hidden behaviour is
  tested only in the policy and the store. Several repositories at once in
  the desktop window. A rebase in the desktop window (the burst above stands
  in for it). The window was not inspected by eye.

Run for the Settings screen with Timber's settings (issue 21), Linux x64
(Omarchy, Hyprland) with Bun 1.4.4, Git 2.56.1, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- `bun test`: 961 passed, 1 skipped, and 1 failed, after rebasing onto watching
  for changes from `main`. The failure is "closing
  a session ends everything it started, even what ignores a hang-up", which
  times out after 5 seconds on `main` too, without this change. New tests
  read real temporary files: values match the file, a missing file is "not
  configured", a malformed, too large, binary, folder, and unreadable file
  each give an error, a folder outside the list is refused, every file's
  bytes and times are unchanged after reading, a credential file made
  unreadable (mode 000) still counts as saved, and a token put in arguments,
  scripts, and an unknown key appears nowhere in what is answered or
  rendered. With a real pseudo terminal, a stand-in Timber started as
  `timber setup` and `timber setup --global` in the worktree's folder, read
  a typed line, and its exit was reported.
- `bun run dev:web` in headless Chromium over the DevTools protocol: Machine
  and Repository showed the sample values, api-server "Not configured",
  billing the error, and Run timber setup closed Settings and showed a
  "Timber setup" chip. No console errors. Screenshots were looked at.
- `bun run start` under Xvfb, with `XDG_CONFIG_HOME` and `TIMBER_APP_REPOS`
  naming temporary folders, and a temporary driver in the main process (not
  committed): Machine showed the values of the temporary `config.toml`, Jira
  as configured from its credential file, and GitHub and Linear as not
  configured. Repository showed the configured repository's values with
  "From the machine defaults" where it set none, the bare one as "Not
  configured", and the malformed one as an error with setup unavailable and
  why. A token in the agent's arguments and in a setup script showed
  nowhere. Run timber setup closed Settings and started the real `timber
  setup` in the primary checkout, which drew its settings screen; Ctrl+C
  ended it with code 0. After `base_branch` was changed on disk, opening
  Settings again showed the new value. The machine file and the credential
  file were byte for byte the same afterwards. Screenshots were looked at.

Run for first-run setup (issue 23), Linux x64 with Bun 1.4.2, Git 2.43, and
Timber 0.1.1, after rebasing onto Timber's settings in Settings from `main`:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- `bun test`: 999 tests passed and 1 was skipped. New ones cover, against a
  real temporary repository: neither file, machine defaults in the home
  folder and under `XDG_CONFIG_HOME`, a relative `XDG_CONFIG_HOME` ignored,
  a `.timber.toml` in a linked worktree not counting, one in the primary
  checkout counting, an unreadable home folder giving `unknown`, and
  reading leaving every file and ref as it was; the installed Timber
  listing the repository with its setup from the primary checkout and from
  a linked worktree; and a stand-in setup that saves, run as a Timber setup
  session in a pseudo terminal by the main process module, after which the
  installed Timber's listing reads the repository as set up. Also the
  dismissed prompts in the layout and the settings file, and, against the
  mock engine, the four acceptance criteria of the issue, setup from a
  linked worktree, a missing primary checkout, a setup that ends while a
  reloaded window has not listed its sessions yet, and the answer on an
  operating system without terminals. That reload test fails with the
  reload after the session list taken out.
- `bun run dev:web` in the browser pane: adding `docs-site` showed the
  prompt; Set up Timber opened a Timber setup session in its primary
  checkout; answering `save` ended it with exit code 0 and the prompt went
  away.

Run for fetching (issue 25), Linux x64 (Pop!_OS 24.04, natively, COSMIC on
Wayland) with Bun 1.4.2, Git 2.43, and Timber 0.1.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1074 tests passed and 1 was skipped, after merging `main`
  with the Timber settings change (998 before the merge, 923 before this
  change).
  New tests cover,
  against real temporary repositories with a bare remote and two clones: a
  push from the other clone showing as behind, a force-push marked (and an
  ordinary push not), a deleted remote branch showing as gone with its local
  branch kept and its mark dropped, local branches, tags (also with
  `fetch.pruneTags` set and a local-only tag), HEAD, the index, the stash,
  and both working trees left as they were while a mirror refspec is
  configured, no `FETCH_HEAD`, a fetch that brings nothing new waking no
  watcher, a remote no branch tracks not fetched, an unreachable remote
  failing as offline at once, and a remote that asks for credentials
  failing as authentication without asking. With a stand-in clock and Git:
  nothing fetched before the preferences are read or with background
  fetching off, the first fetches 10 and 15 seconds in, the interval, the
  wait while hidden, one fetch per repository and two at once, the
  backoff (10, 20, 40, 60, 60 minutes from 5), never sooner than a long
  interval, the exact fetch command, and stopping. Also the setting, the
  marks in the settings file, the store, the sidebar, and the row.
- The next three desktop runs were made before the review fixes
  (the mark keeping the branch's commit and going once level, marks judged
  by their time, a repository removed or switched off while its fetch waits
  or runs, a background fetch stopping before its next remote, the slot
  hand-off, the runner not waiting on a stray process's
  pipes, and keeping "off" when the interval cannot be read). Those were
  run in the tests only.
- `bun run start` with `XDG_CONFIG_HOME` set to a temporary folder whose
  settings listed one temporary clone with three tracked branches and the
  interval at 1 minute, with temporary log lines in the main process for
  each fetch status, each read, and each `forcePushSeen` (not committed).
  Before start, the other clone pushed to main and deleted the remote
  branch of `doomed`. The first background fetch ran 10 seconds after the
  list loaded, and the reload after it read main 2 behind and `doomed`
  gone. A real force-push to `feature` made while the app ran was read as
  `forcePushed` after the next fetch, one minute later, and the mark was
  still in the settings file on the next start. Three fetches ran in 150
  seconds. Local branches, tags, and the status of both worktrees were the
  same afterwards, and there was no `FETCH_HEAD`.
- The same with the remote's URL changed to `https://127.0.0.1:9/`: one
  fetch failed as offline 10 seconds in, and no other was tried in the 100
  seconds the app ran. Nothing asked for anything.
- The same with background fetching off, under `strace -f -e
  trace=execve`, after the other clone force-pushed a commit made on the
  repository's first commit to `main` (a real rewrite of `origin/main`):
  of 74 Git runs in 60 seconds, none was a fetch.
- After the review fixes, `bun run start` again on the same temporary
  repositories, with the window captured by its X11 id (`xwininfo`, then
  `import -window`): seen by eye, `main` showed a red "force-pushed" with
  2 to pull and the header said "origin/main was rewritten: 0 ahead, 2
  behind" (the force-push to `main` from the run above, fetched now that
  background fetching was on again), `doomed` showed "upstream gone", and
  `feature` 1 behind and 1 ahead. A mark saved by the earlier build, without the branch's commit,
  was dropped on reading, as designed. Clicks sent through XTest did not
  reach the window under COSMIC, so a click in the desktop window was not
  tried.
- `bun run dev:web` in the browser pane, by eye and by clicking: Fetch now
  shows on hovering a repository's header; with
  `timberMock.endFetches("offline")` a click left the grey "offline" beside
  the name and no dialog; a working fetch then showed the toast "Fetched
  timber" and took the marker away; after `timberMock.forcePush`, the row
  showed the red "force-pushed", which stayed while the worktree was
  selected and went once another worktree was clicked, and
  `timberMock.seenForcePushes()` held that mark's time; Settings listed
  Fetching after Agents with its switch and interval.
- CI (`.github/workflows/ci.yml`, Ubuntu 24.04 with Git 2.56.1) first
  failed the test of a remote that wants a password: Git 2.56 says
  "unable to get password from user" where 2.43 says "terminal prompts
  disabled". That wording is now read as authentication, and both CI
  runs pass.
- With real credentials, through `createFetcher` and `createGitRunner`
  from a script against a fresh clone of this private repository, with
  `origin/main` moved back three commits first: over SSH (the person's
  key, no SSH command configured, so batch mode) the fetch worked in 0.7
  seconds, moved `origin/main` back, reported the change, and left local
  branches and tags as they were. With the remote changed to HTTPS and
  nothing stored for it, it failed in 0.24 seconds as authentication
  ("terminal prompts disabled") without asking.
- Not run: a credential helper or agent that shows its own prompt, a click
  in the desktop window itself, and anything on Windows or macOS.

Run for starting an agent from the New worktree dialog (issue 53), Linux
x64 (Pop!_OS 24.04, natively) with Bun 1.4.2 and Git 2.43:

- `bun run typecheck`: no errors. `bun run typecheck:desktop` was not run.
- `bun test`: 1097 tests passed and 1 was skipped (1074 before this
  change). `tests/new-worktree-agent.test.tsx` covers, on the mock engine,
  each acceptance item of the ticket: creating with an agent leaves the new
  worktree selected with that agent's session running on the Workspace tab;
  None starts nothing; a failed setup starts nothing, twice, and the "Open
  with setup" that works starts the agent with `timber new` asked once; an
  existing worktree opened starts nothing; and an executable that is not
  found leaves the pane's note and the worktree. Also Existing branch
  creating a worktree, setup finishing in a worktree it created (after two
  failures, and after a refusal and a missing result in between, a test
  that fails with that fix taken out), one that was already there, an edit
  in between, a list that cannot be read again, the field, and the footer.
  The tests submit through the dialog's controller, the wiring the
  component uses: with the agent start taken out of it, 8 tests failed.
- `bun run build:web`: built.
- `bun run dev:web` in the browser pane, by eye: the Agent field showed
  Claude Code picked, and the footer showed `claude` under the Timber
  command. Creating `feat/agent-demo` closed the dialog, selected the new
  worktree, showed the toast, and the Workspace tab showed a running
  Claude Code session.
- `grep -rn $'\u2014' src tests docs README.md`: nothing.
- Not run: the desktop app, and so a real agent executable started this way
  through the RPC bridge; and anything on Windows or macOS.

Run for the desktop app on Linux (issue 28), Pop!_OS 24.04 LTS x64,
natively, kernel 7.2.15, COSMIC on Wayland, with Bun 1.4.2 (the
Electrobun toolchain brings its own Bun 1.4.4), Git 2.43.0, Timber 0.1.1,
Electrobun 2.0.6, and from the distribution `libwebkit2gtk-4.1-0` and
`libjavascriptcoregtk-4.1-0` 2.52.6, `libgtk-3-0t64` 3.24.41,
`libayatana-appindicator3-1` 0.5.93, and `librsvg2-2` 2.58.0 (the list
WSLg needed, see issue 1 above):

- `bun install --frozen-lockfile`, `bun run typecheck`, and `bun run
  typecheck:desktop`: no errors.
- `bun test`: 1074 tests passed and 1 was skipped, and 1097 with 1
  skipped after rebasing onto the issue 53 change. The type checks were
  run again there, with no errors.
- `bun run build`: completed, with `build/stable-linux-x64/Timber`.
  Its `bin/launcher` is an installer, not the app: run once, it copied the
  app to `~/.local/share/com.codingm8s.timber/stable/app`, added
  `Timber.desktop` to `~/.local/share/applications` and to `~/Desktop`, and
  exited with 0. The installed `app/bin/launcher` then starts the app.
- The installed app in the COSMIC Wayland session: the window opened, found
  Timber, and listed the 14 worktrees of this repository with their
  markers, seen by eye in a screenshot. The window was an X11 window
  (found with `xwininfo` on the session's XWayland display), so the app
  runs through XWayland, not as a native Wayland client. The log has one
  `X11 Error: GLXBadWindow (code 168)` on start; nothing on screen was
  wrong. No clicks were sent to this window in this run (an earlier run
  found that XTest clicks do not reach it under COSMIC, see issue 25
  above), so terminals, the folder picker, and editor launching were
  checked in Xephyr only.
- The same installed app in a nested X server, `Xephyr :2` with no window
  manager, started with `DISPLAY=:2`, no `WAYLAND_DISPLAY`,
  `XDG_SESSION_TYPE=x11`, and its own `XDG_CONFIG_HOME`. Clicks and keys
  were sent with XTest and checked in screenshots:
  - With `TIMBER_APP_REPOS` naming this repository, the window listed its
    14 worktrees. Open terminal started bash in the primary checkout, and
    `echo` printed back. Closing the window asked "Quit Timber?", and Quit
    exited with 0.
  - With an empty settings file, "Add repository" opened GTK's own file
    chooser, an "Open File" window of the app's own process on the
    Xephyr display. Typing the repository's path and Select added
    it, showed "Added timber-app", and saved it with its common directory.
  - Open in editor, with a stand-in shell script as the editor, ran it in
    the worktree's folder with the folder as its one argument and showed
    the toast. VS Code and Zed were not started.
  - The log had `libEGL warning: DRI3 error: Could not get DRI3 device`
    and `X11 Error: GLXBadWindow (code 170)`; the window drew normally.
- `bun run dev` in the same Xephyr: the window opened and listed the
  worktrees. Touching `src/bun/index.ts` rebuilt and relaunched it. Closing
  the window leaves the watcher running until it is stopped.
- `bun run dev:hmr` in the same Xephyr: Vite served on port 5173, the
  window connected to it, and touching `src/mainview/styles.css` was a hot
  update (`hot updated: /styles.css` in the webview's console).
- Not run: a real X11 login session (this machine has none, only
  Xephyr), a native Wayland window, `GDK_BACKEND=wayland`, GNOME, KDE, or
  any other distribution, and an NVIDIA GPU. The system packages were
  already installed, so which of them a clean system needs was not tested.
  The `typecheck-desktop` CI job was added and has not run yet.

Run for the display server on Linux (issue 63), the same Pop!_OS 24.04 LTS
x64 machine, COSMIC on Wayland (`XDG_SESSION_TYPE=wayland`,
`WAYLAND_DISPLAY=wayland-1`, XWayland on `DISPLAY=:1`), with the dev build
from `bun run dev`. Its `libNativeWrapper.so` is byte for byte the one in
the Electrobun 2.0.6 toolchain. Each launch had its own `XDG_CONFIG_HOME`
and `TIMBER_APP_REPOS` naming this repository:

- `objdump -d` of `libNativeWrapper.so` and `libNativeWrapper_cef.so`:
  both `initializeGTK()` functions call `ensureXlibThreadSupport`, then
  `setenv("GDK_BACKEND", "x11", 1)`, then `gtk_init`. The strings
  `wayland` and `WAYLAND_DISPLAY` are read only by the screen capture
  code. The source of `v2.0.7-beta.24` still has the same `setenv`.
- Default environment: the window was an X11 window on `:1`
  (`xwininfo -root -tree`).
- `GDK_BACKEND=wayland`: with no Timber window on `:1` before the launch,
  the window again appeared there as an X11 window, and its `_NET_WM_PID`
  (`xprop`) was the app's `bun` process. The variable was not honoured.
- `GDK_BACKEND=wayland` with `DISPLAY` unset (`env -u DISPLAY`): the log
  had `Gtk-WARNING **: cannot open display:` and `Child process exited with
  code: 1`. No window opened.
- Not run: any other compositor or distribution, a real X11 login session,
  and anything that removes the `setenv` (such as an `LD_PRELOAD` shim),
  since the rest of the wrapper needs X11 anyway.

Run for what the desktop development commands leave behind (issue 65),
Pop!_OS 24.04 LTS x64 in the COSMIC Wayland session, Bun 1.4.2, Electrobun
2.0.6. The window was closed by sending it a close request over X11
(`WM_DELETE_WINDOW`), as for issue 13, with no terminal session open:

- `bun run typecheck`: no errors.
- `bun test`: 1098 tests, 1097 passed and 1 skipped.
- `bun run dev`: the app logged `[stopEventLoop] Initiating clean event loop
  exit` and ended; `hutch-engine electrobun dev --watch` and its parents kept
  running, and printed nothing. Touching `src/bun/index.ts` then printed
  "Change detected, rebuilding..." and launched the app again. SIGINT to the
  command's process group, as Ctrl+C sends it, ended every process.
- `bun run dev:hmr` before the change: `bun run start exited with code 0`,
  and Vite kept serving on port 5173 under `concurrently`.
- `bun run dev:hmr` with `--kill-others --success first`: after the app
  exited, `concurrently` sent SIGTERM to Vite, the command exited with 0,
  no process of it was left, and port 5173 was free.
- The same `bun run dev:hmr` with the window open, and SIGINT to its process
  group: both sides ended, the command exited with 0, no process of it was
  left, and port 5173 was free.
- Not run: how the watcher stops the app for a rebuild (by which signal, if
  any), a failing Vite server stopping the app under `dev:hmr` (a test with
  the port taken on 127.0.0.1 did not make Vite fail), and any of these
  commands on Windows or macOS.

Run for the Linux install (issue 62), Linux x64 (Pop!_OS 24.04 LTS, natively,
COSMIC on Wayland) with Bun 1.4.2 and Electrobun 2.0.6. Every install ran
the built launcher with `env -i PATH=/usr/bin:/bin HOME=<temporary folder>`,
so nothing was written to the real home folder. Each install log ended at
"Installation completed successfully!" with no sign of the app starting:

- `bun run build` with the configuration as committed, then an install:
  the menu entry and the shortcut were both installed, the menu entry had
  no `Icon=` line and `Comment=Timber`, and `desktop-file-validate` warned
  that `Comment` looked the same as `Name`.
- `bun run build` on trial, with `build.linux.icon` set to
  `src/mainview/assets/logo.png` and `app.description` set: completed. The
  build had `Resources/appIcon.png`, and the installed menu entry and
  desktop shortcut both had `Icon=` set to its absolute path and the
  description as `Comment=`. `desktop-file-validate` on both: no output,
  exit 0. Neither setting is committed; the icon is left to issue 27.
- The installs below used the trial build.
- Install with `~/Desktop` present: the app folder, the menu entry, and the
  shortcut, as described in
  [installing the Linux build](#installing-the-linux-build).
- Shortcut deleted, launcher run again: the shortcut came back.
- No `~/Desktop`: only the menu entry. With `XDG_DESKTOP_DIR` set to
  `~/Schreibtisch`, in `~/.config/user-dirs.dirs` and in the environment:
  still only `~/Desktop` was used, and nothing went to `~/Schreibtisch`.
- `XDG_DATA_HOME` set to another folder: the app, `uninstall`, and the menu
  entry went there, and the shortcut still went to `~/Desktop`.
- Electrobun's configuration type at tag `v2.0.7-beta.24`, read with
  `gh api` on 2026-11-16: no setting for the desktop shortcut.
- `uninstall --quiet`: exit 0, and the app folder, both entries, and the
  icon file were gone.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1097 tests passed and 1 was skipped.
- `grep -rn $'\u2014' src tests docs README.md electrobun.config.ts`: nothing.
- Not run: the icon seen in a real menu, dock, or window title bar, an
  install into a real home folder with a display, and so whether the app
  starts after installing, an update over an earlier install, the
  uninstaller without `--quiet` in a session that can ask, and anything on
  Windows or macOS.

Not run yet:

- Saving settings through `timber setup` inside the app. Setup was started
  and cancelled only.
- The GitHub integration with a signed-in `gh` in the desktop app. Only a
  stand-in for its exit code was used.
- Timber's settings on macOS or Windows, including where the machine file
  is found there.
- The setup prompt in the desktop window, and so its setup session through
  the RPC bridge. The real Timber's guided setup was not driven by a test.

Run for saving Timber's settings through Timber (issue 22), Linux x64
(Omarchy, Hyprland) with Bun 1.4.4, Git 2.56.1, and Timber built from its
`main` branch at e1ccd00 with the version set to 0.1.2 locally (0.1.2 is not
released yet), named with `TIMBER_APP_TIMBER_PATH`:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- `TIMBER_APP_TIMBER_PATH=<that build> bun test`: 966 passed, 1 skipped, and
  1 failed. The failure is "closing a session ends everything it started,
  even what ignores a hang-up", which times out after 5 seconds on `main`
  too, without this change. With the installed Timber 0.1.1, which is now
  too old, the tests that need a real Timber are skipped: 886 passed, 91
  skipped, the same 1 failed.
- Against the real Timber in temporary repositories with a private
  `XDG_CONFIG_HOME`: reading left files, refs, and the index unchanged;
  saving one group wrote the file with setup's header, kept the named
  workflow, and left Git status clean; a blank editor command was refused
  as `editor.command is invalid` with the file byte for byte unchanged; an
  edit made between read and save, and an edit to a named workflow, were
  each a conflict with the outside edit kept; a Linear key was saved and
  then reported only as saved, appearing in no result, read, or settings
  file; a Jira check with no site answered a safe failure and changed
  nothing. With stand-in executables, the input file was mode 0600 in a
  mode 0700 folder outside the repository, removed afterwards, and no login
  was in the arguments.
- Recorded output of that Timber is in `tests/fixtures/timber-config`.
- `bun run dev:web` in headless Chromium driven by Playwright: a blank
  starting branch was refused at the field and nothing saved; "develop"
  saved and read back; a Linear key passed Test connection, saved, was gone
  from the field and from the page; the tracked repository held Save back
  until the box was ticked and then showed `--edit-tracked` in the command;
  an outside change made the save a conflict, Read again kept the typed
  editor, and the next save went through. No errors besides a 404 for a
  missing resource. Screenshots were looked at.
- `bun run start` with the build above: the main process logged
  "Timber 0.1.2 at <that build>" and the window opened. The window was not
  driven, so saving from inside the desktop window was not run there; the
  same main process module ran against the real Timber in the tests.
- Again on 2026-11-16, after rebasing onto the setup prompt and fetching,
  with the released Timber 0.1.2 (`timber-v0.1.2-linux-x64` from the
  release, checked against its `SHA256SUMS`) named with
  `TIMBER_APP_TIMBER_PATH`: `bun run typecheck` and
  `bun run typecheck:desktop` gave no errors, and `bun test` gave 1104
  passed, 1 skipped, and the same 1 failed. With the installed Timber 0.1.1:
  1022 passed, 93 skipped, the same 1 failed. Nothing was run in a window
  this time.

Not run yet:

- Saving or checking from inside the desktop window, and over the RPC
  bridge.
- A Jira or Linear login check that succeeds. Only rejected and missing
  logins were checked against the real services.
- A tracked `.timber.toml` saved with `--edit-tracked` by the real Timber
  from the app. Timber itself was run with it by hand.
- Timber's settings on macOS or Windows.

- Open in editor for a file from the desktop window. It ran only through the
  main process module with a stand-in editor, and in the mock engine.
- The Changes tab on Windows or macOS.

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
- Open in editor from the desktop window, and through the RPC bridge. VS
  Code was started only from the main process module, and Zed not at all.
- Launching an editor on Windows or macOS. On Windows batch files are
  refused for now, and the stand-in editors of the tests are shell scripts.
- Anything on macOS, terminals included.
- Watching for changes on Windows or macOS, where `fs.watch` works
  differently. It was run only on Linux.
- Terminals on Windows, where `Bun.Terminal` does not exist: they answer
  that they are not supported, and that answer was only acted out on Linux.
- A click on the window's close button by a person. The same request was
  sent over X11 instead (see above).
- Copying with Ctrl+Shift+C and opening a link with Ctrl+click in the
  desktop window. Both were checked as functions only.
- A real X11 login session. Linux was run in a COSMIC Wayland session
  through XWayland, in Xephyr, and under WSLg (see issue 28 above). A native
  Wayland window is not possible with Electrobun 2.0.6 (see issue 63 above
  and [display server on Linux](#display-server-on-linux)).
- A Wayland session other than COSMIC, such as GNOME or KDE.
