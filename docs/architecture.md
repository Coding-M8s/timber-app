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
   [creating and opening worktrees](#creating-and-opening-worktrees)), and
   so is rebasing, which reads Timber's result file (see
   [rebasing a worktree](#rebasing-a-worktree)). Pull requests come from
   `timber __app-pr`, with Timber's GitHub login (see
   [pull requests](#pull-requests)), and the live state of a worktree's
   issue from `timber __app-issue`, with Timber's tracker logins (see
   [linked issues](#linked-issues)).
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
  the folder exists, the changes, which are either known with their
  modified and untracked paths or unknown with Timber's reason, and the
  saved base (below). Ignored files are left out.
- **Saved base.** The record's `base` field becomes `Worktree.base`, a
  `SavedBase`: assigned with the canonical ref exactly as Timber saved it,
  unassigned, or invalid with Timber's reason (malformed, stale, or
  unreadable). A record without the field, as from a Timber before it, reads
  as null and the app shows no base at all. A field of any other shape
  refuses the list like any unreadable record. The app never infers a base
  from branches or history, and never checks that the saved ref still
  exists: Timber reads it offline, so it is a saved choice. Its words come
  from `src/mainview/base-format.ts`, which is pure. A base is worded in the
  form Timber takes for `--base` and prints in its own list
  (`savedBaseSelector` in `src/shared/rebase-command.ts`):
  `refs/remotes/origin/main` as `origin/main`, and a local branch by its
  full ref, `refs/heads/main`. The row's tooltip is its path followed by
  "(Base origin/main)", "(No saved base)", or "(Base unknown)". The workspace
  header shows the same words after the changes, with the whole sentence as a
  tooltip, and "Base unknown" in the error color.
- **Saved issue link.** The record's `issue` field becomes `Worktree.issue`,
  an `IssueLink`: linked with the tracker (`github`, `jira`, `linear`), the
  key as saved, and the `https` address; none; or invalid with Timber's
  reason. It is read as strictly as `base` (`readIssue` in
  `src/shared/timber-ls.ts`): a record without the field, as from Timber
  0.1.2, reads as null and no issue shows; any other shape, an unknown
  tracker, or an address that is not `https` refuses the list. So a tracker
  Timber adds later makes an older app refuse the list rather than guess.
  Timber reads the link offline; its title and status come from
  [linked issues](#linked-issues).
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
  missing" or "status unknown", "locked", "prunable", and "base unknown" for
  saved base metadata Timber cannot use. Timber calls the base stale
  whenever it could not verify the worktree, so a row that already says
  "folder missing" or "status unknown" is not marked again for that. At the end: the
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
so do the Done dialog (see [removing a worktree](#removing-a-worktree)) and
the Rebase dialog (see [rebasing a worktree](#rebasing-a-worktree)), which
needs a Timber that writes the result file for rebase and falls back to a
session on an older one.

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
  the selected worktree, and Done in a sidebar row's menu (right-click,
  Shift+F10, or the context menu key) opens it for that row's worktree,
  without selecting it (`worktreeMenuChoice` in
  `src/mainview/worktree-menu-format.ts`). For the primary checkout, and
  while Timber removes the worktree, both are disabled with the reason. Timber refuses the primary checkout anyway, and the main
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
  untracked file, the count of ignored paths and how far removal reaches for them,
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
- **Where the approval is kept.** In the main process. The interface gets the
  parsed preview and a name for it. On Remove it sends the name back, and the
  main process writes the version, snapshot, expiry, repository and worktree
  identity, and options from Timber's preview to the private approval file.
  File lists can exceed Timber's 1 MiB approval-file limit and are used only
  for the preview. The interface cannot alter the approval, and each name is
  used up by one call. At most 16 approvals are kept.
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
- **In the background.** Once Remove is pressed, the store owns the removal
  (`removeWorktree` in `src/mainview/store/store.ts`), and the dialog can be
  closed with Close or Escape while it runs: closing never stops it. Each
  removal is a record in `removals` (`src/mainview/store/state.ts`), named by
  the repository and the worktree's registered path, because the worktree's
  identity can change while its folder is deleted. While it runs, the row says
  "removing", and Done, Rebase, Open in editor, and new sessions are off for
  that worktree. The store refuses them as well: Done and Rebase by not
  opening their dialogs, the others by running nothing. Closing the dialog
  would leave the keyboard nowhere, because the Done button is disabled, or
  gone once the removal worked, so it goes to the first worktree row of the
  repository's group, or to the group's header while it is collapsed
  (`focusFirstWorktree` in `src/mainview/sidebar-focus.ts`). A second removal of the
  same worktree runs nothing. Other worktrees, sessions, and dialogs keep
  working, and removals of different worktrees run at the same time. Two real
  `timber __ide-done apply` runs in one repository at once have not been
  tested against Git's own locks; a clash would show as a normal failure.
- **How it ends.** A removal that worked leaves a toast, and closes the Done
  dialog of that worktree if it is still open, never another dialog. A
  failure stays as a record until the person closes the Done dialog that
  shows it: the row says "removal failed" with Details, which opens the Done
  dialog with Timber's diagnostic and output. When the row does not show,
  because the worktree left the list (as after a partial failure), the group
  is collapsed, or the filter hides it, the failure shows in its repository's
  group with Details and Dismiss, and a removal that runs shows there as
  "Removing" and the worktree's name. Unless the
  Done dialog of that worktree is open, a toast points at the failure as
  well, with its own mark. A failure goes when its repository leaves the
  list. One whose worktree leaves the list is kept as gone, and a gone one
  goes when a worktree is listed at its path again. The
  records live in the window only: reloading the window forgets them, while
  Timber goes on in the main process.
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
  interface, `__app-config`, and one-off workflows (0.1.1 had only the
  first). The number and the comparison live in
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
- **Order.** The sidebar shows the repositories in the order of the entries
  in the file, which starts as the order they were added. Moving a group
  (`Engine.reorderRepositories`) rewrites that order and nothing else; an
  order that changes nothing writes nothing. The store shows the move at once
  and keeps it over a list read that answers while the save runs. Moves save
  one after another, and a move overtaken by a later one is not saved on its
  own. A save that fails reads the list again, so the saved order comes back,
  and says why. No Git command runs.
- **Unavailable.** A saved repository that Git cannot read at its saved path,
  because the folder is missing or is no longer a primary checkout, stays in
  the list marked unavailable, with Remove offered. It comes back on the next
  refresh once the folder does.
- **Development override.** When `TIMBER_APP_REPOS` is set (paths separated by
  `;` on Windows or `:` elsewhere), the app shows those repositories instead
  and leaves the saved list alone. Add, Remove, and moving a group then
  explain that the variable is set. Paths in it that are not repositories are skipped.
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
  dismissed. A failure stays where the person can act on it. A toast can at
  most point there, with its own mark, as for a removal that failed in the
  background (see [removing a worktree](#removing-a-worktree)).
- **Dialogs.** Every dialog that runs a Timber command is an
  `OperationDialog` (`src/mainview/components`) driven by a submission
  (`src/mainview/store/submission.ts`, through `useSubmission`). The command
  is shown before it runs. While it runs, the fields and buttons are
  disabled, a progress bar shows, the dialog cannot be closed, and a second
  submission does nothing. When it worked, the dialog closes and the toast
  shows. Done is the exception: its removal is the store's
  (`removeWorktree`), the dialog shows the store's record of it, and it can be
  closed while the removal runs (`closableWhileRunning`). When it failed, the dialog stays open with the failure, ready for a
  correction and a retry. Closing gives the keyboard back to the control
  that opened the dialog, such as a worktree row, when it is still in the
  window and enabled. When it is not, as after a removal, the Done dialog
  puts it on the repository's first worktree row (`focusFirstWorktree`).
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
`timberMock.endRebaseResults(ending)` chooses how `timber rebase` ends from
then on: `"rebased"` (the start), `"up-to-date"`, `"conflicts"` (two sample
paths, one with a space), `"refused"`, `"failed"`, `"no-result"` (exit code 1
and no result file), or `"unsupported"` (a Timber too old to report). A
worktree with modified or untracked files is refused whatever the ending, as
Timber does, and a mock Timber older than 0.1.2 is unsupported.
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

## The saved window

The window opens where it was and as large as it was when the app last ran.
This is the main process alone: the interface has no part in it, so it is
not in the `Engine` contract.

- **Where.** The `window` part of the settings file (`SavedWindow` in
  `src/shared/window-frame.ts`): the frame of the window in its normal state
  and whether it was maximized. A file without it is valid and means the
  default window, 1280 by 820. A part that cannot be read, or a size below
  480 by 320, also means the default and never makes the file count as
  damaged.
- **When it is saved.** Electrobun reports every move and resize. The window
  is read once it has been still for 400 milliseconds, never while it is
  dragged, and again when the app quits (`src/bun/window-memory.ts`). It
  saves through the same `SettingsHolder` as everything else, and a save
  that fails is only a warning in the log.
- **Maximized and full screen.** Both report the frame they fill, so the
  frame from before is kept, and the window goes back to the chosen size
  when it leaves that state in a later run. Maximized is remembered and
  asked for again on start. Full screen is not.
- **Displays change.** Before the window opens, the saved frame is moved,
  and shrunk when it has to be, until it lies within the usable area of the
  display that shows most of it (`fitWindowFrame`). A window saved on a
  display that is gone opens on the primary one.
- **No creep.** A window can land a pixel or two away from the frame it was
  opened with, as it does through XWayland with a fractional scale. A change
  of two units or less in every part is not remembered, so the window does
  not move a little further with every run.
- **Tiling.** A tiling window manager sizes the window itself. The app then
  remembers that size, and asking for it on the next start changes nothing.

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
- **Sections today.** Layout: the side of the sidebar, left by default, and
  the zoom (see [interface zoom](#interface-zoom)). Theme: the colors (see
  [themes](#themes)).
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

## Interface zoom

How large everything in the window is drawn, as the `zoom` preference
(`src/shared/zoom.ts`): 1 is the size the window system gives, and it is the
default.

- **Why.** The window is an X11 window (see
  [display server on Linux](#display-server-on-linux)). On Wayland, where a
  compositor leaves the scaling of X11 windows to the app, as Hyprland does
  with `xwayland:force_zero_scaling`, the only scale the app is told is
  `GDK_SCALE`, a whole number. At a monitor scale of 1.6 that is 1 or 2,
  never 1.6, and the interface is drawn too small or too large. The app
  cannot read the real scale from inside XWayland, so the person sets it.
- **Choosing.** Settings, Layout has a Zoom list from 75% to 300%, with
  160% among them. The preference itself takes any number from 0.5 to 3, to
  two decimals. A saved zoom that is not in the list, as after editing the
  file by hand, is offered too. One that cannot be read means 100%.
- **Keys.** Ctrl and plus (or equals, on the same key) zooms in, Ctrl and
  minus zooms out, and Ctrl and 0 goes back to 100%; on macOS Cmd instead of
  Ctrl (`src/mainview/zoom-keys.ts`). A step is the next zoom of the
  Settings list either way (`stepZoom`), so the keys and the list agree, and
  a zoom between two of them goes to the nearest one that way. Each press
  saves the preference as Settings does, and a toast says the new zoom; at
  either end the zoom stays and the toast still says it. Quick presses add
  up before their saves answer. A failed save changes nothing. The window
  hears the keys before anything in it, so they zoom from inside a terminal
  too and never reach its program; Ctrl+Shift+minus types an underscore and
  still reaches it, for programs that read it as undo. The webview has no
  zoom keys of its own, as a browser does.
- **Applying.** The main process sets the page zoom of the window's webview
  (`setPageZoom`) on start and after every save of the preferences, so a
  change shows as soon as it is saved. The window keeps its size: at a
  higher zoom less fits in it.
- **Not zoomed.** What the system draws for the page: the open list of a
  select and tooltips keep their own size.
- **The mock engine** saves the zoom like any preference and draws nothing
  differently, because a browser has its own zoom. In `bun run dev:web` the
  zoom keys save and show the toast, and the browser may zoom as well.
- **Without the setting.** Starting the app with `GDK_DPI_SCALE=1.6` in its
  environment has the same effect, and the two multiply.

For the Done dialog, with a worktree's path:
`timberMock.setChanges(path, { modified: ["a.ts"], untracked: ["b.ts"], ignored: ["dist/"] })`
makes a dirty worktree, and called while the dialog is open it is a change
between preview and Remove, which the removal refuses;
`timberMock.expirePreviewsAfter(5000)` makes previews expire after that many
milliseconds (`null` for ten minutes again);
`timberMock.failBranchDeletion(true)` acts out a partial failure, in which
the worktree leaves the list and the branch is not deleted; and
`timberMock.setDoneDelay(3000)` sets how long a removal takes, long enough
to close the dialog, look at the row, and start a second removal.

## Themes

Every color of the window, the terminals included, comes from a theme, and
the `theme` preference says which.

- **A theme is data.** `Theme` in `src/shared/theme.ts`: an id, a name, an
  appearance (dark or light), the interface's colors (`UI_COLOR_PROPERTIES`,
  each with the CSS custom property the stylesheet uses for it), and the
  terminal's (`TERMINAL_COLORS`, named as xterm.js names them: background,
  text, cursor, selection, scrollbar, and the sixteen ANSI colors). A color
  is hex or `rgb()`/`rgba()` text (`src/shared/color.ts`). `readTheme` never
  fails: a part that is missing or cannot be read comes from Timber Dark or
  Timber Light, by the theme's appearance, and is named in `replaced`, for
  an import to refuse the file.
- **Built in.** `src/shared/builtin-themes.ts`: Timber Dark (the colors the
  app was designed in, and the default), Timber Light, Catppuccin Mocha,
  Gruvbox Dark, Nord, Solarized Dark, and Solarized Light. A palette gives
  the surfaces, text, and meaning colors and the sixteen ANSI colors; the
  see-through fills and shadows, the diff backgrounds, and the terminal's
  selection follow from them. Where a palette's own color was under the
  contrast minimum, a nearby shade is used. Their notices are in
  `licenses/theme-palettes.txt`.
- **The choice.** `ThemeChoice`: `{ mode: "fixed", theme }`, or
  `{ mode: "system", light, dark }` to follow the system's setting. It is the
  `theme` preference, saved like any other (see
  [preferences](#preferences-and-the-settings-dialog)), so the Engine
  contract did not change. An id that names no theme, as from a later
  version, is kept, and means Timber Dark or Timber Light for its slot.
- **On the page.** `themeStyleSheet` turns a choice into one stylesheet that
  sets every custom property and `color-scheme` on `:root`. Following the
  system is a `prefers-color-scheme` media query in it, so the page changes
  with the system by itself. It lives in one style element,
  `THEME_STYLE_ID`. `styles.css` sets only the fonts on `:root` and uses no
  color of its own; a test holds it to that and checks that every custom
  property it uses is defined.
- **Before the first paint.** The main process reads the saved preferences
  before it opens the window and gives the window a `preload` script
  (`src/bun/theme-preload.ts`) with the stylesheet in it. Electrobun runs it
  at the start of every page load, before the page's own stylesheet, so the
  first frame is already in the saved theme. In a browser, `main.tsx` reads
  the preferences and applies the theme before React renders.
- **Showing the window.** The window is made hidden. `main.tsx` renders the
  first time at once (`flushSync`), waits for the built-in fonts (at most
  half a second) and one task, and calls `windowReady` on the `Engine`,
  which shows the window (`src/bun/window-reveal.ts`). Until then nothing
  is on screen, so the webview's white background and the empty page are
  never seen. If the word never comes, as when the page failed to load, the
  window shows anyway after four seconds and the log says so. What is left
  is GTK's own window background for one or two frames as the window
  appears, before WebKit draws: Electrobun 2.0.6 sets neither a window's
  background color nor a webview's, apart from making them transparent.
  The mock engine counts the word; a browser shows the page itself.
- **Keeping it.** `src/mainview/theme-apply.ts` holds the saved choice and,
  while Settings shows one, an unsaved one, and writes the style element
  only when the one to show changes. `ThemeKeeper` in `App.tsx` applies the
  saved choice when it changes, but never the store's default from before
  it read the preferences, which would flash.
- **Terminals.** Their colors come from script, so `theme-apply` resolves
  the choice against `matchMedia("(prefers-color-scheme: dark)")`, and
  listens for it to change, and hands the colors to
  `src/mainview/terminal-colors.ts`. Each terminal view watches that and
  sets xterm's `options.theme`, which redraws at once and keeps the session,
  its screen, and its scrollback. It is a module of its own so that applying
  a theme does not load xterm, which loads only once a terminal shows.
- **Contrast.** `contrastWarnings` measures each text color and meaning
  color (focus included) on every surface, and the terminal's text on its
  background, as WCAG 2 does, laying see-through colors over the app's
  background first. The minimums are WCAG AA (text 4.5:1, meaning colors
  3:1) unless the maker asks for AAA (7:1 and 4.5:1). The sixteen ANSI
  colors are the programs' and are not checked: terminals raise any that
  are too faint as they draw them (see [terminal sessions](#terminal-sessions)). Timber
  Dark's greys are the interface's own, `text2` for white and `text3` for
  bright black, and need no raising. Every built-in theme passes
  AA.
- **Settings, Theme.** `src/mainview/components/settings/ThemeSection.tsx`:
  "One theme" or "Follow the system's light or dark setting", and a card per
  theme with a small picture of a sidebar, a diff, and terminal colors,
  drawn by setting the theme's custom properties on the picture itself.
  Following the system shows two sets of cards, the slot's own appearance
  first. Switching between the two keeps the theme in use
  (`src/mainview/theme-format.ts`). A choice shows at once; Save keeps it,
  and leaving Settings without saving goes back.
- **Custom themes.** The `customThemes` preference
  (`src/shared/custom-themes.ts`), up to 50, listed after the built-in
  ones. Each id starts with `custom-` and comes from the name, so it can
  never be a built-in one's, and stays the same through a rename. Names are
  kept apart, ignoring case. A save from the interface must hold every
  theme whole, or nothing is saved. In the settings file, a theme whose id,
  name, or appearance cannot be read is left out, and a color that cannot
  be read comes from Timber Dark or Timber Light. "Your themes" in the
  Theme section edits, exports, and deletes them; each of those saves at
  once, apart from the section's Save. Deleting a theme that is in use
  puts the app's own theme of that slot in its place, in the same save.
- **The maker.** `ThemeMaker.tsx`, in the Theme section's place, in a
  dialog widened to 1080 pixels. It holds a draft with each color as typed
  (`ThemeDraft`, `draftModel` in `theme-format.ts`), so a color can be
  half typed: the previews keep the color it started from until the text is
  a color, and Save waits. The color picker takes six hex digits, so a
  see-through color keeps its alpha when one is picked. The previews are
  `ThemeSamples.tsx`: the interface drawn with the draft's custom
  properties, and a real xterm.js terminal showing the mock shell's
  `sample` (`src/mainview/terminal-sample.ts`), loaded only once the maker
  shows (`terminal-sample-view.ts`), whose colors follow through
  `options.theme`. Contrast warnings never block a save.
- **Theme files.** `src/shared/theme-file.ts`: JSON with `"format":
  "timber-theme"`, `"version": 1`, the name, the appearance, and every
  color, but no id. Reading is strict: a file over 64 KB, one that is not
  JSON, of another format or a later version, or with any part missing or
  not a color is refused with the reason, and the reason names the colors.
  `exportTheme` and `importTheme` are on the `Engine` contract. The main
  process (`src/bun/theme-files.ts`) asks with the system's dialog,
  Electrobun's `openFileDialog`, which has no save dialog: Export picks a
  folder and writes a new file named after the theme, `-2` and up when the
  name is taken, opened with `wx` so nothing is ever written over. Import
  picks one file and only reads it. An imported theme gets a new id and,
  when its name is taken, "Name 2"; it is saved at once and shown, and Save
  makes it the theme in use. Neither saves the preferences by itself.
- **The mock engine** keeps the theme and custom themes like any
  preference, in memory (`src/mainview/engine/mock-theme-files.ts`).
  Export downloads the file in a browser, and Import opens the browser's
  file picker. `timberMock.setThemeImport(text)` gives the next Import a
  file's text (null for a closed picker), and `timberMock.exportedThemes()`
  lists what Export wrote.

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

## Named workflows

The app knows which named workflows Timber offers for a repository, so that
New and Open can offer them, without parsing Timber's TOML for them.

- **Asking.** `listWorkflows` on the `Engine`, answered by
  `src/bun/workflows.ts`. For a repository in the app's list only, the main
  process runs `timber __app-config read --scope repository` in its primary
  checkout, as an executable plus an argument array, with standard input
  closed and a limit of ten seconds. Nothing runs while Timber is not ready.
- **Reading.** `readWorkflowList` in `src/shared/workflows.ts` is pure. It
  accepts one version 1 record for the repository scope from a Timber that
  exited with 0, and keeps only `effective.workflows`: so the machine
  defaults and `.timber.toml` are merged by name exactly as Timber merges
  them, a repository's `review = false` hides an inherited workflow, and
  `workflows = false` leaves none. Each workflow keeps its name, its
  description (made safe to show), and its agent: a command (executable and
  arguments), none (`agent = false`), or not set. Timber's order is kept.
  Everything else in the record, including whether credentials are saved,
  is dropped. Fields the app does not use are ignored.
- **Never an empty list by mistake.** A failing exit code, output that is
  not one such record, another schema version, or any workflow that cannot
  be read fails the whole list, with a message. A repository with no
  workflows is an empty list. On failure the message carries the last line
  Timber wrote to standard error, which names the file and the field but
  never a value; it is cleaned and cut at 300 characters, and never parsed
  for meaning. A Timber without `__app-config` answers "unknown command".
- **Private.** Unlike the Settings rows, an agent's arguments are passed on
  whole, because starting that agent needs them. They can hold tokens, so
  neither the record, the list, nor Timber's diagnostic is ever logged, and
  the interface must not show arguments without cleaning them.

In `bun run dev:web` timber has a workflow of each agent kind, api-server
has none, and billing's fails as its `.timber.toml` is malformed.
`timberMock.setWorkflows(path, list)` changes one (`null` for the sample).

## Pull requests

Each row shows its branch's pull request, read from GitHub by Timber, so
there is one sign-in, Timber's, and the app holds no token.

- **Asking.** `readPullRequests` on the `Engine`, answered by
  `src/bun/pull-requests.ts`. For a repository in the app's list only, and
  only while Timber is ready, the main process runs `timber __app-pr` in its
  primary checkout, as an executable plus an argument array, with standard
  input closed and a limit of thirty seconds. Timber stops its own network
  part after fifteen. One run answers for every worktree of the repository.
  Timber reads the login it uses for `timber new github:<n>` (`GH_TOKEN`,
  `GITHUB_TOKEN`, or the GitHub CLI's), never prompts, and changes no file
  or ref. This needs a Timber with `__app-pr`, which is on Timber's main
  branch and in no release yet. An older one answers "unknown command".
- **Reading.** `readPullRequestList` in `src/shared/pull-requests.ts` is
  pure. It accepts one version 1 record from a Timber that exited with 0, or
  with 1 when a lookup failed, and only when the exit code agrees with the
  entries. Each entry is found, none, or failed with a reason (`offline`,
  `sign-in-needed`, `not-github`, `failed`) and Timber's diagnostic. A found
  one keeps its number, its `https` link, its title (made safe to show), its
  state, its base branch, the summary of its checks with how many runs pass,
  fail, and are pending, each run with its name, status, and link, its
  review decision, and its description. A run's link is kept only when it
  is `https`, since a commit status may point anywhere. The description
  keeps its line breaks and tabs and is otherwise made safe like any text
  from GitHub (`descriptionText`), cut at 20000 characters, and never
  rendered as markup. Timber reports no reviewers, so the app has none to
  show. Fields the app does not use are ignored.
- **Never an empty answer by mistake.** Another exit code, output that is
  not one such record, another schema version, a repository Timber could
  not read (its `diagnostic`), or any entry that cannot be read fails the
  whole answer, with a message. Nothing Timber printed is logged.
- **When.** The interface (`src/mainview/store/store.ts`) reads a
  repository's pull requests when it is first listed, and again each time a
  fetch of it ends, worked or failed. So they follow the background fetch
  interval, wait while the window is hidden as fetches do, and are read
  again after Fetch now. With background fetching off, only Fetch now reads
  them again. Reads of one repository never overlap, and a removed
  repository's answer is forgotten.
- **Showing.** `describeRowMarkers` takes the worktree's entry, found by its
  Git-registered path (`pullRequestOf`), and adds the pull request's markers
  from `src/mainview/pull-request-format.ts` after the row's state flags.
  A failure is shown once, as a quiet word on the repository's header, and
  in the workspace header of a selected worktree in it, never on every row
  and never as a dialog. "Open pull request" in the workspace header goes
  through `openLink`, which opens only `http` and `https` links.
- **The Pull request tab.** `PullRequestPanel` shows the selected
  worktree's entry from the same answer, with its words from the pure
  `describePullRequestTab` in `src/mainview/pull-request-tab-format.ts`:
  the pull request, "No pull request yet", "Not read yet" before the first
  answer, or why it could not be read. It reads the store only, so it
  changes whenever the pull requests are read again, and it runs no
  command. Its controls open links through `openLink`.

In `bun run dev:web`, timber has an approved pull request and one with
failing checks and requested changes, api-server a merged one, and billing
a draft and a closed one, with descriptions and check runs that show
every status, a run without a link, and none at all. docs-site, once
added, is not on GitHub.
`timberMock.setPullRequests(path, list)` changes one (`null` for the
sample).

## Linked issues

A worktree made from a Jira, Linear, or GitHub issue shows that issue and
where it stands, read by Timber with its own logins, so the app never reads
a tracker login.

- **The link.** `Worktree.issue` comes from `timber ls --json` (see
  [the worktree list](#the-worktree-list)). Only a linked worktree is read.
- **Asking.** `readIssue` on the `Engine`, answered by `src/bun/issues.ts`,
  with a repository in the list and the worktree's Git-registered path. Only
  while Timber is ready, and only for an absolute path, the main process
  runs `timber __app-issue -- <path>` in the repository's primary checkout,
  as an executable plus an argument array, the path after `--`, with
  standard input closed and a limit of thirty seconds. Timber stops its own
  network part after fifteen, never prompts, and changes no file, ref, or
  issue. It refuses a path that is no registered worktree. This needs a
  Timber with `__app-issue`, which is on Timber's main branch and in no
  release yet. An older one answers "unknown command".
- **Reading.** `readIssueRecord` in `src/shared/issues.ts` is pure. It
  accepts one version 1 record whose outcome agrees with its fields and its
  exit code (0 for found or none, 1 for failed) and whose worktree is the
  one asked about. Found keeps the key, the `https` address, the title, the
  tracker's status name (cut at 40 characters), its category (open, in
  progress, closed), and the assignee, all made safe to show. Failed keeps
  the reason (`offline`, `sign-in-needed`, `not-found`, `forbidden`,
  `failed`) and Timber's diagnostic. Anything else is a failure with a
  message. Nothing Timber printed is logged.
- **When.** The store reads each linked worktree when it is first listed
  with its link or the link changes, and every linked worktree of a
  repository again each time a fetch of it ends, as for pull requests. The
  reads of one repository run one after another, so a fetch never starts a
  tracker request per worktree at once. An answer for a link that changed
  meanwhile is dropped and the new link is read next, a found issue whose
  tracker or key differs from the saved link is a failure, and a worktree no
  longer linked keeps nothing. Answers live in `state.issues` by worktree
  id. Since reads are one at a time and Timber allows a tracker fifteen
  seconds, a tracker that hangs makes a repository with many linked
  worktrees take minutes to go round; the earlier answers stay on screen
  meanwhile.
- **Showing.** `describeIssue` in `src/mainview/issue-format.ts` is pure and
  gives the short form ("PROJ-123 · In Review", "#153 · Open"), a sentence
  for the tooltip, the quiet word when the status could not be read, and
  the link. The row's tooltip adds the short form after the base
  (`describeRowTitle`). The workspace header shows it as a link that opens
  the saved address through `openLink`. The Pull request tab shows an Issue
  section above the pull request in every state (`IssueSection` in
  `src/mainview/components/IssueSummary.tsx`). A failure is a quiet word and
  a tooltip, never a dialog.

In `bun run dev:web`, timber has a GitHub issue that is open and a Jira
issue in review, api-server a Linear issue that is done, and billing a Jira
issue that is offline, a Linear issue that needs sign-in, and link metadata
Timber cannot use. docs-site, once added, has a GitHub issue that is not
found. `timberMock.setIssue(worktreePath, lookup)` changes one
(`null` for the sample).

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
  -nw`) without "Runs in a terminal" gets a warning. A command that starts
  with `zed` gets a note that `zeditor` is tried too (see Starting).
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
  Zed is installed as `zeditor` by some Linux packages, Arch's among them, so
  a command that starts with the name `zed` is looked for under that name
  first and then as `zeditor` (`otherExecutableNames` in
  `src/shared/editor.ts`, passed to `findExecutable` in
  `src/bun/find-executable.ts`). The saved setting stays `zed`. The tooltip
  shows the command as set, and the toast or failure after a start shows the
  name that ran. A full path is never swapped for another name. Where
  another program named `zed` is on the PATH, such as the ZFS event daemon,
  it is found first: set `zeditor` or a full path as the command there.
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
  names the command, every name that was looked for, and the PATH the app
  was started with. A PATH can hold dozens of folders, so the message names
  the first three and counts the rest (`src/shared/search-path.ts`), as it
  does for an agent that is not found. A change to PATH needs a restart, as
  for Timber.
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
- **Drawing.** xterm.js 6.0.0 with the fit, web links, WebGL, and Unicode 11
  addons, pinned exactly, and loaded the first time a terminal shows
  (`src/mainview/terminal-view.ts`). The terminal on screen draws with
  WebGL: it is faster than the elements xterm otherwise draws with, and it
  draws lines and blocks itself, so boxes join with no gaps between rows.
  Only the terminal on screen holds a WebGL context, because a window gets a
  limited number of them. Where WebGL cannot start, or the system takes the
  context away, elements draw instead. The first terminal waits for its
  font, at most 1.5 seconds, because xterm measures its cells when it opens.
  Wide characters such as emoji take two cells, as today's programs count
  them. The font, the text size, and the cursor come from Settings,
  Terminal (see "Terminal appearance" below). Each session's drawn terminal lives
  outside React for as long as the session does; a pane borrows it while it
  shows, so its scrollback and screen survive switching worktrees. A pane
  that shows for the first time draws what the main process kept, then
  every new part once (`src/mainview/terminal-feed.ts`, pure). What was kept
  can start in the middle of a full-screen program's picture, so when it
  leaves the alternate screen on, the size is changed for a moment and the
  program draws itself again. The pane's size goes to the shell after it
  has rested for 50 ms, never while a drag moves. A pane takes the keyboard
  when nothing else has it, or when it was asked for
  (`src/mainview/terminal-focus.ts`): choosing its worktree's row by click,
  Enter, or Space, choosing its chip, or a session the app started there,
  such as the agent of a new worktree after its dialog closed. Moving
  through the sidebar with Tab keeps the keyboard there. A worktree with no
  session to show, and none starting, forgets the wish.
- **Terminal appearance.** The `terminal`
  preference holds a font family, a text size, and a cursor shape
  (`src/shared/terminal-appearance.ts`, pure). The family is one name as
  typed, empty for the built-in Geist Mono. A name with quotes, commas,
  semicolons, backslashes, or braces is refused, because it would end the
  name in CSS. The font stack puts it first, then Geist Mono, then the Nerd
  Font symbol fonts when they are installed, for the icons prompts print. So
  a family that is not installed draws as Geist Mono. Settings tells that
  from the width of a text drawn in a canvas with the family and with two
  generic families as stand-ins, and says so under the field. The size is
  10 to 24 pixels: a size outside is clamped and rounded, and in the
  settings file a size that is not a number reads as 13. The cursor is a
  block, as before, or a thin bar. Both blink while the terminal takes
  input; without focus a block is drawn as its outline and a bar stays a
  bar. A save changes every open terminal at once
  (`src/mainview/terminal-look.ts`): it waits for the new font as the first
  terminal does, sets xterm's options, and fits again, so the session hears
  its new columns and rows. Before a terminal is drawn, its size is
  estimated from the chosen text size (`estimateTerminalCells`).
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
  keyboard there are Rename and Close at the right end of the row of chips,
  after the shown session's shell and state. They share the row so that no
  bar of their own takes height from the terminal. In the rename field Enter
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
- **The sidebar.** A worktree's row shows a mark for each agent session, and
  for each other running session whose program reported a status (see
  [agent status](#agent-status)), then the other running sessions in blue
  with their count. The row's description says it in words, such as "Codex:
  Needs you: approval. 1 other session running." Exited plain sessions are
  not counted.
- **Status.** Every session's output, shown or hidden, passes a scanner for
  the Program Status Protocol before it is kept and sent, and a session
  carries what its program last reported as `status`. The output goes on to
  the window unchanged. See [agent status](#agent-status).
- **Copy, paste, links.** Ctrl+Shift+C and Ctrl+Shift+V on Linux and
  Windows, Cmd+C and Cmd+V on macOS, through the system clipboard in the
  main process (`writeClipboard`, `readClipboard`), so Ctrl+C and Ctrl+V stay
  the program's. Pasting marks the text as pasted for programs that ask. A
  link opens with Ctrl+click, or Cmd+click on macOS, and only an `http` or
  `https` link with no spaces or control characters in it, in the person's
  browser (`openLink`, `src/bun/open-link.ts`). The link goes, as the URL
  parser writes it out, as the one argument of `xdg-open` on Linux or `open`
  on macOS, never through a shell, because it is whatever a program printed.
  Elsewhere nothing opens yet. Fonts come from the stylesheet and colors from the
  theme, the sixteen ANSI colors included, and an open terminal takes a new
  theme at once (see [themes](#themes)). Text is drawn at a contrast of at
  least 4.5:1 with its cell's background (`TERMINAL_MINIMUM_CONTRAST` in
  `src/mainview/terminal-colors.ts`, xterm's `minimumContrastRatio`): where
  a program's color is fainter, such as the grey agents print, xterm draws a
  lighter or darker shade of the same hue. xterm halves the minimum for dim
  text, which it draws faint on purpose, and leaves box and block
  characters alone.
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
typed and knows `pwd`, `clear`, `exit`, and `sample`, which prints a box,
the colors, and wide characters for looking at how a terminal draws. `timberMock.requestQuit()` acts
out quitting, `timberMock.endTerminal(id, code)` a shell that exits by
itself, and `timberMock.failTerminals({ outcome: "unsupported", message })`
a terminal that cannot start (`null` to undo).

## Rebasing a worktree

The Rebase dialog runs `timber rebase --result-file` and reads the record,
so it says how the rebase really ended: rebased, already up to date, stopped
on conflicts, refused, or failed. Timber 0.1.2 is the first release that
writes this record (`REBASE_RESULT_TIMBER_VERSION` in
`src/shared/timber-version.ts`).

- **Entry.** The Rebase control in the workspace header opens the dialog
  for the selected worktree (`src/mainview/components/RebaseDialog.tsx`).
  It is disabled when the worktree's folder is missing.
- **Onto.** A `BranchField` over the `listBranches` capability, which takes
  any typed ref. Timber reads a plain name as a branch on a remote, so a
  local branch is offered as `refs/heads/<name>`, and a remote-tracking one
  as `<remote>/<branch>` (`rebaseBases` in `src/shared/rebase-command.ts`).
  The spaces around the text are left off. Empty passes no `--base`, and
  Timber chooses, starting with the base it saved for the worktree.
- **Starting from the saved base.** The field starts as the worktree's saved
  base in that same form (`initialOnto`), as the list had it when the dialog
  opened, and a line above the field says so. Only a base Timber reported as
  assigned is filled in. A worktree with no saved base says "No saved base",
  invalid metadata shows Timber's reason as a warning, and both leave the
  field empty, as does a Timber that reports no base, for which the dialog
  says nothing. What the person types after that stays.
- **One source for the command.** `rebaseResultArguments` in
  `src/shared/timber-rebase.ts` builds
  `rebase [--base <ref>] --result-file <path> -- <registered path>`. The
  footer words it from that function with the result file shown as a
  placeholder, and the main process runs Timber from the same one, so the
  command shown is the command that runs.
- **Running and checks.** The store's `rebaseWorktree` asks the engine's
  `rebaseWorktree` once. In the main process, `WorktreeCommands.rebase` in
  `src/bun/worktree-commands.ts` runs in the same per-repository turn as
  `timber new` and `timber open`. Before it runs anything it checks that the
  request is complete (only text becomes an argument), that the repository is
  in the app's list and readable, that Timber lists a worktree at exactly
  that path right now and its folder is there (`findListedWorktree`), and
  that Timber is ready. Each refusal is a failure with `ran: false` whose
  message ends by saying nothing was run. Then it runs `timber rebase` in the
  repository's primary checkout through `runTimberWithResultFile`, and
  `readRebaseResult` reads the record. Nothing is retried, and what Timber
  printed is never logged.
- **Reading the record.** `readTimberResult` has already checked the common
  fields and that the outcome goes with the exit code. `readRebaseResult`
  then checks the `rebase` object strictly: a known `result`, text or null
  for `base`, `baseCommit`, and `originalTip`, a list of paths for
  `conflicts`, and a boolean `baseSaved`. The result must go with Timber's
  outcome (rebased and up to date succeeded, the others failed), the list is
  empty unless the result is conflicts and not empty for it, and a record
  that names another worktree is not used. Anything else is a failure that
  says what the rebase did is unknown and keeps what Timber printed. The
  record's `base` is a canonical ref, and the dialog says it as a person
  does (`shortBase`: `origin/main`, `main`).
- **Outcomes.** Rebased and up to date close the dialog with a toast that
  names the base. A refusal stays in the dialog with Timber's diagnostic and
  says nothing was changed. A failure stays with Timber's diagnostic and
  says the list was read again and the branch should be checked before
  trying again: a failed rebase can leave the branch changed, so it never
  says that nothing changed. A request the app refused before running
  anything says so, and an older Timber is explained in the dialog.
  `presentRebase` in `src/mainview/rebase-format.ts` maps each answer to what
  the dialog does, and is tested without a window.
- **Conflicts.** The dialog switches to a list of every conflicted file,
  what Timber printed in a details area, and the way out: Git paused the
  rebase and it was left exactly as Git left it. The app runs no Git command
  on conflicts, so the pause stays until the person runs `git rebase
  --continue` or `git rebase --abort` themselves. "Open a terminal here"
  starts a plain shell session in the worktree (the store's `openTerminalIn`,
  as `startAgentIn` does for an agent) and closes the dialog.
- **Afterwards.** The store reads the repository again before it answers,
  whatever the outcome, even when the engine does not answer.
- **The version gate.** The dialog uses the result file when the Timber found
  is ready and `supportsRebaseResult(version)` holds. The main process checks
  the same thing and answers `unsupported` without running anything. An older
  Timber gets the interim dialog below.
- **In the browser.** The mock engine acts out Timber and writes the record
  Timber would, which is read by the same code. `timberMock.endRebaseResults`
  chooses the ending (see [reporting outcomes](#reporting-outcomes)).
- **Tests.** `tests/fixtures/timber-rebase` holds result files recorded from
  Timber 0.1.2 for each outcome (rebased, up to date, conflicts with a file
  name that has a space, refused, and two failures), and
  `tests/timber-rebase-parse.test.ts` maps each one. With the installed
  Timber, `tests/worktree-rebase.test.ts` checks that a conflict leaves Git's
  paused rebase in place and that a refusal changes nothing.

### On an older Timber

A Timber older than 0.1.2 has no result file for rebase, so the dialog runs
`timber rebase` in a new Timber session in the worktree, so the person sees
what Timber prints. The entry and the Onto field are as above.

- **One source for the command.** `rebaseArguments` builds
  `rebase [--base <ref>] -- <registered path>`. The footer words it from that
  function, and the main process runs Timber from the same one, so the
  command shown is the command that runs.
- **Running.** The store's `startRebase` asks `openTerminal` with
  `timberRebase: { onto }`. The request names only the base, never the command. The
  main process runs nothing while Timber is not ready, acts only on a
  repository in the app's list and a path Timber lists for it right now,
  whose folder is there, and starts the Timber that was found in a session
  of kind `timber` named "Rebase", beside any sessions the worktree has (see
  [terminal sessions](#terminal-sessions)).
- **No verdict.** The app never reads what Timber prints and never says
  whether the rebase worked. The toast says only that it started; the pane
  shows Timber's output and the exit status every session shows. When the
  list shows modified or untracked files, the dialog says beforehand that
  Timber refuses such a worktree, but it does not block: Timber decides.
- **Conflicts.** When the rebase stops on conflicts, Timber prints the
  commands to continue or abort and exits with code 1, so the session ends.
  The person resolves them in a terminal session in the worktree with
  `git rebase --continue` or `--abort`. The list follows what they do there,
  as it follows any change in the worktree (see
  [watching for changes](#watching-for-changes)).
- **Afterwards.** When a Timber session stops, setup or rebase, the store
  reads every repository again, whatever the exit code.
- **In the browser.** The mock engine prints the command and exits with 0.
  `timberMock.endRebases(code)` chooses the exit code of later rebases, and
  `null` leaves them running until `timberMock.endTerminal(id, code)`.

## Agent sessions

A coding agent, such as Claude Code or Codex, runs in a session of a
worktree beside its terminals. An agent session is a terminal session that
starts the agent's command in the worktree's folder instead of the shell.
The app only hosts it: it never reads, parses, or answers what an agent
prints on screen, which is handled as any terminal's output. The one thing
it reads is the agent's status, which the agent addresses to the terminal
as a control sequence, as it would a window title or a bell (see
[agent status](#agent-status)).

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
  shown in the tooltip of the shell's name beside the chips. The "+" menu, the buttons of a
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

### Agent status

Each agent's state shows on the sidebar row, on its chip, and on a collapsed
repository header, from the **Program Status Protocol** (OSC 7501,
[spec](https://www.superlogical.com/rex/docs/build/program-status)). A
program writes it into its own terminal stream once the terminal says it
supports it. Nothing is added to an agent's command, and no agent config
file is written.

**Why this is not reading agent output.** OSC 7501 is a terminal control
sequence the program addresses to the terminal, like a title (OSC 0) or a
bell, not text on screen; xterm.js draws nothing for it. The app reads only
that sequence, OSC 133 `A` (a new shell prompt), and the full reset (RIS).
What the agent prints on screen is still never read, parsed, or answered.

- **Probe.** A program writes `ESC ] 7501 ; ? ESC \`. The main process
  answers on the session's input, only while it runs, with
  `ESC ] 7501 ; ?:states=idle,working,done,blocked,error:kinds=permission,question,auth ESC \`
  (`PROBE_ANSWER` in `src/shared/program-status.ts`): exactly the states and
  kinds the app handles. The spec leaves `clear` out of the list, since
  every terminal that answers accepts it. xterm.js ignores 7501, so nothing
  answers twice.
- **Reports.** `ESC ] 7501 ; key=value:key=value` ended by `ESC \` or BEL.
  `state` is required; `kind` counts only with `blocked`, `progress` (0 to
  100) only with `working` or `blocked`; `app`, `id` (a record path such as
  a subagent's), and base64 UTF-8 `title` and `msg` are optional. Malformed
  pairs are skipped, unknown keys ignored, and a repeated key takes its last
  value. Each report replaces its record; `clear` removes a record and its
  children, or every record without an id.
- **Where it is read.** `createStatusScanner` in
  `src/shared/program-status.ts`, a pure state machine fed every part of
  every session's output in `src/bun/terminals.ts`, hidden sessions
  included, before the part is batched. It reads sequences split across
  parts, the 8-bit OSC and ST that xterm.js also reads, and stops an OSC at
  any other escape or at CAN or SUB, as xterm.js does. An OSC of another kind,
  such as a clipboard write, is never kept.
- **Limits and safety.** The spec's limits: 4096 bytes for the whole
  sequence (the 8-bit OSC and ST count as their two UTF-8 bytes), keys of 16
  bytes, `msg` 2048 bytes decoded, `title` 192, `app` 32, `id` 128 bytes in
  segments of 32 and 8 deep, and 256 records per session, the one updated
  longest ago going first. `app` and `id` segments hold only letters, digits,
  and `_ . + -`; base64 is read with or without its padding. A report over a limit is
  dropped whole, and so is one whose `msg` or `title` cannot be decoded or
  holds a control character. Bidirectional overrides and other invisible
  formatting characters are removed. A message is cut to 200 characters for
  showing. Nothing from a report is run, logged, or echoed back. A
  notification body is never read as markup (see "Desktop notifications"
  below). A flood of probes, such as from a file shown
  with `cat`, gets at most one answer every 100 ms.
- **Lifetime.** `working`, `blocked`, and `idle` end when the process exits
  or a new shell prompt starts (OSC 133 `A`); `done` and `error` stay. The
  spec lets a terminal drop `idle`, and dropping it means a program that idled
  and quit leaves no mark on its shell. A full reset clears every record. A program that leaves `working` behind in a
  shell with no OSC 133 prompt marks keeps it until the shell exits, as the
  spec allows.
- **To the window.** The root record goes out as `TerminalSession.status`
  (state, kind, progress, app, title, and decoded message) through
  `onTerminalChanged`, at most once per 4 ms output part, so a stream of
  progress does not flood the window. The exit is told in the same change
  as the status it leaves. Child records are kept and not shown yet.
- **States as shown** (`shownStatus` in `src/shared/session-status.ts`).
  The process exit is the source of truth: an exited session is Stopped
  (code 0) or crashed (another code, or a signal, named), whatever its last
  report said. A running one is Working (with its progress), Needs you (with
  approval, question, or sign-in), Done, Idle, or Error, as reported. A
  running agent that never reported, such as one too old for the protocol,
  is shown as running, as before.
- **Where it shows.** Every agent session, and any other running session
  whose program reported a status, gets a mark. On the sidebar row it is a
  thin rounded outline in its state's color, holding the state's shape and
  the session's initial, or as many of its first letters as tell it apart
  on that row; its name and state are the tooltip. Claude Code and Codex,
  known by an agent session's executable (`claude`, `codex`) or a reported
  `app` starting with either name (`agentBrand` in
  `src/shared/session-status.ts`), show their makers' official marks instead
  of letters (`AgentIcon.tsx`): Claude's spark in its own orange, and
  OpenAI's mark in the text color. On its chip, the same mark in a quiet
  outline takes the place of the agent star, and the same shape, with the decoded
  message in the chip's tooltip and its state in words beside the chips. A
  collapsed repository header sums up its agents, such as "1 needs you, 2
  working", the most urgent first; an expanded one shows nothing extra.
  Every mark is hidden from assistive technology, and the row's and the
  header's descriptions say it in words.
- **Desktop notifications and sounds.** When a marked session moves to
  Needs you, Done, Error, or crashed, the main process decides whether to
  tell the person (`createStatusAlerts` and `createAlertRunner` in
  `src/shared/status-notices.ts`; the mock engine runs the same runner).
  Nothing is told for the worktree that is selected in a window that shows
  and has the focus, as `attend` last said; while Timber is not ready the
  window names no selected worktree, so then nothing counts as on screen.
  - *Settings.* `statusNotifications` (on by default) is the main switch for
    notifications, `notifyStates` the states that notify (all four by
    default), `soundStates` the states that play a sound (none by default),
    and `sound` the sound (`src/shared/sound-setting.ts`).
  - *One per session.* A session's new notification takes the place of its
    earlier one. It is withdrawn once it no longer holds: the session moved
    to a state that is not told about, closed, or its worktree came on
    screen, or Settings stopped notifying for its state.
  - *Rate limit.* At most one alert per session and state every 10 seconds,
    as the spec asks, so Needs you right after Done is still told. One
    inside the interval waits, and goes out when the interval ends if the
    session is still in that state, its worktree is still not on screen, and
    Settings still ask for it. It says what the session says then.
  - *Sounds.* A sound plays with its notification, or alone at the moment
    the notification would have shown when only the sound is chosen for that
    state, so it follows the same on-screen and rate-limit rules. The main
    process plays it, never the window, so it plays while the window is
    hidden (`src/bun/sounds.ts`): `pw-play`, `paplay`, or `aplay` (WAV only)
    on Linux, `afplay` on macOS, and PowerShell's `SoundPlayer` (WAV only,
    the path in an environment variable) on Windows, each as an executable
    plus arguments. A Linux player that fails at once, such as `pw-play`
    where the sound server is PulseAudio, gives way to the next one found.
    One sound plays at a time: one asked for while another plays is lost,
    not held. A sound still playing after 4 seconds is stopped, so a long
    file cannot hold back the next. The three
    that come with the app are tones the app makes itself
    (`src/shared/tones.ts`), written to the cache folder the first time
    they play, and again when the file went missing. The system's is the
    freedesktop theme's `message-new-instant.oga` on Linux; when no player
    found reads it, such as with only `aplay`, the first tone plays. A file of the person's own comes
    from `chooseSoundFile`, the system's file dialog in the main process; a
    path is kept only when it is absolute, short enough, free of control
    characters, and ends in `.wav`, `.ogg`, `.oga`, `.flac`, `.mp3`, `.aiff`,
    or `.aif`, and it must be a regular file when it plays. When it is gone,
    an alert plays the first tone instead; Settings' Play (`playSound`) says
    it is missing. The path is never logged.
  - *Linux.* The main process talks to `org.freedesktop.Notifications` on
    the session bus itself, with its own small D-Bus client over the bus's
    Unix socket (`src/bun/dbus.ts`, `src/bun/notification-server.ts`).
    `Notify` carries `replaces_id` for a session's earlier one, a `default`
    action when the server lists `actions`, the hints `urgency` (normal),
    `desktop-entry` (`Timber`), and `suppress-sound` when the app plays its
    own sound. `CloseNotification` withdraws one. Only signals from the
    bus name that owns the service count: `ActionInvoked` with `default`
    brings the window forward and sends `showSession`, and the store selects
    the worktree, shows the Workspace tab and the session's chip, and asks
    for its terminal to take the keyboard (`revealSession`, through
    `src/mainview/terminal-focus.ts`); an open dialog stays open over it.
    `NotificationClosed` forgets the id. The operations for one session run
    in order, since the server answers an id only later. A lost bus is
    connected again on the next notification, and a server replaced by
    another (`NameOwnerChanged`) has the ids it never gave forgotten; the
    notifications from before stay on screen and can no longer be replaced,
    withdrawn, or clicked. A `Notify` that gets no answer in 5 seconds is
    not shown another way, since the server may still show it. On quitting
    the app writes `CloseNotification` for each one it showed, before it
    waits for anything. The bus address is `DBUS_SESSION_BUS_ADDRESS`, or
    `bus` in `XDG_RUNTIME_DIR`. Without a bus, `notify-send` by argv shows
    it, without a click, and the bus is tried again a minute later.
  - *Markup.* The body is escaped (`&`, `<`, `>`) unless the server's
    `GetCapabilities` answered without `body-markup`; a server that did not
    answer is taken to read markup, so a wrong guess shows `&lt;` as
    written, never markup. `notify-send` always gets it escaped. The title
    is never markup by the spec.
  - *Wayland.* The server sends `ActivationToken` before `ActionInvoked`,
    and the app keeps it with the click. It is not handed on: Electrobun
    2.0.6 starts GTK with `GDK_BACKEND=x11`, so the window is an X11 one
    under XWayland, and GDK's Wayland token call does not apply to it. The
    window comes forward through Electrobun's `activate`. On COSMIC it did,
    behind another window, without the token (see "What has been
    verified"); other compositors have not been tried.
  - *macOS and Windows.* Electrobun's `Utils.showNotification` shows it with
    the text as it is; whether anything there reads markup is not known.
    It cannot answer a click, take the place of an earlier one, or be
    withdrawn: Electrobun 2.0.6 has no way to. Neither system has been
    tried.
  - *Not told again.* A session that stays in a state, such as Needs you
    for a second approval with a new message, gets no new notification, and
    the one on screen keeps its first message.
- **Not built.** Child records (subagents) beyond keeping them, and hooks
  for agents that do not send OSC 7501, which can also carry the prompt and
  the agent's reply.

In `bun run dev:web`, `timberMock.agentStatus(id, "state=blocked:kind=permission:msg=YXBwcm92ZQ==")`
acts out a report from the program in a session (`"?"` for the probe), read
by the same scanner as in the main process. `timberMock.notices()` lists the
desktop notifications the main process would have on screen,
`timberMock.alertSounds()` the sessions a sound played for, and
`timberMock.clickNotice(id)` acts out a click on one.

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
  and setup is optional, "Set up Timber", and "Not now". It is an offer, styled as one, never as an error.
- **Set up Timber (`SetupWizardDialog.tsx`).** The setup wizard for the
  repository (`set-up-timber` in `DialogRequest`), never a terminal
  session. It asks what `timber setup` asks, one step at a time: where to
  save, the repository's `.timber.toml` or, as `timber setup --global`
  does, the machine defaults; then the editor, the coding assistant, the
  branch and remote and folder, the scripts, and issue tracking, with the
  same fields and presets as Settings > Repository; then a last step that
  lists the choices in words (`describeChoices` in
  `src/mainview/setup-wizard-format.ts`) and shows the exact save command.
  The chosen scope is read through Timber when chosen, and what was typed
  carries over between the scopes. Save sends every group at once on top of
  what was read (`wizardSaveRequest`, `valuesWithAll`), through the same
  `saveTimberSettings` as Settings, with the revision it read, so invalid
  fields, a conflict, a tracked `.timber.toml`, and failures behave as they
  do there. Timber's messages about a field send the wizard back to the step
  that draws it (`firstStepOf`). The button waits until Timber is ready,
  since the wizard reads and saves through it.
- **When it goes.** Once a save went through, the store reads the
  repository again, or every repository for the machine defaults, before
  the wizard closes (`saveTimberSettings` in the store), so the prompt goes
  at once, without waiting for the window's focus. Timber writes the file
  even when every choice was left alone, so that counts as set up too.
  Cancel, Escape, or a repository that leaves the list saves nothing, and
  the prompt stays. Settings saved some other way, such as from a terminal
  outside the app, show on the next read, for example when the window gets
  the focus back.
- **Not now.** Remembered per repository in the saved layout
  (`setupDismissed`), so the prompt stays away after a restart, and
  forgotten when the repository leaves the list. Nothing else changes: the
  worktrees, terminals, and Timber commands work as before. There is no way
  back to the prompt in the app yet; Settings > Repository, or
  `timber setup` in a terminal, still sets the repository up.
- **The empty state.** With no repository in the list, the workspace says
  so and makes "Add repository" the first step, mentioning that a repository
  new to Timber gets the offer to set it up.
In `bun run dev:web` the mock engine's folder picker adds `docs-site`, which
was never set up. Its setup wizard reads and saves through the mock's
Timber settings, and a save there sets it up: with the repository scope it
alone, with the machine defaults every repository without settings.

## App identity

What the built app is called, how it is told apart, and what it looks like.
None of it should have to change after a first release.

- **Name.** "Timber" everywhere a person sees it: the window title, the
  taskbar, the menu entry, and the installer (`linux-x64-Timber-Setup.tar.gz`).
  It is `APP_NAME` in `src/shared/app-info.ts`.
- **Identifier.** `com.codingm8s.timber-app`, which is `APP_IDENTIFIER` in
  the same file. It is final. It names the folder the app installs to on
  Linux (see [installing the Linux build](#installing-the-linux-build)) and
  is what an update is matched by, so changing it would leave every install
  behind in its old folder. The app's own settings do not depend on it:
  they live in a folder named `timber-app` (see `src/bun/settings.ts`).
- **Version.** Written once, in `package.json`. `APP_VERSION` reads it from
  there, the build stamps it into the app through `electrobun.config.ts`,
  and the `Engine` contract answers it as `appInfo()`. The import is a
  default import on purpose: Electrobun 2.0.6 does not run its configuration
  as Bun would, and with a named import from JSON it stamped its own default,
  0.1.0, without a word.
- **About.** A section of the Settings dialog, among the app's own sections.
  It shows the app's version and the Timber in use, with the path it was
  found at, or says that Timber is missing, too old, or could not be looked
  for (`src/mainview/about-format.ts`). It also names the licenses below.
  It ends with Uninstall; see
  [uninstalling from the app](#uninstalling-from-the-app).
- **Icons.** `icons/` holds them, all made from
  `src/mainview/assets/logo.png` by `bun run icons`
  (`scripts/make-icons.ts`, which needs ImageMagick 7): `icon.png` at 512
  pixels for Linux, `icon.ico` with seven sizes from 16 to 256 for Windows,
  and `icon.iconset` with the ten pictures macOS asks for. The logo is 256
  pixels square, so everything above that is scaled up and looks soft. A
  larger logo and another run sharpen them.
- **Fonts.** Geist and Geist Mono are built in, as one variable WOFF2 file
  each in `src/mainview/assets/fonts/`, taken from version 1.9.2 of the
  `geist` package on npm. `styles.css` declares them with `@font-face`, and
  Vite copies them into the build, so text looks the same on every platform
  and nothing is fetched from the network.
- **Licenses.** `licenses/` holds the SIL Open Font License of the fonts,
  the notices of the palettes that built-in themes use, and the notice for
  the logo, which is copyright Coding-M8s with all rights
  reserved and is not covered by the MIT license of the code. The build
  copies the folder into the app, to `Resources/app/licenses`.

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

- `~/.local/share/com.codingm8s.timber-app/stable/app/`: the app itself. The
  folder name is `app.identifier` and the channel from `electrobun.config.ts`.
  The identifier is final (see [app identity](#app-identity)): changing it
  would install to a new folder and leave the old one behind. A build from
  before issue 27 installed to `com.codingm8s.timber`, and its own
  `uninstall` removes it.
- `~/.local/share/com.codingm8s.timber-app/stable/uninstall`, with
  `.electrobun-uninstall.json` beside it recording the entries below, and a
  `self-extraction/` folder of install state.
- `~/.local/share/applications/Timber.desktop`: the menu entry. The
  installer also refreshes `mimeinfo.cache` in that folder.
- `~/Desktop/Timber.desktop`: a copy of the menu entry as a desktop
  shortcut. The installer then asks `gio` to mark it trusted, which some
  desktops do not support.

Both entries point at the installed launcher. The build copies
`icons/icon.png` to `app/Resources/appIcon.png`, and both entries name it by
its absolute path as `Icon=`. Their `Comment=` is `app.description`.

**The desktop shortcut.** Electrobun 2.0.6 has no setting to skip it, and
neither does the configuration of 2.0.7-beta.24, the latest on 2026-11-16.
The extractor makes it when `~/Desktop` exists, and skips it when that
folder is missing. It looks only at `~/Desktop` and ignores
`XDG_DESKTOP_DIR`, so a desktop folder under another name gets no shortcut.
Deleting the shortcut is safe, but running the installer again puts it back.
Whether an update does too was not tried. The shortcut is accepted for now,
and is listed under
[open decisions](#open-decisions) to look at again before a first release.

**Removing it.** The easy way is Settings, About, Uninstall, which runs the
uninstaller below with both arguments and then quits; see
[uninstalling from the app](#uninstalling-from-the-app). The uninstaller
also works by hand, which is the way when the app does not start.
`~/.local/share/com.codingm8s.timber-app/stable/uninstall
--quiet` removes the app folder, both entries, and the install records.
It keeps what the app wrote while running, on purpose: in Electrobun's
uninstaller `--quiet` means "App", the choice that keeps a person's data.
Adding `--delete-data`, after `--quiet` and nowhere else, means "App and
Data" and removes that too. Without arguments the uninstaller asks, with
the same two choices and Cancel; that was not run.

**What uninstalling leaves behind.** After `uninstall --quiet`, once the app
has been started at least once:

- `~/.local/share/com.codingm8s.timber-app/stable/WebKit`: the web data of
  the window (a cookie store and storage folders, 16K to 20K after a short
  run). The app keeps nothing of its own there.
- `~/.cache/com.codingm8s.timber-app/stable`: the web cache (20K after a
  short run).

`uninstall --quiet --delete-data` removes both, together with the app. When
the app is already gone and the uninstaller with it, delete the two folders
by hand: `rm -r ~/.local/share/com.codingm8s.timber-app
~/.cache/com.codingm8s.timber-app`. That also removes the same folders of
the `dev` channel, which the development commands write.

Neither way touches these, which belong to no install:

- `~/.config/timber-app/`: the [saved repository list](#saved-repository-list)
  and the app's other settings. It is not under a folder Electrobun manages,
  so a later install finds the same repositories. Delete the folder to
  forget them, or tick the box when uninstalling from the app.
- Timber's own configuration and state, and the caches of other tools the
  app used (Mesa's shader cache, for one). They are not the app's.

**The decision (issue 74).** The app offers its own uninstall, which removes
the web data and cache too, because nothing in them is worth keeping. What
`uninstall --quiet` does by hand stays as Electrobun made it: Electrobun
2.0.6 has no setting for what `--quiet` removes or for extra paths to clean,
and says so in its "Uninstalling" guide; `--delete-data` is its answer, so
nothing is asked of upstream. With `XDG_DATA_HOME`, `XDG_CACHE_HOME`, or `XDG_STATE_HOME` set at
install time, the installer records them and the uninstaller removes from
those folders; that was read in the guide and not run. Neither was the
third folder `--delete-data` covers, for logs under `~/.local/state`, which
this app never made.

## Uninstalling from the app

Settings, About ends with Uninstall, so removing the app does not take
knowing a path and two arguments.

- **The app removes nothing of the install itself.** Electrobun's installer
  leaves an uninstaller beside the app, with a record of what it installed
  (`.electrobun-uninstall.json`). The main process runs that uninstaller as
  an executable plus the arguments `--quiet --delete-data`
  (`src/bun/uninstall.ts`), never through a shell, and stops it after a
  minute. So the app, both entries, the web data, and the cache go by
  Electrobun's own rules.
- **Two steps, and the command shows first.** "Uninstall Timber" removes
  nothing. It opens, in place, the list of what is there to remove, the
  command as it will run, and the two buttons, with focus on Cancel.
  "Uninstall and quit" runs it. The Settings dialog cannot be closed while
  it runs.
- **The plan is read, not assumed.** `Engine.uninstallPlan()` answers the
  uninstaller's command and the folders and files that exist now, taken
  from the install record (`src/shared/uninstall.ts`). Reading it changes
  nothing.
- **Only an installed copy on Linux.** The app counts as installed when it
  runs from `<folder>/app/bin/` with `uninstall` and a readable record in
  that folder. A copy started with `bun run dev` or `bun run start` says it
  was not installed and where it runs from, and has no button. Windows and
  macOS say that this is built for Linux only so far.
- **The settings are the app's own to delete.** The uninstaller does not
  know `~/.config/timber-app/`. A box, off at first, asks to forget the
  saved repository list and settings too. Then, after the uninstaller ended
  well, the main process deletes the settings file, a kept damaged copy,
  and leftover temporary files, and the folder when nothing else is in it
  (`removeSettings` in `src/bun/settings.ts`). From then on the settings
  holder refuses every save, so nothing writes the file back before the
  app quits: the window's size, for one, is saved on quit. A failed
  uninstaller leaves the settings alone.
- **Then the app quits.** Agreeing to uninstall is agreeing to quit: every
  terminal ends without the usual question, and the confirmation says how
  many run. When the settings were to go and could not, the app stays open
  to say so, names the folder, and offers Quit.
- **A failure is shown.** An uninstaller that ends badly, or cannot start,
  shows its exit code and what it printed, and the buttons work again.
- **Never touched:** repositories, worktrees, Timber, and Timber's own
  configuration. No Git or Timber command runs.
- **In the browser build** the mock engine describes an installed copy and
  acts the removal out without removing anything or quitting. In the
  browser console, `timberMock.endUninstalls("fails")`, `("keeps-settings")`,
  or `("unavailable")` acts out the other endings.

See the issue 74 runs under [what has been verified](#what-has-been-verified).

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
- Where the compositor leaves scaling to X11 windows, a fractional monitor
  scale does not reach the app, and everything is drawn too small. The zoom
  in Settings makes up for it (see [interface zoom](#interface-zoom)).

See the issue 63 run under [what has been verified](#what-has-been-verified).

### The GLXBadWindow line at start

Each start seen so far on Linux (Pop!_OS 24.04 under XWayland and Xephyr,
and Omarchy under XWayland) logs one `X11 Error: GLXBadWindow`, with code
168 or 170. It is harmless, and the app does nothing about it. The codes
are the same error: GLXBadWindow is GLX error 12, and the code is the X
server's GLX error base plus 12. The base was 156 on Pop!_OS's XWayland and
158 in Xephyr, and Omarchy's XWayland logged 170 (a base of 158, not read
with `xdpyinfo` there), so the code follows the server, not whether it is
XWayland or Xephyr. The issue 66 runs fit this: 168 under Xwayland 23.2,
and 170 under Xwayland 24.1 and under Xorg.

- While Electrobun creates the web view, WebKitGTK disposes a GTK widget,
  and GTK destroys its X window. Later, from the main loop, GTK frees a
  window's GL drawable with `glXDestroyWindow` inside an error trap it
  ignores. Most likely that drawable belonged to the destroyed window (not
  traced), so the X server answers GLXBadWindow.
- WebKitGTK's DMABUF renderer is the likely owner of that drawable. On
  Omarchy, three starts with `WEBKIT_DISABLE_DMABUF_RENDERER=1` had no line
  and three without had one (see the issue 28 run on Omarchy and the issue
  64 run under [what has been verified](#what-has-been-verified)).
- GTK's trap drops that late error only while GDK's own X error handler is
  installed. Electrobun's `initializeGTK()` replaces it right after
  `gtk_init` with one that prints every error except BadWindow and
  BadDrawable and then carries on, so the trapped error is printed.
- Nothing else follows from it: the request was a cleanup that GTK
  expects may fail, the window draws, and clicks and keys worked in the
  issue 28 Xephyr run with the line present.
- Not done in the app. There are three ways to hide the line, and none is
  worth it. Putting GDK's handler back through Bun FFI would make any other
  X error end the app, since GDK's handler exits on errors no trap expects.
  `GDK_SYNCHRONIZE=1` makes every X request a round trip.
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` switches WebKitGTK to a slower drawing
  path, and would have to be in the process environment before the web
  view starts.
- Reported upstream as
  [blackboardsh/electrobun#618](https://github.com/blackboardsh/electrobun/issues/618),
  with a fix proposed in
  [blackboardsh/electrobun#619](https://github.com/blackboardsh/electrobun/pull/619):
  the handler skips GLXBadWindow and GLXBadDrawable too, using the GLX
  error base read once after `gtk_init`. Separately,
  [blackboardsh/electrobun#593](https://github.com/blackboardsh/electrobun/pull/593)
  would let WebKitGTK windows open natively on Wayland. With it there is no
  X connection on a Wayland session, so the line would go away there and
  stay only in a real X11 session.
- Electrobun's contribution notes say outside pull requests may wait, or be
  closed without explanation, so the line may stay for a while. Carrying
  our own Electrobun build is not worth it for a harmless log line.

This covers only this line, a GLXBadWindow from `X_GLXDestroyWindow`. Any
other `X11 Error:` line is not explained by it. See the issue 64 run under
[what has been verified](#what-has-been-verified).

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
- **The Timber that `listWorkflows` needs.** The app requires Timber 0.1.2,
  taken to be the next release, because `__app-config` and one-off workflows
  are on Timber's main branch but in no release yet. Until 0.1.2 is out, the
  app finds no Timber new enough, CI cannot install it, and a build of
  Timber's main branch still calls itself 0.1.1. If that release gets
  another number, change `REQUIRED_TIMBER_VERSION` in
  `src/shared/timber-version.ts`, its test, the line in
  [Finding Timber](#finding-timber), the README, and `TIMBER_VERSION` in CI
  together.
- **The Timber that pull requests need.** `__app-pr` is on Timber's main
  branch only. With Timber 0.1.2 every repository says "PRs unknown", with
  Timber's "unknown command" in the tooltip. The required version is not
  raised for it, because nothing else depends on it; raise it with the next
  Timber release, as for `listWorkflows` above.
- **The Timber that linked issues need.** The `issue` field of `ls --json`
  and `__app-issue` are on Timber's main branch only. With Timber 0.1.2 no
  issue shows at all, since its records have no `issue` field. Raise the
  required version with the next Timber release, as for pull requests.
- **Rebase backups.** The design shows them, but Timber does not create backup
  branches today. Either Timber gains that, or the app creates them.
- **Linux desktop shortcut.** Electrobun's installer adds one to `~/Desktop`
  without asking, and offers no way to turn that off (see
  [installing the Linux build](#installing-the-linux-build)). Accepted for
  now. Revisit before a first release.
- **A sharper logo.** The icons above 256 pixels are scaled up from a
  256 pixel logo (see [app identity](#app-identity)). They need a larger or
  vector original before a first release on macOS.

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
  wrong (explained by issue 64, see
  [the GLXBadWindow line at start](#the-glxbadwindow-line-at-start)).
  No clicks were sent to this window in this run (an earlier run found
  that XTest clicks do not reach it under COSMIC, see issue 25 above), so
  terminals, the folder picker, and editor launching were checked in
  Xephyr only.
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
    The second line is harmless, see
    [the GLXBadWindow line at start](#the-glxbadwindow-line-at-start).
- `bun run dev` in the same Xephyr: the window opened and listed the
  worktrees. Touching `src/bun/index.ts` rebuilt and relaunched it. Closing
  the window leaves the watcher running until it is stopped.
- `bun run dev:hmr` in the same Xephyr: Vite served on port 5173, the
  window connected to it, and touching `src/mainview/styles.css` was a hot
  update (`hot updated: /styles.css` in the webview's console).
- Not run: a real X11 login session (this machine has none, only
  Xephyr), a native Wayland window, `GDK_BACKEND=wayland`, GNOME, KDE, or
  any other distribution, and an NVIDIA GPU. The system packages were
  already installed, so which of them a clean system needs was not tested
  (tested later, see issue 67).
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

Run for the desktop app on a second Linux system (issue 28), Omarchy
4.0.0 alpha (the `omarchy-dev` package, `4.0.0.r7955.g15d240a`,
Arch based) x64, Hyprland 0.57.2 on Wayland (`XDG_SESSION_TYPE=wayland`,
`WAYLAND_DISPLAY=wayland-1`, XWayland 24.1.15 on `DISPLAY=:0`), monitors at
scale 1, with Bun 1.4.4, Git 2.56.1, Timber 0.1.2, and Electrobun 2.0.6, at
commit `43e9c49`. The machine has Intel Arc and NVIDIA RTX 4050 graphics
(driver 615.78.08). `/bin/sh` is bash. Each launch had its own
`XDG_CONFIG_HOME`, and `TIMBER_APP_REPOS` naming this repository unless
said otherwise:

- `pacman -Q`: `gtk3` 3.24.52, `webkit2gtk-4.1` 2.54.2,
  `libayatana-appindicator` 0.6.1, and `librsvg` 2.63.4 were already
  installed, so which of them a clean system needs was not tested (tested
  later, see issue 67).
- `bun install`: 54 packages installed. `bun run typecheck` and `bun run
  typecheck:desktop`: no errors.
- `bun test`: 1104 passed, 1 skipped, and 1 failed, the same one in four
  runs: "closing a session ends everything it started, even what ignores a
  hang-up" in `tests/terminals.test.ts` waited for four processes and found
  three. Its `sh -c 'trap "" HUP; sleep 301'` leaves a shell and a sleep
  where `sh` is dash; bash replaces itself with the sleep (seen with `ps`).
  With `; :` added after the sleep the test passed three times, and the
  whole suite was 1105 passed, 1 skipped, 0 failed.
- `bun run start`: the window opened. `hyprctl -j clients` listed it with
  class `Timber-dev` and `xwayland: true`, and a screenshot (`grim`) showed
  this repository and its worktrees.
- `bun run build`: completed, with `build/stable-linux-x64/Timber`.
- The built launcher, run in the real home folder with a display: exit 0.
  It wrote the app to `~/.local/share/com.codingm8s.timber/stable/`, the
  menu entry, and `~/Desktop/Timber.desktop`, and then started the installed
  app, which showed "No repository yet". The menu entry had no `Icon=`, and
  `desktop-file-validate` gave the same `Comment` warning as in issue 62.
- Input to the window: XTest clicks (`xdotool`) did not reach it, as under
  COSMIC, and neither did a mouse button sent with Hyprland's
  `send_shortcut`. Real clicks did: the pointer was moved with `hyprctl`
  and the button pressed through `ydotool` (uinput). Keys sent with
  `send_shortcut` to the window arrived. The steps below used these.
- Terminals: Open terminal started bash in the primary checkout, and `echo
  hi42` printed back. Closing the window then asked "Quit Timber?"; Quit
  ended the app (`[stopEventLoop] Initiating clean event loop exit`) and the
  session's bash.
- Open in editor with no editor saved opened Settings on Editor. With the
  Zed choice saved it failed with "zed" not found: Arch installs Zed as
  `zeditor`. The message was right but printed the whole PATH, about 20
  lines here. With VS Code saved, a VS Code window opened on the worktree's
  folder.
- "Add repository" was refused while `TIMBER_APP_REPOS` was set, with the
  note saying so. Without it, the chooser was not GTK's own: Omarchy sets
  `GTK_USE_PORTAL=1` and its portal runs `folio chooser`, a Wayland window
  of another process that opens on the focused workspace. Select returned
  the folder the chooser was showing, the home folder, and the app answered
  "Not a Git repository". Going into a folder in that chooser could not be
  done with sent input, so adding a real repository this way was not run.
- `X11 Error: GLXBadWindow (code 170)` was in the log once on every start
  (issue 64). In six starts of the installed app, the three with
  `WEBKIT_DISABLE_DMABUF_RENDERER=1` had no such line and the three without
  had one; the window drew the same by eye. One start each with
  `WEBKIT_DISABLE_COMPOSITING_MODE=1`, `LIBGL_ALWAYS_SOFTWARE=1`, and
  `__GLX_VENDOR_LIBRARY_NAME=mesa` still had it. See
  [the GLXBadWindow line at start](#the-glxbadwindow-line-at-start).
- `nvidia-smi` listed no process on the NVIDIA card while the app ran, and
  the app had both Mesa and NVIDIA libraries loaded. Which card drew the
  window was not established, so this is not a run on an NVIDIA GPU.
- `bun run dev`: closing the window ended the app and left `electrobun dev
  --watch` running, as documented. Touching `src/bun/index.ts` printed
  "Change detected" and opened the window again. SIGINT to the process
  group ended every process.
- `bun run dev:hmr`, run twice: the window connected to Vite on port 5173,
  and after the window closed nothing of the command was left and the port
  was free. The first run logged 13 lines of `The request id ... is outside
  of Vite serving allow list` for files of another checkout of this
  repository; the second run had none and drew normally. The cause was not
  established (the dev app's web data folder is shared between checkouts
  and was older than this run).
- `uninstall --quiet`: exit 0. The app folder and both entries were gone;
  `~/.local/share/com.codingm8s.timber/stable/WebKit`, 20K of web data the
  app had written, was left.
- Not run: adding a real repository through the chooser, `timber setup`,
  starting an agent, the Changes tab, Zed and Neovim as editors, fractional
  scaling, a hot update under `dev:hmr`, and the menu entry started from a
  launcher.

Run for what uninstalling leaves behind (issue 74), Omarchy 4.0.0 alpha
(`omarchy` 4.0.0.r7968.gc3c8acf, Arch based) x64, natively, Hyprland 0.57.2
on Wayland with XWayland 24.1.15, Bun 1.4.4, Electrobun 2.0.6,
`webkit2gtk-4.1` 2.54.2, Timber 0.1.2, on commit `b7e5058`. Every install
and uninstall ran with `env -i PATH=/usr/bin:/bin HOME=<temporary folder>`,
and the app was started with that HOME plus `DISPLAY=:0` and
`XDG_RUNTIME_DIR`, so nothing was written to the real home folder:

- `bun run build`: completed. The built `bin/launcher`: exit 0, ending at
  "Installation completed successfully!".
- The installed `app/bin/launcher`, left open for 12 seconds and then ended
  with SIGTERM: it logged the settings path and "Timber 0.1.2 at" the real
  Timber. It made `stable/WebKit` beside the app (16K) and
  `~/.cache/com.codingm8s.timber-app/stable` (20K). It made no
  `~/.config/timber-app`, as nothing was saved, and no folder for the app
  under `~/.local/state`. Also new in that home, and not the app's own:
  `~/.cache/mesa_shader_cache`, `~/.bun/install/cache`, and
  `~/.local/state/timber/setup-hint-shown`.
- `uninstall --quiet`: exit 0. The app folder, `self-extraction`,
  `uninstall`, `.electrobun-uninstall.json`, and both entries were gone.
  `stable/WebKit` and `~/.cache/com.codingm8s.timber-app/stable` were left.
- The launcher run again over those leftovers: exit 0.
- `uninstall --delete-data` and `uninstall --delete-data --quiet`: `error:
  InvalidArguments`, exit 1, and the install was as before.
- `uninstall --quiet --delete-data`: exit 0.
  `~/.local/share/com.codingm8s.timber-app` and
  `~/.cache/com.codingm8s.timber-app` were gone whole, and both entries.
- Installed once more with a `~/.config/timber-app/settings.json` put there
  by hand, then `uninstall --quiet --delete-data`: exit 0, and the settings
  file was still there.
- Electrobun's "Uninstalling" guide and `package/src/extractor/main.zig` at
  tag `v2.0.6`, read with `gh api` on 2026-11-18: `--quiet` is "App",
  `--delete-data` is accepted only after it, and there is no configuration
  for uninstall paths.
- `grep -rn $'\u2014' README.md docs`: nothing.
- Not run: the uninstaller without arguments and its dialog, an install
  with the XDG folders set elsewhere, an uninstall after an update, and
  anything on Windows or macOS.

Run for uninstalling from the app (issue 74), on the same machine and
versions, with the changes of this issue on top of commit `b7e5058`. Installs
ran as above, into a temporary home folder that also held a
`~/.config/timber-app/settings.json`. The window took keys sent with
Hyprland's `send_shortcut` dispatcher, and pictures of it were taken with
`grim`:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1256 tests, 1255 passed and 1 skipped. With main merged in
  at `543b346`: 1395 tests, 1394 passed and 1 skipped.
- `bun run build`: completed.
- `uninstall --quiet --delete-data` by hand while the installed app was
  open: exit 0. The files were gone and the app kept running; ended with
  SIGTERM, it logged a clean exit and wrote nothing back.
- Settings, About in the installed app: Uninstall showed its text and
  "Uninstall Timber". Enter on it opened the confirmation with the four
  places that were there (the install folder, the cache folder, the menu
  entry, the desktop shortcut), the uninstaller's full path with `--quiet
  --delete-data`, the box unticked, and focus on Cancel.
- Tab and Enter on "Uninstall and quit", box unticked: within four seconds
  the app had logged `[stopEventLoop] Initiating clean event loop exit`, no
  process or window of it was left, `~/.local/share/com.codingm8s.timber-app`
  and `~/.cache/com.codingm8s.timber-app` and both entries were gone, and
  `settings.json` was as before.
- A second install, with the box ticked by Shift+Tab and Space: the list
  gained the settings folder and the note under the box changed. After
  "Uninstall and quit" the app was gone as above, and so was
  `~/.config/timber-app`. `~/.config` itself stayed.
- The same once more on a build with main merged in at `543b346`, where
  the app saves the window's size when it quits and had already written it
  to `settings.json`: the same result, and nothing wrote the settings back.
- In the first of the two, the folder chooser had been opened once by
  mistake and closed with Escape. GTK left its own files in that home
  (`~/.config/gtk-3.0`, `~/.local/share/recently-used.xbel`,
  `~/.local/share/gvfs-metadata`, `~/.cache/glycin`). They are shared by
  every GTK program and are not the app's to remove.
- `grep -rn $'\u2014' src tests docs README.md electrobun.config.ts`: nothing.
- Not run: uninstalling with a terminal open, a failing uninstaller and
  settings that cannot be deleted in the real app (both are covered with
  stand-ins in `tests/uninstall.test.ts`), the note in a copy started with
  `bun run dev`, a pointer click on the buttons, and anything on Windows or
  macOS.

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

Run for listing a repository's workflows (issue 51), Linux x64 (Pop!_OS,
natively) with Bun 1.4.2 and Git 2.43.0:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors. `bun run
  build:web`: built.
- `bun test` with the installed Timber 0.1.1, after the required version
  became 0.1.2: 940 passed, 88 skipped, 0 failed. Every test against the
  real Timber skips, as 0.1.1 is now too old.
- `bun test` with `TIMBER_APP_TIMBER_PATH` naming a build of Timber's main
  branch at commit e1ccd00 (`bun run build`, run with Bun), behind a wrapper
  that answers `--version` with 0.1.2 because the build calls itself 0.1.1:
  1017 passed, 1 skipped (one from before), 0 failed. In a real temporary
  repository with a private HOME and XDG_CONFIG_HOME, machine workflows of
  each agent kind were listed; with a `.timber.toml` the two were merged by name,
  `review = false` hid the inherited one, and a workflow defined again
  replaced the machine's as a whole; `workflows = false` gave an empty
  list; a malformed file was a failure naming the file and not its
  content. After each of these four reads the repository and the config
  folder had the same files, times, refs, and index as before, and Timber
  had made no home, state, or data folder.
- The fixtures in `tests/fixtures/timber-app-config` were recorded with that
  build. Stand-in Timbers showed the exact arguments, the working
  directory, standard input closed (the stand-in reads it to its end), the
  time limit, arguments with control characters kept exactly, refusal of a
  repository outside the list without running Timber, and that a token in
  a record's arguments or in standard error reached no `console` method and
  nothing a child process running the reader printed. The released Timber
  0.1.1 was run once by hand in a private HOME to record what it prints
  without `__app-config` (exit code 1).
- After rebasing onto `main` with Timber's settings saved through Timber, on
  Linux x64 (Omarchy, natively) with Bun 1.4.4, Git 2.56.1, and the released
  Timber 0.1.2 installed, with no wrapper: `bun run typecheck` and `bun run
  typecheck:desktop`: no errors. `bun run build:web`: built. `bun test
  tests/workflows.test.ts tests/workflows-parse.test.ts`: 55 passed, none
  skipped, so the tests against real temporary repositories ran with the
  release. `bun test`: 1159 passed, 1 skipped, 1 failed. The failure is
  "closing a session ends everything it started" in
  `tests/terminals.test.ts`, which fails the same way on `main` on this
  machine without this change.

Not run for issue 51: the desktop window and the RPC bridge. Nothing in the
interface asks for workflows yet.

Run for the GLXBadWindow line at start (issue 64), Pop!_OS 24.04 LTS x64,
natively, COSMIC on Wayland, with Electrobun 2.0.6, GTK 3.24.41
(`libgtk-3-0t64`), WebKitGTK 2.52.6, libX11 1.8.7, Mesa 26.1.6, Xwayland
24.1.13, and Xephyr 21.1.12. Each launch was `bunx electrobun dev` (the dev
build) with `WAYLAND_DISPLAY` unset, `XDG_SESSION_TYPE=x11`, its own
`XDG_CONFIG_HOME`, `TIMBER_APP_REPOS` naming this repository, and `DISPLAY`
set to XWayland (`:1`) or to `Xephyr :3`, stopped with SIGINT after 25 to
30 seconds. Some launches had an `LD_PRELOAD` wrapper around
`XSetErrorHandler` and `XDestroyWindow`, written for this run and kept out
of the repository, that printed the request serial and backtrace of each
`XDestroyWindow` and, for each error, the serial and backtrace of the
nearest GDK error trap before it. An earlier version of the wrapper
printed the backtrace of the error handler itself:

- `objdump -d` of the dev build's `libNativeWrapper.so` (the same file as
  the Electrobun 2.0.6 toolchain's): `initializeGTK()` calls `gtk_init`,
  then `XSetErrorHandler(x11_error_handler)`. The handler skips BadWindow
  and BadDrawable, prints `X11 Error: %s (code %d)`, and returns 0. The
  source of `nativeWrapper.cpp` at `v2.0.6`, `v2.0.7-beta.24`, and `main`,
  read with `gh api` on 2026-11-16, has the same handler and call.
- GTK 3.24.41 source (`gdk/x11/gdkmain-x11.c`, `gdkdisplay-x11.c`): an
  error trap installs GDK's handler on push and puts the previous handler
  back on pop. `gdk_x11_display_error_trap_pop_ignored` does not wait for
  the server, and late errors are dropped by serial only in GDK's handler.
  GDK's handler ends the process on an error no trap expects (`g_error`
  in debug builds, otherwise `_exit(1)`).
- `xdpyinfo -queryExtensions`: GLX opcode 149 and error base 156 on `:1`,
  opcode 150 and error base 158 on `:3`.
- With the wrapper in Xephyr: WebKitGTK, called from Electrobun's
  `WebKitWebViewImpl` constructor through `g_object_new`, ran
  `g_object_run_dispose` on a widget, which reached `gtk_widget_unrealize`,
  `gdk_window_destroy`, and `XDestroyWindow` at serial 332. Later, from
  the GTK main loop, `g_object_unref` of a GdkWindow cleared its data and
  pushed a GDK error trap at serial 351, followed by `XDestroyWindow` of
  another window at 355. The error was code 170, request 150 minor 32
  (`X_GLXDestroyWindow`), serial 351, read by `XPending` after the trap
  had popped, and Electrobun's handler printed it. That the GLX drawable
  belonged to the window destroyed at 332 is consistent with this, and was
  not traced.
- With the wrapper on `:1`: the same order, with `XDestroyWindow` at serial
  318 under the same WebKitGTK frames, the trap at 334, and the error code
  168, request 149 minor 32, serial 334.
- Without the wrapper, one launch each on `:1` and on `:3`: one
  `X11 Error: GLXBadWindow` line (`grep -c "X11 Error"`). With
  `GDK_SYNCHRONIZE=1`, one launch each: none, consistent with the error
  arriving while the trap is pushed.
- A screenshot of `:3` taken with `import -window root` after the line was
  logged: the sidebar showed this repository with a count of 18 worktrees,
  and the window drew normally.
- Not run: the installed build (the issue 28 run above logged the same
  line from it; its `libNativeWrapper.so` was not compared here), the CEF
  wrapper, a real X11 login session, an NVIDIA GPU, and which WebKitGTK
  function creates and disposes the widget.
  `WEBKIT_DISABLE_COMPOSITING_MODE=1` was tried in the issue 28 run on
  Omarchy, and the line stayed; `WEBKIT_DISABLE_DMABUF_RENDERER=1` hid it
  there.
- Reported upstream as
  [blackboardsh/electrobun#618](https://github.com/blackboardsh/electrobun/issues/618),
  with a proposed fix in
  [blackboardsh/electrobun#619](https://github.com/blackboardsh/electrobun/pull/619).

Not run yet:

- The setup wizard and the agent's keyboard focus in the desktop app. Both
  were run in the browser build only (see below).
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

Run for the app's identity (issue 27), Linux x64 (Omarchy, Arch Linux) with
Bun 1.4.4, Electrobun 2.0.6, Timber 0.1.2, and ImageMagick 7. Geist was not
installed on the machine: `fc-list | grep -ic geist` printed 0.

- `bun run icons`: wrote `icons/icon.png` at 512 by 512, `icons/icon.ico`
  with 16, 24, 32, 48, 64, 128, and 256, and the ten pictures of
  `icons/icon.iconset`, from 16 to 1024 pixels.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1121 tests passed, 1 was skipped, and 1 failed. The failure
  is "closing a session ends everything it started" in
  `tests/terminals.test.ts`, which timed out on this machine. It is not
  part of this change, which touches no terminal code.
- `bun run build`: completed. Vite put `Geist-Variable` and
  `GeistMono-Variable` WOFF2 files in `dist/assets`, and
  `artifacts/stable-linux-x64-update.json` named the identifier
  `com.codingm8s.timber-app` and the version 0.0.1, as in `package.json`.
- The same build with `version` taken from `package.json` by a named
  import: the update record said 0.1.0. With a default import, or with the
  version written out: 0.0.1.
- The built launcher run with `env -i PATH=/usr/bin:/bin HOME=<temporary
  folder>`: it installed to `~/.local/share/com.codingm8s.timber-app/stable`.
  `app/Resources/appIcon.png` was the 512 pixel icon, and
  `app/Resources/app/licenses` held `geist-fonts-OFL.txt` and
  `timber-logo.txt`. The menu entry had `Name=Timber`, the description as
  `Comment=`, and `Icon=` set to that icon. `desktop-file-validate` on it:
  no output, exit 0.
- The built interface from `vite preview` in headless Chromium, with every
  host but localhost made unresolvable: `document.fonts` listed Geist and
  Geist Mono as loaded, every request went to localhost, the page title was
  Timber, and Settings, About showed the app at 0.0.1 and the sample Timber
  at 0.1.2 with its path. A screenshot showed the text set in Geist.
- `grep -rn $'\u2014' src tests docs scripts licenses README.md
  electrobun.config.ts`: nothing.
- Not run: the icon seen in a real window, taskbar, or launcher on Linux,
  and About in the desktop window. Nothing on Windows or under WSLg, so the
  Windows icon, the typeface there, and the installer's name on Windows are
  unchecked. Nothing on macOS, where the iconset has never been compiled.

Run for the interim rebase (issue 17), Linux x64 (Fedora 44) with Bun 1.4.2
and Timber 0.1.2, after rebasing it onto several sessions per worktree:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1197 tests passed, 1 was skipped, none failed. The ones in
  `tests/rebase.test.ts` run a stand-in Timber in a folder with a space in a
  pseudo terminal in a temporary repository: it gets exactly the arguments
  the dialog words, in the worktree's folder, and its exit code 3 is what the
  session reports; no base passes no `--base`; a worktree with a shell gets
  the rebase in a session beside it; nothing runs while Timber is not ready,
  for an unlisted worktree or repository, for a request of the wrong shape,
  together with setup, or on Windows. One runs the installed Timber, which
  rebased the worktree onto `refs/heads/main` with exit code 0 and left it
  clean. `tests/rebase-dialog.test.tsx` covers the store (the session, the
  Workspace tab, a read of the list only once the process ended, a worktree
  with a shell, a refusal, an engine that does not answer) and the rendered
  dialog.
- `bun run start` in a headless sway session with XWayland, driven by X11
  test input, with a temporary repository whose two worktrees were behind
  `main`. On `feat/demo`, with a shell already open, the dialog offered the
  three local branches as `refs/heads/...`, typing narrowed the list and
  changed the footer, and submitting `refs/heads/main` started a "Rebase"
  chip beside the shell; Timber printed "Rebase completed (or already up to
  date)." and exited with code 0, and `git log` showed the branch on top of
  `main`. On `feat/conflict`, Timber stopped on a conflict in `README.md` and
  exited with code 1, and the list showed the detached HEAD and one modified
  file. A terminal from the "+" menu ran `git rebase --abort`, after which
  the branch was back on its old tip, clean, and the list showed it so
  without a refresh. Screenshots were looked at.
- Not run: a remote base, which needs a remote to fetch from, and the
  dialog on macOS or Windows.

Run for showing each worktree's saved base (issue 19), Linux x64 (Omarchy,
Arch Linux) with Bun 1.4.4, Git 2.56.1, and Timber 0.1.2:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1246 tests passed, 1 was skipped, none failed.
  `tests/saved-base.test.ts` runs the installed Timber in a temporary
  repository with a remote: worktrees made with `timber new --base
  origin/main` and `--base refs/heads/main` list those bases, the primary
  checkout and a worktree added with plain Git list none, a worktree whose
  saved `base.json` was overwritten lists as invalid (malformed) and stays in
  the list, and two reads leave every file, ref, and index as they were.
  `tests/timber-ls-parse.test.ts` reads a listing recorded from that Timber
  (`tests/fixtures/timber-ls/with-bases.json`) and the older recording
  without the field, which still lists all seven worktrees with no base.
- `bun run build:web`, served with `vite preview` and driven in headless
  Chromium with the sample data: the row tooltips and the header read "Base
  origin/main", "Base refs/heads/main", "No saved base", "Base unknown" (also
  a "base unknown" marker on the row), and nothing for the worktree whose
  record has no base. The Rebase dialog opened with `origin/main` in Onto
  and `timber rebase --base origin/main -- <path>` in the footer, and with
  an empty Onto and no `--base` for the invalid base and for the record
  without one. Screenshots of the header and the dialog were looked at.
- Not run: the desktop window, a Timber older than 0.1.2 (the missing field
  was read from a recording of 0.1.1 only), and anything on macOS or
  Windows.

Run for the saved window, Linux x64 (Omarchy, Arch Linux, Hyprland 0.57.2
at a monitor scale of 1.6, through XWayland) with Bun 1.4.4:

- `bun test tests/window-frame.test.ts tests/window-memory.test.ts
  tests/settings-parse.test.ts`: all passed. They cover reading a saved
  window, what is remembered while maximized and full screen, fitting a
  frame to the displays, and saving against a real temporary settings file
  next to the layout.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- The dev build (`bunx vite build`, `bunx electrobun build`, then
  `build/dev-linux-x64/Timber-dev/bin/launcher`) with `XDG_CONFIG_HOME` on a
  temporary folder, as a floating window through a temporary Hyprland
  window rule. The window was resized and moved with `xdotool` and closed
  through Hyprland. The first run opened at 1280 by 819. After a resize to
  1500 by 900 the file held that frame (as 1502 by 899) within about a
  second, and three more runs each opened at 1502 by 899. Before the two
  unit slack the position moved left by one or two pixels on every run
  (699, 697, 696); with it the file stayed at 696 over two more runs. A file
  edited to a frame 4000 wide at x 5000 opened at x 0, 3200 wide, which is
  the display.
- Not run: a maximized window. Hyprland did not maximize the floating
  window when asked, so the app saw it as not maximized and saved that. Not
  run either: a window manager with title bars, where the frame read back
  may differ from the frame asked for by more than the slack, any second
  display, and Windows and macOS.

Run for rebasing through Timber's result file (issue 18), Linux x64
(Fedora 44) with Bun 1.4.2, Git 2.56.1, and Timber 0.1.2:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1270 tests passed, 1 was skipped, none failed, in two runs in
  a row, and 1343, 1, and none after rebasing onto the saved base (issue
  19), whose dialog tests now expect the result file in the footer. Before
  that, the test that rebases with the installed Timber failed
  on this machine: the test empties Git's global configuration, and Git then
  had no committer for the rebased commits and could not guess one from the
  host name. The test now gives Timber's Git an identity, as the `git`
  helper of the tests does.
- The records in `tests/fixtures/timber-rebase` were written by the
  installed Timber 0.1.2 in temporary repositories: rebased and up to date
  (exit code 0), and conflicts in two files, one with a space in its name,
  a refusal over an untracked file, a `pre-rebase` hook that exits with 1,
  and a fetch from a missing remote (each exit code 1). Each matched the
  contract. `tests/worktree-rebase.test.ts` runs the installed Timber: a
  conflict leaves Git's `rebase-merge` folder and the unmerged file in
  place, and a refusal leaves files and refs as they were.
- `bun run dev:web` in headless Chromium against the mock engine, with
  every ending of `timberMock.endRebaseResults`: the toasts for rebased and
  up to date, Timber's reason with "Nothing was changed." for a refusal,
  the failure words for failed and no result, the words for an older
  Timber, the refusal of a worktree with changes whatever the ending, and
  the conflicts view, whose "Open a terminal here" started a shell in that
  worktree on the Workspace tab. The footer followed the Onto field.
- `bun run start` in a headless sway session with XWayland, driven by X11
  test input, with its own `XDG_CONFIG_HOME` and a temporary repository
  whose four worktrees were behind `main`, in conflict with it, holding an
  untracked file, and level with it. `feat/demo` onto `refs/heads/main`
  closed with "Rebased feat/demo onto main", and `git log` showed it on top
  of `main`; again with an empty Onto (the saved base) it closed with
  "feat/demo is already up to date with main". `feat/dirty` stayed open
  with Timber's refusal, and its HEAD, status, and refs were the same
  afterwards. `feat/conflict` showed both conflicted files, and Git had
  `rebase-merge` with `AA` and `UU` entries. This run found that the title
  named the detached HEAD the list showed after the pause, that
  `git rebase --continue` broke at its dashes, and that the focus went back
  to the Rebase control instead of the new terminal, so a typed space
  opened the dialog again. All three were fixed and run again: the title
  names `feat/conflict`, and `git rebase --abort` typed straight after
  "Open a terminal here" went to the terminal and put the branch back on
  its old tip, which the list showed without a refresh. Screenshots were
  looked at.
- Not run: a remote base that was fetched, and the dialog on macOS or
  Windows.

Run for the interface zoom, Linux x64 (Omarchy, Arch Linux, Hyprland 0.57.2
at a monitor scale of 1.6 with `xwayland:force_zero_scaling`, `GDK_SCALE=1`,
through XWayland) with Bun 1.4.4:

- `bun test`, `bun run typecheck`, and `bun run typecheck:desktop`: see the
  pull request for the counts. The tests cover reading a zoom, the list
  Settings offers, the preference in the table of preferences, and the
  Layout section as drawn.
- The cause, with the dev build pointed at a small page that reported its
  own measurements, in a window Hyprland counted as 992 wide: a device
  pixel ratio of 1 and a width of 1587, so nothing was scaled. With
  `GDK_DPI_SCALE=1.6` the ratio was 1.6 and the width 991. With
  `GDK_SCALE=2` the ratio was 2 and the width 794.
- The setting, same page, with the zoom written into a temporary settings
  file: 1 gave a ratio of 1 and a width of 1587, 1.6 gave 1.6 and 991, and
  2 gave 2 and 793.
- The real interface in the dev build at a saved zoom of 1.6, looked at in
  screenshots: the sidebar, the workspace, and the Settings dialog were
  drawn larger and whole, and Zoom showed 160%. Choosing 200% and pressing
  Save (clicks sent with `xdotool`) redrew the window larger at once, the
  file then held 2, and a terminal opened after that drew its prompt sharp
  at that size. The open list of the select and a tooltip stayed small.
- Not run: a terminal that was already open while the zoom changed, a
  display that scales X11 windows itself (where 100% is already right),
  Windows, and macOS, where `setPageZoom` was not tried at all.

Run for themes (issue 83, the picker and the built-in themes), Linux x64
(Omarchy, Arch Linux) with Bun 1.4.4 and Timber 0.1.2:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1420 tests passed, 1 was skipped, none failed. The theme tests
  cover reading colors and themes, the contrast check, every built-in theme
  passing it, the choice as a preference, the stylesheet, the preload script
  run against a stand-in page, and that `styles.css` has no color of its
  own. The Settings test draws the Theme section with each theme's card.
- `bun run build:web`: built, with xterm still in its own chunk.
- `bun run start` on a virtual X server (`Xvfb :5`, no window manager,
  no `WAYLAND_DISPLAY`), with its own `XDG_CONFIG_HOME` holding this
  repository and a saved theme, driven by `xdotool` clicks and looked at in
  screenshots:
  - Saved Solarized Light: the window and a new terminal were drawn in it.
    A loop that printed the six ANSI colors showed them.
  - Settings, Theme showed seven cards, Solarized Light chosen. Choosing
    Nord redrew the window and the open terminal at once. Close without
    Save went back to Solarized Light, the terminal too, with its output
    still there. Nord and Save, then Close: the window stayed Nord, the
    terminal kept its session and its scrollback, and the file held
    `{ "mode": "fixed", "theme": "nord" }`.
  - First paint: a pixel of the sidebar read every few milliseconds from
    the moment the window appeared. With Timber Light saved it went from the
    window's own grey, through one white frame, to Timber Light's surface;
    with Nord saved, from the grey and one white frame to Nord's. Neither
    showed Timber Dark. The grey and the white come before any page content
    and do not depend on the theme.
  - Following the system, light Timber Light and dark Nord: started plainly
    the window was Timber Light, and with `GTK_THEME=Adwaita:dark` it was
    Nord, so WebKitGTK passes GTK's dark setting to
    `prefers-color-scheme`.
- Not run: the system's setting changing while the app is open, the
  desktop under a real Wayland or X11 session for this change, the window's
  own background before the first frame, Windows, and macOS.

Run for themes (issue 83, the maker, custom themes, and theme files),
Linux x64 (Omarchy, Arch Linux) with Bun 1.4.4 and Timber 0.1.2:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1447 tests passed, 1 was skipped, none failed.
  `tests/theme-files.test.ts` covers custom themes read strictly and
  salvaged from the file, ids and names, the file format and every
  refusal, the main process's Export and Import in temporary folders (a
  file that is there is never written over, a missing folder writes
  nothing, reading changes nothing), the saved preferences refusing a broken
  theme without touching the file, the mock, and the maker's model.
  `tests/theme-maker.test.tsx` draws the maker.
- `bun run build:web`: built, with xterm still loaded only on demand.
- `bun run start` on `Xvfb :5` with its own `XDG_CONFIG_HOME`, driven by
  `xdotool` and checked in screenshots:
  - New theme from Nord opened the maker in the wider dialog. Making faint
    text `#4c566a` listed four warnings with their ratios and marked the
    row; the sidebar color and the name changed both previews as typed.
    Enter saved it: the file held `custom-plum` named Plum, in use, and the
    window was drawn in it. After a restart it was drawn in it from the
    first frame.
  - Export picked a folder in GTK's own dialog and wrote
    `plum.timber-theme.json`. Delete asked first, saying it was in use, and
    the save put Timber Dark back and emptied the list.
  - Import of a file with only a format, a version, and a name was refused
    with the reasons, and the file was unchanged. Import of the exported
    file added Plum and showed it, with Save offered.
  - Edit renamed it to Plum Night, keeping its id. In the maker, changing
    the terminal's red redrew the sample terminal at once; Cancel left the
    file as it was.
  - On this machine the file dialog first went through the desktop portal
    of the real session, so it opened on the real desktop, not on Xvfb. The
    run went on under `dbus-run-session` with `GTK_USE_PORTAL=0`.
- Not run: the portal's dialog driven to the end, Windows, and macOS.

Run for the startup flash (follows issue 83), Linux x64 (Omarchy, Arch
Linux) with Bun 1.4.4:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1450 tests passed, 1 was skipped, none failed.
  `tests/window-reveal.test.ts` covers showing once on the word, the
  fallback, and a late word after it.
- The dev build on `Xvfb :5` under `dbus-run-session`, with Nord saved: a
  sampler read one pixel of the sidebar through `XGetImage` as fast as it
  could from before the launch, three launches each. On `main`: GTK's grey
  `#f6f5f4` for about 250 ms, white `#ffffff` for 20 to 50 ms, then Nord's
  `#2a2f3a`, its `#272c36`, and `#2a2f3a` again as the empty page filled,
  in Nord at 0.63 to 0.68 s. With the window shown on the word: grey for 35
  to 50 ms, no white and no change after, in Nord at 0.63 to 0.67 s. The
  log never said the window was shown by the fallback.
- Not run: the fallback in the desktop window, a saved maximized window
  (Xvfb has no window manager), a dark GTK theme, where the grey is dark,
  Windows, and macOS.

Run for adding a repository through a portal file chooser (issue 75),
Linux x64, Omarchy 4.0.0 alpha (`omarchy-dev` `4.0.0.r8031.ge6aec97`),
Hyprland 0.57.2, `xdg-desktop-portal` 1.22.1, and Files (`folio`) 0.6.1 as
the portal's file chooser, with Bun 1.4.4 and Git 2.56.1. The app was the
dev build already in `build/dev-linux-x64`, not rebuilt for this run, with
its own `XDG_CONFIG_HOME` and no `TIMBER_APP_REPOS`:

- Set up so that no input reached the real desktop: under
  `dbus-run-session`, a nested Hyprland with its own Wayland socket and
  `/usr/lib/xdg-desktop-portal` started on that bus, with
  `GTK_USE_PORTAL=1` and `XDG_CURRENT_DESKTOP=Hyprland`. The app ran on
  `Xvfb :75` on the same bus and was clicked with `xdotool`. Keys went to
  the chooser with `wtype` on the nested socket, and screenshots were taken
  with `grim` and `import`. The nested Hyprland draws only while its window
  is shown, so that window was put on a headless output of the real session
  (`hyprctl output create headless`), which was removed after.
- Keys from `wtype` and Hyprland's `send_shortcut` did not reach the app's
  window when it ran on the nested Hyprland's XWayland, so the app was moved
  to Xvfb, where `xdotool` clicks did.
- "Add repository" opened `folio-chooser`, titled "Open File", in the home
  folder. Ctrl+L and a typed path went into the folder, and Ctrl+Enter
  answered. With 0.5.0 (issue 28 above) going into a folder could not be
  done with sent input.
- A repository's primary checkout: "Added alpha", its two worktrees listed,
  and the settings file had its path and common directory.
- A folder inside its linked worktree: "alpha is already in the list. That
  folder belongs to it, so nothing was added." A folder that is not in a
  repository: "Not a Git repository" with its path. The settings file was
  byte for byte the same after both.
- Cancel with Escape, and again by closing the chooser window through the
  nested Hyprland: no notice, the list and settings file unchanged, the
  button back to "Add repository", and selecting the other worktree worked.
- The fixture's worktrees, refs, and files were the same after the run.
- Not run: Folio's Cancel and Select buttons clicked with a pointer, the
  chooser on the real desktop, so where it opens next to the app was not
  seen, and GNOME's and KDE's portal choosers.

Run for the terminal pane's polish (issue 82), Linux x64 (Omarchy, Arch
Linux) with Bun 1.4.4 and Timber 0.1.2:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1463 tests passed, 1 was skipped, none failed. They cover the
  shell, state, Rename, and Close in the row of chips with no bar of their
  own, Timber Dark's greys at the minimum contrast on the pane, and both
  terminals, the theme maker's sample included, setting the minimum.
- `bun run build:web`: built.
- Measured with `contrastRatio` before the change: Timber Dark's bright
  black (`#5c5c66`) was 2.96:1 on the pane and its black 1.19:1. Under
  4.5:1 in the other built-in themes: black in every dark theme, bright
  black in Catppuccin Mocha, Nord, and Solarized Dark, red in Gruvbox Dark,
  Nord, and Solarized Dark, Gruvbox Dark's blue and magenta, Solarized
  Dark's magenta, Timber Light's bright green, magenta, and cyan, and most
  of Solarized Light. Those palettes stay as they are; the minimum raises
  them as they are drawn.
- `bun run start` on `Xvfb :82` under `dbus-run-session`, with its own
  `XDG_CONFIG_HOME` and a temporary repository, driven by `xdotool` and
  checked in screenshots:
  - At 1280 by 820, the chip, "+", and at the right bash, Running, Rename,
    and Close shared one row, and the terminal began right under it.
  - `printf` of bright black, dim, white, black, and the sixteen colors:
    each was readable and kept its hue; black was drawn as a grey.
  - After `exit`, at 760 by 520: the chip showed `exit 0`, the row "Exited
    with code 0", and the ended note fit on two lines beside Dismiss.
  - At 640 by 520, where the sidebar stacks above the workspace, two chips
    and the controls still fit on one row.
- Not run: many chips at a narrow width, a light theme in the desktop
  window, Windows, and macOS.

Run for the system packages a clean Linux needs (issue 67), on Pop!_OS
24.04 LTS x64 with Docker 29.10, Bun 1.4.2, and Electrobun 2.0.6, at commit
`36a61ce`. `bun run build` made the installer. Each run used a fresh
container from the distribution's official image, with only the packages
named below added, and ran the installer as a non-root user with
`--shm-size=1g`. The display was `Xvfb :99` in a second container sharing
`/tmp/.X11-unix`, so Xvfb's own libraries were not in the app's container.
"Starts" means the installed app's window was listed by `xwininfo -root
-tree` after 20 seconds and a screenshot showed the interface drawn, here
"Timber is not installed", since no Timber or Git was installed. The
installer starts the app itself when it is done, and the script started the
installed launcher once more, so every run that started listed two Timber
windows at the same place; the screenshot does not tell which one drew.

- `readelf -d` of the build: `libNativeWrapper.so` needs
  `libwebkit2gtk-4.1.so.0`, `libjavascriptcoregtk-4.1.so.0`,
  `libsoup-3.0.so.0`, `libayatana-appindicator3.so.1`, `libgtk-3.so.0`, and
  GLib, GDK, cairo, and gdk-pixbuf, plus `libstdc++`, `libgcc_s`, and the
  bundled `libasar.so`. `launcher`, `bun`, and `libElectrobunCore.so` need
  only glibc's libraries. No file needs librsvg, and zstd is bundled
  (`bin/zig-zstd`).
- `ubuntu:24.04` as it comes (92 packages): the installer exited 0 (it
  noted it could not update the desktop database), and the app exited 1
  with "Linux desktop runtime libraries are missing", the eleven libraries
  of the list above, and
  Electrobun's suggestion `libgtk-3-0 libwebkit2gtk-4.1-0
  libayatana-appindicator3-1 librsvg2-2`, which is where the earlier README
  list came from.
- `apt-get install libwebkit2gtk-4.1-0 libayatana-appindicator3-1`, with
  recommended packages (373 packages after): started.
- The same with `--no-install-recommends` (315 packages): started, and the
  screenshot was the same.
- The versions, from `dpkg-query`, `rpm -q`, and `pacman -Q` in fresh
  containers that ran the same install commands the same day (not the
  containers above): on Ubuntu `libwebkit2gtk-4.1-0` and
  `libjavascriptcoregtk-4.1-0` 2.52.6, `libayatana-appindicator3-1` 0.5.93,
  and `libgtk-3-0t64` 3.24.41 either way; `librsvg2-2` 2.58.0 only with
  recommended packages. On Fedora and Arch librsvg came as a dependency
  (2.61.5 and 2.63.4), so there it was not left out.
- Only `libwebkit2gtk-4.1-0`: the app exited 1 naming
  `libayatana-appindicator3.so.1`. Only `libayatana-appindicator3-1`: it
  exited 1 naming the WebKitGTK, JavaScriptCore, and libsoup libraries.
- `fedora:43`, `dnf install webkit2gtk4.1 libayatana-appindicator-gtk3`
  (webkit2gtk4.1 2.54.2, libayatana-appindicator-gtk3 0.6.0, gtk3
  3.24.52): started, with weak dependencies (488 packages) and with
  `--setopt=install_weak_deps=False` (298 packages). Electrobun's
  suggestion for Fedora names `libappindicator-gtk3`, which is not the
  Ayatana library the wrapper links; that was not run.
- `archlinux:latest`, `pacman -Sy webkit2gtk-4.1 libayatana-appindicator`
  (2.54.2 and 0.6.1, gtk3 3.24.52, 262 packages): started.
- Every run that started logged `DRI3 error: Could not get DRI3 device`
  (Xvfb has no DRI3) and one `X11 Error: GLXBadWindow (code 170)`, see
  [the GLXBadWindow line at start](#the-glxbadwindow-line-at-start).
- Not run: a full desktop install or a VM, where these packages are often
  there already; Git, Timber, and listing worktrees (needed to use the app,
  not to start it); terminals, the folder picker, and editors; fonts other
  than the bundled ones; other Debian-based or Fedora versions.

Run for GNOME, KDE, and a real X11 login session (issue 66), on 2026-11-18
with the installer built at commit `36a61ce` and copied into each guest
with `scp`, Timber 0.1.2, and Git from each distribution. Each system was a QEMU/KVM virtual machine on the Pop!_OS
host (4 CPUs, 6 GB, `virtio-vga`, no display of its own), made from the
distribution's cloud image with a desktop added, and logged in by its
display manager's automatic login. Rendering was Mesa's llvmpipe, so no GPU
drew anything. Input was a USB tablet and keyboard emulated by QEMU and
driven through its QMP socket, which the guest sees as a mouse and keyboard
(unlike XTest, see issue 28 above). Screenshots came from QMP too. In each
session the installer ran as the user (`systemd-run --user`), and the app
was then started from the desktop's own menu; its environment had no
`GTK_USE_PORTAL`. A test repository had a primary checkout and two linked
worktrees, one with a modified file.

- Ubuntu 24.04.5 with `ubuntu-desktop-minimal` (GNOME Shell 46.0, GDM
  46.2, Xwayland 23.2.6), Wayland session (`loginctl`: `Type=wayland`):
  - The desktop package already brought `libwebkit2gtk-4.1-0` 2.52.6 and
    `libayatana-appindicator3-1` 0.5.93.
  - The app grid showed Timber with its icon; clicking it opened the window
    under XWayland, and the dock showed the same icon. A search typed right
    after opening the overview found nothing; the grid was used instead.
  - "Add repository" opened GTK's own "Open File" chooser, a window of the
    app's process. Choosing the linked worktree `demo-feature-two` added the
    repository `demo` with all three worktrees and the modified file.
  - Open terminal started bash in the primary checkout; typed `echo
    hello-$((40+2)) && pwd && echo $XDG_SESSION_TYPE` printed `hello-42`,
    the folder, and `wayland`.
  - Open in editor with no editor saved opened Settings, Editor. "Other
    command" `nautilus --new-window` was saved, and Open in editor then ran
    it with the worktree's folder, and Files opened there.
  - The title bar's close button asked "Quit Timber?", and Quit ended the
    app.
- The same machine logged in to "Ubuntu on Xorg", a real X11 session
  (`Type=x11`, `Xorg` on vt2, no Xwayland, `xserver-xorg-core` 21.1.12):
  the app started from the grid and listed the saved repository, the
  terminal printed `x11`, the chooser added a second, plain repository,
  Open in editor started Files on it, and Quit ended the app. The journal
  had `DRI3 error` and `X11 Error: GLXBadWindow (code 170)` once (see
  [the GLXBadWindow line at start](#the-glxbadwindow-line-at-start)).
- Ubuntu 24.04.5 with `kde-plasma-desktop` and `plasma-workspace-wayland`
  (Plasma 5.27.12, KWin 5.27.11, SDDM 0.20.0; not the `kubuntu-desktop`
  package), Wayland session (`Type=wayland`, Xwayland on `:1`):
  - The desktop did not bring the app's libraries; the README's `sudo apt
    install libwebkit2gtk-4.1-0 libayatana-appindicator3-1` did.
  - The menu's search found Timber with its icon and description. The
    window's title bar showed a generic X icon, the task bar the app's.
  - In the chooser, Ctrl+L and the typed path of `demo-feature-one` added
    the repository with its three worktrees.
  - The terminal printed `wayland`. "Other command" `kate` opened Kate on
    the worktree's folder as a project. Quit ended the app. The journal had
    `GLXBadWindow (code 168)` once.
- The same machine's Plasma X11 session (`Type=x11`, Xorg): the app started
  from the menu and listed the saved repository, the terminal printed
  `x11`, Open in editor ran `kate` with a worktree's folder, and Quit ended
  the app. The chooser was not run there.
- Fedora 43 with the `kde-desktop-environment` group (Plasma 6.7.5, KWin
  6.7.5, SDDM 0.21.0, Xwayland 24.1.14), Wayland session (`Type=wayland`,
  `Desktop=KDE`), SELinux enforcing:
  - The desktop did not bring the app's libraries; `dnf install
    webkit2gtk4.1 libayatana-appindicator-gtk3` did (2.54.2 and 0.6.0).
  - The launcher's search found Timber with its icon; the window opened
    under XWayland with the app's icon in its title bar. The app found
    Timber; the session's PATH had `~/.local/bin`.
  - The chooser was GTK's own; double-clicking `projects` and choosing
    `demo` added the repository with its three worktrees.
  - The terminal printed `wayland`. With VS Code 1.147.0 installed from
    Microsoft's repository and chosen in Settings, Open in editor ran `code`
    with the worktree's folder, and a VS Code window opened.
  - Quit ended the app with `[stopEventLoop] Initiating clean event loop
    exit`. The log had `GLXBadWindow (code 170)` once.
- The installer exited 0 on both Ubuntu machines (on Fedora it was not
  waited for, and its log ended "Installation completed successfully."),
  and each run wrote the menu entry and `~/Desktop/Timber.desktop`. On KDE it printed `gio: Setting attribute
  metadata::trusted not supported`. The app the installer starts by itself
  ended with the `systemd-run` unit, so it was not used.
- On both Ubuntu machines, installing the desktop over the cloud image's
  network setup left the network without IPv4 until `netplan apply`. That
  belongs to the cloud image, not to the app.
- Typed input in the terminal appeared about two seconds late under
  llvmpipe. Clicks did not.
- Not run: real hardware or an NVIDIA GPU, a login typed at the greeter
  instead of automatic login, the `kubuntu-desktop` and Fedora KDE spin
  installs, fractional scaling, the portal chooser
  (`GTK_USE_PORTAL=1`), Zed and Neovim, starting an agent, and the Changes
  tab.

Run for the same issue on real hardware by a person, the Pop!_OS 24.04
machine of the issue 28 run, in its COSMIC session, with the same build
and display scale 100%. The person installed it with
`build/stable-linux-x64/Timber/bin/launcher` and followed these steps,
clicking and typing themselves, and reported that every step worked:

- Started from the COSMIC launcher, the window opened and found Timber.
- "Add repository" opened COSMIC's own file chooser, not GTK's, so it went
  through the desktop portal. Choosing a repository in it added the
  repository and listed its worktrees.
- Open terminal, and the same typed `echo` line printed back.
- Open in editor, first with no editor saved (Settings, Editor), then with
  their editor chosen, which opened on the worktree's folder.
- The window's close button asked "Quit Timber?", and Quit ended the app.
- Nothing looked wrong to them.
- Not recorded: which editor, the GPU and driver, the versions, and the
  log. Not run: fractional scaling.

Run for the setup wizard (issue 95) and the agent's keyboard focus, Linux
x64 with Bun 1.4.2, Git 2.43.0, Timber 0.1.2, and headless Google Chrome
151 driven over the DevTools protocol against `bun run dev:web`, with real
pointer clicks and typed text:

- `bun run typecheck`: no errors. `bun test`: every test passed.
- `timber __app-config apply --scope repository` with empty values, in a new
  temporary repository: exit code 0, and Timber wrote `.timber.toml`, so a
  save with every choice left alone sets a repository up.
- Add repository, then Set up Timber on `docs-site`: the wizard opened at
  "Step 1 of 7: Where to save". The Zed preset filled the editor; the last
  step listed "zed --new" and showed
  `timber __app-config apply --scope repository --input-file <settings draft> --result-file <temporary file>`.
  Save closed the wizard and the prompt was gone, with no focus change.
- Cancel left the prompt. "Every repository on this machine" showed the
  machine file and `--scope global`; saving it removed the prompt too.
- A click on a worktree row with an agent running, on another row and
  back, and on the row already selected, put the focus in the terminal
  (`xterm-helper-textarea`). New worktree with Claude Code as its agent
  closed the dialog, selected the new worktree, and put the focus in its
  agent's terminal.
- No console errors.
- Not run: the desktop window, where the order of the dialog closing and
  the session showing may differ from the browser build.

Run for pull requests (issue 100), Linux x64 (Omarchy, Arch) with Bun
1.4.4, Git 2.56.1, the installed Timber 0.1.2, and Timber's main branch at
`b2aad95` run from its source as `~/Projects/timber/src/index.ts`:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1544 passed, 5 skipped, 0 failed. The two real Timber tests of
  `tests/pull-requests.test.ts` are among the skipped, because the installed
  Timber 0.1.2 has no `__app-pr`.
- `TIMBER_APP_TIMBER_PATH=~/Projects/timber/src/index.ts bun test
  tests/pull-requests.test.ts`: 15 passed, 0 failed, including both real
  Timber tests: a temporary repository whose remote is not on GitHub, with a
  linked worktree and a detached one, answered `not-github` for each branch
  and `none` for the detached one, with the files, refs, index, and worktree
  list of all three unchanged; and a folder outside any repository failed
  with Timber's diagnostic.
- The fixtures in `tests/fixtures/timber-app-pr` other than `found.json`
  were recorded from that Timber in temporary repositories: offline (a
  proxy that does not answer), a token GitHub refused, no login at all, a
  remote not on GitHub, a folder outside any repository, and Timber 0.1.2's
  "unknown command". `found.json` is written by hand in the same shape.
- That Timber run by hand in a temporary clone of this private repository,
  with worktrees on the branches of an open and a merged pull request and a
  detached one: an open one with failing checks, a merged one with passing
  checks, and `none` for `main` and the detached one.
- `bun run build:web`, then the built interface in headless Chromium with
  the sample data: the rows showed `#42`, "checks pass", "approved"; `#38`
  with "checks fail" and "changes requested" in red; `#17 merged`; and
  `#5 closed`.

Run for the Pull request tab (issue 101), Linux x64 (Omarchy, Arch) with
Bun 1.4.4:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1561 passed, 5 skipped, 0 failed.
- `bun run build:web`: built.
- `bun run dev:web` in headless Chromium, each worktree selected and the
  Pull request tab clicked: #38 with "Changes requested" and "Checks fail"
  in red, a failing run in red, and a status without a link and no Open;
  #42 approved, with a skipped run and a description whose `<b>` shows as
  text and whose blank lines are kept; the draft, merged, and closed ones,
  the closed one with "No checks were reported for the head commit." and
  "No description."; and "No pull request yet" for spike/new-idea. No
  console errors.

Run for desktop notifications and sounds (issue 119), on 2026-11-18,
Pop!_OS 24.04 (COSMIC, `cosmic-notifications` 1.11.0, spec 1.2) on Linux
x64 with Bun 1.4.2:

- `bun test`: 1725 passed, 5 skipped, including the alert policy and its
  runner, the D-Bus wire format with byte fixtures, a fake bus on a
  temporary Unix socket, the notifications backend with a fake server, the
  sound player with a fake spawn, and the Settings section.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- The app's own D-Bus client, from a scratch script outside the app,
  against the real session bus: `GetCapabilities` listed `actions`,
  `body-markup`, and `sound`, but not `activation-token`. A notification
  with the body `In feat: <b>not bold</b> & plain` showed the tags as text,
  nothing bold. A person clicked it: `ActivationToken` (32 characters) came
  first, then `ActionInvoked` with `default`, and the click reached
  `onClick` with its session and token, about 1.7 seconds after it showed.
  No `notify-send` was involved. `CloseNotification` took one away;
  COSMIC sent `NotificationClosed` twice for it, reasons 3 and 2.
- The three tones that come with the app and the system sound played
  through `pw-play`, from a scratch script with the real spawn; a missing
  own file answered "missing", and a second sound while one played "busy".
- The desktop window (`bun run start`), Wayland session: a shell in one
  worktree ran `sleep 15; printf '\e]7501;state=working\e\\'; sleep 1;
  printf '\e]7501;state=done\e\\'` while another worktree was selected and
  another window was in front. The notification showed; a person clicked
  it, and Timber came to the front and showed that worktree and its shell.
- Not run: quitting with a notification on screen; other compositors
  (GNOME, KDE); macOS and Windows (notifications and sounds); `afplay` and
  PowerShell; an MP3 file.

Run for agent status from the Program Status Protocol (issue 111), on
2026-11-18, Pop!_OS 24.04 (COSMIC) on Linux x64 with Bun 1.4.2:

- `bun test`: all tests passed, 1 skipped, including the scanner on split
  parts, BEL and ST, malformed pairs, and oversized reports, and real pseudo
  terminals in which `/bin/sh` printed a probe (answered on its input, read
  back byte for byte with `dd`), reports, an OSC 133 prompt, and an exit.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- The real Claude Code 2.1.327 started through `createTerminalSessions` (the
  main process's own module) in a new temporary repository, for 12 seconds,
  from a scratch script: it sent one probe, got the answer, and reported
  `state=blocked:app=claude-code:kind=permission` with the message "trust this
  folder", which reached the session's `status`. No prompt was sent to it.
- The real Codex CLI 0.169.0 the same way, also with stand-in answers to its
  device attribute, cursor position, and color queries: in 12 seconds at its
  first screen it sent neither a probe nor a report. Its executable holds
  program status code, so it may report only once a turn runs; not known.
- Not run: the desktop window with either agent (marks, chips, the
  collapsed header, a notification and its click), a turn of either agent
  from Working to Done, and `notify-send` with `--wait` and `--action`, which
  is not installed on this machine.

Run for Done from a worktree row's menu (issue 97), on 2026-11-18, Pop!_OS
24.04 (COSMIC) on Linux x64 with Bun 1.4.2:

- `bun test`: all tests passed, 5 skipped, including the menu's entries for a
  linked worktree and a primary checkout, its keys, its placement inside the
  window, and the Done dialog opened for a worktree that is not selected.
- `bun run typecheck`: no errors.
- `bun run dev:web` in headless Chrome, driven over the DevTools protocol
  with real mouse and key input: a right-click on an unselected row, and on
  its "Open in editor" button, opened its menu with Done focused. Escape
  closed it and gave the keyboard back to the row. Shift+F10 and the context
  menu key on the focused row opened it under the row, and a click elsewhere
  closed it. Scrolling the sidebar's list closed it and gave the keyboard
  back to the row. Enter and a click on Done opened the Done dialog for that row
  while the primary checkout stayed selected, and closing the dialog gave
  the keyboard back to the row. On a primary checkout Done was disabled with
  "The primary checkout is never removed." under it, and Enter on it left
  the menu open with no dialog. The menu on the last row stayed inside the
  window.
- In the desktop window, run by a person: Shift+F10 on a focused row opened
  the menu under the row, and it stayed there.
- Not run: the rest of the menu in the desktop window (right-click, the
  context menu key, Done, a primary checkout), and
  `bun run typecheck:desktop`.

Run for linked issues (issue 103), on 2026-11-18, Pop!_OS 24.04 on Linux x64
with Bun 1.4.2, the installed Timber 0.1.2, and Timber's main branch at
`d2cb215` run from its source through a wrapper script
(`exec bun ~/timber/src/index.ts "$@"`):

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: all passed, 8 skipped. The real Timber test of
  `tests/issues.test.ts` is among the skipped, because Timber 0.1.2 has no
  `__app-issue`.
- `TIMBER_APP_TIMBER_PATH=<wrapper> bun test tests/issues.test.ts
  tests/pull-requests.test.ts`: all passed, including the real Timber test:
  a temporary repository with a worktree made from a branch name and one
  with a Jira link written as Timber saves it; `ls --json` reported none and
  the link, `__app-issue` answered `none` and `sign-in-needed` (no Jira
  site), and the files, refs, index, and worktree list were unchanged. With
  the same wrapper, four real Timber tests of `tests/workflows.test.ts` fail,
  the same on the commit before this work, so not from it.
- The fixtures in `tests/fixtures/timber-app-issue` and
  `tests/fixtures/timber-ls/with-issues.json` were recorded from that Timber
  with an empty home folder and no tracker tokens: none, found (the public
  issue github.com/Coding-M8s/timber/issues/153 read without a login, its
  assignee's login replaced), sign-in needed for Jira and Linear, not
  found, offline (HTTPS_PROXY at a closed port), a malformed link, a path
  that is no worktree, and Timber 0.1.2's "unknown command". Saving a link
  needs a tracker lookup, so each `issue.json` was written by hand in
  Timber's form and Timber read it back.
- `bun run build:web`: built.
- Not run: the desktop window and `readIssue` over the RPC bridge, the
  header link clicked, `bun run dev:web` in a browser, and a found Jira or
  Linear issue, which needs a login.

Not run yet:

- The Pull request tab in the desktop window, a check's Open clicked
  there, and a real pull request with its runs and description read by the
  app's own code from GitHub. Offline, sign-in needed, and not on GitHub in
  the tab were run in the tests only.
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
- Open in editor with Zed. VS Code, Kate, and Files as an "Other command"
  were started from the desktop window in issue 66.
- Launching an editor on Windows or macOS. On Windows batch files are
  refused for now, and the stand-in editors of the tests are shell scripts.
- Anything on macOS, terminals included.
- Watching for changes on Windows or macOS, where `fs.watch` works
  differently. It was run only on Linux.
- Terminals on Windows, where `Bun.Terminal` does not exist: they answer
  that they are not supported, and that answer was only acted out on Linux.
- Copying with Ctrl+Shift+C and opening a link with Ctrl+click in the
  desktop window. Both were checked as functions only.
- A real X11 login session, and GNOME and KDE, on real hardware. They
  were run in virtual machines only (see issue 66 above); on real hardware
  only COSMIC was run by a person. A native Wayland window is not possible
  with Electrobun 2.0.6 (see issue 63 above and
  [display server on Linux](#display-server-on-linux)).
- An NVIDIA GPU known to be drawing the window.
- Pull requests in the desktop window, and so `readPullRequests` over the
  RPC bridge, "Open pull request" clicked, and the refresh after a real
  background fetch. Only the main process module, the store, and static
  markup were run, and no installed Timber release has `__app-pr` yet.
- A found pull request read by the app's own code from GitHub. That was run
  with Timber by hand only, and the tests use `found.json`.
- A portal file chooser other than Files on Omarchy and COSMIC's on Pop!_OS,
  and Files on the real desktop rather than a nested Hyprland (see issues 75
  and 66 above).
