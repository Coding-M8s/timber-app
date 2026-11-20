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
   [linked issues](#linked-issues)). Recovery backups are listed, restored,
   and deleted with `timber backup list --json`, `timber backup restore`,
   and `timber __app-backup delete` (see
   [recovery backups](#recovery-backups)).
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

New, open, done, rebase, opening a pull request (`pr`), saving Timber's
settings (`config`), restoring a backup (`backup-restore`), and deleting one
(`backup-delete`) say how they
ended in a result file, not on standard output. One helper runs all of them, so no dialog reads a result its
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
  dialog can tell "created, then stopped" (`materialized`) from "nothing
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
  one argument: `new [--base <ref>] [--workflow <name>] --no-setup
  --result-file <path> --no-editor --no-agent -- <name>` and `open
  [--workflow <name>] --no-setup --result-file <path> --no-editor --no-agent
  -- <selector>`. Text that starts with a dash is therefore never read as an
  option. Both launch flags are always passed, so an editor or an agent
  configured in Timber does not start.
- **Setup never holds the window.** `--no-setup` makes Timber answer as soon
  as the worktree exists, so the dialog never waits for setup scripts, however
  long they take. When Timber skipped configured scripts, its record says
  `setupSkipped: true` (`setupSkipped` in `WorktreeCommandResult`), also when
  only the picked workflow has scripts, and the app runs them itself in a
  "Setup" session in the worktree: `timber open --setup [--workflow <name>]
  --no-editor --no-agent -- <exact path>` (`worktreeSetupArguments`,
  `timberWorktreeSetup` in `OpenTerminalRequest`). Timber does not remember a
  worktree's workflow, so the session passes the one the dialog ran with
  again; without it, only the ordinary scripts would run. The main process
  accepts only a workflow name there, as for `new` and `open`. The session
  shows what the scripts print as they run, and how they ended. Without
  configured scripts no session starts. Timber still runs the scripts, so its
  rules for them stay Timber's.
- **Running.** `src/bun/worktree-commands.ts` runs the command in the
  repository's primary checkout. It refuses a request whose parts are not
  the text and flags the command is built from, refuses a path that is not a
  repository in the app's list, runs nothing while Timber is not ready, runs the
  commands of one repository one after another, and never logs what a
  command printed or what it answered. It checks nothing about a name, a
  base, or a folder: those rules are Timber's. A workflow must have the form
  of a workflow name, so it can never read as an option; whether one by that
  name exists is Timber's to say.
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
  retried. Sessions start afterwards through `startSessionsIn`, never from
  these two.

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
- When the worktree was made, the dialog closes and setup follows in its
  session, as above. A script that fails shows there, in the worktree, and
  the worktree stays.
- A failure after the worktree was created but before setup, such as a base
  Timber could not save, is reported as created, then stopped before setup.
  The worktree is in the list and selected, the form is replaced by that
  news, and the dialog offers "Run setup". That starts the setup session on
  the exact path Timber reported, whose command the footer shows first, and
  closes the dialog; it runs nothing in the dialog. The dialog does not
  suggest creating again.
- Left out of the agreed mock on purpose: the checkbox that starts an editor,
  which is a later ticket and would go against `--no-editor`, and a line
  predicting the branch and the folder, which only Timber can know.

"Existing branch" is the second mode: `timber open` for a branch, a ticket
key, or a worktree path, with an optional "Rerun setup" that runs the setup
session also when the worktree was already there. It does not change the
Timber command, which always has `--no-setup`.

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
- **A failure that still names a worktree** is reported as that, with the
  worktree selected in the list. The fields change to its exact path with
  "Rerun setup" ticked, so the next run the person starts cannot create
  anything, and runs setup in its session.

Both modes have a **Workflow** field among their own fields, for the
repository's [named workflows](#named-workflows): None first and by
default, then each workflow in Timber's order with its description. A pick
adds `--workflow <name>` to the command in the footer, so Timber runs that
workflow's `post_create` scripts after the ordinary ones.
(`worktree-modes/workflow-choice.tsx`.)

- **The list.** The dialog's controller reads `listWorkflows` once when the
  dialog opens, and again only after a run that failed, when a workflow may
  have left the settings. Each read runs Timber, so it is not read again
  whenever file watching reads the repository again. With no workflows
  there is no field. When the list cannot be read, the field is
  replaced by a short note with the reason, and creating without a
  workflow still works. A pick the list no longer has passes none, so the
  footer never shows a workflow the field does not.
- **Setup repeats it.** Timber does not remember the workflow a worktree
  was created with, so the Setup session that follows passes the workflow
  the dialog ran with (`--workflow <name>`), and "Run setup" after Timber
  stopped in a New branch run passes the workflow that run had, even when
  the list has changed since. Existing branch does the same while its
  fields name the kept worktree; the field then shows that workflow, marked
  "no longer listed" when the list has lost it.
- **A workflow that is gone.** Removed from the settings between listing and
  creating, it fails with Timber's diagnostic shown as it is ("Unknown
  workflow. ..."), and nothing is created.
- **Its agent** is not started here. Timber still runs with `--no-agent`.

Both modes share an **Agent** field under their own fields: the agents from
Settings, Agents, in menu order, the first one picked, then None. With no
saved agents it offers only None and points to Settings. Timber still runs
with `--no-agent`. The app starts the picked agent itself
(`src/mainview/components/worktree-modes/agent-choice.ts`).

- **When it starts.** Only after a run worked and the worktree is one this
  dialog created: `timber new` that worked, `timber open` that Timber says
  created the worktree, or "Run setup" (or Existing branch run again on the
  kept path) in a worktree an earlier run of this dialog created. It starts
  beside the setup session at once and does not wait for setup: a script
  that is still installing does not stop the person from writing a prompt. A failed run starts nothing, and a
  worktree that was already there never gets an agent. A run in between
  that names no worktree, such as a refusal, does not forget that the
  dialog created it; an edit to the Existing branch fields does.
- **How it starts.** Each mode's `run` reports the worktree it created and
  the one to set up, and `runAndStart` hands them to the store's
  `startSessionsIn` without waiting. That asks for the setup session first,
  then for the agent once the setup session is there (one request at a time
  per worktree), and shows the agent's pane. The
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
- **The footer.** Under the Timber command, a note and a command on a line of
  their own for each session that follows ("Command that will start next"),
  never joined to the Timber command: setup first, with `<worktree>` for
  the path until Timber has made it, then the agent (`followUps`). Setup says
  "if Timber left setup scripts to run", and Existing branch says "if this
  creates a worktree", because only Timber knows.

### Finding Timber

Nothing that depends on Timber is offered until a usable one is found.

- On start the main process resolves `timber` from PATH and runs
  `timber --version`, as an executable plus an argument array
  (`src/bun/timber.ts`). It logs the result.
- The app requires the newest Timber release (see
  [the newest Timber release is required](#the-newest-timber-release-is-required)),
  and never less than 0.1.3, the first release with the machine interface,
  `__app-config`, one-off workflows, and `__app-pr` with each pull request's
  reviewers (0.1.1 had only the first; 0.1.2 had no `__app-pr`). The
  number and the comparison live in `src/shared/timber-version.ts`. A
  pre-release sorts before its release.
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
  address to see the notice, or `?timber=newer-release` to see the banner.

### The newest Timber release is required

A Timber older than the newest release may lack what the app uses, so the
app requires the newest release (`src/bun/timber-release.ts`).

- **Looking it up.** The main process sends a `HEAD` request to
  `https://github.com/Coding-M8s/timber/releases/latest` without following
  the redirect, and reads the version from the tag it points to. This needs
  no login and is not counted against GitHub's API limit. Nothing about the
  person or the machine is sent. Only a redirect to a release tag counts; a
  pre-release, an error, or no answer within five seconds is a failed check.
- **When.** On start, and every three hours while the app runs. The first
  look for Timber waits at most two seconds for the lookup on start, so a
  slow network never holds the window up.
- **Saved.** A lookup that worked is saved in `timber-release.json` beside
  the settings file, and stands in when a later lookup fails, for example
  offline. A lookup always replaces the saved release, even with an older
  one, so a withdrawn release cannot lock anyone out. With no release saved
  and no answer, the built-in minimum is required.
- **On start**, a Timber older than the newest release known gets the
  full-window notice, "Update Timber", with the update command.
- **While the app runs**, a release that comes out never takes Timber away
  mid-task. The main process looks for Timber again and tells the window
  (`timberChanged`), and the status stays ready with `newerRelease` set. The
  window shows a banner above the sidebar and the workspace with the update
  command and Check again. Terminals, agents, and Timber keep working until
  the next start.
- **The development override.** With `TIMBER_APP_TIMBER_PATH` set, only the
  built-in minimum is required and there is no banner, because a local build
  may carry any version number.

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
was typed and lists them), `"stops-after-create"` (the worktree is created,
then Timber stops before setup), `"setup-fails"` (the worktree is created,
and its setup script then fails in the setup session), or `"no-result"`
(exit code 0 and no result file). Every mock repository has a pretend setup
script, so a worktree Timber creates always gets a setup session. A name whose
branch is already checked out is refused whatever the ending, and so is text
for `timber open` that matches no worktree and no listed branch.
`timberMock.endRebaseResults(ending)` chooses how `timber rebase` ends from
then on: `"rebased"` (the start), `"up-to-date"`, `"conflicts"` (two sample
paths, one with a space), `"refused"`, `"failed"`, `"no-result"` (exit code 1
and no result file), or `"unsupported"` (a Timber too old to report). A
worktree with modified or untracked files is refused whatever the ending, as
Timber does, and a mock Timber older than 0.1.2 is unsupported.
`timberMock.endPullRequestResults(ending)` chooses how `timber pr` ends from
then on: `"created"` (the start), `"exists"`, `"refused"`, `"failed-login"`
(nothing pushed), `"failed-after-push"` (the branch was published), or
`"no-result"` (exit code 1 and no result file). An empty title is refused
whatever the ending. Created and exists show the pull request on the next
read. `timberMock.setHeadSubject(path, subject)` sets a worktree's last
commit subject (`null` for none); until then it is "Work on <branch>".
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
- **Command palette.** The title bar button, and Ctrl+Shift+P (Cmd+Shift+P on
  macOS), open the palette: a `{ kind: "palette" }` dialog in the store, drawn
  by `CommandPalette.tsx`. `PaletteShortcut` listens on the window in the
  capture phase, and a drawn terminal lets the chord through, so it works
  from any focus. It opens only when no other dialog is open. What it lists
  and how typing narrows it are pure functions in `src/mainview/palette.ts`:
  the actions first (New worktree, Open existing branch, Fetch now, Rebase,
  Done, Open in editor, Open terminal, Start each saved agent, Settings, Add
  repository), then every worktree of every available repository. Matching is
  case-insensitive and fuzzy over the label, the branch, the folder name, and
  the repository name, and shows at most 50 entries so hundreds of worktrees
  stay quick. Actions that need a worktree apply to the selected one and name
  it. An action that cannot run is listed with its reason, using the same
  words and rules as its button, and Enter does nothing on it.
  `palette-run.ts` does the choosing through the store methods the buttons
  call, so the palette adds no second way of doing anything. "Open existing
  branch" is the New worktree dialog opened on its Existing branch mode
  (`mode: "existing"`). The "+" and the Settings cog only ask: each puts a
  `DialogRequest` in the store (`openDialog`), and the New dialog or the
  Settings dialog is what answers it.
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

### Settings that need a restart

Most preferences apply as soon as they are saved. A few are read only when
the app starts, today the DMA-BUF renderer (see
[WebKitGTK's DMA-BUF renderer](#webkitgtks-dma-buf-renderer)). After saving
one of those, the section offers to restart the app.

- **One place.** A preference that needs a restart has `restart: true` in
  its entry of `PREFERENCE_PARTS` (`src/shared/preferences.ts`).
  `restartNeededFor` lists the marked ones that differ between two sets of
  preferences. Nothing else names them, so marking another preference is
  enough for its section to offer a restart.
- **Compared with the start.** The store keeps the preferences as first read
  (`preferencesAtStart`). A save offers a restart only when it left a marked
  preference that the section saved different from that, so saving the
  value the app started with offers nothing, as the Rendering hint says.
- **The offer.** Every section is a `SettingsSection`, and after such a save
  its foot shows `RestartPrompt`: "Restart now" and "Later". Later puts the
  offer away and changes nothing; the Rendering hint still says "Restart
  the app to use the saved choice." Restart now asks the main process
  whether this copy can restart (`Engine.restartPlan`). When it cannot, the
  reason shows instead. While terminals run it asks first, says how many
  end, and has focus on Cancel. The Settings dialog stays open while it
  checks and while the restart request waits. A lost answer that the
  window lives to see is a failure that says to quit and start the app by
  hand. A section can leave the offer out where a restart would change
  nothing (`offerRestart`): Rendering does on a system without WebKitGTK
  and while `WEBKIT_DISABLE_DMABUF_RENDERER` decides, since a restart keeps
  the same environment.
- **Restarting.** `Engine.restart` (`src/bun/restart.ts`) works as
  Electrobun's updater does, since Electrobun has no relaunch: it starts a
  small detached waiter first, then ends every terminal and quits through
  the quit guard, without asking again. When the app does not quit after
  all, the waiter is stopped, so no second app starts later. The waiter is
  a fixed `/bin/sh` script that waits until the launcher is gone and then
  starts it again. It gives up after 20 seconds rather than start a second
  app beside one that does not go.
- **The same app.** Electrobun's launcher starts the app and sets
  `ELECTROBUN_LAUNCHER_PID`. The main process reads that launcher from
  `/proc`: its arguments, its environment as it started, and its working
  folder, and starts `<install>/app/bin/launcher` again with them. A
  launcher that is not the installed one, such as a shell, is never started.
  The environment goes to the waiter as its own environment, never in its
  arguments, which every user of the machine can read.
- **Only an installed copy on Linux.** A copy started from source (`bun run
  dev`, `bun run start`, `bun run dev:hmr`) says it cannot restart itself:
  its watcher would lose track of an app started behind its back. Windows
  and macOS say that this is built for Linux only so far.
- **In the browser build** the mock engine can restart and acts it out
  without quitting. In the browser console, `timberMock.endRestarts("fails")`
  or `("unavailable")` acts out the other endings, and
  `timberMock.restartCount()` counts the restarts.

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
  or ref. This needs Timber 0.1.3, the first release with `__app-pr`. An
  older one answers "unknown command".
- **Reading.** `readPullRequestList` in `src/shared/pull-requests.ts` is
  pure. It accepts one version 1 record from a Timber that exited with 0, or
  with 1 when a lookup failed, and only when the exit code agrees with the
  entries. Each entry is found, none, or failed with a reason (`offline`,
  `sign-in-needed`, `not-github`, `failed`) and Timber's diagnostic. A found
  one keeps its number, its `https` link, its title (made safe to show), its
  state, its base branch, the summary of its checks with how many runs pass,
  fail, and are pending, each run with its name, status, and link, its
  review decision, its reviewers, whether that list is complete, and its
  description. A run's link is kept only when it
  is `https`, since a commit status may point anywhere. The description
  keeps its line breaks and tabs and is otherwise made safe like any text
  from GitHub (`descriptionText`), cut at 20000 characters, and never
  rendered as markup. Each reviewer keeps its kind (user, team, or bot),
  its name (made safe to show), its state (requested, approved, changes
  requested, commented, or dismissed), and its link, kept only when it is
  `https`. A missing reviewer list, a missing or non-boolean
  `reviewersComplete`, or a reviewer of an unknown kind or state makes the
  entry unreadable, since every Timber with `__app-pr` reports them. Fields
  the app does not use are ignored.
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
  answer, or why it could not be read. Under the review decision it lists
  each reviewer with its state, "team" or "bot" beside the name, and an
  Open link when it has one, then a quiet line when there are none or
  Timber's login could not read them all. It reads the store, so it
  changes whenever the pull requests are read again. Showing a pull request
  runs no command, and its controls open links through `openLink`. A
  worktree on a branch with none yet gets a form that runs `timber pr` (see
  [opening a pull request](#opening-a-pull-request)).

In `bun run dev:web`, timber has an approved pull request and one with
failing checks and requested changes, api-server a merged one, and billing
a draft and a closed one, with descriptions and check runs that show
every status, a run without a link, and none at all. Their reviewers show
every state, a team, a bot, none at all, and a list Timber could not read
in full (the draft). docs-site, once
added, is not on GitHub.
`timberMock.setPullRequests(path, list)` changes one (`null` for the
sample).

## Opening a pull request

The Pull request tab of a worktree on a branch with no pull request yet is a
form that runs `timber pr --result-file`. Timber publishes the branch with the
rules of `timber publish` and opens the pull request on github.com with its
own login. The app never pushes and never calls GitHub. Timber 0.1.3, the
release the app requires, is the first with `timber pr`, so there is no
version gate of its own.

- **The form.** `PullRequestFormView` in
  `src/mainview/components/PullRequestPanel.tsx`, shown when the worktree's
  entry from `timber __app-pr` is none and it has a branch. Its state lives in
  the store, `pullRequestForms` by worktree id, so leaving the tab or the
  worktree while Timber runs keeps what was typed and the run, and cannot
  start a second one. The tab calls `startPullRequestForm` each time it
  shows the worktree. The first call starts the form: Title as the branch,
  then the last commit's subject once `readHeadSubject` answers, unless
  something was typed first. A later call whose worktree has a new head
  reads the subject again, under the same condition, so a form started
  before the branch had a commit of its own does not keep the base's
  subject. A form whose worktree left the list is forgotten when the list is
  read again, so one made again at that path starts afresh. Base as `initialPullRequestBase` of the
  saved base, which gives `<remote>/<branch>` for a saved
  `refs/remotes/<remote>/<branch>` and nothing for a saved local branch,
  none, or invalid metadata, since `timber pr --base` refuses a local
  branch. Empty Base passes no `--base`, and Timber takes the saved base and
  says what it needs. The app checks no title, length, or base itself:
  Title is always passed, even empty, and Timber refuses it.
- **The last commit's subject.** `readHeadSubject` on the `Engine`, answered
  by `WorktreeCommands.headSubject` in `src/bun/worktree-commands.ts`: for a
  worktree Timber lists in a repository from the list (`findListedWorktree`)
  it runs `git -C <worktree> log -1 --format=%s HEAD --` without optional
  locks (`readHeadSubject` in `src/bun/git-engine.ts`), and answers null for
  anything else, a branch with no commit, or an empty subject. It changes
  nothing.
- **One source for the command.** `prResultArguments` in
  `src/shared/timber-pr.ts` builds `pr --title <text> [--body <text>]
  [--base <ref>] [--draft] --result-file <path> -- <registered path>`. Each
  value is its own argument after its option, so a title or a description
  that starts with a dash stays text, which Timber 0.1.3 was checked to
  accept. The footer words it from that function with `<temporary file>`
  (`pullRequestCommandFor` in `src/mainview/pull-request-create-format.ts`),
  and it follows every keystroke.
- **Running and checks.** `createPullRequest` on the `Engine`, answered by
  `WorktreeCommands.pullRequest`, in the same per-repository turn as `timber
  new`, `open`, and `rebase`. Before it runs anything it checks that the
  request is complete (only text becomes an argument, and `draft` is a
  boolean), that the repository is in the list, that Timber lists the
  worktree there with its folder, and that Timber is ready. Each refusal is
  a failure with `ran: false` that ends "Nothing was run." The desktop
  engine asks with no time limit: Timber stops each GitHub request after ten
  seconds, but a push takes as long as it takes.
- **Reading the record.** `readTimberResult` has checked the common fields.
  `readPrResult` then checks the `pr` object: a known `result`, a positive
  whole `number` or null, text or null for `url` and `base`, and a boolean
  `published`. Created and exists must have succeeded and refused and failed
  must have failed; `number` and `url` are there exactly for created and
  exists; `url` must be an `https://github.com` link; a refusal never
  published; and a record that names another worktree is not used. Anything
  else is a failure whose effect is unknown (`published: null`), since the
  branch may have been pushed.
- **Outcomes.** `presentPullRequestCreation` maps each answer. Created: a
  toast, "Pull request #N opened". Exists: a quiet line above that pull
  request saying it was already open and Timber opened no other. Both stay
  as `reported` in the form until the next read of the repository's pull
  requests after the run. Until then, while GitHub does not list it yet,
  the tab shows its number with "Open in browser". That read shows it, or,
  if it still says none, the form again. Refused: Timber's
  diagnostic, and that nothing was pushed. Failed: Timber's diagnostic, and
  whether this run published the branch, or that it is unknown, never that
  nothing changed. Running it again reports one that was opened as already
  open. Each failure keeps Timber's output in `TimberFailureDetails`, closed
  at first, and stays until a field changes or the next run.
- **Afterwards.** After every outcome that ran, even a failure, the store
  reads the repository and its pull requests again before it says how it
  ended, so a created pull request shows as soon as GitHub lists it.
- **In the browser.** The mock engine acts out `timber pr`
  (`src/mainview/engine/mock-pr.ts`) and writes the record Timber would,
  read by the same code. Created and exists add the pull request to the
  repository's next answer. `timberMock.endPullRequestResults` chooses the
  ending, and `timberMock.setHeadSubject(path, subject)` the last commit's
  subject (see [reporting outcomes](#reporting-outcomes)).
- **Tests.** `tests/fixtures/timber-pr` holds two refusals recorded from
  Timber 0.1.3 (a remote that is not on github.com, and no title). Created,
  exists, and two failures are written by hand from the recorded one in the
  form Timber's `docs/ide-contract.md` gives, because recording them would
  open a real pull request. `tests/timber-pr-parse.test.ts` maps each one.
  With the installed Timber, `tests/worktree-pr.test.ts` checks that a
  refusal against a remote on disk changes no file or ref in the worktree,
  the primary checkout, or the remote, with no GitHub login in reach, and
  that reading the subject changes nothing.
  `tests/pull-request-create.test.tsx` covers the form, the store, and the
  mock endings.

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

## Recovery backups

Timber can keep a private backup of a worktree: its commit, pinned by a ref
under `refs/timber/backups/`, and a copy of its files, ignored ones such as
`.env` included, in the repository's Git directory. People make one with
`timber backup create` in a terminal; Timber does not make them during a
rebase yet. The sidebar lists them under each repository's worktrees, and
restores or deletes one through Timber. Which backups are usable, which are
protected, and whether one may be restored or deleted are Timber's rules,
checked again by Timber right before it acts. The app repeats none of them.

- **Asking.** `readBackups` on the `Engine`, answered by
  `src/bun/backups.ts`. For a repository in the app's list only, and only
  while Timber is ready, the main process runs `timber backup list --json` in
  its primary checkout, as an executable plus an argument array, with
  standard input closed and a limit of thirty seconds. It changes no file or
  ref.
- **Reading.** `readBackupList` in `src/shared/backups.ts` is pure. It
  accepts one version 1 record whose exit code is the process's, with every
  entry readable, and keeps the usable backups (ID, branch or detached,
  commit, creation time as recorded, size, entry count, the worktree it came
  from, the digest of its record, and whether Timber protects it, with the
  reason), the unfinished deletions, and the entries that are not usable,
  each with Timber's reason. Values are kept exactly: IDs and digests become
  arguments, and paths are shown whole. `expiry` and fields the app does not
  use are ignored. A failed record, another schema version, or anything that
  cannot be read is a failure with a message, never an empty list.
- **A Timber without the list.** Released Timber 0.1.2 has `backup create`
  and `restore` but no list, and a build of Timber's main branch with the
  list still calls itself 0.1.2, so the version cannot tell them apart. The
  answer is `unsupported` only when Timber exited with 1, printed nothing,
  and its standard error says `unknown command 'list'` or `unknown option
  '--json'`, the words of the command line library Timber is built on. This
  is the one place the app reads Timber's human output. A Timber with the
  list always prints a record and leaves standard error empty, so a crash is
  never taken for "no support". Replace this with a version check once a
  Timber release has the list.
- **When.** The interface (`src/mainview/store/store.ts`) reads a
  repository's backups when it is first listed, on Refresh, when another
  Timber is found, and right after the app restored or deleted one. Making
  or deleting a backup changes a ref under `refs/timber/backups/`, which the
  watcher reports as a change of the repository (see
  [watching for changes](#watching-for-changes)), so they are read again
  then too, at most once in 15 seconds per repository
  (`BACKUP_READ_SPACING_MS`), with one more read at the end of that time
  when a change came meanwhile: an agent at work changes a repository often,
  and each list reads every backup's manifest. Changes inside backup storage
  that touch no ref, such as an interrupted deletion, show at the next read.
  A Timber without the list is asked again only on Refresh or when another
  Timber is found. Reads of one repository never overlap, an answer from a
  Timber that was replaced meanwhile is dropped and asked again, and a
  removed repository's answer is forgotten.
- **Showing.** `BackupsSection` in `src/mainview/components`, with its words
  from the pure `src/mainview/backup-format.ts`, sits below an open
  repository's rows. Each usable backup shows its branch, how long ago it
  was made, and its size, with the rest in its tooltip, and Restore and
  Delete. A protected one shows "protected" and Timber's reason, and has no
  Delete. Unfinished deletions and entries that are not usable show
  Timber's reason and point to `timber backup list` and `timber backup
  done` in a terminal; the app offers nothing for them. The section says
  that backups can hold copies of ignored files, as Timber asks. There is no
  section when a repository has no backups, when they were not read yet,
  when its Timber has no list, or while the worktree filter has text. A
  list that could not be read is a quiet grey word on the repository's
  header, "backups unknown", with the reason in its tooltip.
- **Restore.** The Restore dialog (`src/mainview/components/BackupDialogs.tsx`)
  shows the backup and a folder for the new worktree, by default beside the
  primary checkout as `<name>-recovery-<id>` (`defaultRestoreFolder`), which
  the person can change. It must be a whole path: Timber reads a relative one
  from the primary checkout and would restore inside it. The dialog and the
  main process both refuse one that is not; the main process also by its
  own system's rules, so `C:\x` is refused on Linux. `timber backup restore
  --result-file <path> -- <id> <folder>` (`backupRestoreArguments`) runs
  through the result-file helper above, in the same turn as new, open, and
  rebase of that repository (`src/bun/repository-turns.ts`). Timber makes
  branch `recovery/<id>` in the new folder, never changes the backup or the
  worktree it came from, and runs no hook, setup, editor, or agent. The
  record (`readBackupRestoreResult`) says restored, refused, or partial; it
  must be for the backup asked for. After every outcome the repository is
  read again, and a restored worktree is selected. A partial restore can
  leave an incomplete worktree in the list: the dialog says not to use it
  and shows Timber's cleanup commands as text. The app never runs them, and
  never selects that worktree.
- **Delete.** The Delete dialog is destructive (Keep has the focus) and
  shows the backup as the person chose it in the sidebar. That choice is
  kept in the dialog request, so a later read cannot change what is asked
  about. `timber __app-backup delete --id <id> --record-sha256 <digest>
  --result-file <path>` (`backupDeleteArguments`), in the repository's
  turn as for a restore, passes the digest of the
  backup's record from that same list. Timber deletes only that backup, and
  only when its record still has that digest and it is not protected;
  otherwise it refuses and changes nothing. When the list read meanwhile no
  longer has the backup as it was, before the dialog ran anything, it says
  so and offers only Close. Once it ran the command, Timber's answer is
  shown instead, whatever the list says, since Timber checks again on
  every run. A partial deletion leaves the backup unrestorable: the dialog shows
  what is left, Timber's manual commands as text, and "Delete again", which
  runs the same command, as Timber's contract asks, and finishes it with
  Timber's checks. The backups are read again after every outcome.
- **Not here yet.** Comparing a worktree against a backup in the Changes
  tab, and making a backup from the app.

In `bun run dev:web`, timber has a usable backup, a protected one, one of a
detached HEAD, an unfinished deletion, and an entry that is not usable;
api-server has none; and billing acts out a Timber without the list.
`timberMock.setBackups(path, list)` changes one (`null` for the sample),
and `timberMock.endBackupCommands("refused")`, `("partial")`, or
`("no-result")` chooses how a restore or delete ends.

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
commits. Comparing against the base or a backup is a later step.

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
  that start at once get different names.
- **Naming after the branch.** The `sessionNames` preference, set in
  Settings, Terminal, is `plain` by default, which names sessions as above.
  `branch` names a new terminal session after its worktree's branch, such
  as `feature-login`, and an agent session `<agent>: <branch>`, such as
  `Codex: feature-login`. `issue` uses the issue key in the branch
  (`issueKeyOf`), the first of: a key that starts the branch or a part of it after a slash, in any case,
  uppercased (`GH-122` from `gh-122-option-to-name-tab`, `PROJ-42` from
  `feature/PROJ-42-login`); a key written in capitals later, after a
  hyphen or an underscore (`PROJ-42` from `feature/login-PROJ-42`; only
  capitals, so `fix-login-2` has none); a number that starts the branch or
  a part of it, as `#122` (from `122-fix-login` or `fix/122-login`). A key
  is letters and digits that start with a letter, a hyphen, and a number.
  Neither a key nor a number may be followed by a dot, so `react-18.2.0`
  has none, but `fix-2-typos` gives `FIX-2`. A branch with no key gives
  its name. Both are numbered the same way when taken (`feature-login 2`, `Codex: GH-122 2`). A detached HEAD, which
  has no branch, falls back to "Terminal" or the agent's name alone. The
  branch comes from the listed worktree the request is checked against, so
  naming adds no Git query. The name is cut to 40 characters from its end,
  so an agent's name stays and its branch is cut first; an agent's name
  that leaves fewer than 4 characters for the branch is used alone.
  Format and control characters in the branch are dropped, so the name is
  one `cleanSessionName` keeps (`sessionNameBase` in
  `src/shared/terminal.ts`). The name is set once when the session opens:
  a later change of branch or of the setting renames nothing. A
  `timber rebase` session is always "Rebase", and does not read it. The
  preference is read before the worktree is looked up, and one that cannot be read names
  sessions as `plain`. The mock engine names its sessions the same way.
- **Renaming.** `renameTerminal` gives a session
  another name, kept in the main process so it survives a reload of the
  window. A name is cleaned up first (`cleanSessionName` in
  `src/shared/terminal.ts`): control characters and runs of white space
  become one space, it is trimmed and cut to 40 characters, and a name with
  nothing left is refused. Names may repeat.
- **Setup sessions.** A `timber` session named "Setup" runs a worktree's
  setup scripts with `timber open --setup --no-editor --no-agent -- <path>`
  (`timberWorktreeSetup`), started after the New worktree dialog opened the
  worktree, so setup never holds the window (see
  [creating and opening worktrees](#creating-and-opening-worktrees)).
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
  Elsewhere nothing opens yet. One click opens a link once: xterm activates
  only the link under the pointer, whether a program marked it (OSC 8) or it
  is a plain URL. A program that tracks the mouse, such as Claude Code in
  fullscreen, may open a clicked link itself, so a press that opens a link
  here is not reported to it; every other press still is
  (`src/mainview/terminal-links.ts`). Fonts come from the stylesheet and colors from the
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
- **Windows.** Sessions run on ConPTY through node-pty 1.1.0, with the
  `conpty.dll` and `OpenConsole.exe` it ships (ConPTY 1.23.251008001 from
  Windows Terminal), not the ConPTY in Windows: that one drops the status
  probe's answer and answers `CSI c` itself (see "Agent status"). What
  differs (`src/bun/terminals.ts`, `src/bun/pseudo-terminal.ts`):
  - *The pseudo terminal.* `startPseudoTerminal` picks node-pty on Windows,
    with `useConptyDll`, and `Bun.Terminal` elsewhere. node-pty is required
    at run time, only on Windows, and only when its prebuilt ConPTY for the
    machine's architecture is there; otherwise Windows' own ConPTY through
    `Bun.Terminal` (Bun 1.4.4 has it) runs the session, without agent status
    for programs like Claude Code. Its install scripts are not run
    (`"trustedDependencies": []` in package.json), so no install compiles
    it; Windows uses its prebuilt files. The Windows build copies its
    JavaScript and the prebuilt files for the build machine's architecture
    beside the main process's bundle (`electrobun.config.ts`), about 2 MB.
    Its license and ConPTY's are in `licenses/node-pty.txt`.
  - *The startup query.* This ConPTY asks the terminal for `CSI c` when it
    starts and holds the program back until it is answered, or for 3
    seconds. The app answers that one itself (`createStartupQuery`), as
    xterm.js would, and takes it out of the output, so a session the window
    does not show starts at once and the window does not answer twice.
    Every later `CSI c` is the program's, and the window answers it.
  - *The shell* is PowerShell 7 (`pwsh.exe`) when it is on the PATH, else
    Windows PowerShell, else `ComSpec`, else cmd.exe from the system folder
    (`pickWindowsShell` in `src/shared/terminal.ts`). `SHELL` is not read,
    because Git Bash sets it to a POSIX path.
  - *Hanging up.* Windows has no sessions or process groups to signal.
    Closing the pseudo console tells every process attached to it to close;
    a `ping` running in the shell ended with it within milliseconds. That is
    what happens when a session is closed and when its shell ends by itself.
    A program that ignores it was not tried; the kill below is for that.
  - *Killing.* What still runs after the wait is ended with the shell's
    whole process tree, `taskkill /PID <pid> /T /F` from the system folder
    (`killProcessTree` in `src/bun/process-session.ts`). taskkill follows
    parent process ids, so it reaches only what the shell started while the
    shell still runs. A program that leaves the console on purpose, as a
    daemon does with `setsid` on Linux, goes on.
  - *Agents* must be their own executables. One that resolves to a `.cmd` or
    `.bat` file, such as an npm launcher, is refused with a message, as
    "Open in editor" does (`isWindowsBatch` in `src/bun/find-executable.ts`):
    cmd.exe would read `&`, `%`, and `^` in its arguments again. Claude
    Code's and Codex's own installers put a `.exe` on the PATH.
  - *The status probe's answer* goes in as win32-input-mode key events,
    which both ConPTYs read (see "Agent status").
  - Where there is neither node-pty nor `Bun.Terminal` on Windows,
    `openTerminal` answers that terminals are not supported there, and
    nothing starts.
  - Shell integration (OSC 133 prompts) is not set up for PowerShell, and
    the shell cannot be chosen in Settings yet.
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
  as `startSessionsIn` does for an agent) and closes the dialog.
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
- **On Windows** (issue 149). Reports arrive as on Linux: ConPTY passes OSC
  7501 output through unchanged. Probes are answered as on Linux too, but
  only because sessions run on the ConPTY that node-pty ships (see
  "Terminals", Windows), not the one in Windows. Two things about Windows'
  own ConPTY (Windows 11 build 26200) stop the answer:
  - It reads the session's input as keys and drops an OSC written to it.
    Since it turns on win32-input-mode (`ESC [ ? 9001 h`) when it starts,
    the app writes the answer as one key press and release per character
    (`asWin32KeyEvents` in `src/shared/win32-input.ts`), and the program
    reads it byte for byte. node-pty's ConPTY reads it that way too.
  - It answers primary device attributes (`CSI c`) itself, at once, and
    does not pass the query on. A program that sends `CSI c` right after the
    probe and takes its reply as "no answer", as the spec suggests, so gets
    that reply before the app's answer. Claude Code 2.1.329 does this, and
    on Windows' own ConPTY it reported nothing. node-pty's ConPTY passes the
    query on, the window answers it after the probe's answer, and Claude
    Code reports as on Linux.
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
  - *Windows.* Electrobun 2.0.6 shows a notification as a tray balloon it
    cannot click through, replace, or withdraw, so the app shows WinRT
    toasts itself (`src/bun/windows-toasts.ts`). The main process keeps one
    Windows PowerShell 5.1 running a fixed script, given as
    `-EncodedCommand`, with the app's identifier, name, and icon in
    environment variables. The script registers the identifier for the
    current user under `HKCU\Software\Classes\AppUserModelId`, which lets an
    app with no Start menu shortcut show toasts under its own name and the
    icon the build ships (`Resources\app.ico`). Windows PowerShell cannot
    subscribe to WinRT events, so the script compiles a small C# class that
    adds the `Activated` and `Dismissed` handlers by reflection. The two
    talk in lines over the script's input and output: the app sends `show
    <tag> <silent> <title> <body>` (the texts base64 of UTF-8),
    `withdraw <tag>`, and `stop`, and the script prints `ready`,
    `activated <tag>`, and `dismissed <tag> <reason>`. It acts as the
    notification server for `createDesktopNotices`, so the rules above
    hold: a tag is the app's own number, a session's new toast keeps its
    tag and takes the place of the one before, `withdraw` hides it and
    removes it from the notification center, and a click brings the window
    forward and sends `showSession`. A toast that timed out into the
    notification center can still be clicked; one the person closed is
    forgotten. The texts go into the toast as XML text nodes, so nothing is
    read as markup, and `audio silent` keeps Windows quiet when the app
    plays its own sound. On quitting, `stop` takes every toast of the app
    away; so does the end of the script's input, should the app die. When
    PowerShell is not found, the script ends before `ready` (such as where
    `Add-Type` is not allowed), or it takes over 20 seconds to start,
    Electrobun's balloon shows the notification instead, and the app logs
    why once a minute at most. Programs are found on `PATH`, or `Path`,
    which is how the variable is named in the process Electrobun starts.
    The registry entry stays after an uninstall.
  - *macOS.* Electrobun's `Utils.showNotification` shows it with the text
    as it is; whether anything there reads markup is not known. It cannot
    answer a click, take the place of an earlier one, or be withdrawn:
    Electrobun 2.0.6 has no way to. Not tried.
  - *Agents on Windows.* Windows' ConPTY drops an OSC sequence written to a
    program's input, so the answer to the OSC 7501 probe never arrives,
    and an agent that waits for it, such as Claude Code, reports nothing:
    no marks, notifications, or sounds for it. A program that reports
    without asking, such as a shell printing a report, works (issue 149).
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
  taskbar, the menu entry, and the installer (`linux-x64-Timber-Setup.tar.gz`
  on Linux, `Timber-Setup.exe`, packed as `win-x64-Timber-Setup.zip`, on
  Windows). It is `APP_NAME` in `src/shared/app-info.ts`.
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
  larger logo and another run sharpen them. On Windows, Electrobun 2.0.6
  gives the window no icon (its `setWindowIcon` is empty there), so the
  main process loads the shipped `Resources\app.ico` and sets it on the
  window with `WM_SETICON` (`src/bun/window-icon.ts`).
- **Fonts.** Geist and Geist Mono are built in, as one variable WOFF2 file
  each in `src/mainview/assets/fonts/`, taken from version 1.9.2 of the
  `geist` package on npm. `styles.css` declares them with `@font-face`, and
  Vite copies them into the build, so text looks the same on every platform
  and nothing is fetched from the network.
- **Licenses.** `licenses/` holds the SIL Open Font License of the fonts,
  the notices of the palettes that built-in themes use, the MIT licenses of
  node-pty and of the ConPTY it ships (Windows only), and the notice for
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

See the issue 74 runs under [what has been verified](verification.md).

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

See the issue 63 run under [what has been verified](verification.md).

### WebKitGTK's DMA-BUF renderer

Settings, Rendering has a "DMA-BUF renderer" choice: Auto, On, or Off. It
decides whether WebKitGTK hands frames to the window through DMA-BUF (its
default) or copies them through shared memory, by setting
`WEBKIT_DISABLE_DMABUF_RENDERER=1` for Off. Which is smoother depends on the
machine: on one with Intel graphics only, DMA-BUF lagged and Off was smooth;
on one with Intel and NVIDIA graphics, Off was choppy and DMA-BUF was smooth.

- Auto turns it off only when every render node in `/sys/class/drm` is
  Intel (vendor `0x8086`), and otherwise leaves WebKitGTK's default. That
  rule comes from those two machines only (`autoDmabuf` in
  `src/shared/rendering.ts`).
- WebKitGTK reads the variable once, when it starts, so the main process
  decides first thing: `src/bun/webkit-rendering-setup.ts` is the first
  import of `src/bun/index.ts`. It reads the saved choice from the settings
  file synchronously, and a missing or damaged file gives Auto.
- The variable has to reach the C environment, where WebKitGTK calls
  `getenv`. Bun keeps `process.env` apart from it, so
  `src/bun/webkit-rendering.ts` calls libc `setenv` through `bun:ffi`.
  WebKitGTK's web processes inherit it; terminals and agents the app starts
  get `process.env`, so they do not.
- A value of `WEBKIT_DISABLE_DMABUF_RENDERER` set before the app starts wins
  over the setting, so either renderer can still be tried from a terminal.
- `appInfo` reports what was decided for this run, and Settings says it.
  After a change it offers to restart the app (see
  [settings that need a restart](#settings-that-need-a-restart)), and the
  hint asks for a restart until then.

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
  64 run under [what has been verified](verification.md)).
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
  Turning the DMA-BUF renderer off hides it too, but that is chosen for
  smoothness, not for this line (see
  [WebKitGTK's DMA-BUF renderer](#webkitgtks-dma-buf-renderer)).
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
[what has been verified](verification.md).

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
4. **Changes.** Diff against the base, the last commit, or a backup.
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
- **The Timber that backups need.** `backup list --json`, `backup restore
  --result-file`, and `__app-backup delete` are on Timber's main branch
  only, which still calls itself 0.1.2. With released Timber 0.1.2 the
  section never shows (see [recovery backups](#recovery-backups)). When a
  Timber release has them, check for its version instead of reading the
  "unknown command" text.
- **Backups made by a rebase.** Timber makes backups only with `timber
  backup create`. An assisted rebase that makes one first is planned in
  Timber's issue 59. The section is called "Backups" until then.
- **Linux desktop shortcut.** Electrobun's installer adds one to `~/Desktop`
  without asking, and offers no way to turn that off (see
  [installing the Linux build](#installing-the-linux-build)). Accepted for
  now. Revisit before a first release.
- **A sharper logo.** The icons above 256 pixels are scaled up from a
  256 pixel logo (see [app identity](#app-identity)). They need a larger or
  vector original before a first release on macOS. Checking the app's
  identity on macOS at all is issue 158.
