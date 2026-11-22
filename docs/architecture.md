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

None of them fetches the bundled Timber, so they run the timber on PATH
until `bun run fetch:timber` has run once (see
[the bundled Timber](#the-bundled-timber)).

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

### Tests on Windows

`bun run test` runs on Windows too, and the `test-windows` CI job fails the run
when a test fails there. That job installs no Timber, so the tests that need
the installed Timber are skipped in it and are run on a Windows machine with
Timber instead (see [what has been verified](verification.md)). A few things
keep the tests the same on both systems:

- **Paths.** Recordings write their folder as `/work`. `recordedHere` in
  `tests/support/timber.ts` puts the test's own folders in place, with
  backslashes on Windows as the real Timber prints them, escaped when the
  recording is JSON. Git prints worktree folders with forward slashes there,
  so `listedWorktrees` reads them back in this system's form. A stand-in that
  records folders keeps them with forward slashes.
- **The temporary folder.** It can be given in its short 8.3 form, such as
  `C:\Users\RUNNER~1\...` on GitHub's runners, while Git and Timber print the
  long one. `tests/support/windows.ts`, loaded first through `bunfig.toml`,
  puts the long form in TEMP and TMP.
- **Stand-ins.** A stand-in Timber that runs a Bun script is compiled into a
  `timber.exe` on Windows (`bunStandIn`), like the installed one: cmd.exe
  refuses an argument with a line break for a `.cmd` file, and stopping a
  `.cmd` leaves the Bun it started running, holding its output. A stand-in
  player or `notify-send` ends in `.exe`, since `Bun.which` finds a file
  there only by an extension in PATHEXT.
- **Timeouts.** A run of the installed Timber takes from under a second to
  over four there, so each file that runs it sets a default timeout of a
  minute on Windows, and of 30 seconds elsewhere, as `bun run test` gives
  every test (`REAL_TIMBER_TIMEOUT_MS`). Bun sets the default again for each
  file, so a preload cannot.
- **Private folders.** Timber reads its private records and credential store
  on Windows only when their access list allows nobody but the user, SYSTEM,
  and Administrators. A test that writes such a folder by hand makes it with
  `privateFolder`, since a temporary folder can allow others too.

A test that cannot run on Windows is skipped there with a comment that says
why: it acts out a Linux-only feature such as restarting through `/proc`,
needs a POSIX shell or pseudo terminal, uses permission bits that Windows
does not have, or makes symbolic links, which Windows allows only in
Developer Mode or for an administrator.

## Boundary with Timber

Timber's safety logic must exist once. The app follows two rules:

1. **What Timber owns or changes goes through Timber's machine interface.**
   The worktree list is `timber ls --json`. New, open, rebase, and done run
   the `timber` command, and the interface shows the command before it runs.
   Creating a worktree and opening an existing branch are built (see
   [creating and opening worktrees](#creating-and-opening-worktrees)), and
   so is rebasing, which reads Timber's result file (see
   [rebasing a worktree](#rebasing-a-worktree)). Pull requests come from
   `timber __app-pr`, with Timber's GitHub or Bitbucket login (see
   [pull requests](#pull-requests)), and the live state of a worktree's
   issue from `timber __app-issue`, with Timber's tracker logins (see
   [linked issues](#linked-issues)). Recovery backups are listed, restored,
   and deleted with `timber backup list --json`, `timber backup restore`,
   and `timber __app-backup delete` (see
   [recovery backups](#recovery-backups)).
2. **Git is asked directly only for read-only status that Timber does not
   report.** Today that is which repository a folder belongs to, how each
   branch stands against its upstream, which branches there are to offer
   for picking, the changed files and diffs of the Changes view (see
   [the Changes view](#the-changes-view)), and the status of the selected
   worktree for the background check (see
   [watching for changes](#watching-for-changes)). Git is invoked as an
   executable plus an argument array.

Two things are not read-only and do not go through Timber, because Timber
has no command for them:

- **Fetching** (see [fetching](#fetching)). It writes only remote-tracking
  refs (`refs/remotes/`), which Timber neither owns nor checks, and never a
  local branch, a tag, the index, or a working tree.
- **Sync actions** (see [sync actions](#sync-actions)), started from a
  worktree's row: Pull, which fetches and then fast-forwards the worktree's
  branch to its upstream, and Push, which runs `timber publish`. Neither
  creates, rebases, or removes a worktree, makes a merge commit, or
  rewrites a branch, and Push never force-pushes.

Everything else that writes still goes through Timber.

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
  a commit with its full lowercase hash (SHA-1 or SHA-256), unassigned, or
  invalid with Timber's reason (malformed, stale, or unreadable). A record
  without the field, as from a Timber before it, reads as null and the app
  shows no base at all. A field of any other shape, including a commit
  whose hash is abbreviated or not lowercase, refuses the list like any
  unreadable record. The app never infers a base from branches or history,
  and never checks that the saved ref or commit still exists: Timber reads
  it offline, so it is a saved choice. Its words come from
  `src/mainview/base-format.ts`, which is pure. A ref is worded in the form
  Timber takes for `--base` and prints in its own list (`savedBaseSelector`
  in `src/shared/rebase-command.ts`): `refs/remotes/origin/main` as
  `origin/main`, and a local branch by its full ref, `refs/heads/main`. A
  commit is worded by the first seven characters of its hash, `a1b2c3d`,
  and the sentences call it a commit. The row's tooltip is its path
  followed by "(Base origin/main)", "(Base a1b2c3d)", "(No saved base)", or
  "(Base unknown)". The workspace header shows the same words after the
  changes, with the whole sentence as a tooltip, and "Base unknown" in the
  error color.
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

New, open, done, rebase, saving a worktree's base (`base`), opening a pull
request (`pr`), saving Timber's settings (`config`), restoring a backup
(`backup-restore`), and deleting one (`backup-delete`) say how they ended in
a result file, not on standard output. One helper runs all of them, so no
dialog reads a result its own way: `runTimberWithResultFile` in `src/bun/timber-run.ts`. Creating and
opening worktrees use it (see [below](#creating-and-opening-worktrees)), and
so do the Done dialog (see [removing a worktree](#removing-a-worktree)),
the Rebase dialog (see [rebasing a worktree](#rebasing-a-worktree)), and
the Set base dialog (see [setting the base](#setting-the-base)).

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

- **Entry.** Done in the workspace header's More menu opens the dialog for
  the selected worktree (`workspaceMenuChoice` in
  `src/mainview/workspace-actions-format.ts`), and Done in a sidebar row's menu (right-click,
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
  used up by one call. At most 64 approvals are kept (`HELD_PREVIEWS` in
  `src/bun/done.ts`), the oldest going first: twice what one run of [Clean
  up merged](#cleaning-up-merged-worktrees) holds, so Done dialogs opened
  while it runs do not push its approvals out.
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
  (`removeWorktree` in `src/mainview/store/store.ts`) and closes the Done
  dialog as it starts, so nothing covers the window while Timber works. Each
  removal is a record in `removals` (`src/mainview/store/state.ts`), named by
  the repository and the worktree's registered path, because the worktree's
  identity can change while its folder is deleted. While it runs, the row says
  "removing", and Done, Rebase, Open in editor, and new sessions are off for
  that worktree. The store refuses them as well: Done and Rebase by not
  opening their dialogs, the others by running nothing. Closing the dialog
  would leave the keyboard nowhere, because Done in the More menu is
  disabled, or gone once the removal worked, so it goes to the first worktree row of the
  repository's group, or to the group's header while it is collapsed
  (`focusFirstWorktree` in `src/mainview/sidebar-focus.ts`). A second removal of the
  same worktree runs nothing. Other worktrees, sessions, and dialogs keep
  working, and removals of different worktrees run at the same time. Two real
  `timber __ide-done apply` runs in one repository at once have not been
  tested against Git's own locks; a clash would show as a normal failure.
- **How it ends.** A removal that worked leaves a toast, and closes the Done
  dialog of that worktree if one is open again, never another dialog. A
  failure stays as a record until the person closes the Done dialog that
  shows it: the row says "removal failed" with Details, which opens the Done
  dialog with Timber's diagnostic and output. Details, with the row's other
  controls, shows on a line of its own under the row without pointing at it,
  so it covers nothing at any sidebar width. When the row does not show,
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

### Cleaning up merged worktrees

Clean up merged removes every linked worktree of one repository whose pull
request merged, with the same preview and approval as Done, one worktree at
a time. It adds no Engine capability: it is `previewDone` and `applyDone`
once per worktree.

- **Entry.** The repository header's menu (right-click, Shift+F10, or the
  context menu key; `repositoryMenuItems` in
  `src/mainview/worktree-menu-format.ts`) and one command palette entry per
  repository. Both are disabled with the reason unless at least one linked
  worktree has a merged pull request (`cleanUpUnavailableReason` in
  `src/mainview/clean-up-format.ts`). There is no global version. While it
  is available, the header also shows a button before Fetch now, with the
  number of merged worktrees that no removal has taken yet
  (`describeCleanUpButton`). The button is gone once that number is zero.
- **Candidates.** `mergedCandidates`: linked worktrees on a branch whose pull
  request, as `timber __app-pr` last answered, is merged and is for the
  branch the worktree has now. The primary checkout never is one. A run
  previews at most 32 (`CLEAN_UP_LIMIT`); the rest are listed as skipped.
- **Preview.** Opening the dialog asks Timber for every candidate's preview
  with the default options, so ignored files are discarded, as Done does by
  default (`src/mainview/store/clean-up-session.ts`). Previews only read and
  each is its own process with a 30 second limit, so four run at a time
  (`CLEAN_UP_PREVIEWS_AT_ONCE`). Every answer is sorted by `skipReason`:
  modified or untracked files, a branch never published, commits still to
  push, an upstream state Git could not read, or files Timber could not
  read make a row Skipped, as do a live session and a removal that runs.
  So does a preview for another commit than the list has: what the list
  says about commits would then be out of date, and Timber's removal never
  asks about them.
  Ignored files never do, and the dialog neither lists nor counts them. A
  failed preview is Skipped with Timber's diagnostic. Each Skipped row opens
  the single Done dialog for its worktree.
- **A deleted upstream is Ready.** That is the usual state after a pull
  request merged and its branch was deleted on GitHub. Timber's apply then
  discards local commits without asking, as `timber done` does, and does not
  check that they are integrated. So the Ready row says, in the Done
  dialog's words, that commits only on the branch are deleted with it.
- **What is shown.** Every preview command, and one `apply` command per Ready
  row, before Remove, in a footer that scrolls once it is long. A preview
  that expires takes its row out of Ready at once, and Remove checks the
  time again. The dialog says that a worktree whose turn comes more than ten
  minutes after the previews is not removed. When the repository leaves the
  list or its folder goes, the dialog closes.
- **Remove** hands the Ready rows, each with its own preview's name, to the
  store (`cleanUpMerged` in `src/mainview/store/store.ts`) and closes the
  dialog. The store queues them all as `waiting` removals, which turns their
  actions off as a running removal does, and removes them one at a time
  through `removeWorktree`, so scripts that run before deletion never
  compete. A second run in the same repository is queued the same way and
  starts once the first ended. Before each turn it looks the worktree up again: one that left
  the list is passed over, and one with a running session fails with
  nothing run. The repository is read again after every outcome.
- **Outcomes.** Each worktree ends as a Done removal does, without its own
  toast: removed, or a failure record with Details, including a refusal
  (such as a preview that expired while earlier ones ran, or a worktree that
  changed) and a partial failure. One failure never stops the others. One
  toast says how many were removed and how many did not finish. The records
  stay after the dialog closed, and the sidebar shows the list as it is.

### Creating and opening worktrees

`timber new` and `timber open` are the `newWorktree` and `openWorktree`
capabilities of the `Engine` contract.

- **One source for the command.** `src/shared/worktree-commands.ts` builds the
  arguments from a request, and is pure. The interface words the command in a
  dialog's footer from that function, and the main process runs Timber from
  the same function with the real result file, so the command shown is the
  command that runs.
- **The arguments.** Options first, then `--`, then what the person typed as
  one argument: `new [--base <ref>] [--workflow <name>] [--branch <name>]
  [-c] [--assign | --reassign] --no-setup --result-file <path> --no-editor
  --no-agent -- <name>` and `open
  [--workflow <name>] --no-setup --result-file <path> --no-editor --no-agent
  -- <selector>`. Text that starts with a dash is therefore never read as an
  option. Both launch flags are always passed, so an editor or an agent
  configured in Timber does not start. `--branch`, `-c`, `--assign`, and
  `--reassign` come only from Start work on the issues board, beside an
  issue selector (see [Issues board](#issues-board)).
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
  name exists is Timber's to say. `branch` must be text that is not empty
  and does not start with a dash, since it is an option's value before `--`,
  `assign` one of `assign` and `reassign`, and `allowClosed` true, and any
  of them only with a name `isIssueLinkSelector` accepts; Timber judges the
  branch name.
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

- **The Tracker field.** Under Name, for picking which issue tracker a bare
  issue number or key is read with, for this one creation. The mode's model
  reads `readIssueTrackers` once when the dialog opens (only the latest read
  counts), and the field shows only with two or more trackers set up, Default
  first and picked. Default passes the name unchanged, so Timber's
  `default_tracker` applies; it is labelled with that tracker, or plain
  "Default" when Timber reads bare issues with none. A pick goes through
  `issueSelector` (`src/shared/issue-trackers.ts`) inside
  `newWorktreeRequest`, so the footer and the run pass the same name: a name
  that Timber reads as an issue of that tracker (a positive whole number for
  GitHub, a whole key such as `ENG-42` for Jira and Linear, in any case)
  gets the prefix, and anything else, including a name with a prefix
  already, passes unchanged, so a prefix never turns a name into a selector
  Timber refuses. A key keeps the case it was typed in (`eng-42` becomes
  `jira:eng-42`), since Timber 0.1.4 reads keys in any case and uppercases
  them. So with Jira or Linear picked, a key-shaped branch name such as
  `fix-2` is read as a key too; Default or `feature/fix-2` keeps it a branch.
  A pick the field no longer offers is Default. No setting is saved.
  Start work on the issues board does not prefill this dialog: it has its
  own (below), and names the issue with `issueLinkSelector`, never
  `issueSelector`, which would pass a bare key to Timber's default tracker.
  (`worktree-modes/tracker-choice.tsx`.)

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

"Arena (Beta)" is the third mode: `timber arena new` with the fields and
command the New arena dialog had (`worktree-modes/arena.tsx`, its state in
`arena-form.ts`). The palette's New arena opens the dialog on it
(`mode: "arena"`). It starts its own agents, so it sets `ownFollowUps`: the
footer shows the `timber __app-arena launch` the store asks next in place of
setup and the picked agent, and the frame draws no Agent field. Its run
reports no worktree, so the controller starts nothing; `store.newArena`
starts each attempt's agent. A create that stopped shows what Timber
reserved as the mode's `failureNote`. The presets are read only once the
mode is on screen, since each read runs Timber. When the Timber found has no
arenas for apps, the mode's `unavailable` reason disables its option on the
switch, and a request for it opens on New branch instead.

The New branch and Existing branch modes have a **Workflow** field among their own fields, for the
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
- **Its agent** replaces the app's agent. Timber still runs with
  `--no-agent`, and the app starts the agent itself, as below. A workflow
  that sets a command (`agent = { command, args }`) starts that command in
  place of the picked agent; one that turns the agent off
  (`agent = false`) starts none; one that leaves the agent unset leaves
  the pick as it was. While a workflow decides, the Agent field is locked
  to what it decided and says why. A workflow the dialog cannot look up,
  such as a kept one the list has lost, leaves the field to the pick; the
  field and the footer say that the workflow's agent starts instead if it
  sets one.

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
  saved Settings, never from the dialog, or, with a workflow picked, with
  `workflowAgent: { workflow, agent? }`. `agent` is the picked agent's
  name, sent only when the dialog left the field to the pick. The main
  process then reads the workflow again from Timber, through the same read
  as `listWorkflows`, and starts what it reports now: a command starts as
  Timber reports it, even if it changed or was unset when picked; a
  workflow that turns the agent off starts nothing. Otherwise the picked
  agent named with it starts, as the field showed, even when the workflow
  is gone or cannot be read. A locked field names no picked agent, so then
  nothing starts, with the reason in the pane: it never falls back to an
  agent the person did not see. The session starts at 80 by 24 and
  the pane fits it once it shows. An agent that cannot start is shown in the
  worktree's pane as for the "+" menu, never as a failure of the dialog: the
  worktree stays, and the toast still says it was created. When the list
  does not have the worktree, for example because reading it again failed,
  there is no pane, so nothing starts and the toast says so.
- **The footer.** Under the Timber command, a note and a command on a line of
  their own for each session that follows ("Command that will start next"),
  never joined to the Timber command: setup first, with `<worktree>` for
  the path until Timber has made it, then the agent (`followUps`). A
  workflow's agent shows its command as Timber reports it; the session
  shows the executable as found on the PATH, as for any agent. Setup says
  "if Timber left setup scripts to run", and Existing branch says "if this
  creates a worktree", because only Timber knows.

### Finding Timber

Nothing that depends on Timber is offered until a usable one is found.

- **Which Timber.** The app ships a pinned Timber release inside it (see
  [the bundled Timber](#the-bundled-timber)) and runs it by default.
  Settings, Timber, Executable picks another: the timber on PATH, or one
  executable by its full path (the `timber` preference,
  `src/shared/timber-choice.ts`). `chooseTimber` in `src/bun/timber.ts`
  decides, in this order: the development override, a chosen file, the
  bundled Timber, then the timber on PATH. The bundled choice falls back to
  PATH only on a platform the app ships no Timber for, or in a development
  build that never fetched it. A chosen file is the only candidate: when it
  does not answer, that is reported, and nothing else is tried.
- On start the main process runs the chosen Timber with `--version`, as an
  executable plus an argument array, and logs the result with where it came
  from. Every Timber command then runs that executable.
- Saving another choice makes the main process look again at once and tell
  the window (`timberChanged`), with no restart.
- The app requires the newest Timber release (see
  [the newest Timber release is required](#the-newest-timber-release-is-required)),
  and never less than 0.2.0, the first release with the machine interface,
  `__app-config`, one-off workflows, `__app-pr` with each pull request's
  reviewers, Jira and Linear keys in any case, and `new --branch`,
  `--assign`, and `--reassign`, which starting work on an issue runs (0.1.1
  had only the first; 0.1.2 had no `__app-pr`; 0.1.3 read only uppercase
  keys; 0.1.4 had no `--branch` or `--assign`). The
  number and the comparison live in `src/shared/timber-version.ts`. A
  pre-release sorts before its release.
- The `Engine` contract reports one of three states: ready (path and version),
  not found, or too old (found and required versions), each with the
  `source` the Timber came from: bundled, setting, path, or override. An
  executable that fails, or does not print a version, counts as not found.
  About and Settings, Timber, Executable show the version, the source, and
  the path.
- When Timber is not ready, the interface shows a full-window notice instead
  of the worktree list, with Retry and Choose Timber, which opens Settings,
  Timber, Executable. Settings is the one dialog that opens without a
  usable Timber, so a chosen Timber that stopped working never locks the
  person out. It gives install guidance for the timber on PATH,
  and for a bundled or chosen Timber points to reinstalling the app or to
  Settings instead. Retry looks again, so a Timber
  installed into a folder already on PATH is picked up without a restart. A
  change to PATH itself still needs a restart, because the app keeps the
  environment it was started with.
- For development, `TIMBER_APP_TIMBER_PATH` names the Timber executable to use.
  It takes precedence over the choice in Settings, and a broken value is
  reported instead of silently falling back.
- In `bun run dev:web`, add `?timber=not-found` or `?timber=too-old` to the
  address to see the notice, or `?timber=newer-release` to see the banner.

### The bundled Timber

- **One pin.** `timber-pin.json` holds the Timber version the app ships and
  the SHA-256 of each platform's binary and of Timber's `LICENSE` and
  `THIRD_PARTY_NOTICES.txt`, read by `src/shared/timber-pin.ts`. Nothing
  else names the version: CI and the release workflow test with the same
  pinned binary.
- **Fetched and checked at build time.** `bun run build` first runs
  `scripts/fetch-timber.ts`, before `electrobun prepare`, which already
  reads the config. It downloads the pinned files for this
  platform from the Timber release into
  `vendor/timber/v<version>/<platform>/` (ignored by Git), checks each
  against the pin, and stops the build when one does not match. Files that
  already match are kept. `electrobun.config.ts` copies that folder into the
  app as `Resources/app/timber`, beside the main process's `bun` folder,
  only when the pinned version's folder is there.
- **Platforms.** Timber publishes binaries for Linux x64, Windows x64, and
  macOS on x64 and arm64. Elsewhere, such as Linux on arm64, the app has no
  bundled Timber and uses the timber on PATH.
- **Development.** `bun run dev` and `bun run start` do not fetch it, so
  they use the timber on PATH unless `bun run fetch:timber` ran first.
- **Raising the version** is a reviewed change; the steps are in
  [releasing](releasing.md#raising-the-bundled-timber).

### The newest Timber release is required

A Timber older than the newest release may lack what the app uses, so the
app requires the newest release of a Timber the person installed: the one
on PATH or the one chosen in Settings (`src/bun/timber-release.ts`). The
bundled Timber is exempt: it is the release this version of the app was
tested with, so it needs only the built-in minimum and gets no banner. A
newer Timber reaches people who use it with the next app release.

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
- **Another choice.** When another Timber is chosen, the newest release is
  required of it at once, even if the last one was usable.

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
  in the file, which starts as the order they were added. Moving a repository
  (`Engine.reorderRepositories`) rewrites that order and nothing else; an
  order that changes nothing writes nothing. The store shows the move at once
  and keeps it over a list read that answers while the save runs. Moves save
  one after another, and a move overtaken by a later one is not saved on its
  own. A save that fails reads the list again, so the saved order comes back,
  and says why. No Git command runs.
- **Groups.** The person can gather repositories into named groups, such as
  Work and Personal (issue 130). There are none until the person makes one.
  The file gets an ordered `groups` list, and each grouped entry a `group`
  that names one by id. A group inside another names it in `parent`
  (issue 316):

  ```json
  {
  	"version": 1,
  	"repositories": [
  		{ "path": "/work/api-server", "commonDir": "/work/api-server/.git" },
  		{ "path": "/work/timber", "commonDir": "/work/timber/.git", "group": "4f6c1d2e-..." }
  	],
  	"groups": [
  		{ "id": "4f6c1d2e-...", "name": "Work" },
  		{ "id": "9a07b3c4-...", "name": "Client A", "parent": "4f6c1d2e-..." }
  	]
  }
  ```

  All three fields are optional, so `SETTINGS_VERSION` stays 1, a file
  without groups is written exactly as before, and `parent` is written only
  for a group inside another. Order inside a group is the order of the
  entries, so moving a repository saves the same way as before. Order among
  groups with the same parent is their order in `groups`; where groups with
  different parents sit in it means nothing. Inside a group its own
  repositories show first, then its subgroups, so the shown order is a walk
  of the tree, each group before its subgroups.
  Group data is a convenience, like the layout: a `groups` part that cannot be
  read, an entry with a repeated id or a name that is empty or not text, and a
  `group` that names no group are dropped, and the repositories always load.
  A `parent` is dropped, and its group goes to the top level, in this order:
  when it is not text, names the group itself, or names no group; when the
  group is on a loop of parents (each group on the loop, not those hanging
  under it); and, going down from the top level, when the group would sit
  deeper than three levels (`MAX_GROUP_DEPTH`), so its subgroups go with it.
  The pure rules are in `src/shared/repository-groups.ts`: names are trimmed,
  inner runs of spaces become one, they are cut to 40 characters, and two
  names are the same when they match ignoring case. A name only has to
  differ from those of the groups with the same parent.
- **Group methods.** `Engine.listRepositoryGroups` answers the groups and the
  group of each repository. `createRepositoryGroup`, `renameRepositoryGroup`,
  `deleteRepositoryGroup`, `moveRepositoryGroup`, and `placeRepository`
  each change the file in one save, in turn with every other change to it,
  and answer `RepositoryGroupsResult`: `saved` with the groups as saved, a
  name problem (`name-empty`, `name-taken`), a refused place
  (`inside-itself`, `too-deep`), `overridden`, or `failed`.
  `createRepositoryGroup` takes an optional parent. `moveRepositoryGroup`
  takes a parent (null for the top level) and the sibling to go before (null
  for the end), and refuses a parent that is the group or one of its
  subgroups, a place more than three levels deep for the group and what it
  holds, and a parent that already holds a group with its name. The store
  checks the same rules first, so a refusal says why in the sidebar's notice
  without asking the engine. Deleting a group moves its repositories and
  subgroups up into its parent, or to the top level, its subgroups taking its
  place among their new siblings; it never refuses, even when a lifted
  subgroup then shares a name with a sibling. It forgets that the group was
  folded, in the same save, and nothing else: each subgroup keeps its own
  fold. A group, parent, or repository that is not listed changes nothing and
  answers `saved`, so a request that raced a delete is safe.
  Removing a repository takes its `group` with it; the group stays.
- **Icons.** A repository, by the path of its primary checkout, or a group,
  by id, can have an icon, in an `icons` part of the file written only once
  one is set:

  ```json
  "icons": {
  	"repositories": { "/work/timber": { "kind": "image", "source": "github", "type": "image/png", "data": "iVBORw0..." } },
  	"groups": { "4f6c1d2e-...": { "kind": "bundled", "name": "briefcase" } }
  }
  ```

  A bundled icon is one of twelve names drawn by the interface. An image
  keeps its bytes in base64, with `source` `file`, `github`, or `bitbucket`,
  at most `MAX_ICON_BYTES` (32 KB) and `MAX_ICON_PIXELS` (512) on a side.
  Its type is read from its first bytes (`sniffImage` in
  `src/shared/sidebar-icons.ts`): PNG, JPEG, or WebP, never SVG. Like the
  groups, icons are a convenience: an icon that cannot be read, whose
  bytes are no such image, or whose repository or group is not listed, is
  dropped on its own when the file is read, and the repositories always
  load. The bytes are checked when the file is read and when an icon is
  set, not on every save, since the layout and window save the whole file
  often. Removing a repository and deleting a group drop its icon in the
  same save.
- **Icon methods.** `Engine.listSidebarIcons` answers the icons from the
  settings, never from Git or the network, and none under the development
  override. `readRemoteIconSource(path)` runs one read-only `git remote
  get-url --all -- origin` in a listed repository, as an argument array
  with the limits of the issue tracker read, and answers where its icon can
  come from: the owner of a github.com repository (`githubRepositoryOf`, the
  shapes Timber reads) or a bitbucket.org repository in its HTTPS, SSH, or
  short SSH form, a user name in the URL dropped. Only `origin` is read,
  so it works while Timber is not ready. `setSidebarIcon(target, choice)`
  takes a bundled name, `file`, which opens the native file picker offering
  PNG, JPEG, and WebP, refuses a file over the limit by its size before
  reading it, and checks the bytes read, or `remote`, which fetches. Null
  removes the icon. The picker and the fetch happen before the change takes
  its turn with the other changes to the file, so they never hold a save up;
  in its turn the repository or group is looked for again, and one that left
  meanwhile answers `unknown`. A refusal (`refused`) or failure (`failed`)
  says why for the person and changes nothing on disk. The request's shape
  is checked in the main process, and maps are read with `Object.hasOwn`.
  The interface asks with no time limit, as Add repository does, because the
  picker stays open as long as the person likes.
- **Fetching a remote icon.** Only when the person chooses it, or chooses it
  again to refresh it, the main process sends a `GET` to
  `https://github.com/<owner>.png?size=64` or
  `https://bitbucket.org/<workspace>/<repository>/avatar/64`, with no login.
  The URL carries the owner, or the workspace and repository name, from the
  repository's `origin`; nothing else about the person or the machine is
  sent. Redirects are followed one at a time, at most five, and only to
  another HTTPS address, so nothing is ever asked for in the clear. The
  whole fetch, body included, must end within 15 seconds. The answer's type
  counts for nothing; its body is read up to the limit and no further, then
  checked as a file is. A 404 is refused with its own words (Bitbucket shows
  no icon for a private repository without a login), another status, no
  answer within 15 seconds, or no connection fail with the reason, and in
  each case the icon stays as it was. The app never reads Timber's
  credential stores for this, so Jira and Linear images, which need a login,
  are not offered.
- **No reload.** Grouping changes only the settings file, never the set of
  repositories, so no Git or Timber command runs, nothing is watched or
  fetched anew, and the interface never reads the repositories again for it.
  The store shows each change at once and applies the groups the engine
  answers. A save that fails puts back the groups and the order last saved
  from memory, and says why, still without a reload. Loading the groups rides
  along with each full list read; they come from the settings, so that is no
  second read of a repository.
- **Unavailable.** A saved repository that Git cannot read at its saved path,
  because the folder is missing or is no longer a primary checkout, stays in
  the list marked unavailable, with Remove offered. It comes back on the next
  refresh once the folder does.
- **Development override.** When `TIMBER_APP_REPOS` is set (paths separated by
  `;` on Windows or `:` elsewhere), the app shows those repositories instead
  and leaves the saved list alone. Add, Remove, moving a repository, and
  every group change then explain that the variable is set, and there are
  no groups. Paths in it that are not repositories are skipped.
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

The sidebar and the Changes view follow what happens outside the app, such as
a commit in a terminal or a file saved in an editor, without a press of
Refresh. Everything here is in the main process and only reads. What it
finds becomes a `repositoryChanged` message, so the interface reloads one
repository through the path described [above](#shared-state-and-live-updates).

- **What is watched (`src/bun/repository-watcher.ts`).** For each repository
  in the list, its common Git directory: the folder itself (HEAD, the index,
  `packed-refs`, `config`), `refs` and `worktrees` recursively (each linked
  worktree keeps its HEAD and index in `worktrees/<name>`), and `reftable`
  when there is one. Working trees are never watched, so a dependency install
  or a build costs nothing here. The one exception is the chops file of
  each main checkout, watched on its own (see [chops](#chops)). `src/shared/git-watch.ts` decides, purely,
  which names count: lock files, logs, objects, and the scratch files of a
  commit, merge, or rebase in progress do not. Nor does `FETCH_HEAD`:
  nothing shown reads it, and a fetch that moves refs is heard under `refs`.
- **Which repositories.** `RepositoryList.watchTargets` gives each primary
  checkout with its common Git directory, from the saved list without asking
  Timber (or from the repositories the `TIMBER_APP_REPOS` override lists).
  The watches follow the list on start, after adding or removing a
  repository, and whenever the window comes back.
- **Grouping.** Events for one repository are reported once nothing more
  happened for 300 ms, and at the latest 2 seconds after the first, so a
  rebase or a burst of new branches is one reload, or one every 2 seconds
  while it lasts.
- **Pacing by cost (`src/bun/listing-pace.ts`).** Tools outside the app,
  such as agents, editors, and shell prompts that run a plain `git
  status`, rewrite a worktree's index whenever file times are stale, and
  each rewrite is a change here. Reading a repository with many worktrees
  takes seconds, so the reloads of one repository are paced by what they
  cost: every read of its worktrees is timed, and a background change that
  comes while one runs, or sooner than three times its length after the
  last one ended, is held. The changes held for one repository become one,
  which goes back through the refresh policy when its time comes, so it
  waits while the window is hidden and the selected worktree's stamp is
  read again first. A change after a quiet spell goes out at once.
  Refresh and the app's own commands reload without waiting. This bounds
  the time `timber ls` runs, not CPU: it checks every worktree at once.
  Making each listing cheaper is Timber's part.
- **One listing per change (`src/bun/recent-listings.ts`).** The Changes
  tab and running a chop need only which worktrees Timber lists and their saved
  bases, so they reuse the listing the sidebar just read instead of running
  `timber ls` again. A listing is reused until the watcher or a fetch hears
  a change in that repository, and for at most 10 seconds; one that Timber
  could not list is not reused. Every command that changes a repository
  still reads it again. With `TIMBER_APP_REPOS` nothing is reused or paced.
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
  check took. The check reads `git status` with the Changes view's options,
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
  otherwise wake the watcher again. `git diff` refreshes the index even so,
  so the Changes view's diffs also turn `diff.autoRefreshIndex` off (see
  [the Changes view](#the-changes-view)). The check also turns `core.fsmonitor`
  off, so a background read never starts a monitor from the repository's
  configuration.
- **Not done here.** Fetching, which moves ahead and behind counts, is
  described [next](#fetching). An already open diff updates when the status
  of the worktree changes or the window gets the focus back.

## Fetching

Ahead and behind counts, "upstream gone", and "force-pushed" are only as
good as the last fetch. So the app fetches every repository in the list, in
the background and when asked, without anyone fetching by hand. The
fetcher's own fetches write only remote-tracking refs. Pull's fetch (see
[sync actions](#sync-actions)) takes the same turn but runs the plain `git
fetch <remote>` it showed, so, like a fetch typed in a terminal, it follows
the remote's configured refspecs and may also fetch tags and write
`FETCH_HEAD`.

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

## Sync actions

A sync action brings a worktree's branch and its upstream together from the
worktree's row: Pull for a branch that is behind, Push for one that is
ahead. Each is one entry in each table below, with its runner, on one
engine call, one dialog, and one kind of row control.

- **The table (`src/shared/sync-actions.ts`).** Pure. `SYNC_ACTIONS` gives,
  for each action, its steps (`syncActionSteps`: the program, Git or
  Timber, its arguments, and whether a step reaches a remote) and when it
  is offered (`syncActionApplies`). `readPullRuns` reads what Git printed
  into a `SyncActionResult`, and `readPublishResult`
  (`src/shared/timber-publish.ts`) reads Timber's record: done (`moved`
  says whether the branch moved, and `fetchFailure` that a pull's fetch
  did not work), refused (diverged, local changes, or refused by Timber,
  with Git's or Timber's words), or failed. The steps name the branch's remote and the upstream's
  full ref, which the list reads with each branch's sync state (`remote` and
  `upstreamRef` on `SyncState`, from `%(upstream:remotename)` and
  `%(upstream)`).
- **The contract.** `Engine.runSyncAction` takes the action, the repository,
  the worktree's registered path, and the target (remote and upstream ref)
  the shown commands named. `src/shared/rpc.ts` gives it no time limit.
- **The runner (`src/bun/sync-actions.ts`).** One runner per action. Each
  run is in the repository's turn (`src/bun/repository-turns.ts`), so it
  never overlaps a rebase or another command there, and only for a worktree
  Timber lists right now, on a branch whose remote and upstream are still
  the ones shown: otherwise nothing runs and the result says so. Pull's Git
  runs as an executable plus arguments in the worktree's folder, with the
  never-asking environment of `src/bun/fetch-git.ts`. Push's Timber runs as
  every Timber command with a result file does (`src/bun/timber-run.ts`).
- **Pull.** Two steps, shown before they run:
  1. `git fetch <remote>`, run through `Fetcher.fetchWith`: after the fetch
     of that repository that runs, never beside it, and followed by the
     same before-and-after check, so a force-push it brings in is marked
     and the repository is reported changed. One that fails shows on the
     repository's header like any failed fetch ("offline", "sign-in needed",
     or "fetch failed", with Git's words in its tooltip) until a fetch works.
     One that works fetched a single remote, so it does not count as a fetch
     that worked and clears no earlier failure. The
     arguments are exactly the ones shown, so the remote's own configured
     refspecs apply, as for a `git pull` typed in a terminal: it may also
     fetch tags and write `FETCH_HEAD`, which the background fetch never
     does.
  2. `git merge --ff-only --no-autostash <upstream ref>`, even when the
     fetch failed: it then fast-forwards to the commits of the last fetch
     that worked, which are the ones the behind count was made from, and
     the result notes the fetch failure with Git's words.
  Online this is `git pull --ff-only`. `--no-autostash` keeps a configured
  `merge.autostash` from putting local changes away and back: when they are
  in the way, Git refuses and leaves them. A branch that diverged is
  refused by Git, with its message and a note pointing to Rebase. Any
  other stop is reported as a failure that may have changed files, with
  Git's words and a note to check the worktree, never as "nothing changed". The
  fast-forward is stopped after 10 minutes, as a fetch is, since it
  updates files and runs hooks.
- **Push.** One step, shown before it runs:
  `timber publish --result-file <temporary file> -- <worktree>`, in the
  repository's primary checkout. Timber pushes the branch under its own
  name to its upstream, never force-pushes, never asks for a password, and
  refuses a remote branch that has moved on; the app repeats none of these
  rules. It runs through `Fetcher.whileNotFetching`, the same turn as
  Pull's fetch, because a push moves the upstream's remote-tracking ref too:
  it never runs beside a fetch of the repository. The record's `publish`
  object decides the result: `published` is done and moved, `up-to-date`
  done and not moved, `refused` a refusal (nothing pushed and no local ref
  changed, as the contract says), and `failed` a failure, both with
  Timber's diagnostic, which says what to do, such as signing in outside
  the app. A missing or unreadable record is a failure whose effect is
  unknown.
- **When it is offered.** Pull is offered for a branch that is behind and not
  ahead, Push for one that is ahead and not behind, each only when the
  upstream is a remote-tracking branch that was not marked force-pushed.
  Neither for a diverged, force-pushed, gone, unpublished, or detached
  branch, nor while Timber removes the worktree.
- **The interface.** `src/mainview/sync-action-format.ts` has each
  action's words, the row's control (`describeSyncControls`), the dialog's
  commands, and how a result is told. On the row, the behind count (Pull)
  or the ahead count (Push) becomes a button beside the row's own button
  (the row is a button, so it cannot hold one), drawn where the marker
  was; the marker's sentence stays in the row's description. The worktree
  menu and the command palette list each action while it applies. Each
  opens `SyncActionDialog`, an `OperationDialog` that shows the commands,
  Pull's second as a follow-up. One that worked closes it with a toast,
  for a pull marked as a problem when the fetch failed, and gives the
  keyboard to the worktree's row, since the control that opened it is
  gone. A refusal or a failure stays in the dialog with Git's or Timber's
  words. The store reads the
  repository again after every outcome, so the row's counts follow without
  a refresh.
- **Skipping the Pull dialog.** The `pull` preference
  (`src/shared/pull-confirm-setting.ts`) holds "Ask before pulling", on by
  default, and the primary checkouts whose "Skip pull confirmation" is on.
  Pull asks only while the first is on and the repository is not listed
  (`confirmsPull`); a saved value that cannot be read whole asks everywhere. The row, the
  menu, and the palette all ask the store's `openDialog` for the Pull
  dialog, so the choice is made there: a pull that skips it runs at once
  through `runSyncAction`, with the same commands and checks, as a
  `pull-worktree` operation that turns the row's control and the menu and
  palette entries off until it ends. One that worked gives the dialog's
  toast. A refusal or a failure opens the dialog on that outcome (`ended`
  on the request), with Git's words and the commands, unless another
  dialog is open, which it would replace: a problem toast says what Git
  said instead. The Pull dialog opened to ask first offers "Don't ask
  before pulling in <repository>", saved when Pull is submitted, never on
  Cancel. Settings, Pull holds both settings. Removing a repository drops
  its entry, in the settings file and on screen. Push always asks: it runs
  a Timber command, and every Timber command is shown before it runs.

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
  shows. Done and Clean up merged are the exceptions: their removals are the
  store's (`removeWorktree`, `cleanUpMerged`), and Remove closes the dialog
  as they start. A Done failure is shown when its dialog is opened again
  from Details. When it failed, the dialog stays open with the failure, ready for a
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
  to open. Done in the workspace header's More menu opens the Done dialog,
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
paths, one with a space), `"refused"`, `"failed"`, or `"no-result"` (exit
code 1 and no result file). A worktree with modified or untracked files is
refused whatever the ending, as Timber does.
`timberMock.endSyncActions(ending)` chooses how sync actions end from then
on. For Pull: `"pulled"` (the start), `"fetch-failed"`, `"diverged"`, or
`"local-changes"`; a branch that is ahead is refused as diverged whatever
the ending. For Push: `"pushed"` (the start), `"push-up-to-date"`,
`"remote-moved"`, `"offline"`, or `"sign-in"`, with Timber's wording; a
branch that is behind is refused as moved on whatever the ending.
`"failed"` decides both. In `/work/timber`, `main` offers Pull and
`feat/github-issue-lookup` offers Push.
`timberMock.endPullRequestResults(ending)` chooses how `timber pr` ends from
then on: `"created"` (the start), `"created-reviewer-failed"` (the first
reviewer cannot be requested, with Timber's wording), `"exists"`,
`"refused"`, `"failed-login"`
(nothing pushed), `"failed-after-push"` (the branch was published), or
`"no-result"` (exit code 1 and no result file). An empty title, or a
reviewer that is not a login or `org/team`, is refused whatever the ending.
Created and exists show the pull request on the next read, with the
reviewers requested. `timberMock.setHeadSubject(path, subject)` sets a worktree's last
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
  worktree, the Chops button while chops are in use, and the command
  palette button.
- **Sidebar.** The filter, Refresh, and New group, one collapsible section per
  repository with a "+" for a new worktree and a More menu, the repository
  groups, "Add repository" after the list, and the Settings cog fixed at the
  bottom. Its edge is a resize handle: drag it, or
  focus it and use the arrow keys, Home, and End. The width stays between 200
  and 480 pixels, and never above half the window.
- **Workspace.** A header for the selected worktree and its tabs as one tab
  list: Workspace and Pull request, then a diff tab while a diff is open
  and a File tab while a file is (`visibleTabs`). The arrows, Home, and End
  move between tabs. Workspace holds the terminal, and the diff tab one
  changed file's diff (see [the Changes view](#the-changes-view)). Which tab
  shows is in the store and is not remembered between runs.
- **Command palette.** The title bar button, and Ctrl+Shift+P (Cmd+Shift+P on
  macOS), open the palette: a `{ kind: "palette" }` dialog in the store, drawn
  by `CommandPalette.tsx`. `PaletteShortcut` listens on the window in the
  capture phase, and a drawn terminal lets the chord through, so it works
  from any focus. It opens only when no other dialog is open. What it lists
  and how typing narrows it are pure functions in `src/mainview/palette.ts`:
  the actions first (New worktree, Open existing branch, Fetch now, Rebase,
  Done, Open in editor, Open terminal, Start each saved agent, Show next
  session that needs you or is done, Clean up merged for each repository,
  Settings, Add repository), then every worktree of every available
  repository. Matching is
  case-insensitive and fuzzy over the label, the branch, the folder name, and
  the repository name, and shows at most 50 entries so hundreds of worktrees
  stay quick. Actions that need a worktree apply to the selected one and name
  it. An action that cannot run is listed with its reason, using the same
  words and rules as its button, and Enter does nothing on it.
  `palette-run.ts` does the choosing through the store methods the buttons
  call, so the palette adds no second way of doing anything. "Open existing
  branch" is the New worktree dialog opened on its Existing branch mode
  (`mode: "existing"`), and "New arena (Beta)" the same dialog on its Arena
  mode (`mode: "arena"`). The "+" and the Settings cog only ask: each puts a
  `DialogRequest` in the store (`openDialog`), and the New dialog or the
  Settings dialog is what answers it.
- **Next session that needs you or is done.** Ctrl+Shift+J (Cmd+Shift+J on
  macOS), the title bar's "2 need you, 1 done", and the palette's "Show next
  session that needs you or is done" all call the store's `jumpToWaiting`,
  which shows the session as a click on its notification does
  (`revealSession`). The orders are the interface's own, kept in `update()`
  in `src/mainview/store/store.ts`. `waitingOrder` (`withWaitingOrder` in
  `src/mainview/waiting.ts`, whenever `terminals` changes): sessions join at
  the end as they move into Needs you and leave when they move out, close,
  or exit, so the one that has waited longest is first. `finishedOrder`
  (`withFinishedOrder`, on every update, at once when neither the sessions
  nor what is on screen changed): a session joins at the end as it moves
  into Done, unless it is on screen then. Done stays until the program
  reports something else, so it also leaves once it was on screen and no
  longer is, and joins again only when it finishes again. On screen means
  shown in the window, focused or not, as for a chip's unseen mark, so one
  that finishes in a window behind another never joins. This is not the
  rule for a seen status (below), which needs a focused window. No clock is kept and
  the Engine has no part in it, so after the window reloads, sessions
  already waiting or done are in the order they started. `waitingSessions`
  and `finishedSessions` keep only those whose worktree the list has, and
  `sessionsToVisit` puts every Needs you session before every finished one;
  the counts, the palette, and the key all read them. A press goes to the
  session after the one on screen when that one is in the list, wrapping
  around, or else to the first. A finished session on screen stays in the
  list until the person moves on, so presses go on from it. With none
  listed, while a dialog or the quit question is open, or while Timber is
  not ready, it does nothing and the title bar shows nothing.
  `WaitingShortcut` listens on the window in the capture phase and always
  takes the chord from the page (`handleWaitingKey`), a held one jumping
  once, and a drawn terminal never passes it to its program, even with none
  listed, since Ctrl+J would reach it as a new line. The title bar says "1
  needs you" or "2 need you", a sentence, where a collapsed header's summary
  keeps "2 needs you", and its accessible name joins the parts with a comma.
  Not verified that a desktop webview leaves Ctrl+Shift+J to the page.
- **Chops panel.** `src/mainview/components/ChopsPanel.tsx`, with its
  words and key in `src/mainview/chops-panel-format.ts`. It is one of the
  side panel's three views; the others are [the file explorer](#the-file-explorer)
  and [the Changes view](#the-changes-view), and what they share (the keyboard as the panel shows, switches, and hides,
  its edge, and the switch in its header) is in
  `src/mainview/components/SidePanel.tsx`. Drawn on the
  workspace's right, after it in the page, with its own edge
  (`SidePanelResizer`), whichever side the sidebar is on: on the right the body
  is workspace, chops edge, panel, sidebar edge, sidebar. The edge works as
  a sidebar's on the right (`chopsWidthAfterKey`, `chopsWidthAfterDrag` in
  `shell.ts`), between 240 and 560 pixels, and CSS keeps the panel under a
  third of the window; keys and drags step from the width on screen, so
  each one changes what is seen. Stacked in the narrow layout, it sits below the
  workspace. The title bar's Chops button (`aria-pressed`) and Ctrl+Shift+K
  (Cmd+Shift+K, or the key set in Settings, Chops) call `toggleChopsPanel` in the panel's module, which asks
  the store and moves the keyboard: shown that way, the panel takes focus
  and remembers what had it; hidden while focus is inside it, focus goes
  back there, or to the Chops button. Focus elsewhere stays where it is,
  and a panel shown from the saved layout at start takes nothing. The
  store knows nothing of focus. Its Close button only hides it. What it
  shows is `chopsPanelModel` in `chops-panel-format.ts`, pure: the counts
  of each kind, the rows of the tab that match the filter (`chopMatches`,
  name or text, ignoring case), what a tab says when it lists nothing, and
  the footer. Its chops are the selected worktree's repository's, or, with
  none selected, the ones last read, as in the palette. Whether a row can
  run is `chopBlockedReason` in `palette.ts`, the palette's own rule, so the
  two agree: no worktree selected, the folder missing, being removed, or,
  for a command, a session already starting. The buttons use
  `aria-disabled`, not `disabled`, so the keyboard stays on them while a
  session starts, and name the chop's text and the footer with
  `aria-describedby`; a double click chooses once, so a prompt is not sent
  twice. The text is a tab stop, so a long one that scrolls can be read by
  keyboard. A click
  calls `runChopIn` in `palette-run.ts`, the palette's own path, which
  selects the worktree and shows the Workspace tab (not for Copy) and calls
  the store's `runChop`. The tab and the filter are the component's state
  and are not remembered.
  Making, changing, and deleting the person's own chops in the panel use
  the pure rules in `chop-format.ts`: `chopsWithSaved` and `chopsWithout`
  take what is saved when the save starts (`store.getState()`), keep the
  edited chop's place, and check names, text, limits, and the whole list as
  `readPersonalChops` will; `chopTargetOf` maps a listed row to its saved
  chop by group and name, and is null for a repository file's chop. The
  panel saves through `savePreferences({ chops })`, the Settings path, so
  there is no engine capability of its own and the main process checks it
  again; it then reads the listed repository's chops again, which
  `ChopsKeeper` does not do with no worktree selected. The form, a view of
  a file chop, and the delete question are drawn by `ChopEditor.tsx`, in
  place of the row or above the list. The form's Sound field and the file
  chop view's are `SoundPicker.tsx`, the picker Settings, Notifications
  uses, whose Play previews through `playSound` and whose Choose file asks
  `chooseSoundFile`; an answer that comes after the form or view closed is
  dropped. The file chop view saves its sound at once through
  `savePreferences({ fileChopSounds })`, from what is saved when it starts,
  one save at a time, with the picker off while it waits or while saves are
  blocked, then reads the listed chops again; `ChopsKeeper` reads again
  when `fileChopSounds` changes too. What is open is kept in the panel's
  module, as the focus return is, so it survives the panel being hidden.
  A row's menu is the worktree menu (`WorktreeMenu`), opened by right
  click, its actions button, or Shift+F10 and the menu key, handled as a
  key as the worktree row does. Saves are blocked while
  `preferencesProblem` is set, since the window then holds the defaults.
  Favorites and order: the pure rules are in `src/shared/chop-order.ts`.
  A repository's `ChopArrangement` is two lists of names, `favorites` and
  `rest`, each top to bottom, matched ignoring case, since a merged list
  has each name once whatever its kind; one order serves both tabs.
  `arrangeChops` puts the favorites first, then the rest, then chops
  neither names in listed order. `placeChop` puts one chop in a part,
  before a chop or at the part's end, and keeps names not listed now (a
  damaged file, a deleted chop) after the listed ones while there is room
  (`CHOP_ORDER_LIMIT`). `stepChop` is Alt+Up and Alt+Down: the chop takes
  the place of the row shown next to it in its part, so the other tab's
  chops and rows hidden by the filter keep theirs, and a step never stars
  or unstars. `chopDropPlace` in `chops-panel-format.ts` turns a pointer
  position into a place, with the "Other chops" heading, or the drop zone
  while no favorite shows, as the line between the parts.
  `chopsPanelModel` arranges the rows from `shownChopOrder(state)`. The
  panel saves through the store's `saveChopOrder`, which shows the new
  order at once as `chopOrderAim` and calls `savePreferences({ chopOrder
  })`, so quick moves build on each other; a failed latest save shows the
  saved order again, and the live region says why. After a move, focus is
  sent back to the same control of the row (`data-chop-handle`,
  `data-chop-star`, `data-chop-run`, and the like), since React draws a
  moved row anew. A rename keeps the chop's place and star: the panel's
  form and Settings, Chops each find their renames (`chopRenames`, and
  `chopsSectionRenames` by row key in Settings) and save
  `renameInArrangements` of the order on screen in the same save as the
  chops. All renames apply at once, so two chops that swap names swap
  places. The renamed chop is the one listed under its new name, so a
  place that name held before (a deleted chop's, or the file chop's it now
  overrides) is dropped; a chop for every repository is left alone where
  a chop for that repository has its old or new name, since that one is
  listed there. Until the chop list is read again under the new names,
  the store's `chopRenaming` (set by `noteChopRenames` before the save,
  with the list shown then) lets `chopsPanelModel` find the renamed chops'
  places by their old names (`listedChopArrangement`), so a row does not
  jump, and a move made in that time is saved under the new names; a
  failed save lets the renames go. Whether a chop for every repository is
  held back by one for a repository is judged from the list as it will be
  saved. A press on a handle ends on any release of its pointer in the
  window, on lost capture, or on Escape, which a window listener hears
  while a drag is live. While a drag is near the top or bottom of the
  panel's list, or past it, a frame loop scrolls the list by
  `chopsDragScroll` in `chops-panel-format.ts` (up to 12 pixels a frame
  within 32 pixels of the edge, faster nearer it) and works out the drop
  place again, until the pointer leaves the edge or the list can scroll no
  further.
  The live region ends every other message with a no-break space, so the
  same words said again are heard again, and only the latest move's save
  failure is said, since a later save holds the earlier change.
  `ChopsShortcut` listens on the window in the capture phase and takes the
  key only when it acts (`takesChopsPanelKey`): with chops off, a dialog
  or the quit question open, or Timber not ready, the key goes on to the
  page, and a drawn terminal passes it to its program then too.
  `chopsEnabled` in `src/mainview/store/state.ts` is the one gate: the
  `useChops` preference and a ready Timber. The button, the panel, and
  every chop shortcut, the chop search's too, ask it. Everywhere else the
  window offers chops (the palette, the "+"
  menu and the empty pane's buttons, "Insert chop") reads them through
  `offeredChops`, which has none while `useChops` is off, and `runChop`
  and `insertChop` in the store do nothing then. The list is still read,
  so turning chops on shows it at once.
- **Chop search.** Ctrl+Shift+T (Cmd+Shift+T), or the key set in
  Settings, Chops, opens a `{ kind: "run-chop" }` dialog, drawn by
  `RunChopDialog.tsx` on the palette's frame and classes, with the chops
  panel shown or hidden. `RunChopShortcut` listens on the window in the
  capture phase and takes the key only when it acts (`takesRunChopKey`):
  chops in use and no other dialog or the quit question open, or its own
  dialog open, which the key closes (`toggleRunChop` in the store). A drawn
  terminal passes the key to its program otherwise. What it lists is
  `runChopModel` in `src/mainview/run-chop-format.ts`, pure, over the
  chops the panel lists (`chopsPanelModel`'s `arranged`, favorites first in
  the panel's order), with the panel's empty, reading, and failed states.
  `findChops` ranks them: tiers by where the query matched (a name that
  has it as one piece, a name with its letters in order through the
  palette's `fuzzy`, the whole text that has it as one piece, the first
  line with its letters in order), then the repository's last chop, then
  favorites, then the match's score, then the panel's order. A long
  prompt is never matched letter by letter beyond its first line, which is
  what a row shows. The last chop is `lastChops` in the store, set by
  `runChop` for any path once chops are in use, by primary checkout, and
  kept until the app closes. Each row is blocked by its own kind
  (`chopBlockedReason` with `chopAction`). Enter calls `runChopIn`, the
  panel's and the palette's path; Ctrl+Enter or Cmd+Enter swaps the list
  for a text box with the chop's text, and Enter there passes the edited
  text, when it differs, to `runChop` as `text`. Escape is the dialog's
  `cancel`: back to the list from the text box, closed from the list. A
  key while an input method composes runs nothing. Tab and Shift+Tab move
  the kind chip through All, Commands, and Prompts, said in a live region.
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
- **The saved layout.** The sidebar width, the collapsed repositories, and the
  dismissed setup prompts (see [first-run setup](#first-run-setup)), each
  repository named by the path of its primary checkout, the folded
  repository groups (`collapsedGroups`, by group id, written only once one is
  folded), and whether the side panel shows, its width, and whether it shows
  the chops or the files (`chopsOpen`, `chopsWidth`, and `sidePanel`, each
  written only once it differs from its default), are
  the `layout` part of the
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
- **When it is saved.** Collapsing or opening a group, and showing or
  hiding the chops panel, save at once. A resize
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
  file that says off never turns fetching on. The Pull part takes its
  default, asking everywhere, when any of it cannot be read, so a damaged
  file never skips the Pull dialog. A part this version does not know is left
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
  [agent sessions](#agent-sessions)). Chops: "Use chops" (`useChops`, on by
  default), the two chop shortcuts (`shortcuts`, by id, only a key that
  differs from the default, as "Ctrl+Shift+L"; see `src/shared/shortcuts.ts`),
  "Play each chop's sound" (`playChopSounds`, on by default), and
  the person's saved commands and prompts (see [chops](#chops)); each
  switch, and the shortcuts, save with the section's Save, on its own
  while the rows are as saved (`chopsSectionChange`), so it never waits on
  rows nobody touched; with a changed row that cannot be saved, nothing is
  saved until the row is fixed or removed. A shortcut is Ctrl+Shift and a
  letter (either Ctrl or Cmd counts, read by `event.key`), set by pressing
  it in its field (`ShortcutField`); a key the app or the text editor keeps
  (`RESERVED_SHORTCUTS`, tied by a test to the app's key handlers and
  CodeMirror's keymaps) or the other shortcut's is refused with the
  reason, and never reaches the draft, so Save never holds a clash.
  `readShortcuts` refuses such a save in the main process too, and a hand
  edit keeps what it can (`salvageShortcuts`). Turning it off never touches
  `chops`, and turning sounds off keeps each chop's sound. The chops
  panel's order and favorites (`chopOrder`) and the sounds of
  `.timber/chops.json` chops (`fileChopSounds`) are preferences with no
  section: the panel saves them (see the chops panel above). Sounds kept
  for a repository that left the list stay, within the limits, as its
  order does. Fetching: whether the app fetches in
  the background and how often (see [fetching](#fetching)). Pull: "Ask
  before pulling" and each repository's "Skip pull confirmation" (see
  [sync actions](#sync-actions)). Under a
  "Timber" heading, Executable picks which Timber the app runs (see
  [finding Timber](#finding-timber)), and Machine and Repository edit
  Timber's own settings through Timber (see
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

## Chops

A chop is a saved, named thing to run in a worktree: a **command** (shell
text) or a **prompt** (text for an agent). Names clash ignoring case,
compared without the machine's locale and after NFC normalization, so
every machine agrees. The rules are pure, in
`src/shared/chops.ts`.

- **Fields.** `name` is clean as a session name (`cleanSessionName`, at most
  40 characters), since it names the session it starts. `kind` is `command`
  or `prompt`. `text` is never blank and at most 10,000 characters.
  `description` is one line, at most 200 characters, or empty. `agent` is
  only for a prompt: an agent's name from Settings, Agents, or none for the
  first saved agent. A name no saved agent has is still a valid chop, since
  a shared file names agents other people may not have; running it must
  say so, never fall back to another agent.
- **Text is checked, not cleaned.** It may hold line breaks and tabs, and
  Windows line endings become `\n`, but no other control character (C0,
  DEL, C1), no invisible format character (`\p{Cf}`, such as bidirectional
  overrides, zero-width spaces, and tag characters) apart from the
  zero-width joiner in emoji, no line or paragraph separator, and no lone
  surrogate. The description follows the same rules and has no line
  breaks. The text is shown
  before it runs and sent to a terminal as a bracketed paste: an escape
  sequence such as `ESC [201~` could end the paste early, and an override
  could hide what it says. It is kept exactly as saved otherwise, so an
  approval of a repository chop's text stays valid until the text changes.
- **Personal chops** are the `chops` preference, in the app's settings file,
  each with `repository`: the primary checkout of a repository in the list,
  or none for every repository. Names are unique, ignoring case, among the
  chops for the same repository, and among those for every repository. A
  save is taken whole or not at all. Reading the settings file keeps every
  readable entry and drops the rest (`salvagePersonalChops`), so a hand edit
  does not cost the others at the next save. A chop for a repository that
  left the list is kept, and Settings shows its path as "not in the list".
  Each may have a `sound` (a `SoundChoice` from
  `src/shared/sound-setting.ts`), written only when it has one; missing or
  null is none. A save with a sound that cannot be read is refused; reading
  the settings file plays the chime for it instead, as for an alert.
- **Sounds** (`src/shared/chop-sounds.ts`). A chop's sound plays when it
  starts. A personal chop keeps its own. A file chop's is the
  `fileChopSounds` preference: for each repository's primary checkout, a
  list of names and sounds, matched ignoring case, never in the repository
  file, whose `sound` key, if any, is passed over and is not part of the
  approval digest. Only chops with a sound are kept, so None takes the
  entry away; a name not listed now keeps its sound while there is room.
  At most 200 names a repository and 200 repositories, the ones changed
  longest ago dropped first (`withFileChopSound`), so a save never goes past
  what `readFileChopSounds` accepts. `playChopSounds` (on by default) is
  "Play each chop's sound" in Settings, Chops. `mergeChops` gives each
  listed chop its `sound`, so the panel shows it, and `runChop` in the
  main process plays it (`chopSoundToPlay`) once the chop started: its
  terminal or agent opened, or its prompt went to a running agent. Nothing
  plays for `needs-approval`, a failure, "Insert chop", or a copied prompt.
  The sound is read with the chop from the saved preferences, never from
  the window, and goes through the alerts' player (`src/bun/sounds.ts`)
  with the chime for a missing file of one's own, so its rules hold: one
  sound at a time, a chop's sound can make an alert's sound skip, and none
  longer than 4 seconds. A sound setting that cannot be read never stops a
  chop: it runs silent, with a warning.
- **Order and favorites** are the `chopOrder` preference: for each
  repository's primary checkout, the names of its favorites and of the
  rest, in the chops panel's order (`src/shared/chop-order.ts`). Any chop
  listed can be in it, a file chop too, and the repository is never
  written. A save is taken whole or not at all; reading the settings file
  keeps every readable name (`salvageChopArrangements`). At most 200 names
  for a repository and 200 repositories are kept: the order of a
  repository that left the list stays, and past 200 the one changed
  longest ago is dropped (`withChopArrangement` keeps them oldest first).
- **The repository file** is `.timber/chops.json`, committed with the code,
  and read from the repository's main checkout (its primary checkout) only,
  never from the active worktree, so every worktree of a repository shows
  the same list. A branch's change to the file shows once it reaches the
  main checkout. It is an optional extra a team can share; the person's own
  chops are the default source:

  ```json
  {
  	"version": 1,
  	"chops": [
  		{ "name": "Test", "kind": "command", "text": "bun test", "description": "Run every test" },
  		{ "name": "Review", "kind": "prompt", "text": "Review this branch against main.", "agent": "Claude Code" }
  	]
  }
  ```

  `description` and `agent` may be left out. Keys the app does not know are
  passed over. The app owns only `chops.json` in `.timber`: it reads the
  file and never writes it, and never creates the folder. `.timber.toml`
  stays Timber's own and holds no chops. The file is read whole or not at
  all, at most 100 chops: one entry that cannot be used makes it damaged,
  with a reason that names the entry by its number and cleaned name
  ("Chop 2 ("Lint"): ...") and otherwise never quotes the file.
- **Reading the file** (`src/bun/chops.ts`). The content comes from the
  repository, so `.timber` must be a folder and `chops.json` a regular
  file, checked with `lstat`: a symbolic link, a folder, or a device is
  damaged and never opened. It is then opened with `O_NOFOLLOW` and
  `O_NONBLOCK`, so a named pipe cannot hang the read and a link put in
  place of `chops.json` after the check is not followed, and checked again
  on what was opened. A `.timber` swapped for a link between the check and
  the open is still followed, and Windows has neither flag; the content is
  only ever parsed, so that needs a racing local process and reveals
  nothing beyond "damaged". It
  must be UTF-8 and at most 256 KB. A missing file, or a `.timber` that is
  not a folder, is simply no file.
- **Merging** (`mergeChops`). A personal chop for this repository wins over
  a personal chop for every repository with the same name, ignoring case,
  which is then left out. Either kind of personal chop wins over a file chop
  with the same name, which is listed in `overridden` with which one won.
  The order is personal for this repository, personal for every repository,
  then the file's, each in saved order.
- **`listChops`** takes a repository, the path of its primary checkout,
  which must be in the app's list with its folder there, and answers the
  merged list, the overridden file chops, the file's full path in the main
  checkout, and whether the file was read, missing, or damaged. The main
  process merges with the saved preferences, never with chops sent by the
  interface. The file is read on every call and never cached.
- **Watching the file** (`src/bun/chops-watcher.ts`). For each repository
  in the list, two watches, neither recursive and neither polling: the main
  checkout's own folder, where only events named `.timber` count, so the
  folder appearing or going is heard and a build writing beside it is not;
  and `.timber` while it is there, for `chops.json`. Nothing is read there.
  A burst becomes one `chopsChanged` message after 300 ms, and the window
  lists that repository's chops again if they are on screen. The watches
  follow the repository list with the Git metadata watches. The store also
  reads them again after every reload of the repository, as for a pull in
  the main checkout, and on "Read again".
- **In the window.** The store keeps one answer in `chops`: the selected
  worktree's repository's, the latest read winning. `ChopsKeeper` reads it
  when another repository is selected and when the saved chops change. The
  chops panel (see [the shell](#the-shell-and-the-saved-layout)) lists it
  in a Commands and a Prompts tab, with a filter, runs each through
  the palette's path, and makes, changes, and deletes personal chops. The
  Workspace "+" menu lists the chops after the agents, under "Chops",
  commands and prompts, a prompt marked "Prompt", or "Copy prompt" when no
  agent is saved in Settings, with the description, or the text's first
  line, as the tooltip; with no session yet the empty pane has a "Run",
  "Send", or "Copy" button for at most three, both kinds, in the chops
  panel's order for the repository, favorites first (`emptyPaneChops`, over
  `arrangeChops` and `listedChopArrangement`, so a star or a move shows
  there at once), and with more than three an "All chops" button that shows
  the chops panel, or gives it the keyboard when it shows already
  (`showSidePanel`), never hiding it. The "+" menu and the palette keep
  every chop, in listed order. The command palette has "Run chop:
  <name>" for a command and "Send prompt: <name>" or "Copy prompt: <name>"
  for a prompt (`chopAction`), found by name and description, for the
  active worktree, and lists them with the reason when they cannot run: no
  worktree selected, the folder missing or being removed, or, for a
  command, a session already starting there. The words, the menu entries,
  and the palette entries are pure (`src/mainview/chop-format.ts`,
  `src/mainview/agent-format.ts`, `src/mainview/palette.ts`).
- **Running a command chop** (`runChop`). The request names the
  repository, the worktree's registered path, the chop by name, and the
  pane's size, never the text, except `text` for a run the person edited
  in the chop search: it is typed or sent in place of the chop's text,
  once, and changes nothing else (the name, the agent, the sound, the
  approval). `textToRun` in `src/shared/chops.ts`, in the main process and
  the mock engine, refuses one that is not a string, blank, or longer than
  a chop's text can be, and makes its line endings `\n`. The main process lists the chops once, finds
  the chop by name, ignoring case, and uses the text from that same read. A
  command chop starts the person's shell in the
  worktree as a new session named after the chop (`defaultSessionName`, so
  a second run is "Test 2"), whatever Settings says about naming, as Setup
  is. The text is then typed in (`chopRunBytes` in
  `src/shared/terminal.ts`): as soon as the shell turns on bracketed paste
  (mode 2004, read from its output), as one bracketed paste and Enter, so
  the whole text is one command line. If it has not once its output was
  quiet for 300 ms, as at a prompt of dash or `/bin/sh`, which never turn it
  on, or after 5 seconds of no output at all, each line is typed with
  Enter, as a script runs. A text with a tab is not typed that way, since a shell takes a tab
  as completion; the session prints why instead. The timer ends with the
  session. The shell stays after the command ends, so its output can be
  read, and the shell's history runs it again. Only the main process can
  pass a chop to `TerminalSessions.open`; the `openTerminal` request
  cannot.
- **Sending a prompt chop** (`runChop` too). A prompt always goes to an
  agent in the active worktree, as typed input: one paste, then Enter. The
  window picks where (`promptTarget` in `src/mainview/agent-sessions.ts`):
  with no agent running in the worktree, a new one; with one that does not
  wait on the person (`blocked`) and is not still waiting for a prompt of
  its own (`prompt` is `pending`), that one; otherwise the Send prompt
  dialog lists the running agents with their state, and "A new <agent>",
  with nothing picked, and warns when the picked agent waits on the
  person, since the Enter would answer it. The request then names the
  session in `session`, or leaves it out for a new agent. `runChop`
  refuses `session` for a command.
  - *To a running agent* (`TerminalSessions.sendPrompt`): only a running
    session of kind `agent` in that worktree of that repository takes it,
    at once, also while it is busy, which is how the agent would get it from
    the keyboard. One still waiting for a prompt of its own takes no other
    (`not-ready`), since it may be on a first-run screen. The
    answer is `sent` with the session, or why nothing was written, as for
    a paste (`gone`, `not-agent`, `not-ready`, `refused`). A session that
    ended meanwhile is `gone`; no agent starts in its place.
  - *To a new agent*: the agent is the one the chop names, or the first
    saved one, from the saved Settings, never from the request. A chop that
    names an agent not saved starts nothing (`not-configured`), never
    another agent or a shell. It starts as any agent does, with nothing
    added to its command line, so the prompt is never on a command line.
    `TerminalSessions.open` takes the prompt only with an agent from
    Settings, and refuses it for a shell, setup, a workflow, or an arena
    attempt, so Enter can never run it in a shell. The session's `prompt`
    is `pending`, then `sent`, or `not-sent` with the reason, told through
    the usual session change; the window shows a toast for either.
  - *When a new agent is ready* (`isReadyForPrompt` in
    `src/shared/agent-prompt.ts`). An agent that probed for the Program
    Status Protocol gets the prompt once its root record is `idle`: Claude
    Code 2.1 reports `idle` at its input, and `blocked` with "trust this
    folder" on its first-run question in a folder it does not trust, where
    the prompt waits. An agent that never probed, such as Codex, gets it
    once it turned bracketed paste on and its output stayed quiet for 500
    ms, or, if it keeps redrawing, once bracketed paste was on for 5
    seconds. The app never reads what an agent prints, so it cannot tell that
    first prompt from a first-run screen that also takes Enter, such as a
    sign-in. A prompt with a line break also waits for bracketed paste. An
    agent not ready after two minutes, or that ended first, gets nothing,
    and `prompt` says why.
  - *The bytes* (`promptBytes` in `src/shared/terminal.ts`): the paste as
    `pasteBytes` builds it, so a text with a line break goes only as one
    bracketed paste, then Enter written 100 ms later, once the agent read
    the paste whole. Reviews and prompts both write through one function
    in `src/bun/terminals.ts` (`deliver`); a review sends no Enter.
  - *No agent saved*: the window offers "Copy prompt", which puts the
    listed chop's text on the clipboard as it is (`writeClipboard`) and
    sends nothing, also when an agent of a workflow or an arena runs.
- **Approving a repository chop.** A chop from the file is code from the
  repository. It runs only once its text was approved for that repository:
  otherwise `runChop` starts nothing and answers `needs-approval` with the
  chop as read and the file's path, and the window shows the exact text and
  where it comes from, with Cancel first; Run asks again with `approve` set
  to the text shown, which approves it only if it is still the chop's text,
  so a file changed meanwhile asks again. A run with edited `text` asks
  the same, for the file's own text: the `approve-chop` dialog carries the
  edited text, shows it under the file's as what runs once approved, and
  Run passes both. The `send-prompt` dialog carries it too. The question never replaces a
  dialog the person opened meanwhile: a toast asks them to run it again.
  A run after Run that cannot start, such as while another session starts
  there, says why in a toast. Approvals are kept app-side in
  the settings file under `chopApprovals`, by primary checkout, as
  SHA-256 digests of the kind and the text, and a prompt's agent
  (`chopDigestInput`), at most 200
  per repository, newest kept. A changed text has another digest and asks
  again; a rename does not. A save that fails still runs that once, and
  the next run asks again. Personal chops run straight away. A prompt asks
  the same way, its dialog says "Send" and where it goes, and the dialog
  keeps the target picked before, so a confirmed prompt goes there, and
  names the agent a new session would start. The digest covers the kind, so
  an approved prompt never runs as a command, and for a prompt the agent it
  names, so a changed agent asks again.
  The mock keeps approvals in memory.
- **Insert chop.** Right-clicking a session's chip, or Shift+F10 or the
  context menu key on it, opens its menu: "Insert chop: <name>" for each
  command chop of its repository, disabled with the reason once the session
  ended. It types the text into the session with `pasteTerminal`, with no
  Enter, so it can be edited first: as one bracketed paste when the program
  asked for one, so line breaks do not run it early; a text of one line as
  typed when it did not; and a text with a line break is refused then, with
  a toast. No approval is asked: nothing runs until the person presses
  Enter. `pasteTerminal` takes any running session now, not only an
  agent's; the review still goes only to an agent, which the store checks.
- **Windows.** Untested. The shell is PowerShell, which may not turn on
  bracketed paste, so a chop is typed line by line once its prompt is
  quiet. Whether
  ConPTY passes `ESC [?2004h` and a bracketed paste through is not known
  (see [review notes](#review-notes)).

In `bun run dev:web`, the sample Timber repository's main checkout shares
three chops and the API server has a damaged file.
`timberMock.setChopsFile(repository, text)` changes a repository's file
(`null` for none) and is heard as the watch would hear it.
`timberMock.chopApprovals()` shows what was approved.

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
  text, cursor, selection, scrollbar, and the sixteen ANSI colors; the text
  and the sixteen are also custom properties, `TERMINAL_COLOR_PROPERTIES`,
  which the File tab's editor colors code with). A color
  is hex or `rgb()`/`rgba()` text (`src/shared/color.ts`). `readTheme` never
  fails: a part that is missing or cannot be read comes from Timber Dark or
  Timber Light, by the theme's appearance, and is named in `replaced`, for
  an import to refuse the file.
- **Built in.** `src/shared/builtin-themes.ts`: Timber Dark (the colors the
  app was designed in, and the default), Timber Light, Catppuccin Mocha,
  Gruvbox Dark, Nord, Solarized Dark, and Solarized Light. A palette gives
  the surfaces, text, and meaning colors and the sixteen ANSI colors; the
  see-through fills and shadows, the diff backgrounds and changed-word
  tints, and the terminal's selection follow from them. A theme saved
  before the changed-word tints (`diffAddedWord`, `diffRemovedWord`) gets
  them the same way, from its own added and error colors, so it still reads
  whole. A palette also gives the purple of merged pull requests (`merged`);
  a theme saved before it had one takes its own terminal magenta for it.
  Where a palette's own color was under the
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
  color (focus included) on every surface (the four backgrounds, and
  `fillField`, which is also the tint of a repository's header row in the
  sidebar), the terminal's text on its
  background, and the interface's and the terminal's text on each
  changed-word tint laid over its line's tint and the diff's pane, as WCAG 2 does, laying see-through colors over the app's
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
  logins, and where each tracker's current sprint comes from). The presets
  of `timber setup` fill the fields, which stay editable. A table can
  inherit, be off (`false`), or be set here. A group
  is held in the window as typed (`src/mainview/timber-settings-format.ts`)
  and saved as the whole scope: its own keys replaced in the settings as last
  read, every other key sent back as it was read. Inside a table the group
  sets, only the keys it draws are replaced: hand-set keys such as
  `[agent].resolve_handoff` stay as read.
- **Sprint source and tracker scope.** Issue tracking also draws
  `[jira].board` or `[jira].sprint_jql` (a "Current sprint from" choice of
  Not set, Scrum board, or JQL; only the chosen one is sent, so the app
  never saves both) and `[jira].project`, shown with the site when Jira is
  set here; `[github].project` and `[github].milestone`; and
  `[linear].team`. Values go to Timber as typed, trimmed only to tell blank
  from set: a board that is a whole number is sent as one, anything else as
  the text, so Timber refuses it at the field (`jira.board is invalid`).
  Timber names `jira.sprint_jql` when both are set, which shows at the
  board field while Board is chosen. Timber's scopes merge table by table,
  so a repository's `[jira]` replaces the machine's whole, site included:
  choosing "This site" in a repository with no site typed starts from the
  machine's site, sprint source, and project (`withJiraMode`). GitHub and
  Linear have no Off or Inherit choice: blank fields leave the table as
  read when it sets none of them (absent, `false`, or empty), a field typed
  writes the table, and clearing every field removes it, so the machine's
  applies again. A repository's GitHub and Linear fields show the machine's
  values as placeholders only while all of that table's fields are blank
  (`scopePlaceholder`). The setup wizard draws the same fields, returns to
  Issue tracking for Timber's messages about them, and lists them on its
  last step. After a save, the Issues board shown, when the save could
  change it, reads its trackers and lists again (`refreshBoard`), so a
  sprint just set up shows; another board reads them when it opens. Named workflows and arena presets are not edited: they are
  left out of the draft and Timber carries them over from the file as it is
  at save time, so a change made to them outside the app is a conflict, not
  a refused field.
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
  whole, because starting that agent needs them: the New worktree dialog
  starts a workflow's agent with them, shows them in its footer and the
  locked Agent field, and the session shows them in its tooltip. They can
  hold tokens, so neither the record, the list, Timber's diagnostic, nor
  the command of a workflow's agent is ever logged, and the interface must
  not show arguments without cleaning them.

In `bun run dev:web` timber has a workflow of each agent kind, api-server
has none, and billing's fails as its `.timber.toml` is malformed.
`timberMock.setWorkflows(path, list)` changes one (`null` for the sample).

## Issue trackers

The New worktree dialog's Tracker field needs to know which trackers a
repository has set up, without the app reading Timber's files or holding a
login.

- **Asking.** `readIssueTrackers` on the `Engine`, answered by
  `src/bun/issue-trackers.ts`. It reads the repository scope through the
  same service as Settings (`timber __app-config read --scope repository`,
  which checks that the repository is in the list and that Timber is ready),
  then runs one read-only `git -C <checkout> remote get-url --all -- <remote>`
  through `readGit`, with a limit of ten seconds. Git runs only after
  Timber's read worked.
- **Deciding.** `issueTrackersOf` in `src/shared/issue-trackers.ts` is pure,
  and mirrors Timber's rules. GitHub is set up when the remote Timber uses
  (its `remote` setting, or `origin`) has exactly one fetch URL, of one
  github.com repository in a form Timber accepts. Jira is set up when a site
  applies and its login is saved or given in the environment; Linear when
  its login is saved or given in the environment. The default is
  `effective.default_tracker`, and none for `none` or when no default is
  set, even with a Jira site, as Timber 0.1.4 then reads every bare name as
  a branch.
- **Private.** Only whether a login applies is used, never a login, and
  nothing read is logged. A failed read is a failure with Timber's
  diagnostic; the dialog then shows no field, and creating still works.
- **Linear** is listed when its login applies, but has not been tested
  against a real Linear workspace.

In `bun run dev:web` timber has GitHub and Jira, so the field shows, and
api-server has GitHub only, so it does not. The mock derives the trackers
from its Timber settings, so saving or removing a login in Settings changes
them. `timberMock.setGithubRemote(path, false)` takes GitHub away (`null` for
the sample).

## Pull requests

Each row shows its branch's pull request, read by Timber from GitHub or
Bitbucket Cloud, so there is one sign-in, Timber's, and the app holds no
token. The host follows the repository's remote, not its issue tracker: a
repository with Jira as its tracker and its code on bitbucket.org shows
its Bitbucket pull requests.

- **Asking.** `readPullRequests` on the `Engine`, answered by
  `src/bun/pull-requests.ts`. For a repository in the app's list only, and
  only while Timber is ready, the main process runs `timber __app-pr` in its
  primary checkout, as an executable plus an argument array, with standard
  input closed and a limit of thirty seconds. Timber stops its own network
  part after fifteen. One run answers for every worktree of the repository.
  On GitHub, Timber reads the login it uses for `timber new github:<n>`
  (`GH_TOKEN`, `GITHUB_TOKEN`, or the GitHub CLI's); on Bitbucket, the one
  `timber pr` uses (`BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN`, or the
  login saved by `timber setup`). It never prompts, and changes no file or
  ref. This needs Timber 0.1.3, the first release with `__app-pr`, and
  Timber 0.1.4 for Bitbucket. An older one answers "unknown command".
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
  the app does not use are ignored. `not-github` means the remote is on
  neither github.com nor bitbucket.org. The answer keeps the host,
  `github` or `bitbucket`, from Timber's `pullRequestRepository`; with
  none, as for a remote on neither host or a Timber before 0.1.4, the
  words are GitHub's. A host the app does not know makes the answer
  unreadable, so it is never named as GitHub.
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
  repository's answer is forgotten. Background fetches are at least a
  minute apart, so a Bitbucket repository is not read in the background
  more often than Timber asks (Bitbucket allows a user about 1,000
  requests an hour); a read that hit the limit fails every entry, shown
  as "PRs failed".
- **Showing.** `describeRowMarkers` takes the worktree's entry, found by its
  Git-registered path (`pullRequestOf`), and adds the pull request's markers
  from `src/mainview/pull-request-format.ts` after the row's state flags.
  A failure is shown once, as a quiet word on the repository's header, and
  in the workspace header of a selected worktree in it, never on every row
  and never as a dialog. The pull request's number in the workspace header
  is a link that goes through `openLink`, which opens only `http` and
  `https` links. The words name the host the answer gives
  (`pullRequestHostName`): the link's "Open pull request #N on Bitbucket
  in the browser", "PRs need Bitbucket sign-in" with `timber setup` or
  `BITBUCKET_EMAIL` and `BITBUCKET_API_TOKEN` in its tooltip, and
  "Bitbucket could not be reached". On Bitbucket, which has no review
  decision, "review required" says the reviewers have not approved yet
  rather than that the repository requires a review, and the checks are
  its build statuses.
- **The Pull request tab.** `PullRequestPanel` shows the selected
  worktree's entry from the same answer, with its words from the pure
  `describePullRequestTab` in `src/mainview/pull-request-tab-format.ts`:
  the pull request, "No pull request yet", "Not read yet" before the first
  answer, or why it could not be read. Under the review decision it lists
  each reviewer with its state, "team" or "bot" beside the name, and an
  Open link when it has one, then a quiet line when there are none or
  Timber's login could not read them all. It reads the store, so it
  changes whenever the pull requests are read again. Showing a pull request
  runs no command, and its controls open links through `openLink`. On
  Bitbucket, its review sentence follows Timber's rule (anyone asking for
  changes, then any approval, then any reviewer), a merged or closed pull
  request says Bitbucket's checks are read only while it is open, and an
  incomplete reviewer list says Bitbucket did not list them all. A
  worktree on a branch with none yet gets a form that runs `timber pr` (see
  [opening a pull request](#opening-a-pull-request)); on Bitbucket its
  Reviewers field offers no suggestions, since Bitbucket's reviewers are
  display names and Timber refuses `--reviewer` there.

In `bun run dev:web`, timber has an approved pull request and one with
failing checks and requested changes, api-server a merged one, and billing
a draft and a closed one on Bitbucket, beside its Jira issue, with
descriptions and check runs that show
every status, a run without a link, and none at all. Their reviewers show
every state, a team, a bot, none at all, and a list Timber could not read
in full (the draft, on Bitbucket). docs-site, once
added, is on neither GitHub nor Bitbucket.
`timberMock.setPullRequests(path, list)` changes one (`null` for the
sample).

## Opening a pull request

The Pull request tab of a worktree on a branch with no pull request yet is a
form that runs `timber pr --result-file`. Timber publishes the branch with the
rules of `timber publish` and opens the pull request on github.com, or
since Timber 0.1.4 on bitbucket.org, with its own login; the form's note
names the host the pull requests were read from. The app never pushes and
never calls GitHub or Bitbucket. On Bitbucket the form has no Reviewers
field, since Timber refuses `--reviewer` there, and says to add reviewers
on Bitbucket. Timber 0.1.3, the
release the app requires, is the first with `timber pr`, so there is no
version gate of its own. Reviewers need `timber pr --reviewer` and the
record's `reviewers` field (Coding-M8s/timber#174), which are on Timber's
main branch but in no release yet. The app reads the record in that form
already, so until the required Timber is raised to the first release with
them, a record from Timber 0.1.3, which has no `reviewers`, is one this app
cannot read, and with reviewers 0.1.3 stops at "unknown option
'--reviewer'" with exit code 1 and no result file, which the app reports as
a failure whose effect is unknown. Raising the required release is the step
that finishes this.

- **The form.** `PullRequestFormView` in
  `src/mainview/components/PullRequestPanel.tsx`, shown when the worktree's
  entry from `timber __app-pr` is none and it has a branch. Its state lives in
  the store, `pullRequestForms` by worktree id, so leaving the tab or the
  worktree while Timber runs keeps what was typed and the run, and cannot
  start a second one. The tab calls `startPullRequestForm` each time it
  shows the worktree. The first call starts the form: Title as the branch,
  then the last commit's subject once `readHeadSubject` answers, unless
  something was typed first. `defaultPullRequestTitle` in
  `src/mainview/pull-request-create-format.ts` puts the key of a saved Jira
  or Linear link (`titleKeyOf`) first, as `PROJ-123: subject`, unless the
  title already starts with that key in any case, maybe after one `[` or
  `(`. A GitHub link, no link, or invalid metadata adds nothing, and the
  app never guesses a key from the branch name. A later call whose worktree
  has a new head reads the subject again, under the same condition, so a
  form started before the branch had a commit of its own does not keep the
  base's subject. A subject read for an older head is dropped, and a read
  that answers null leaves the title as it is. A later call whose link
  gives another key than the form's `titleKey`, because a link was
  attached, changed, or removed, makes the title again at once from the
  form's last read `subject`, under the same condition, without reading.
  A read that answers later uses the form's key as it is then. A form
  whose worktree left the list is forgotten when the list is read again,
  so one made again at that path starts afresh. Base as `initialPullRequestBase` of the
  saved base, which gives `<remote>/<branch>` for a saved
  `refs/remotes/<remote>/<branch>` and nothing for a saved local branch, a
  commit, none, or invalid metadata, since `timber pr --base` takes only a
  branch on a remote. Empty Base passes no `--base`, and Timber takes the
  saved base and
  says what it needs. The app checks no title, length, or base itself:
  Title is always passed, even empty, and Timber refuses it.
- **Reviewers.** `ReviewersField` in
  `src/mainview/components/ReviewersField.tsx`, a text field in the form for
  logins or `org/team`, separated by commas or spaces
  (`pullRequestReviewersFromText` in `src/shared/timber-pr.ts` splits them
  and leaves out empty ones, nothing more). Timber trims, deduplicates, and
  refuses a value that is not a login or `org/team`, more than 15, a team
  outside the base repository's owner, and any reviewer on a Bitbucket
  base, all before it reads a login or pushes, so the app checks none of
  that. While the field has the focus, `reviewerSuggestions` in
  `src/mainview/pull-request-create-format.ts` offers the people and teams
  the repository's last `timber __app-pr` answer lists as reviewers, each
  once whatever its case, by name, without bots, which `--reviewer` does
  not take. `matchReviewers` narrows them by the name being typed (the text
  after the last comma or space, with the caret taken to be at the end) and
  leaves out the ones typed before it, and `withReviewerPicked` puts a
  picked one in its place. Arrow keys move, Enter takes the marked one, and
  Enter with none marked submits the form. While Timber runs, nothing is offered.
- **The last commit's subject.** `readHeadSubject` on the `Engine`, answered
  by `WorktreeCommands.headSubject` in `src/bun/worktree-commands.ts`: for a
  worktree Timber lists in a repository from the list (`findListedWorktree`)
  it runs `git -C <worktree> log -1 --format=%s HEAD --` without optional
  locks (`readHeadSubject` in `src/bun/git-engine.ts`), and answers null for
  anything else, a branch with no commit, an empty subject, or when Git
  could not answer. It changes nothing.
- **One source for the command.** `prResultArguments` in
  `src/shared/timber-pr.ts` builds `pr --title <text> [--body <text>]
  [--base <ref>] [--draft] [--reviewer <name>]... --result-file <path> --
  <registered path>`, one `--reviewer` for each reviewer, in the order
  typed. Each value is its own argument after its option, so a title or a
  description that starts with a dash stays text, which Timber 0.1.3 was
  checked to accept, and a reviewer that starts with a dash stays a value,
  which Timber refuses as no login. The footer words it from that function with `<temporary file>`
  (`pullRequestCommandFor` in `src/mainview/pull-request-create-format.ts`),
  and it follows every keystroke.
- **Running and checks.** `createPullRequest` on the `Engine`, answered by
  `WorktreeCommands.pullRequest`, in the same per-repository turn as `timber
  new`, `open`, and `rebase`. Before it runs anything it checks that the
  request is complete (only text becomes an argument, `draft` is a
  boolean, and `reviewers` is a list of text that is not empty), that the repository is in the list, that Timber lists the
  worktree there with its folder, and that Timber is ready. Each refusal is
  a failure with `ran: false` that ends "Nothing was run." The desktop
  engine asks with no time limit: Timber stops each GitHub request after ten
  seconds, but a push takes as long as it takes.
- **Reading the record.** `readTimberResult` has checked the common fields.
  `readPrResult` then checks the `pr` object: a known `result`, a positive
  whole `number` or null, text or null for `url` and `base`, a boolean
  `published`, and a `reviewers` list, required even empty, whose every
  entry has a `name` that is not blank, a `kind` of `user` or `team`, a
  `result` of `requested` or `failed`, and a `diagnostic` that is text that
  is not blank exactly when it failed and null otherwise. Names and
  diagnostics are made safe to show (`displayText`). Reviewers are listed
  only for created and exists. The app does not compare the list with what
  was asked for, since Timber trims and deduplicates. Created and exists must have succeeded and refused and failed
  must have failed; `number` and `url` are there exactly for created and
  exists; `url` must be an `https://github.com` or `https://bitbucket.org`
  link; a refusal never
  published; and a record that names another worktree is not used. Anything
  else is a failure whose effect is unknown (`published: null`), since the
  branch may have been pushed.
- **Outcomes.** `presentPullRequestCreation` maps each answer. Created: a
  toast, "Pull request #N opened", with "1 reviewer could not be
  requested." (or the count) after it when some failed. Exists: a quiet line above that pull
  request saying it was already open and Timber opened no other. Both stay
  as `reported` in the form until the next read of the repository's pull
  requests after the run. Until then, while GitHub does not list it yet,
  the tab shows its number with "Open in browser". That read shows it, or,
  if it still says none, the form again. Refused: Timber's
  diagnostic, and that nothing was pushed. Failed: Timber's diagnostic, and
  whether this run published the branch, or that it is unknown, never that
  nothing changed. Running it again reports one that was opened as already
  open. Each failure keeps Timber's output in `TimberFailureDetails`, closed
  at first, and stays until a field changes or the next run. A reviewer
  that could not be requested, on created or exists, is a line in
  `reviewerFailures` of the form, "Review could not be requested from
  <name>." with Timber's diagnostic. It shows below the note that names the
  reported pull request, and, once the pull requests read list it, above
  that pull request in the tab, so it never takes the place of what was
  created. Unlike `reported`, a read keeps it: it lasts until "Dismiss"
  (`dismissReviewerFailures`), the next run, or the form is forgotten.
  While a read still lists no pull request, or the pull requests cannot be
  read, it shows above the form or the note in the tab's place.
- **Afterwards.** After every outcome that ran, even a failure, the store
  reads the repository and its pull requests again before it says how it
  ended, so a created pull request shows as soon as the host lists it,
  and the note until then names that host.
- **In the browser.** The mock engine acts out `timber pr`
  (`src/mainview/engine/mock-pr.ts`) and writes the record Timber would,
  read by the same code. Created and exists add the pull request to the
  repository's next answer, and request each reviewer, trimmed and each
  once as Timber takes them, so that pull request lists the requested ones
  with `requested`. A reviewer Timber would refuse is refused whatever the
  ending. `timberMock.endPullRequestResults` chooses the
  ending, and `timberMock.setHeadSubject(path, subject)` the last commit's
  subject (see [reporting outcomes](#reporting-outcomes)).
- **Tests.** `tests/fixtures/timber-pr` holds two refusals recorded from
  Timber 0.1.3 (a remote that is not on github.com, and no title), each
  with the empty `reviewers` list that later Timber writes. Created,
  exists, and two failures are written by hand from the recorded one in the
  form Timber's `docs/ide-contract.md` gives, because recording them would
  open a real pull request. `tests/timber-pr-parse.test.ts` maps each one.
  With the installed Timber, `tests/worktree-pr.test.ts` checks that a
  refusal against a remote on disk changes no file or ref in the worktree,
  the primary checkout, or the remote, with no GitHub login in reach,
  including refused reviewers, one of them starting with a dash, and that
  reading the subject changes nothing. The refusal test checks Timber's
  outcomes only with a Timber whose `timber pr --help` lists `--reviewer`;
  with an older one it still checks that nothing changed.
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

### Issue suggestions

The New worktree dialog suggests issues while a Name is typed, found by
Timber with its own logins.

- **Asking.** `searchIssues` on the `Engine`, answered by
  `src/bun/issue-search.ts`, with a repository in the list, a tracker, and
  the typed text (1 to 200 characters). Only while Timber is ready, the main
  process runs `timber __app-issues search --tracker <tracker> --limit 10 --
  <text>` in the repository's primary checkout, as an executable plus an
  argument array, the text after `--`, with standard input closed and a
  limit of thirty seconds. Timber stops its own network part after fifteen,
  never prompts, and changes no file, ref, or issue. It does not take the
  repository's turn, so it never waits behind a command that changes the
  repository. Timber matches key prefixes and title words: Jira through its
  issue picker, GitHub against the 300 most recently updated open issues,
  locally. `__app-issues` is on Timber's main branch and in no release yet.
- **Reading.** `readIssueSearchRecord` in `src/shared/issue-search.ts` is
  pure. It accepts one version 1 search record for the tracker asked about,
  whose outcome agrees with its fields and its exit code, with every issue
  readable (as `readIssueValue` in `src/shared/issues.ts`), and keeps the
  worktree Timber says is linked to each issue. `none` reads as an empty
  list. A Timber without the command (exit 1, nothing printed, "unknown
  command '__app-issues'") is `unsupported`, never confused with a crash.
- **Typing.** `createIssueSuggestions` in
  `src/mainview/components/worktree-modes/issue-suggestions.ts` holds the
  list, apart from the form, so a key press never waits for a search. A
  search starts once typing pauses for 250 ms, at most one runs at a time,
  and only the latest text waits behind it. Lists are kept by tracker and
  text for the dialog's life, so typing back to earlier text shows its list
  at once. An answer for text no longer in the field is kept but not shown.
  The tracker is the one picked in the Tracker field, else Timber's default,
  else the only one set up. A Name that already names a tracker
  (`jira:ENG-4`) is not searched. Sign-in needed, not configured, not
  found, forbidden, and a Timber without the command stop the searches of
  that tracker (or of all, for the last) until the dialog opens again;
  offline and failed ask again on the next text. Each shows a quiet hint
  under Name, never a dialog.
- **Showing.** `NameField` in
  `src/mainview/components/worktree-modes/name-field.tsx` draws the list
  over the fields below Name. Nothing is highlighted at first, so Enter on
  typed text still creates. Arrow keys move the highlight, Enter or a click
  fills Name with `github:42` or `jira:ENG-42`, and Escape closes the list
  without closing the dialog. Leaving Name closes it too, so it never covers
  the fields below; another tracker's list is dropped at once. Each row shows the key, the title, the
  tracker's status name, and "Has a worktree" for an issue already linked
  to one.

In `bun run dev:web`, the samples' trackers hold a few GitHub, Jira, and
Linear issues (`sampleIssueSearch` in `src/mainview/engine/mock-issues.ts`);
TIM-88 and #41 have worktrees. `timberMock.setIssueSearch(result)` makes
every search answer `result` (`null` for the samples).

### Issues board

Each repository's board lists issues that Timber reads with its own logins.

- **Asking.** `listIssues` on the `Engine`, answered by
  `src/bun/issue-lists.ts`, with a repository in the list, a list, and a
  tracker. The board's two toggles, Current sprint and Assigned to me, make
  four lists (`listOf` and `togglesOf` in `src/shared/issue-lists.ts`):
  `open` (neither), `sprint`, `assigned`, and `my-sprint` (both). Only while
  Timber is ready, the main process runs `timber __app-issues <list>
  --tracker <tracker>` (with `--limit 50` for `assigned` and `open`, and
  `sprint --assigned` for `my-sprint`) in the
  repository's primary checkout, as an executable plus an argument array,
  with standard input closed and a limit of thirty seconds. It reads up to 8
  MB of record: a 500-issue sprint is far less. It changes no file, ref, or
  issue and does not take the repository's turn. The tracker is always
  named, so the board never depends on a default it did not see; with no
  default and none named, Timber answers not configured. A Timber older
  than `--assigned` (0.1.4 and before) exits 1 with "unknown option
  '--assigned'" and prints nothing (`isAssignedOptionUnknown`). Then the
  main process reads `sprint`, and, only when some issue does not say
  whether it is the person's (`assignedToMe` null, as from 0.1.4), also
  `assigned`, and joins them with `intersectMySprint`: it keeps the
  sprint's issues by `assignedToMe`, else by address in the assigned list
  (an address, since a GitHub project can hold issues of several
  repositories). That join is lossy, so its result is `partial`. Only the
  sprint's own `not-configured` passes through as `not-configured`, so the
  assigned list can never hide the sprint. Any other failure, a crash
  included, is read as usual and never falls back.
- **Reading.** `readIssueListRecord` in `src/shared/issue-lists.ts` is pure.
  It accepts one version 1 record of the list and tracker asked about, whose
  outcome agrees with its fields and its exit code, reading each issue as a
  search does (`readListedIssue`). A found sprint must say its sprint and
  source; other lists must not. `my-sprint` reads a record whose `query`
  is `sprint`, and every issue in it must have `assignedToMe` true, since
  nothing else shows that Timber applied the filter; otherwise the record
  is refused. An empty list is `found` with no issues.
  A Timber without the command is `unsupported`. Each issue's
  `pullRequests` (the open pull requests the tracker links to it: number,
  address, head branch, `fromFork`, `draft`) is the one lenient read: Timber
  never fails a list over its links and an older Timber leaves the field
  out, so a field that is missing, null, or cannot be read makes that
  issue's `pullRequests` null and leaves the rest of the list as read.
  Within the field it is strict: one entry that cannot be read (a number
  that is not a positive whole number, an address that is not `https`, an
  empty branch, one with a control character or over 255 characters, or a
  flag that is not true, false, or null) makes the whole field null, never
  a partial list. The head branch is kept exactly as the tracker gave it.
- **Holding.** `src/mainview/store/issue-board.ts` keeps each answer by
  tracker and list, and the latest good one apart, so an answer that comes
  late lands on its own list and a failed read leaves the last good list on
  screen. `boardView` derives what shows: the tracker (picked, else Timber's
  default, else the first set up), the lists not set up (`hiddenLists`:
  whose latest answer is `not-configured`; `sprint` and `my-sprint` need the
  same setting, so both are not set up when the newer of their two answers
  says so), and the list shown (`shownList`: the one remembered in the
  layout's `issueLists`, else the first set up of `sprint`, `assigned`,
  `open`, `my-sprint`). The layout keeps the list, so the toggles need no
  new field and a list remembered before the toggles maps to them as is.
  `boardToggles` says, for each toggle, whether it is on and which list not
  set up flipping it would show; such a toggle is disabled and points at
  that list's hint. A read whose list turns out not to be set up shows the
  next list; when a toggle was turned to it, the list shown before comes
  back and is remembered again. Whenever the list shown changes, it is read
  if it never was or its own answer still says not set up, so both toggles
  remembered come back with a fresh read once the sprint is set up. Opening the board and Refresh read the trackers
  (`readIssueTrackers`), the list shown, and each list not set up, so one
  set up since comes back; a sprint not set up is asked about once, as
  `sprint`, never as `my-sprint` too. That read contacts nothing when the
  setting is still missing. Nothing reads on a timer.
- **Showing.** `IssuesBoard` and `IssuesRow` in
  `src/mainview/components/IssuesBoard.tsx`; `state.board` names the
  repository whose board replaces the workspace, and `select` clears it.
  A list not set up (its hint under the toggles, or the board's own line
  when no list is), and a list whose board, project, milestone, or team
  Timber cannot find (`fixedInTrackingSettings`), offer "Open Issue
  tracking settings": the settings dialog request names the section
  (`repository`), the board's repository, and the group (`tracking`), so
  Settings opens on that repository, not the selected worktree's, and
  Issue tracking scrolls into view and takes the focus once read.
  Columns come from `boardColumns` in `src/mainview/issue-board-format.ts`,
  which never drops an issue. Cards are keyed by address, since a GitHub
  project can hold issues of several repositories. Cards use
  `content-visibility: auto`, so a long column draws only what is in view.
- **Checking out a pull request.** `checkOutChoice` in
  `src/mainview/check-out-format.ts` decides, purely, whether a card offers
  Check out PR: no worktree here, not done, links read and not empty, and a
  key `issueLinkSelector` (`src/shared/issue-trackers.ts`) can name to
  Timber whole (`github:<n>`, `jira:<KEY>`, `linear:<KEY>`; never a bare key,
  which Timber would read with its default tracker). It also refuses, with
  the reason, a pull request whose `fromFork` is true, a github.com pull
  request of another repository (any, when this repository has no
  github.com remote), and every pull request of a GitHub issue of another
  repository, because `timber open` resolves a bare branch name
  in this repository only and `github:<n>` names issue n of this
  repository. This repository's github.com "owner/name" comes from
  `readIssueTrackers` (`githubRepository`, read from the same
  `git remote get-url --all` as before). `CheckOutPullRequestDialog`
  (DialogRequest `check-out-pull-request`) shows the exact command from
  `openWorktreeArguments`, then `runCheckOut` calls `openWorktree` once with
  the head branch as the selector and `issue`, which adds `--issue
  <selector>` among the options. The main process accepts `issue` only when
  `isIssueLinkSelector` says it is whole. The store reads the repository
  again and selects the worktree Timber reported; setup Timber left starts
  in a session (`startSessionsIn`), and then the Pull request tab shows.
  When that read does not list the worktree, neither starts and the toast
  says so (`describeUnlisted`). A failure, also one where Timber kept a
  worktree, stays in the dialog with Timber's reason. If no branch has the
  exact name, Timber may open one by its ticket prefix; the toast names the
  branch it opened (`describeCheckedOut`).
  Opening the board again reads it, and Timber's `worktree` field, from the
  link `--issue` saved, gives the card its pill.
- **Starting work.** A card with a worktree here offers Open worktree, which
  selects it. Every other card offers Start work, beside Check out PR when
  that shows. `startWorkChoice` in `src/mainview/start-work-format.ts`
  decides, purely: the selector `issueLinkSelector` makes, or a reason the
  button is off (a key Timber cannot be given whole, a GitHub issue of
  another repository). It opens `StartWorkDialog`
  (`src/mainview/components/StartWorkDialog.tsx`, DialogRequest
  `start-work`), which reuses the New worktree dialog's frame and
  controller, so the Agent field, workflows, setup, and the agent that
  starts afterwards are the same. Its one mode
  (`worktree-modes/start-work-model.ts`) runs `timber new` with the
  issue's selector as the name, so the worktree is always linked to it, and
  shows the command first (`startWorkRequest`):
  - **Branch.** Empty passes nothing, and Timber names the branch. The app
    does not show the name Timber would generate: Timber's contract says
    not to duplicate its branch resolution, and nothing in it reports the
    name before creation. A typed name passes `--branch <name>`; the hint
    names the prefix Timber requires (`branchPrefix`), and Timber checks it.
  - **Assignee.** Always `--assign`. `initialQuestion` reads the card:
    `assignedToMe` false with an assignee asks, from the moment the dialog
    opens, whether to replace them, naming them, and the command shows
    `--reassign` (on GitHub the card has the first assignee only, which
    the question says). Cancel is the dialog's own, so nothing runs. When
    the card could not tell (`assignedToMe` null), Timber refuses
    `--assign` on someone else's issue with `assignment.result:
    "not-attempted"` and their names; `assigneeRefusal` turns that into the
    same question, with the failure on screen. It counts only a run that
    passed `--assign`, created nothing, and whose card did not say the issue
    is the person's, and never names the signed-in account, because Timber
    also reports `not-attempted` when a later step failed.
  - **An open pull request.** With someone else assigned and a pull
    request `checkOutChoice` can open, the question also offers "Check out
    their pull request", which opens Check out PR for the same card.
  - **A closed issue** asks the same way and passes `-c`. An issue closed
    since the board read it fails with Timber's reason, as does an issue a
    stale card called the person's that someone else took since: Refresh
    the board and start again. Timber's record names assignees by display
    name only, so a Jira or Linear assignee who shares the person's
    display name is not asked about.
  - **Afterwards.** As for New branch. The toast adds what Timber did about
    the assignee (`describeAssignment`, from the record's `assignment`),
    marked as a problem when the write failed: Timber keeps the worktree
    then. When Timber stopped before setup, the "Run setup" step says the
    issue was not assigned if Timber had not written it yet.
  - **An older Timber** answers "unknown option" without a record; the
    dialog says Start work needs a Timber with `--branch` and `--assign`
    (`unknownStartWorkOption`).

In `bun run dev:web`, the samples' trackers have a GitHub milestone and a
Jira board sprint; Linear has no team, so its sprint and open issues are not
set up (`src/mainview/engine/mock-issue-lists.ts`). The lists follow the
mock's Timber settings after inheritance: a Linear team saved in Settings
sets up Linear's cycle and open issues, and a Jira site with neither a board
nor sprint JQL has no sprint. The GitHub sprint has
one issue with a pull request, one with two (one from a fork), one with a
worktree and a pull request, and a done one with a pull request; Jira's
TIM-80 has one, and two issues' links could not be read. Their head branches
are remote branches of the sample repository, and the mock's `timber open
--issue` saves the link. The mock's `timber new` with an issue selector
saves the link too, takes `--branch` only with the issue's prefix, refuses
a closed issue without `-c`, and refuses `--assign` on an issue assigned to
someone other than the sample tracker's login (`sampleLogin`) as Timber
does; Jira's TIM-90 and GitHub's 44 are someone else's.
`timberMock.setIssueList(result, list?)` makes every list, or one, answer
`result` (`null` for the samples), `timberMock.setIssueListDelay(ms)` slows
them, and `timberMock.sampleBigSprint(n)` builds a sprint of `n` issues.
`timberMock.setAssignedOption(false)` acts out a Timber without `sprint
--assigned`, such as 0.1.4: no issue says whose it is, and both toggles on
join the sprint and the assigned list as the main process does, so GitHub's
done issue 7 drops out and the board says the list may be incomplete
(`true` undoes it).

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

## Arenas

An arena gives two or more agents the same task from the same commit, each
in its own worktree, and keeps one (Coding-M8s/timber-app#172). Timber's
arena commands are beta, and so is everything the app offers for them.
Timber owns every rule: which attempt is ready, what its agent runs, what
counts as work, and what pick may remove. The app repeats none of them. It
uses Timber's arena records for apps ("Arenas for app consumers" in Timber's
`docs/ide-contract.md`), read in `src/shared/arenas.ts`, which is pure, and
run from `src/bun/arenas.ts`.

- **Listing.** `listArenas` runs `timber __app-arena list` in the primary
  checkout, as an executable plus an argument array, with standard input
  closed and a limit of thirty seconds. Exit 1 with a record still lists:
  only a record with a top-level diagnostic is a failure, and an arena
  Timber could not read is a failed entry beside the others. Another schema
  version, an attempt that cannot be read, or exit 1 with nothing failed is
  a failure with a message, never an empty list. Unknown fields are
  ignored. The store reads arenas as it reads backups: when a repository is
  first listed, on Refresh, right after a create or pick, and after a change
  of the repository, at most once in `ARENA_READ_SPACING_MS`.
- **A Timber without arenas.** Released 0.1.3 has no `__app-arena`, and a
  build of Timber's main branch with it still calls itself 0.1.3. As for
  backups, the answer is `unsupported` only when Timber exited with 1,
  printed nothing, and its standard error says `unknown command
  '__app-arena'`. The app then offers no arena: the New worktree dialog's
  Arena mode and the palette's New arena are disabled with the reason. Replace this with a version check once a release has
  arenas.
- **The sidebar.** `groupArenaRows` in `src/mainview/arena-format.ts` puts a
  listed worktree under its arena only when an attempt of an arena read whole
  has its exact path and `git: "ok"`. Branch and folder names are never
  read.
- **Creating.** `newArena` runs `timber arena new` with each group's flags in
  order (a model, effort, or runs count belongs to the tool or preset before
  it), `--base`, `--prompt-file <task file>`, `--no-editor --no-agent
  --result-file <temporary file>`, and the name after `--`. Every value the
  person typed is joined to its option with `=`, so none can read as an
  option. The task is written to a new file that only this user can read,
  in the same private folder as the result file, which is removed after
  Timber ends; it is never an argument, never logged, and never in a record.
  Timber names the arena (a ticket key becomes lowercase), so the app takes
  the name from the record. A failure after Timber reserved the arena keeps
  that report: the name stays taken, and the app never creates it again.
- **Starting an attempt's agent.** `openTerminal` with `arenaAttempt` asks
  `timber __app-arena launch <arena> --attempt <label>` in the attempt's
  worktree, before anything else, since nothing may wait between finding the
  worktree and keeping the session. It starts exactly the program, arguments,
  folder, and environment Timber gives (`environment` set on top of the
  app's, `unset` removed), the program found on the PATH unless it is a
  whole path, as an agent session named after the label. Timber's folder
  must be the worktree asked for. A manual attempt starts nothing. After a
  create in which every attempt is ready, the store starts one session per
  attempt with an agent; after a failure it starts none.
- **Comparing.** `inspectArena` runs `timber arena pick <arena> --inspect
  --json`, which changes nothing, and the Compare dialog shows its counts as
  they are: committed and uncommitted apart, untracked as a count. "Open in
  Changes" shows the attempt's changes in the side panel as for any worktree
  (`showSidePanel`). Timber saves
  no base for an attempt (`timber ls` reports it unassigned), so that tab
  compares uncommitted changes only; comparing with the arena's base commit
  there is not done yet.
- **Picking.** `pickArena` runs `timber arena pick <arena> --winner <label>
  --result-file`, in the repository's turn. Timber refuses only attempts it
  recorded as running, and it never sees the app's sessions, so the main
  process first reads the list again, checks that the winner is one of the
  attempts, and ends every session of the app (agents and shells) in the
  other attempts' folders, which pick removes. The winner's sessions keep
  running. When a session does not end, nothing is picked. The record says what
  happened to each attempt: the winner, removed, archived under a
  `refs/timber/arena/...` ref, already removed, or kept or partly removed
  with Timber's reason, which makes the pick a failure to fix and run again.
  The repository and its arenas are read again after every outcome.
- **Tests.** `tests/arenas-parse.test.ts` reads records recorded from
  Timber's main branch (`tests/fixtures/timber-arena`). `tests/arenas.test.ts`
  runs a stand-in Timber that notes each run, the task file's text and
  permission bits included, and, when the Timber found has arenas, the real
  one in a temporary repository with a stub wrapper preset: list, launch,
  and inspect leave every file and ref as they were, a pick whose sessions
  did not end changes nothing, and a pick archives the attempt with work.

## Opening a worktree in an editor

The app has no code editor of its own, only the File tab's small text editor
for quick fixes (see [the file viewer](#the-file-viewer)). "Open in editor"
starts the person's editor
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
  the diff tab does. The editor then gets that file's full path in place
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
  is missing, it is disabled with the reason, which the workspace header
  shows as one quiet line under its details (`OpenInEditorReason`): starting a terminal editor in
  the worktree's terminal is a later step. A started editor is a toast. Any
  other answer is a note under the workspace header that names the command,
  until it is dismissed or the next open works (`editorProblem` in the store).
- **Trying it.** In `bun run dev:web` the mock engine acts it out and starts
  nothing. `timberMock.endEditorLaunches("not-found")` or `("fails")` chooses
  how it ends from then on, and `("opens")` goes back to the start.

## The Changes view

The side panel's Changes view shows what changed in the selected worktree,
as `git status` and `git diff` see it, compared with the worktree's base or
with its last commit, and opens each file's diff in a diff tab beside
Workspace and Pull request. It is read-only: nothing in it stages,
discards, or commits. Comparing against a backup is a later step.

- **The capabilities.** `readFileChanges({ repository, worktree, compare })`
  and `readFileDiff({ repository, worktree, compare, file })` on the
  `Engine` contract, where `compare` is "base" or "uncommitted".
  The types and pure parsers are in `src/shared/file-changes.ts`, and the
  main process side is `src/bun/file-changes.ts`. Both act only on a
  worktree Timber lists, in a repository in the app's list, whose folder is
  there (`findListedWorktree`), as "Open in editor" does.
- **The list, Uncommitted.** `git status --porcelain=v2 -z
  --untracked-files=all`. Each untracked file is listed on its own, not its
  folder, so it can show its content. A file with staged and unstaged
  changes is listed once in each group. Groups show conflicts first, then
  staged, then unstaged (untracked included). With Base, the groups are
  conflicts, changed, and untracked (below). Kinds: modified, added, deleted, renamed, copied, type changed,
  untracked, and conflicted. At most 5,000 files are listed, with a note
  when there are more.
- **Comparing with the base.** The revision is the base Timber saved for
  the listed worktree (`Worktree.base`), read in the main process, never
  sent by the window, and only a canonical ref under `refs/` or a commit's
  full hash (`savedBaseRef` in `src/shared/file-changes.ts`). The main
  process resolves it and `HEAD` with `git rev-parse --verify --quiet
  --end-of-options <rev>^{commit}`, then finds the branch point with `git
  merge-base <base> <head>`. For a commit base the resolved hash must be the
  saved one, so a hash that names a tag, which Git would peel to its commit,
  is not used. A commit that HEAD descends from is its own branch point; a
  commit the branch left earlier, such as one no branch contains, gives the
  commit where their histories part. In a partial clone, resolving a saved
  commit that is not there can make Git fetch it from the promisor remote,
  as any read of a missing object does. The list is `git diff --name-status
  -z -M
  <branch point>`, which compares that commit with the files on disk, so
  committed, staged, and unstaged changes are one entry each and commits on
  the base after the branch point do not show. Since the index is not
  refreshed (see below), that list also names files whose times changed
  but whose content did not, so only the files that `git diff --numstat -z
  -M <branch point>` also names are kept; Git compares the content for
  those counts. When the counts are cut short, every name is kept, which can
  list a file that was only touched, but never leaves out a real change.
  Comparing the content of every changed file costs more than the names
  alone, within the same 20 second limit; when the counts fail, every name
  is kept too. Conflicts and untracked
  files come from the same `git status` as Uncommitted: conflicts replace
  the base diff's entry for that path, and untracked files are a group of
  their own, so a file removed from Git but still on disk is listed as
  deleted and as untracked. Every answer says which comparison its files
  come from (`compared`) and whether the base can be used, with its name
  and branch point, or the reason it cannot: no saved base, metadata Timber
  cannot use, a ref or commit Git does not have, a hash that is not a
  commit, no commit yet, or no shared history.
  A base that cannot be used is never a failure: the answer is the
  uncommitted list. The branch point is worked out again for every list
  and diff.
- **A diff.** A change since the base is `git diff -M <branch point> --
  <path>`. Staged changes are `git diff --cached -- <path>`, unstaged
  ones `git diff -- <path>`, both paths for a rename or a copy, and an
  untracked file is `git diff --no-index -- /dev/null <path>`, so every line
  is an addition. A conflicted file is Git's combined diff. The request names
  the file by group and path. The main process reads that file's status
  again and builds the command from what Git says now, so a path from the
  interface never reaches Git unchecked; one that is absolute or steps out
  with `..` is refused first. A file that is no longer changed there says so.
- **Read-only for real.** Every query runs with `GIT_OPTIONAL_LOCKS=0`,
  without which `git status` rewrites the index to refresh file times.
  `git diff` rewrites it even with that, so every diff of tracked files also
  runs with `-c diff.autoRefreshIndex=false`. A test with stale file times
  shows that comparing with the base and the diffs leave the index bytes
  unchanged, and fails without that option. Paths are literal (`--literal-pathspecs`),
  so a file named `*` means that file. Diffs run with `--no-color
  --no-ext-diff --no-textconv`, so the person's diff configuration cannot
  start a program or change the text, and with `LC_ALL=C`, so Git's "Binary
  files ... differ" is in English for the parser.
- **Line counts.** Each `FileChange` has `added` and `removed`, as `git
  diff --numstat -z -M` counts them with the diff's own options
  (`uncommittedContentArguments`): `--cached` for the staged group, plain
  for the unstaged one, and, comparing with the base, the numstat that
  already checks the names. A rename's counts are under where it went
  (`parseNumstat`). An untracked file is read from disk and counted as Git
  counts a new file (`countAddedLines`), up to 16 MiB each and 64 MiB in
  all for one list, a link as the one
  line of its target, never followed; a NUL in its first 8,000 bytes, as
  Git checks, makes it binary. A binary file, a conflict, and a numstat
  that failed or was cut short give null counts, never a failed list.
  Only the files that are listed (at most 5,000) are counted and looked at
  on disk.
  Tests on real repositories check that every listed file's counts are
  its diff's added and removed lines and that reading them changes no
  file, ref, or index byte.
- **Versions.** Each `FileChange` also has a `version`, never shown: a hash
  of what its diff is made from, so the window can tell that a file marked
  Viewed changed again even when its counts did not. `parseStatus` starts it
  with the modes and objects `git status` reports (the last commit's and
  the index's for a staged change, the index's for an unstaged one, the
  stages' for a conflict), and the main process adds the branch point for
  the base and, for every diff that reads the file on disk, its size and
  modification time from `lstat`, as the stamp of the periodic check does.
  Touching a file without changing it gives a new version, which only
  clears a Viewed mark.
- **Large and binary.** Git's output is read up to 512 KiB, and Git is
  stopped beyond that. A diff of more than 5,000 lines is not drawn. Either
  way, and for a binary file, a notice shows instead, with the Git command
  to run in a terminal. Git is stopped after 20 seconds.
- **Colors and changed words.** `src/mainview/diff-highlight.ts` colors a
  diff as the File tab's editor colors the file: `pickLanguage` picks the
  language from the file's name, its parser loads once on demand, and
  Lezer's `highlightTree` gives each token its class from
  `codeHighlightStyle`, with no editor. Each hunk's old side (context and
  removed lines) and new side (context and added lines) is parsed as one
  piece of code, and context lines take the new side's colors. Git's notes
  get none. A kind of file the editor does not know, or a diff whose
  highest line number or text is over the editor's limits, stays plain.
  The highlight style's classes are mounted on the page with the diff, so
  a diff colors before any editor opened; a theme change recolors it with
  no script, as in the editor. Known limit: a hunk that starts inside a
  multi-line comment or string is parsed from its first line, so it may be
  colored wrongly. `src/mainview/diff-words.ts` pairs each run of removed
  lines with the run of added lines right after it, line by line, skipping
  Git's notes, and marks the stretch between their shared start and end,
  widened to whole words. A pair that shares fewer than 4 characters, or
  under 30% of the shorter line, not counting indentation, is a rewrite
  and gets no mark. A marked word is drawn in the interface's text color on
  its tint, since some themes' code colors are too faint there (Catppuccin
  Mocha's comment grey is about 1.1:1 on it), and the contrast check
  measures the text color on the tint. `DiffText` in `src/mainview/components/DiffText.tsx`
  draws a line's pieces (`lineSegments`), memoized, so a refresh colors at
  once without flashing plain.
- **Compare with.** A switch above the list, Base or Uncommitted. The view
  in the store keeps the comparison its files came from, and the header
  shows `origin/main @ a1b2c3d` or "Last commit". A commit base shows as
  `a1b2c3d` when it is the branch point itself, and as `a1b2c3d @ 9f8e7d6`
  when the branch left its history at an earlier commit. Base is disabled,
  with
  the reason under the switch, when the latest answer says the base cannot
  be used. Switching clears the list and reads it again, so no file of one
  comparison shows under the other's header. A worktree compares with its
  base unless the person chose Uncommitted there; that choice is in the
  saved layout as `uncommittedChanges`, the worktree identities set to
  Uncommitted. An identity stays there after its worktree is removed,
  which costs one short string.
- **Setting the base.** Beside the switch, "Set base…" when the worktree
  has no saved base (or metadata Timber cannot use) and "Change base…" when
  it has one opens the Set base dialog (see [below](#setting-the-base)).
  After Timber saves a base, the worktree compares with it, as if the person
  had chosen Base, and the list is read again, so the header shows the new
  `name @ hash`. Review notes taken under the old base stay, and are marked
  outdated when their lines are no longer in the diff.
- **In the window.** `src/mainview/components/ChangesList.tsx` draws the
  view: Compare with, the base, "Filter files", the counts with the total
  lines and Refresh, the file list, and the Review section (see
  [review notes](#review-notes)). Each file shows its name, its folder, a
  check when it is marked Viewed, its `+n -m`, and Git's letter (M, A, D,
  R, C, T, U, and ! for a conflict). The filter is `changeFilters` in the
  store, by worktree, and `filterFiles` in `src/mainview/changes-format.ts`
  matches paths ignoring case. The arrows, Home, and End move the keyboard through the list
  without opening anything; a click or Enter opens the file's diff
  (`selectChangedFile`). Its words and Ctrl+Shift+G are in
  `src/mainview/changes-panel-format.ts`, and the rest of the side panel is
  shared with the chops and the files (see
  [the file explorer](#the-file-explorer), "One side panel, three views").
- **The diff tab.** `diffs` in the store holds each worktree's diff tab, by
  its identity: the file, and the tab it was opened from (`DiffTab` in the
  store's state), never saved. `changes.selected` is the file of the
  selected worktree's diff tab while it is listed, and only its diff is
  read; nothing is read for a file no tab shows. A read whose list no
  longer has the tab's file closes the tab, and so does a switch of
  "Compare with". `closeDiff` shows the tab it came from; when that is gone,
  or the worktree leaves the list, `settleTabs` in
  `src/mainview/file-view-format.ts` shows Workspace instead.
  `src/mainview/components/DiffTab.tsx` draws the tab, with the Review
  button while there are notes and the Changes view is not on screen, and
  `src/mainview/components/DiffView.tsx` the diff: old and new line numbers,
  Git's own header lines, such as `rename from`, notes on lines, ranges,
  and outdated notes. "Open in editor" opens the file, and is not offered
  for a deleted one. Each line is drawn in two parts, `lineTone` for its
  background and `LineContent` for its text, in either layout.
- **Previous, next, and Viewed.** `stepChangedFile` opens the file before
  or after the diff tab's, among the files the list shows through its
  filter, going round (`steppedFile`); the title line's buttons and
  Alt+Up and Alt+Down (`takesFileStepKey`, not from a field that edits
  text) call it. `viewed` in the store keeps, by worktree, each file marked
  Viewed by its comparison and file (`viewedKey`) with the version it had;
  `fileViewed` is true only while the listed version is the same, and a
  read of the list drops the marks whose file left it or has a new version.
  Kept in the window only.
- **Unchanged lines.** `src/mainview/diff-unchanged.ts` works out, from
  Git's hunk lines, the unchanged lines before each hunk, and fills them
  from the file on disk, since unchanged lines are the same on both sides.
  That holds only where the file on disk is the diff's new side
  (`unchangedReadable`): not for a deletion, a conflict, a type change, an
  untracked file, or a staged change whose file also has unstaged edits.
  For those, the store reads the file with `readWorktreeFile` beside the
  diff and keeps its lines in `changes.unchanged` only when every new-side
  line of the diff is there at its number (`linesMatchDiff`), so a file
  that changed between the two reads fills nothing until the next read.
  `shownSections` gives the diff a slot before each hunk, empty or not, so
  opening a gap never moves the index of a hunk or a line, and a note being
  written keeps its place. A note can be on an unchanged line: outdated
  notes are judged against the diff with every gap filled
  (`fillUnchanged`), a read that could not check the file judges none, and
  a gap that holds a noted line shows by itself, so its reference can mark
  it. Send review and Copy review read each noted file again the same way
  (`readJudgedDiff` in the store), so a note on an unchanged line is not
  sent as outdated.
- **Unified and Split.** The Unified | Split switch (`DiffLayoutSwitch`),
  at the end of the worktree's tab row while the diff tab shows, since the
  diff's title line has no room left, sets `diffLayout` in the saved layout (`chooseDiffLayout`), so the
  choice is one for every worktree and kept after a restart; Unified until
  one is made. Split puts old lines on the left with their old numbers and
  new lines on the right with their new numbers. `splitRows` in
  `src/shared/diff-split.ts` pairs them: a kept line on both sides, and in
  each run of removed lines and the added lines after it, the first removed
  beside the first added and so on, with an empty, hatched cell where one
  side has no more lines. Git's "No newline at end of file" stays on the
  side of the line it follows. `changedWords` pairs lines by the same rule
  (`hunkParts`), so a marked word is always beside the line it changed in.
  A long line wraps inside its cell, so the row stays paired. `shownLayout`
  draws Unified instead, and a line under the title says why, while the tab
  is narrower than `MIN_SPLIT_WIDTH` (600 pixels, measured as it resizes)
  and for a conflict's combined diff; the choice stays Split. For a narrow
  tab the line offers "Hide side panel" (`toggleSidePanel`) and "Show
  Split anyway", kept in `DiffView` while it shows and never saved, which
  draws Split `cramped`: each hunk keeps `MIN_SPLIT_WIDTH` as its least
  width and the diff scrolls sideways.
- **Refreshing.** `ChangesReader` reads the list while the Changes view
  shows or the diff tab does (`changesWanted`), and again whenever the
  worktree's status on screen is read again, which is whenever its
  repository reloads: the sidebar's Refresh, the view's own Refresh, or a
  reported change. The open file's diff is read again with it. The view is
  in the store (`changes`), and the latest read wins.
- **Showing a refresh.** `changesBusy` in the store's state says whether a
  worktree's changes are being read again: its `read-changes`, its repository's
  `reload-repository`, or `reload-all`. A switch of "Compare with" is a
  `read-changes` too. The panel holds that for `REFRESH_HOLD_MS` (300 ms)
  after it ends, so the reload and the read that its effect starts next are
  one refresh, with one spinner. `nextRefreshSpan` (pure, in
  `changes-format.ts`) remembers whether that refresh began over a list on
  screen; only then is the list dimmed and the hidden polite status set to
  "Refreshing…", so a first read or a new comparison is never announced
  as a refresh. The counts keep their own status, unchanged.
- **Trying it.** In `bun run dev:web` the billing worktree feat/tax-rules
  shows every kind of change, and with Base two files committed on the
  branch. The pretend branch point is always `a1b2c3d`. `timberMock.failFileChanges("Git is busy")`
  makes reads fail (`null` to undo), and `timberMock.setFileChanges(path,
  files)` sets what a worktree lists.

### Setting the base

The Set base dialog (`src/mainview/components/SetBaseDialog.tsx`) runs
`timber base --set <ref> --result-file` and reads the record, so it says
how the command really ended: set, refused, or failed. Timber checks the
base and saves it in the worktree's private Git metadata; it never touches
the branch, the index, or files, and never fetches. Nothing in the app
checks a ref.

- **Entry.** The control beside "Compare with" in the Changes view, for the
  shown worktree. The view shows nothing to compare when the worktree's
  folder is missing, so the control is not offered then.
- **The field.** A `BranchField` over `listBranches`, in the form Timber
  takes (`rebaseBases`: `refs/heads/<name>` for a local branch,
  `<remote>/<branch>` for a remote one), starting as the saved base
  (`initialOnto`). The spaces around the text are left off
  (`baseFromText`), and nothing typed cannot be submitted. Metadata Timber
  cannot use shows Timber's reason as a warning: Timber replaces stale
  metadata and refuses malformed or unreadable metadata, which is Timber's
  call, not the app's. A remote base is checked against the remote without
  fetching, so it needs the network, and Changes can use it only once it
  has been fetched.
- **One source for the command.** `setBaseResultArguments` in
  `src/shared/timber-base.ts` builds `base --set <ref> --result-file <path>
  -- <registered path>`. The footer words it from that function, with
  `<base>` while nothing is typed, and the main process runs the same one.
- **Running and checks.** `setWorktreeBase` on the `Engine` contract.
  `WorktreeCommands.setBase` in `src/bun/worktree-commands.ts` runs in the
  repository's turn, after the same checks as a rebase (a complete request,
  a listed repository, a worktree Timber lists right now with its folder
  there, and a ready Timber), each refusal saying nothing was run.
- **Reading the record.** `readSetBaseResult` checks the `baseChange`
  object strictly: action `set`, a known result that goes with Timber's
  outcome, `previous` and `current` in the shape of a listed base, and on
  `set` a `current` that is assigned. A record that names another worktree,
  or anything else, is a failure that says what the command did is unknown.
  On `set`, `current` is a ref or, for a full commit hash, a commit base,
  which the toast names by its short hash.
- **Outcomes.** A saved base closes the dialog with a toast that names it. A
  refusal stays in the dialog with Timber's reason, keeps what was typed,
  and says nothing changed. A failure stays with Timber's reason and says
  the branch and files were not touched and the list was read again. The
  store's `setWorktreeBase` reads the repository again after every outcome,
  so the workspace header and the row's tooltip show the saved base; after
  a set it also moves the worktree's Changes view to Base and reads its list
  again. So does an answer that was lost or unreadable when the list read
  again shows a new base, since Timber may have saved it. `presentSetBase`
  in `src/mainview/base-change-format.ts` maps each answer, and is tested
  without a window.
- **In the browser.** The mock engine writes the record Timber would
  (`src/mainview/engine/mock-base.ts`), read by the same code. There is no
  ending to choose: a listed branch is saved (a plain name as the one remote
  branch of that name), a full hash as a commit base, and a branch the
  pretend repository does not have, the worktree's own branch, and
  malformed metadata are refused, as Timber does.
- **Tests.** `tests/fixtures/timber-base` holds records from Timber 0.1.4
  (set from none, set over another base, set over stale metadata, set to a
  commit, three refusals, and a remote that could not be reached), mapped by
  `tests/timber-base-parse.test.ts`. With the installed Timber,
  `tests/worktree-set-base.test.ts` saves and changes a base, saves a
  commit base, replaces
  stale metadata, and checks that a refusal leaves the files, the refs, and
  the saved base unchanged. `tests/set-base.test.tsx` covers the control,
  the dialog, the mock, and the store.

## The file viewer

The File tab shows one file of a worktree, such as a plan or a report an
agent wrote. A Markdown file shows rendered too. Any text file can be
edited and saved in a small editor.

- **The capability.** `readWorktreeFile({ repository, worktree, path })` on
  the `Engine` contract. Types and pure checks are in
  `src/shared/worktree-files.ts`, the main process side is
  `src/bun/worktree-files.ts`. It acts only on a worktree Timber lists, in a
  repository in the app's list, whose folder is there
  (`findListedWorktree`). It runs no Git and writes nothing; a test on a
  real repository compares files, refs, worktrees, status, and the index
  bytes before and after every kind of read.
- **Staying inside.** The path must be relative and must not step out
  (`relativePathProblem`). Then the real path of the file, every link
  followed, must be inside the real path of the worktree, so a link to a
  file elsewhere is refused as "outside" without reading it. A link whose
  target is gone is "missing".
- **What is read.** Only a plain file: a folder or a pipe is refused before
  it is opened, and the file is opened without blocking and checked again.
  At most `MAX_FILE_BYTES` (1 MiB) and one more byte are read, whatever size
  the file claimed, so a file still growing is refused too. A NUL byte or
  bytes that are not UTF-8 make it binary. More than `MAX_FILE_LINES`
  (20,000) lines is too large.
- **In the window.** The open file of each worktree is in the store
  (`files`, by worktree identity), never saved. The File tab is listed only
  while its worktree has one (`visibleTabs`); when the selected worktree has
  none, or its worktree leaves the list, the store shows the Workspace tab
  instead (`settleTabs`). The numbers and the text are two blocks side by
  side, not an element per line, so 20,000 lines draw quickly. The latest
  read of each worktree's file wins.
- **Opening a file.** "View file" beside a diff in the diff tab, for a
  file that is on disk, or a file in the file explorer (see
  [the file explorer](#the-file-explorer)). In a terminal, a link provider finds paths in each
  row (`findFilePaths` in `src/mainview/terminal-paths.ts`): a name with an
  extension, with or without folders, relative or absolute, maybe followed
  by `:line` or `:line:column`, never inside a web address. A plain left
  click opens it, since it stays in the app; web links still take Ctrl (Cmd
  on macOS). Over a path, a left click is kept from a program that tracks
  the mouse, such as Claude Code in fullscreen, so it does not act on the
  same click. A relative path is taken from the
  worktree's folder, not the shell's current folder, which the app does
  not know. A path that wraps onto the next row is not found. An absolute
  path outside the worktree is refused in the window, without a read.
- **Saving.** `writeWorktreeFile({ repository, worktree, path, text,
  expected })` on the `Engine` contract goes through the same checks as a
  read (`locate` in `src/bun/worktree-files.ts`): a listed worktree, a path
  and real path inside it, a plain file that is there. It opens that file
  without `O_CREAT`, reads it, and writes only when it still holds
  `expected`, the text the window edited from; otherwise the answer is
  "changed" with what it holds now, and `expected: null` writes over it.
  The write is in place (truncate, then write), not a temporary file and a
  rename, so no other file appears, a link stays a link, and the mode stays.
  A byte order mark the file starts with is kept. Text over the read limits
  is refused, so a saved file can always be opened again. It runs no Git; a
  test on a real repository checks that Git then sees exactly that path
  changed, refs, HEAD, and the index stay, no entry appears beside it, and
  every refusal leaves every file as it was.
- **Edits in the window.** The `FileView` holds `mode`, `draft`, `saving`,
  and `saveProblem`, in the store, so a draft outlives the File tab's
  component. The editor gives back plain new lines (CodeMirror splits lines
  at CR LF, CR, and LF, and joins them with LF), so a file with CR LF is
  edited as `editableText` and saved as `textToSave`, and saving unedited
  text writes the same bytes. `hasUnsavedEdits` decides when to ask: before
  `closeFile`, `readFileAgain`, and `openFile` of another path, which leave
  an `unsaved-file` dialog instead. The store tells the main process how
  many files hold unsaved edits (`reportUnsavedFiles`, the `unsavedFiles`
  message); the quit guard asks while that is above zero as it does while
  sessions run, and Restart now and restarting into an update ask in the
  window.
- **What can be edited.** `canEditFile` in `src/mainview/file-view-format.ts`:
  any file read as text, unless `lineEndingProblem`
  (`src/shared/worktree-files.ts`) finds CR LF mixed with LF, or a lone CR.
  The editor turns both into plain new lines and a save puts back one kind
  for the whole file, so such a file would change on lines nobody touched;
  it shows in the editor read-only, with the reason (`editRefusal`). The
  modes are Rendered, Source, and Edit for Markdown; any other file is
  always in Edit (`initialFileMode`), with no switch, and its draft starts
  with its first change (`changeDraft` makes it while the file can be
  edited). Read again and Discard go back to the mode the file opened in,
  and drop the editor's memory, so a new editor starts from the file. What the file reads as, with plain new lines, is
  worked out once per read (`editableFileText`), since `hasUnsavedEdits`
  runs after every change to the open files.
- **The editor.** `src/mainview/components/TextEditor.tsx`, on CodeMirror 6
  (`@codemirror/state`, `view`, `commands`, `language`, `search`,
  `autocomplete` for closing brackets only, and `language-data`, pinned;
  notices in `licenses/codemirror.txt`). Markdown's Source is the same
  editor, not `editable`: read-only, and it gives the store nothing. A plain text box was
  tried first and could not keep up: in Chrome a keystroke in a box of
  10,000 lines took about 450 ms (3,000 lines: 47 ms), with the rest of
  the window hidden. CodeMirror draws only the lines in view. Only these
  parts are used: line numbers, the active line, the drawn selection,
  special characters shown, history, search, and the default, history,
  and search keys (`editorKeys`), without the keys the window keeps
  (Ctrl+Shift+P, K, and J, in any order of the modifiers; the chop
  shortcuts set in Settings never take a key the editor binds, see
  `RESERVED_SHORTCUTS` in `src/shared/shortcuts.ts`) and without
  going to a line, selecting the next match or every match, block
  comments, and deleting, moving, or copying lines; Ctrl+/ (`toggleComment`)
  stays. `bracketMatching` marks the matching bracket, and `closeBrackets`
  closes brackets and quotes. No completion, language server, linting, or
  other extension.
- **Coloring.** `src/mainview/editor-language.ts`. `pickLanguage` matches
  the file's name and extension against `@codemirror/language-data`, whose
  descriptions import each parser on demand, so opening a file loads only
  its own (Vite splits each into its own chunk). The parser goes into a
  compartment once loaded; one loaded before, as for the last showing,
  goes in at once. A kind it does not know, or a file over
  `MAX_COLORED_LINES` or `MAX_COLORED_CHARACTERS`, stays plain, and the
  status line says why. `codeHighlightStyle` colors each kind of token
  with a `var()` of the theme's terminal palette (`TERMINAL_COLOR_PROPERTIES`
  in `src/shared/theme.ts`, which `themeVariables` now sets beside the
  interface's colors), so a theme change recolors open files with no
  script. The parser reparses incrementally and colors only the lines in
  view; typing in a colored file of 10,000 lines stays under 50 ms per key
  (`tests/text-editor-browser.test.ts`).
  Tab is `indentWithTab`, with CodeMirror's own Escape then Tab to move
  the keyboard on, and `indentUnit` comes from the file (`indentUnitOf`
  in `src/mainview/text-editor-format.ts`). The editor is made once as it
  appears, so typing renders nothing but its status line. The text goes
  to the store's draft (`changeDraft`) at once when the file turns
  unsaved or saved (the text compared with the file as a CodeMirror
  `Text`, and with whether the store's draft holds unsaved edits, since a
  save changes the file without a change in the editor), so the quit
  guard knows, else after 150 ms without typing, and always on
  leaving the editor (as a click on Save or a dialog taking the keyboard
  does), on Ctrl+S (in the text or the search field), and when the
  editor goes, as when another tab shows.
  Saving makes the editor read-only until the answer.
- **Undo and redo.** CodeMirror's history, Ctrl+Z, Ctrl+Shift+Z, and
  Ctrl+Y (Cmd on macOS). The editor's whole state, history and selection
  included, and its scroll are kept for each worktree's open file
  (`FileEditMemory`) in the store's closure, not its state
  (`fileEditMemory`), so typing changes no state. An editor that appears
  takes the kept state while it still holds the draft, with its own
  handlers in place of the last editor's (`StateEffect.reconfigure`,
  which keeps the history). The memory goes on Discard and Read again, and
  with the file when it closes, another opens in its place, or its
  worktree leaves the list.
- **Search.** CodeMirror's search, with the bar drawn by React into its
  panel: the query is the text as typed (`literal`), matching case only
  when asked. Matches are counted up to `MAX_MATCHES`, and the count says
  which one is selected (`describeMatches`). Next and previous are
  CodeMirror's `findNext` and `findPrevious`, around the ends.
- **Rendering Markdown.** `markdownTokens` in
  `src/mainview/markdown-format.ts` uses only the lexer of `marked`
  (GitHub flavored) to turn the text into tokens, and
  `src/mainview/components/MarkdownView.tsx` turns those into React
  elements. No HTML string reaches the page: an HTML token is drawn as its
  text, images are never loaded, and links have no `href`, so the page can
  never follow one itself. `markdownLink` decides what a click does: a web
  page (as `webLink` accepts) goes to `openLink`, a relative path inside the
  worktree goes to `openFile`, a `#` link scrolls to the heading, and
  anything else is not followed.
- **Trying it.** In `bun run dev:web` every worktree has `docs/plan.md`,
  `report.txt`, `src/long.ts` (10,000 lines, for typing in a long file),
  `logo.png` (binary), and a `docs` folder, besides its changed files.
  `timberMock.setWorktreeFile(worktreePath, path, text)` puts a file there, `{ kind: "bytes", bytes: [0] }` a binary one, and `null`
  removes it. Changing a file while it is edited acts out an agent writing
  it, and `timberMock.delayFileSaves(milliseconds)` slows saves down.

## The file explorer

The side panel beside the workspace shows the chops, or the selected
worktree's files or changes, as the person chooses. The files are a tree of the
worktree's folders that opens a file in the File tab, so a file an agent
wrote and never mentioned can be found.

- **The capability.** `listWorktreeFolder({ repository, worktree, folder,
  ignored })` on the `Engine` contract lists one folder, "" for the
  worktree's own. Types and pure rules are in
  `src/shared/worktree-folders.ts`, the main process side is
  `src/bun/worktree-folders.ts`. One folder per request, so a large ignored
  folder such as `node_modules` is read only when it is opened.
- **Staying inside.** As for a file (`locateFolder`): a worktree Timber
  lists, in a repository in the app's list, whose folder is there; a path
  that is relative and does not step out (`folderPathProblem`); and a real
  path, every link followed, that is the worktree's own or inside it. A link
  in a folder is listed as a link and never followed, so the tree cannot
  lead out of the worktree or around in a circle; opening one goes through
  the file viewer's own checks. `.git` is never listed.
- **What Git ignores.** Each entry is marked with `git check-ignore
  --stdin -z`, the paths on standard input (`readGit`'s `input`), so no
  name is taken as an option or a pathspec. A tracked file is never
  ignored, and an entry inside an ignored folder is. Inside a submodule, or
  any folder with its own `.git`, that repository is asked, with paths
  relative to it, since the worktree's Git refuses paths in a submodule. Git runs without
  optional locks and with `core.fsmonitor` off. Ignored entries are left
  out unless asked for. Entries are sorted folders first, then by name as a
  person reads it (`compareEntries`), and at most `MAX_FOLDER_ENTRIES`
  (1,000) are answered, with how many more there are. Listing writes
  nothing; a test on a real repository compares files, refs, worktrees,
  status, and both index files before and after every kind of listing,
  ignored entries shown and hidden.
- **Hearing changes.** `watchWorktreeFolders({ repository, worktree, folders
  })` tells the main process which folders show; null when none do. Each is
  watched alone, never what is below it, at most `MAX_WATCHED_FOLDERS`
  (100), shallowest first, and a change is reported through
  `onWorktreeFolderChanged` once its events settle (`QUIET_MILLISECONDS`),
  or `MOST_MILLISECONDS` after the first while they keep coming, `.git`
  left out. The store reads that folder again. It also reads every
  folder that shows again when the repository changes, since what Git
  ignores may have changed with it, and when the panel shows a worktree
  again after it was hidden or another worktree was selected.
- **In the window.** `fileTree` in the store holds, for each worktree by its
  identity, which folders are open and what each showed when last read, and
  whether ignored entries show (not saved). The pure model is
  `src/mainview/file-tree.ts`: the rows that show (`treeRows`), opening and
  closing a folder (`withFolder`, which forgets what is open below a closed
  one), and where each key goes (`treeKeyAction`). Each read of a folder
  counts, so only the latest answer for it lands, and an answer for a
  folder closed meanwhile is dropped. A folder that went away closes; a
  failure says why and keeps what showed. A tree of a worktree that left
  the list is forgotten.
- **The panel.** `src/mainview/components/FilesPanel.tsx`, with its words
  and shortcut in `src/mainview/files-panel-format.ts`. It is a WAI-ARIA
  tree: the rows are `treeitem`s with their level, place, and whether a
  folder is open, and one row is the tab stop. Down and Up move, Home and
  End go to the ends, Right opens a folder and then moves into it, Left
  closes it and then moves out, and Enter or a click opens a file through
  the store's `openFile`, the path every other way of opening a file takes,
  so unsaved edits are asked about first. The keyboard stays in the tree.
  The open file's row is `aria-current`. Ignored entries are dimmed.
- **Icons.** `iconFor(name, kind, open, appearance)` in
  `src/mainview/file-icons.ts` picks each row's icon from the manifest of
  `material-icon-theme` (pinned to one version, MIT, notice in
  `licenses/material-icon-theme.txt`): a file by its exact name, then by
  its extension, longest first; a folder by its name, with the open icon
  named after the closed one plus `-open`, which a test checks against the
  manifest. Its keys are compared in lower case, keys naming a path are
  skipped, and a light theme takes the manifest's `light` overrides. It is
  pure and imports only the tables it uses, so the bundle does not carry the
  rest of the manifest. The panel follows the theme that shows, saved,
  previewed, or the system's, through `currentAppearance` and
  `onAppearanceChange` in `src/mainview/theme-apply.ts`. The SVGs are never
  inlined: `fileIcons` in `vite.config.ts` serves them from the package on
  the dev server and copies the ones the lookup can give into
  `dist/assets/material-icons/`, which the build already carries into the
  app, so nothing loads from the network and a browser fetches only the
  icons of the rows that show. The lookup takes a bare name, so the File
  tab and the Changes list can use it later.
- **One side panel, three views.** `chopsOpen` and `chopsWidth` in the
  layout are the side panel's, whichever view it shows, and `sidePanel`
  ("chops", "files", or "changes", written only when it is not "chops") is
  the view. A layout saved before the Changes view reads as it was. The
  title bar's Files button and Ctrl+Shift+E (Cmd+Shift+E), and its Changes
  button, Ctrl+Shift+G (Cmd+Shift+G), and "Show changes" in the command
  palette, call `toggleSidePanel` in `src/mainview/components/SidePanel.tsx`,
  as the Chops button and its shortcut do with the chops: the panel shows
  with that view, switches to it, or hides when it shows it already, and
  the keyboard moves as it does for the chops panel. `showSidePanel` in the
  store shows a view and never hides it. The switch in the panel's header
  changes the view and keeps the keyboard on the switch; Changes there
  counts the worktree's review notes. With "Use chops" off, the switch
  offers Files and Changes (`offeredSidePanelViews`, `sidePanelView`); a
  panel left on the chops stays hidden then rather than showing the files
  unasked (`sidePanelShown`). A drawn terminal keeps Ctrl+Shift+E and
  Ctrl+Shift+G from its program only while they show or hide a view
  (`takesFilesPanelKey`, `takesChangesPanelKey`), as for the chops key.
- **Trying it.** In `bun run dev:web` every worktree also has a
  `.gitignore`, a `debug.log`, and `node_modules/left-pad/index.js`, which
  the mock counts as ignored. `timberMock.setWorktreeFile` tells the window
  that the folder changed, as the main process does, when that folder is
  watched.

## Review notes

Notes on lines of a diff in the diff tab, sent to an agent as one
message, kept in the Review section at the foot of the side panel's
Changes view (`ReviewSection`). The rules are pure, in `src/shared/review.ts`; the words and the
choice of agent are in `src/mainview/review-format.ts` and
`src/mainview/agent-sessions.ts` (which running agents can take text,
shared with prompt chops), and the views in
`src/mainview/components/ReviewNotes.tsx` and the agent list it shares with
the Send prompt dialog, `src/mainview/components/AgentChoices.tsx`.

- **A note.** One line, or a run of at most 30 lines of one hunk, of one
  file (`FileChangeTarget`) in one comparison, with the lines as Git
  printed them and the text written. In the Split layout a run is of one
  side's lines only, so a range on the right never takes the removed lines
  between its added ones (`notedLines` with a side). Each noted line keeps
  both its numbers, so a note's reference is the same in either layout. Only lines with a number take a note
  (`notableLine`). The text is kept with `\n` line breaks and no spaces at
  its end, at most 10,000 characters, and like a chop's text holds only
  line breaks, tabs, and visible characters (`isSafeText` in
  `src/shared/safe-text.ts`, shared with chops).
- **Where they live.** `reviews` in the window's store, by worktree
  identity, in the order written. They are never saved, because they quote
  the files: a reload or a quit drops them. A worktree that leaves the list
  takes its notes (`forgetGoneReviews`, beside `forgetGoneForms`).
- **The message** (`buildReviewMessage`). A title with the count, then per
  note, a blank line apart: `path:line` or `path:first-last` with the
  numbers of the file now, or the old numbers for lines that are only
  removed, said so; each line as `> ` and Git's marker; then the note.
  Paths and quoted lines are someone else's text: every control or
  invisible character becomes U+FFFD (`cleanLine`), a Windows line ending
  is dropped, and a line over 300 characters is cut with ` [cut]`. So
  whatever a file holds, the message passes `pasteProblem` and cannot end
  the paste early. The preview shows this string, and the same string is
  pasted.
- **Outdated** (`markOutdated`). When the diff of a noted file is read
  again in the note's comparison, a note whose lines are not all there with
  the same kind, numbers, and text is outdated, and stays so. A file that
  is no longer changed there outdates its notes; a binary or too large
  diff, or a failed read, changes nothing. This runs on every diff the app
  reads, and before the preview for every noted file (`prepareReview`), so
  notes on files not on screen are checked too. An outdated note keeps its
  old lines and is sent with them, marked. Lines are matched by their
  numbers as well as their text, so lines that only moved, such as after
  an edit above them, count as outdated, since the numbers sent would no
  longer be right. A note is tied to its file's area: in Uncommitted, a
  file that is staged after the note (an agent's `git add`) leaves the
  unstaged area, its notes are outdated, and their file is no longer
  listed there to show.
- **Writing one.** The draft keeps the lines as they showed when chosen
  (`chooseNoteLine`) and the text typed so far, so stretching it to a
  range keeps the text and a diff read again meanwhile does not change
  what the note quotes. A draft is not a note: choosing another file or
  worktree drops it. A draft started in Split keeps its side, and
  Shift+click on the other side starts a note there instead of stretching
  across; switching the layout keeps the draft, and its range marks the
  same lines.
- **Pasting** (`pasteTerminal` on the `Engine`). The main process takes
  the text for a running session, only when it passes
  `pasteProblem` (not blank, at most 100,000 characters, no carriage
  return, `isSafeText`), and, for text with a line break, only when the
  program asked for bracketed paste: every session's output passes a paste mode scanner
  (`createPasteModeScanner` in `src/shared/terminal.ts`) beside the status
  scanner, which reads `CSI ? ... h` and `l` with mode 2004 among any
  others, across parts, and turns off on a full reset or when the program
  ends. Then it writes `ESC [200~`, the text with each `\n` as `\r`, and
  `ESC [201~` (`bracketedPaste`), as xterm.js pastes, and nothing after
  it: no Enter. A text of one line goes as typed while the program has
  not asked (`pasteBytes`), as "Insert chop" needs for a plain shell.
  Otherwise nothing is written, and the answer says why (`gone`,
  `not-ready`, `refused`). The store gives a review only to an agent of
  its worktree (`not-agent`). The window's own
  terminal view cannot do this, because a session's view exists only once
  its pane showed.
- **Where it goes.** The dialog picks as for a prompt chop
  (`promptTarget` in `src/mainview/agent-sessions.ts`): the new agent when
  none runs in the worktree, the only one when it does not wait on the
  person and is not still waiting for text of its own, and otherwise
  nothing, so the person picks. The choices are the running agents and a
  new one, the first agent saved in Settings, with its command line
  (`describeAgentCommand`). With none saved, no new one is offered; with
  none saved and none running, Copy review is the only way.
- **Sending** (`sendReview`). The dialog shows the message from
  `prepareReview` and sends that string. Once pasted, the worktree's notes
  are gone, the dialog closes, a toast says to press Enter in the agent,
  and its session shows. Any other answer keeps the notes and the dialog,
  with the reason. Copy review writes the same string to the clipboard and
  keeps the notes.
- **Sending to a new agent** (`startReviewAgent`). The store opens the
  first saved agent with `openTerminal` and `review` set to the message.
  The main process takes the review as a prompt chop's prompt with no
  Enter: the agent starts as usual, with nothing of the review on its
  command line, and the review waits for `isReadyForPrompt` (`src/shared/agent-prompt.ts`), so an
  agent that probed waits while it is `blocked`, such as on "trust this
  folder", and one that never probed waits for bracketed paste and quiet.
  Then it goes as one bracketed paste through the same `deliver` as
  `pasteTerminal`, and nothing after it. The session's `prompt` is
  `{ state: "pending", what: "review" }` meanwhile, which the session's
  state words show as "Waiting to paste the review", then `sent` or
  `not-sent` with the reason (not ready in 120 seconds, or ended first). A
  review request with a shell, setup, an arena attempt, a workflow,
  `resume`, or `restore`, or text `pasteProblem` refuses, starts nothing.
  While it waits, that agent takes no other paste or prompt
  (`PROMPT_STILL_STARTING`), and the store starts no second review agent
  in the worktree (`reviewWaiting`). The store keeps the notes the agent
  was given, by session; once `sent` it drops only those still unchanged,
  so a note added or edited meanwhile stays. `not-sent` keeps the notes,
  with a toast. A change heard before the answer that opened the session
  is settled when the answer comes. A reloaded window has neither the
  notes nor what was given, so only the toast shows then. The limit is
  the prompt chop's: the app never reads what an agent prints, so an agent
  that never probed and shows a first-run screen that takes a paste gets
  the review there. Nothing is sent without Enter, so the person can still
  clear it.
- **Trying it.** In `bun run dev:web`, start Claude Code or Codex in a
  worktree with changes (the mock agent asks for bracketed paste), note
  lines in a diff tab, and Send review: the pretend agent shows the
  text it was given. `timberMock.pastedInto(id)` lists what each session
  was given, and `timberMock.printInto(id, "\x1b[?2004l")` turns its
  bracketed paste off. `timberMock.holdNewAgents(true)` keeps a new agent
  waiting for its review or prompt until `timberMock.agentReady(id)`.
- **Tried with a real agent:** Claude Code only, on Linux, in a bare
  pseudo terminal outside the app (see [verification](verification.md)).
  Codex and the app window are not tried. ConPTY on Windows is not tried:
  whether it passes mode 2004 on and a raw `ESC [200~` through is not
  known.

## Ports of a worktree

The workspace header says which `localhost` ports belong to the selected
worktree, so people open the right one and see when two worktrees want the
same port. It only reads.

- **The capability.** `readPorts({ repository, worktree })` on the `Engine`
  contract. The types and pure parsers are in `src/shared/ports.ts`, the
  main process side is `src/bun/ports.ts`, and the process table is read
  in `src/bun/session-ports.ts`. It acts only on a worktree that `git
  worktree list --porcelain -z` lists for a repository in the app's list,
  whose folder is there (`src/bun/worktree-paths.ts`). Timber is not asked:
  a read comes with every reload of the repository, and `timber ls` reads
  the status of every worktree (issue 138).
- **Docker.** `docker ps --all --no-trunc --filter
  label=com.docker.compose.project.working_dir --format {{.ID}}`, then
  `docker inspect` of those ids with a format that prints only the name,
  state, working directory and service labels, published ports, and wanted
  port bindings (`DOCKER_INSPECT_FORMAT`). Never the whole record, which
  holds each container's environment. Both run as an executable plus
  arguments, are stopped after 5 seconds, and only ids Docker printed reach
  the arguments. A container belongs to the deepest worktree of the
  repository whose registered or canonical path holds its Compose working
  directory, on a whole path segment, so `GH-16` never takes `GH-169`'s
  containers and a worktree inside the primary checkout keeps its own. The
  list shows the ports a running container publishes, IPv4 and IPv6 as one;
  a port the container only exposes is left out.
- **Docker that cannot be read.** No `docker` on the PATH, or one that
  cannot start, is "not installed". Docker 29's "Cannot connect to the
  Docker daemon", "failed to connect to the docker API ... is the daemon
  running", connection refused, and a missing socket are "not running".
  "permission denied" is no permission. Anything else is "could not list".
  Each is a sentence with Docker's own first line after it, shown in the
  header item's tooltip, and sessions are still read.
- **Sessions.** On Linux, from `/proc`: the processes whose session id is a
  running session's shell (`TerminalSessions.leaders`), the sockets their
  descriptors name, and which of those listen in `/proc/net/tcp` and
  `tcp6`. Only TCP listeners count. Elsewhere, or where `/proc` cannot be
  read, the sessions part is unknown with a quiet reason, never empty.
- **Clashes.** Every Compose container on the machine claims the host ports
  it publishes and the ones its bindings ask for, running or not, so a
  project that could not start because another holds its port counts. Every
  running session claims what it listens on. A host port claimed from more
  than one folder is a clash; the interface maps each folder to the deepest
  worktree it knows (`portClashMarks`) and drops a clash that falls in one
  worktree. Both worktrees are marked, each with the other's name; a folder
  in no known worktree is named by its last segment.
- **How often.** There is no timer. The interface asks when a worktree is
  selected, whenever its repository reloads (Refresh, a reported change, the
  window coming back), and when the list opens. The main process reads
  nothing while the window is hidden (`attend`), answers `hidden`, and reads
  the same worktree at most once in 5 seconds (`PORTS_GAP_MILLISECONDS`):
  sooner requests get the last answer, and requests while a read runs share
  it. One read is `git worktree list`, two Docker calls, and one walk of
  `/proc`. On a Linux machine with 13 Compose containers and five
  worktrees, 25 reads took 33 ms each at the median and 38 ms at most.
- **In the store.** `ports` holds the last answer of each worktree read,
  by its path; `portClashes` the clashes of the latest read, which mark
  rows. A hidden answer changes nothing.
- **Trying it.** In `bun run dev:web`, timber's `feat/github-issue-lookup`
  shows six Docker ports and a session's port, and its database port
  clashes with `spike/new-idea`. `timberMock.setDocker("stopped")` (or
  `"no-docker"`, `"denied"`) makes Docker unreadable,
  `timberMock.setDocker([...])` sets the containers, and
  `timberMock.setSessionPorts(path, [{ name, hostPort }])` sets a worktree's
  session ports.

## Terminal sessions

A worktree can have any number of terminal sessions: each is the person's
shell, running in its folder, drawn in the Workspace tab under a chip of its
own. Every session keeps running while another one, or another worktree,
shows, and coming back shows it as it was. The terminal and agent sessions
that run when the app quits open again when it starts.

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
  `terminal` for the shell, or `agent` for a coding agent, from Settings or
  from a workflow, which starts the agent's command instead of the shell
  (see [agent sessions](#agent-sessions)).
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
  a later change of branch or of the setting renames nothing. A setup
  session is always "Setup", and does not read it. The
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
  `renameTerminal`, `writeTerminal`, `pasteTerminal` (see
  [review notes](#review-notes)), `runChop` (see [chops](#chops)), `resizeTerminal`, `drawnTerminal`,
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
  Ctrl+Shift+S (Cmd+Shift+S) puts the focus on the chips. Ctrl+Shift+J
  (Cmd+Shift+J) shows the next session that needs you or is done, in any
  worktree (see
  [the shell](#the-shell-and-the-saved-layout)). Which chip shows
  in each worktree, and which sessions printed unseen, are the interface's
  own (`shownSessions` and `unseenSessions` in
  `src/mainview/store/state.ts`): after the window reloads, each worktree
  shows its first session and nothing is marked. A session counts as seen
  whenever it is on screen: its chip shows in the selected worktree while
  the Workspace tab shows. A program that keeps redrawing, such as a
  spinner, keeps its chip marked. Which Done, Error, and crash statuses the
  person has seen is the interface's own too (`seenStatuses`, kept by
  `withSeenStatuses` in `src/mainview/seen-status.ts` from `update()`, and
  again when the window's focus or visibility changes): the session on
  screen in a window that shows and has the focus is seen in the state it
  shows, and the mark is forgotten once the session leaves that state, so a
  new state starts unseen. Needs you is never seen. This is per session,
  stricter than the desktop notification's per-worktree rule: a Done on a
  chip that never showed stays bright. Seen does not survive a reload, and
  the Engine has no part in it.
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
- **Dropped files.** `watchPathDrops` in `src/mainview/path-drop.ts` takes
  every drag in the window that carries files (`Files` or `text/uri-list`)
  or Files panel rows (`application/x-timber-paths`, a JSON list of
  absolute paths), and leaves text drags alone. Over a running session's
  terminal (`data-drop-session`) it accepts the drop and outlines it; a drop
  there pastes `pathsPasteText(droppedPaths(...))` through xterm's `paste`,
  so it is bracketed. Anywhere else the drop is taken and does nothing, so
  neither the webview nor the editor opens the file. The pure parts are in
  `src/mainview/terminal-drop.ts`: the app's own list first, then the URI
  list, then the `file:` URIs in `text/html`. WebKitGTK gives a page an
  empty `text/uri-list` for a drop from a file manager and writes one URI,
  one of the items, as a link's text in `text/html`, so on Linux
  a drop of several files brings one path (seen with WebKitGTK through
  Electrobun 2.0.6). Such a drop can also make the webview open a file
  whatever the page does, so the window is made with the navigation rule
  `^file://*` (`src/bun/index.ts`), which keeps it on the app. Quoting is
  for POSIX shells: plain paths as they are, anything else in single quotes.
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
- **An agent that ends.** When an agent session's process ends by itself, its
  chip does not go dead. In the same step, with no wait between them,
  the session swaps to the person's shell (`shellOf()`) in the worktree's
  folder, started with the session's own environment and last pane size. It
  keeps its id and name. What the agent printed stays in the scrollback,
  followed by a reset of the terminal modes the agent may have left on and a
  one-line note. The session becomes a terminal: one change tells the window
  its kind is now terminal, with the agent's name, program, conversation,
  command, and exit in `endedAgent` (kept for Resume, #284). What the agent
  left running is hung up on as above, and closing the session still ends it,
  through the agent's recorded leftovers. A prompt that was waiting is
  dropped as not sent, and its Enter never reaches the shell. A shell that
  exits later stays exited, with no second shell. Sessions closed from the
  app, killed on quit, or ended by removing the worktree end as before. A
  Timber setup session and a terminal never fall back. Workflow agents and
  arena attempts do. If the shell cannot start, the session ends as an
  agent's did before.
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
  in front, but not what ignores a hang-up. Before any session ends, which
  sessions run is saved, synchronously (see "After a restart" below). The
  question says so: "A session is still running. Quitting stops it and
  everything running in it. It opens again when Timber does, and an agent
  goes back to its conversation."
- **After a restart.** Every worktree gets back the terminal and agent
  sessions it had running when the app quit, in the same order, with the
  same chip showing and the same worktree selected, and each agent goes back
  into its own conversation (see
  [going back to a conversation](#going-back-to-a-conversation)).
  - *When it is saved.* Once, at quit, through the quit guard, so also when
    the app restarts itself and when it is uninstalled without its
    settings: right after the person agreed, or when the window could not
    ask, and before any session ends; with nothing running, as the app
    quits (`guardQuit` in `src/bun/index.ts`). Never while the app runs: no
    timer and no write on a change. A crash, SIGKILL, or a power cut loses
    what changed since the last clean quit, and the older save opens
    instead. The conversations themselves are the agents' own and are kept
    by them.
  - *What is saved.* `sessions.json` beside `settings.json`, written to a
    temporary file, flushed, and renamed over the old one, all
    synchronously (`src/bun/session-layout.ts`, the shape in
    `src/shared/saved-sessions.ts`). Per worktree, by its id
    (`Worktree.id`, which holds the common Git directory and the folder):
    the kinds of its running sessions in chip order, a name only when the
    person renamed the chip, an agent's name in Settings and the id of its
    own conversation when one is known, and the index of the chip that
    showed. Then the id of the selected worktree. A closed session is left
    out, so it stays closed; saved sessions that did not open again in this
    run are kept (see *What is carried* below). An example:

    ```json
    {
    	"version": 1,
    	"selected": "/work/timber/.git\u0000verified\u0000/work/timber-worktrees/feat-login",
    	"worktrees": {
    		"/work/timber/.git\u0000verified\u0000/work/timber-worktrees/feat-login": {
    			"shown": 1,
    			"sessions": [
    				{"kind":"terminal"},
    				{"kind":"agent","agent":"Claude Code","conversation":"0b6f1c1e-7a52-4f0e-9d53-2f1f6f0c7a11"},
    				{"kind":"agent","agent":"Codex","conversation":"01a17995-a303-7160-8d6d-d7587e0d5d50","name":"review"}
    			]
    		}
    	}
    }
    ```

    Left out, because the app works them out again at launch or they are
    not wanted: session ids (new each launch), folders, repository paths,
    shells, commands (always built again from Settings), states, exit
    codes, times, default names (made again by the naming Settings choose),
    and anything a session printed. Only running sessions of kind
    `terminal` and `agent` are saved; a Timber session such as setup, an
    arena attempt or a workflow's own agent (their commands come from
    Timber, not Settings), and a session whose process had ended, are not.
    A workflow that started an agent picked in Settings saves that agent.
  - *The shown chip and the selected worktree.* The window's `attend`
    message names the selected worktree's id and the session whose chip
    shows there once one was chosen there (`Attention` in
    `src/shared/attention.ts`). Chips are switched only in the selected
    worktree, so the main process keeps the shown chip of every worktree
    from these reports, with no request at quit, which also works when the
    window no longer answers. A worktree the window never reported in this
    run keeps the chip that showed before, through the restore tags below.
  - *How it opens again.* The file is read once at launch. The window takes
    it once (`takeSavedSessions`, null after that, so a reloaded window
    opens nothing twice), after its first list of repositories was read and
    its first list of sessions came in (`restoreOnce` in
    `src/mainview/store/store.ts`, the order in
    `src/mainview/store/restore.ts`). The saved selected worktree is
    selected and goes first, then the others in list order, three
    worktrees at a time, the sessions of one worktree one after another so
    chips keep their order. Each opens through the ordinary
    `openTerminal`, where every check is made, with `resume` for an
    agent's conversation, `name` for a renamed chip, and `restore`, the
    saved worktree id and index it opens again. A shell is a fresh
    one in the worktree's folder. When a worktree's sessions are open, its
    saved chip shows, or the nearest one before it that opened, unless the
    person chose a chip there meanwhile. Session ids are new. A restored
    session does not light the new-output dot for its first three seconds,
    or every worktree would show unread output after each launch. Nothing
    waits for the restore: the window is usable while the sessions start.
  - *What is skipped.* A saved worktree that Timber no longer lists, whose
    folder is gone, or whose repository was removed or is unavailable, is
    skipped without a word. An agent that Settings no longer has does not
    open: one toast, "Could not open a session from the last time again"
    (with a count for more), and, in the selected worktree, the pane says
    why, as for any session that did not start.
  - *What is carried.* The main process keeps, in memory, what came of each
    saved session in this run, from the `restore` tag and the outcome of
    its `openTerminal` (`SavedCarry` in `src/shared/saved-sessions.ts`).
    At quit every saved session is either running again, or carried to the
    next save in its saved order among the others: one the window had not
    reached by quit or by a reload, one in a repository that was
    unavailable or a worktree whose folder was missing, and one that failed
    to start (its agent not on the PATH that day), which counts a miss and
    is dropped after three launches in a row, so nothing fails at every
    launch. A saved session is dropped when it opened again (from then on
    its running session counts, and closing it closes it), when its agent
    left Settings, or when the window found its worktree gone
    (`forgetSavedSessions`, `goneSavedWorktrees` in
    `src/mainview/store/restore.ts`): not listed in a repository that was
    read well with every worktree's folder there, or, with every repository
    read well, in none of them. A missing folder changes a worktree's id
    (`worktreeId`), so while one is missing nothing of that repository is
    forgotten. Nothing is written until quit.
  - *Versions.* The file has `version: 1`. One that cannot be read is moved
    to `sessions.json.damaged`, with a warning in the log, and nothing
    opens. One of a later version is left as it is, nothing opens, and
    nothing is saved in that run, so the newer app finds it again. Inside a
    good file nothing is fatal: what cannot be trusted is dropped piece by
    piece, a conversation id is kept only as a UUID, names are cleaned as a
    rename is, and at most 200 worktrees of 50 sessions are read. A file
    over 4 MiB is not read at all and is treated as damaged. Worktree ids
    are keys of an object with no prototype, so an id such as `__proto__`
    is only a key. A save never holds more than is read: at most 50
    sessions of a worktree and 200 worktrees, those with running sessions
    first.
  - *Cost.* The save is one small write: 200 worktrees of 5 sessions are
    under 100 KB and under 10 ms in the tests, after a Codex search that
    may take 300 ms in all (see below), so a quit waits under half a
    second. The existing two second close wait is unchanged.
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
  what a session printed after a restart, keeping sessions running while
  the app is closed, and starting a terminal editor in a session.

In `bun run dev:web` the mock engine acts out a shell that echoes what is
typed and knows `pwd`, `clear`, `exit`, and `sample`, which prints a box,
the colors, and wide characters for looking at how a terminal draws. `timberMock.requestQuit()` acts
out quitting, `timberMock.endTerminal(id, code)` a shell that exits by
itself, and `timberMock.failTerminals({ outcome: "unsupported", message })`
a terminal that cannot start (`null` to undo). The open sessions are saved
to the browser's localStorage (`timber-app.mock.sessions`) as quitting saves
them, when the page goes away and on `timberMock.saveSessionsNow()`, so a
reload opens them again; `timberMock.missingConversations([id])` acts out a
conversation that is gone.

## Rebasing a worktree

The Rebase dialog runs `timber rebase --result-file` and reads the record,
so it says how the rebase really ended: rebased, already up to date, stopped
on conflicts, refused, or failed. Every Timber the app accepts as ready
(`REQUIRED_TIMBER_VERSION` in `src/shared/timber-version.ts`) writes this
record, so there is no other way to rebase. Like every dialog, it shows only
while Timber is ready (`Dialogs`); until then the window shows the Timber
notice instead.

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
  assigned or as a commit is filled in, a commit by its full hash, since
  Timber refuses an abbreviated one; the line names it as `a1b2c3d`. A
  worktree with no saved base says "No saved base",
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
  record's `base` is a canonical ref or a commit's full hash, and the dialog
  says it as a person does (`shortBase`: `origin/main`, `main`,
  `a1b2c3d`).
- **Outcomes.** Rebased and up to date close the dialog with a toast that
  names the base. A refusal stays in the dialog with Timber's diagnostic and
  says nothing was changed. A failure stays with Timber's diagnostic and
  says the list was read again and the branch should be checked before
  trying again: a failed rebase can leave the branch changed, so it never
  says that nothing changed. A request the app refused before running
  anything says so.
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
- **In the browser.** The mock engine acts out Timber and writes the record
  Timber would, which is read by the same code. `timberMock.endRebaseResults`
  chooses the ending (see [reporting outcomes](#reporting-outcomes)).
- **Tests.** `tests/fixtures/timber-rebase` holds result files recorded from
  Timber 0.1.2 for each outcome (rebased, up to date, conflicts with a file
  name that has a space, refused, and two failures), and
  `tests/timber-rebase-parse.test.ts` maps each one. With the installed
  Timber, `tests/worktree-rebase.test.ts` checks that a conflict leaves Git's
  paused rebase in place and that a refusal changes nothing.

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
  editor: quotes group words, nothing is expanded. Nothing is added to it
  but the arguments that pick its conversation (see
  [going back to a conversation](#going-back-to-a-conversation)), and it
  starts in the worktree's folder. The executable is looked for on
  the PATH the app was started with, or is a full path; a relative path is
  refused (`findExecutable` in `src/bun/find-executable.ts`, shared with
  "Open in editor"). An app started from a desktop launcher can have a
  shorter PATH than a terminal, so an agent that a terminal finds may need
  its full path here.
- **Starting.** `openTerminal` with `agent` set to the agent's name. The main
  process takes the command from the saved preferences only, never from the
  request. A name that is not saved starts nothing, not even a shell. Or
  `openTerminal` with `workflowAgent: { workflow }`, for the agent a named
  workflow sets: the main process reads the workflow again from Timber and
  starts its executable and arguments as Timber reports them, never split
  again, found on the PATH as above. The session is named after the
  workflow (`review`, or `review: GH-54` under the issue naming). A
  workflow that is gone, cannot be read, or sets no agent now starts
  nothing. Nothing about it is logged, as its arguments can hold tokens.
  The session's `shell` is the executable as found and `command` the whole line,
  shown in the tooltip of the shell's name beside the chips. The "+" menu, the buttons of a
  worktree with no session, and the Agent field of the New worktree dialog
  start an agent, all through `openTerminal`. Timber's `new` and `open`
  never do: they always run with `--no-agent` (see
  [creating and opening worktrees](#creating-and-opening-worktrees)). A
  `timber new` typed in one of the app's terminals hands its worktree to the
  app, which starts the agent the same way (see
  [`timber new` in a terminal](#timber-new-in-a-terminal)).
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

### `timber new` in a terminal

`timber new` typed in one of the app's terminals opens the new worktree's
session in the app, as the New worktree dialog does, instead of running
Timber's agent in the terminal it was typed in. Timber and the app share a
small contract for it (Timber's `docs/ide-contract.md`, "Handing off from app
terminals"); the app's side is `src/bun/handoffs.ts`,
`src/shared/handoff.ts`, and `takeHandoff` in the store.

- **The folder.** At start the main process makes a private folder
  (`mkdtemp`, mode 0700) under `XDG_RUNTIME_DIR`, or the temporary folder,
  watches it, and removes it on quit. Every terminal session gets its path
  as `TIMBER_APP_HANDOFF` (`sessionEnvironment` in `src/bun/terminals.ts`),
  waited for, so a session opened while the app starts gets it too. The
  Timber commands the app runs itself with `--result-file` use the app's own
  environment, without it, and a value the app inherited is dropped. A setup
  session (`timber open --setup` of an existing worktree) has it, and never
  hands off, since it creates nothing.
- **Timber's side.** In an interactive terminal with that variable, a
  `timber new` (or `timber open`) that creates a worktree runs setup and the
  editor in that terminal as before, then writes one JSON record to the
  folder in place of starting its agent, and ends. The record names the
  repository, the worktree, and whether Timber would have started its agent.
  It never carries the agent's command. A worktree that already existed, a
  run without a terminal or with `--result-file`, and Timber's Orca
  integration behave as before.
- **Reading.** Each finished record (`*.json`, a regular file of 16 KiB at
  most) is read once and deleted. Dot-files are still being written. Links
  and records that do not parse are deleted unread; folders are left alone.
  At most 4 records are passed on in 5 seconds; the rest are deleted, with a
  warning in the app's log.
- **Opening.** The window reads the repository again, then looks for the
  worktree in the list. Found: it selects it, shows the Workspace tab, and
  starts the first saved agent there when Timber wanted its agent, or a
  shell, which takes the keyboard (`startSessionsIn`, `openTerminalIn`).
  Timber says whether an agent starts, the app says which; Timber's own
  agent setting may name another. With no saved agent a shell opens and a
  toast points to Settings, Agents. A worktree that is not in the list, such
  as one in a repository the app does not show, opens nothing; the toast
  gives `timber open --agent --no-editor -- '<path>'`. The terminal it was
  typed in keeps running, untouched.
- **Safety.** A record is a request only. Another program of the same user
  could write one, and at most it selects a listed worktree and starts a
  shell or a saved agent. Nothing named in a record is run.
- **Older Timber.** A Timber without the handoff ignores the variable, so
  `timber new` runs its agent in the terminal as before, and the worktree
  only shows in the sidebar. Terminals outside the app have no variable and
  behave as before.

In `bun run dev:web`, `timberMock.typeTimberNew("/work/timber", "feat/x", true)`
acts out `timber new feat/x` typed in a terminal with Timber's agent on.

### Going back to a conversation

After a restart an agent session goes back into the conversation it was in,
which the agent itself keeps (see "After a restart" under
[terminal sessions](#terminal-sessions)). The arguments are added when the
agent starts and never stored in Settings (`src/shared/agent-resume.ts`).
Verified on Linux on 2026-11-20:

| Agent | Fresh start | Going back | Source |
|---|---|---|---|
| Claude Code 2.1.329, 2.1.330 | `claude --session-id <uuid> <args>`, with a UUID the app makes | `claude --resume <uuid> <args>` | `claude --help`: "`--session-id <uuid>` Use a specific session ID for the conversation (must be a valid UUID)"; "`-r, --resume [value]` Resume a conversation by session ID or name" |
| Codex CLI 0.170.0, 0.171.0 | `codex <args>`; no flag sets or prints the id | `codex resume <uuid> <args>` | `codex resume --help`: "Usage: codex resume [OPTIONS] [SESSION_ID] [PROMPT]", with the same options as `codex --help` |

What the app adds goes first, before the arguments from Settings, so no
option that takes several values (Codex's `-i, --image <FILE>...`) and no
`--` can take it for one of theirs.

- **Which agents.** By the executable's last path part as typed in
  Settings: `claude` or `codex` (`.exe` cut, in any case, on Windows).
  Anything else, a wrapper script included, starts exactly as typed and
  fresh after a restart. So when an agent's command now runs another
  program, it gets no resume flag, and one agent never gets another's id.
- **A command that already picks a conversation, or runs without one,** is
  started exactly as typed, fresh, with no id saved: for Claude Code
  `--session-id`, `--resume`, `-r`, `--continue`, `-c`, `--from-pr`,
  `--teleport`, `--print`, `-p`, `--fork-session`, `--cloud`, `--bg`,
  `--background`, `--help`, `-h`, `--version`, `-v`, also as `--resume=<id>`
  and inside a group of short options such as `-cp`; for Codex `resume`,
  `fork`, `exec`, `e`, `review`, `--help`, `-h`, `--version`, `-V`. So is a
  command with `--`, or whose first argument is not an option, which names
  a subcommand (`claude mcp list`) or a prompt (`codex "fix the bug"`).
  Words are matched whole.
- **Where the conversations are.** Claude Code keeps each as
  `<config>/projects/<folder>/<uuid>.jsonl`, `<config>` being
  `$CLAUDE_CONFIG_DIR` or `~/.claude`. Codex keeps each as
  `<home>/sessions/YYYY/MM/DD/rollout-<local time>-<uuid>.jsonl`, `<home>`
  being `$CODEX_HOME` or `~/.codex`, with a first line of type
  `session_meta` that names its id, folder (`cwd`), start time, and
  `source` (`src/bun/agent-conversations.ts`). The app only looks: it
  never writes there, and of a conversation it reads nothing but the first
  line of a Codex session file.
- **The check before going back.** The id comes back from the window only
  as a UUID and only follows a word the main process adds itself. It is
  used only when the conversation's file is found in that agent's own
  folder, because both agents refuse an id they do not know: Claude Code
  prints "No conversation found with session ID" and exits, Codex "No
  saved session found with ID". Otherwise the agent starts fresh, and a
  dim line at the top of its terminal says "The saved conversation was not
  found, so <agent> started fresh." A Claude id is never found under
  Codex's sessions, and the reverse. Claude Code refuses `--session-id`
  together with `--resume`, so the two are never combined.
- **Claude Code** gets `--session-id` with a new UUID on every fresh start,
  so its id is exact from the first moment. It shows in the command beside
  the chips. At quit the id is saved only when Claude Code wrote that
  conversation, so a session that never got a message starts fresh after a
  restart, without a note that it was not found.
- **Codex** has no such flag, so its id is read at quit from its own files:
  the newest session file whose first line has the worktree's folder as
  `cwd`, `source` `"cli"`, no `parent_thread_id`, and a start at or after
  the session's own start, less two seconds. The newest wins, so a `/new`
  inside Codex is followed. Only day folders from the day before the
  session started on are opened, at most 1 MiB of a first line is read,
  newest file first, and the search of all worktrees together stops after
  300 ms with what it has, after the Claude Code checks. It is made only
  for a worktree with exactly one running Codex session, and none of the
  app's other Codex sessions there ended after that one started, less the
  two seconds. Every session whose executable is `codex` counts, also one
  started as typed, from a workflow, or for an arena attempt: otherwise nothing
  tells their conversations apart (open A, open B, close B, quit would
  give A the conversation of B), so it keeps the id it was opened with, or
  starts fresh. When the last Codex session of each worktree ended is kept
  in memory (`endedCodex` in `src/bun/terminals.ts`). An id is never
  given to two sessions. What was seen on this machine: an interactive
  Codex has `source` `"cli"`; `codex exec` runs have `"exec"`, the editor
  extension `"vscode"`, and a subagent an object with a parent, so none of
  those is taken for the terminal's session. A Codex session file with
  only its first line, from a Codex that was never spoken to, shows that
  the file is written when Codex starts.
- **A custom agent** starts as typed and fresh, and says so when a
  conversation was asked for.
- **Known limits.** After `/clear`, Claude Code comes back in the
  conversation from before it: following it would need Claude Code hooks
  in the person's own config. Two Codex sessions in one worktree, running
  together or one after the other, are not told apart. A prompt typed in
  Settings after options (`codex -m o3 "fix it"`) is sent again when the
  agent goes back. A subcommand after an option (`claude --model opus mcp
  list`) is not told from a prompt, so it gets the app's words. A Codex
  started by hand in the same folder after the app's
  Codex session started can be taken for it. When an agent changes where
  or how it keeps conversations, nothing is found and it starts fresh,
  never with an error.

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
  (state, kind, progress, app, title, and decoded message), and the child
  records as `TerminalSession.children`, ordered by path so a record comes
  right before its descendants, each with its `id` and its message already
  cut to 200 characters (`recordsForWindow` in
  `src/shared/session-status.ts`). A change carries every child, so with
  255 children of the longest titles and ids it is about 300 KB, and about
  85 KB with plain short ones; Claude Code sends at most 32. Both go through `onTerminalChanged` in one change, at most
  once per 4 ms output part, so a stream of progress from many children
  does not flood the window. A record is compared with what it was, so a
  report repeating itself is no change and sends nothing. The exit is told
  in the same change as the status it leaves. No `Engine` or `rpc.ts`
  change was needed: the field rides on `TerminalSession`.
- **Tasks (child records).** A child record is a subagent's or a background
  task's, and the protocol does not say which, so the app calls them all
  tasks. Read from the strings of the installed executables: Claude Code
  2.1.330 reports its background tasks this way: one
  flat `id` per task (the task id with other characters made `-`, at most
  32 of them), its description as `title`, an agent task's own state, any
  other background task (a shell, a monitor) as `working`, and `clear` for
  a task that went away. Codex 0.169 reports only the root.
  - *Counted.* A task runs while it is Working or Needs you and its session
    runs (`runningChildren`). The count and the descriptions take in the
    running ones and those that reported an error (`notableChildren`), so a
    task in Error shows on the row as well as in a collapsed header. Done
    and Idle tasks are only listed, and an exited session shows none of its
    tasks.
  - *Lifetime.* As for the root: `working`, `blocked`, and `idle` tasks end
    with the process or a new prompt, `clear` on a path removes it and its
    descendants, and `done` and `error` stay until then. A Done task does
    not fade on a timer; Claude Code clears its own.
  - *Count.* A session with running tasks gets a small count beside its
    mark, on its sidebar row and its chip (`ChildBadge` in
    `src/mainview/components/ChildTasks.tsx`): the shape and color of the
    most urgent counted task's state, and how many are counted, so a task
    that needs you shows its diamond. A shell whose program reports only
    tasks gets a mark while any is counted (`hasStatusMark`). The descriptions say it
    in words, such as "Claude Code: Working. 3 tasks: 1 needs you, 2
    working"; the command palette gets the same words and keeps its marks
    without the count.
  - *Still working.* A root that says Done or Idle while tasks run reads
    "Done, tasks still running" beside the chips and in the descriptions.
    The words beside the chips are a live region, so they hold no count
    and are not spoken again at every change of the tasks.
  - *List.* Beside the shown session's state, a button such as "4 tasks"
    opens a list of its tasks over the terminal (`ChildTasks`): nested
    lists by path, each task under the nearest record above it on its path
    (with none, at the top, named by its whole path), with its state shape,
    title or path, state and progress in words, and message, all as text.
    At most 50 are listed, those that need you or reported an error first
    (with the records they sit under), then how many more. The list takes
    the keyboard when it opens, so a long one scrolls by keys; Escape, the
    button again, or a click elsewhere puts it away. A list rather than a hover on the chip,
    since the chip is a tab and a hover cannot be reached by keyboard.
  - *Header, waiting list, and notifications.* All three use one status
    per session (`alertStatus`): an exited session's exit; else a root
    that needs you; else the first task, by path, that needs you; else a
    root that is done or reported an error; else the first task that
    reported an error; else the root. So a collapsed repository header
    counts a working agent with a task that needs you under "needs you"
    (the summary stays one count per session, with no count of tasks), the
    session joins the waiting list (Ctrl+Shift+J), and a notification says
    so, such as "Claude Code: task Run the tests needs you", under the same
    settings, rate limit, and one notification per session. Tasks never
    make a session Working, so a background server cannot hold back a
    Done, and a task moving to Done never notifies. A second task that
    needs you while the first still does is not told again, whatever its
    path, as for the root; another task taking over after the first stopped
    needing you is. A task already told about is not told again while it
    stays in that state, so a task left in Error, or still waiting, is not
    told each time the root moves away and back.
    A task error after the root said Done is not told, so a stale error
    cannot swallow every later Done.
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
  on that row; its name and state are the tooltip. Past three marks, the row
  shows the two most urgent, in the order they started, and "+4" for the
  rest, whose names and states are its tooltip; the row's description for
  assistive technology names every one (`describeRowSessions` in
  `src/mainview/terminal-format.ts`). The row's lines wrap, so nothing in it
  reaches past the sidebar at its narrowest width. Claude Code and Codex,
  known by an agent session's executable (`claude`, `codex`) or a reported
  `app` starting with either name (`agentBrand` in
  `src/shared/session-status.ts`), show their makers' official marks instead
  of letters (`AgentIcon.tsx`): Claude's spark in its own orange, and
  OpenAI's mark in the text color. On its chip, the same mark in a quiet
  outline takes the place of the agent star, and the same shape, with the decoded
  message in the chip's tooltip and its state in words beside the chips. A
  collapsed repository header sums up its agents' unseen states, such as
  "1 needs you, 2 working", the most urgent first; an expanded one shows
  nothing extra. A Done, Error, or crash the person has seen (see
  `seenStatuses` under [the shell](#the-shell-and-the-saved-layout)) keeps
  its shape in the theme's quietest text color (`seen` on the glyph and the
  row mark, whose outline turns dashed), and its words say "seen".
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
    default), and `sounds` the sound each state plays: one that comes with
    the app, the system's, a file of the person's own, or none (none for
    every state by default; `src/shared/sound-setting.ts`). A change from
    the window names all four states, so it cannot silence one by leaving
    it out. A settings file from before each state had its own sound, with
    `soundStates` and one `sound`, is carried over as it played: each
    ticked state plays that sound, the chime when it could not be read,
    and the rest none; a sound with no state ticked is not kept. The old
    parts stay in the file until the next save, which does not write them
    again, so the carry-over is one way: an older build then reads no
    sound, and drops `sounds` on its own next save. A saved state whose
    sound cannot be read plays the chime.
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
    hidden (`carryAlert` in `src/bun/alert-actions.ts` plays the sound chosen
    for the state, through `src/bun/sounds.ts`): `pw-play`, `paplay`, or `aplay` (WAV only)
    on Linux, `afplay` on macOS, and PowerShell's `SoundPlayer` (WAV only,
    the path in an environment variable) on Windows, each as an executable
    plus arguments. A Linux player that fails at once, such as `pw-play`
    where the sound server is PulseAudio, gives way to the next one found.
    One sound plays at a time, whatever state asked for it: one asked for
    while another plays is lost, not held, so a Needs you sound can be lost
    behind another session's Done sound, and Settings' Play on a second row
    while the first plays says another sound is still playing. A sound still playing after 4 seconds is stopped, so a long
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
- **Not built.** Hooks for agents that do not send OSC 7501, which can
  also carry the prompt and the agent's reply.

In `bun run dev:web`, `timberMock.agentStatus(id, "state=blocked:kind=permission:msg=YXBwcm92ZQ==")`
acts out a report from the program in a session (`"?"` for the probe), read
by the same scanner as in the main process. `timberMock.notices()` lists the
desktop notifications the main process would have on screen,
`timberMock.alertSounds()` the sounds played, each with its session, and
`timberMock.clickNotice(id)` acts out a click on one. Typing `subagents` in
a session acts out four tasks, one of them with a task that needs you under
it (Claude Code's own ids are flat; the nested one shows the tree), and
`subagents clear` clears every record.

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
  It shows the app's version and the Timber in use, with where it came
  from (bundled with the app, chosen in Settings, found on PATH, or the
  development override) and its path, or says that Timber is missing, too
  old, or could not be looked for (`src/mainview/about-format.ts`). It also
  names the licenses below, Timber's among them: its `LICENSE` and
  `THIRD_PARTY_NOTICES.txt` ship in the app's `timber` folder.
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
  node-pty and of the ConPTY it ships (Windows only), of CodeMirror and
  the packages it uses, of Material Icon Theme, whose icons the Files
  panel shows, and the notice for
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
  (`removeSettings` in `src/bun/settings.ts`). The sessions saved for the
  next launch (`sessions.json`, see "After a restart" under
  [terminal sessions](#terminal-sessions)) go first, with their damaged
  copy and temporary files, and nothing is saved at the quit that follows. From then on the settings
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
   [the Changes view](#the-changes-view)).
5. **Settings.** Editor, agents, scripts, layout. Built: layout, editor,
   agents, and Timber's settings, edited and saved through Timber's
   settings commands (issue 22).
6. **Background refresh.** File watching per worktree and periodic fetch.
   Built: watching the Git metadata and checking the selected worktree (see
   [watching for changes](#watching-for-changes)), and fetching with
   force-push detection, which compares the remote-tracking refs before and
   after each fetch instead of reading their reflogs (see
   [fetching](#fetching)).

## Updating the app

An installed app updates itself from the app's GitHub releases, with
Electrobun's updater (`src/bun/app-updates.ts`, issue 32).

- **Where it looks.** `release.baseUrl` in `electrobun.config.ts` is
  `https://github.com/Coding-M8s/timber-app/releases/latest/download`, and
  the build stamps it into the app's `Resources/version.json`. The updater
  asks for `<baseUrl>/stable-<os>-x64-update-v2.json` (falling back to
  `-update.json`), and the bundle that manifest names,
  `stable-<os>-x64-Timber.tar.zst`. GitHub serves the files of the newest
  published release that is not a pre-release under `latest/download`, so a
  draft is never offered and a pre-release never either. The updater adds a
  `?<random hex>` to each address; GitHub ignores it (tried with a public
  release asset on 2026-11-21). The release workflow attaches the six files
  (see [releasing](releasing.md)).
- **What counts as newer.** The manifest's `hash`, a build's own, differs
  from the running app's. Any other published build is offered, so
  publishing an older version would offer that one.
- **Whole bundles.** `generatePatch` is false: every update downloads the
  whole bundle, about 90 MB on Linux. Delta patches need the previous
  release at build time and can come later.
- **When it looks.** 30 seconds after start, so it never competes with the
  first listing, then every six hours, and when the person presses "Check
  for updates" in Settings, About. One look at a time; a second request
  shares it. A newer release is downloaded at once, and checked against the
  manifest's SHA-256 by Electrobun before it counts as ready. A look that
  finds nothing new, or fails, while an update is ready keeps it ready and
  says nothing, so the banner and an open question stay.
- **Nothing installs by itself.** A downloaded update waits for "Restart to
  update". `Engine.installAppUpdate` refuses while sessions run unless the
  request says the person agreed (`endSessions`), so the rule holds in the
  main process, not only in the window. Then `QuitGuard.confirmWith` saves
  which sessions run, ends them, and calls Electrobun's `applyUpdate`, which
  asks before quitting like any quit (the guard now says yes), starts its
  helper, and quits. The helper swaps the new app in once the old one is
  gone and starts it (read in Electrobun's source, not run yet); the saved sessions open again then (see "After a
  restart" under [terminal sessions](#terminal-sessions)). On Windows the
  helper runs as a scheduled task, which Electrobun creates.
- **Failure leaves the installed app.** The download is unpacked and
  checked beside the installed app, under its channel folder, and the swap
  happens only after the app quit, with a rollback in Electrobun's helper.
  That is read in Electrobun 2.0.6's `Updater.ts` and its helper's
  messages, not run: an interrupted download or swap has not been tried.
  A look or download that fails, offline for one, becomes the state
  `failed` with the reason, shown only in Settings, About: no dialog, no
  banner. When `applyUpdate` does not get as far as quitting, the window
  says so and asks to quit and start again; by then the sessions have
  ended and the app's watchers have stopped, as for any quit.
- **Copies that cannot update.** The `dev` channel (`bun run dev`, `bun run
  start`) and a build without `baseUrl` answer `unavailable`, and About says
  why without a button.
- **What has been verified.** The pure parts and the store are tested with
  a stand-in updater and the mock engine (`tests/app-updates.test.ts`,
  `tests/app-update-view.test.tsx`, `tests/quit-guard.test.ts`). `bun run
  build` on Linux stamps the address into `version.json` and writes the
  three Linux files. An update from one installed release to the next has
  not been run on Linux or Windows yet: the first release that can update
  is the first one built with this address, and it needs a later one to
  update to.

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
  [Finding Timber](#finding-timber), the README, and `TIMBER_VERSION` in the CI and release
  workflows together.
- **The Timber that pull requests need.** `__app-pr` is on Timber's main
  branch only. With Timber 0.1.2 every repository says "PRs unknown", with
  Timber's "unknown command" in the tooltip. The required version is not
  raised for it, because nothing else depends on it; raise it with the next
  Timber release, as for `listWorkflows` above.
- **The Timber that linked issues need.** The `issue` field of `ls --json`
  and `__app-issue` are on Timber's main branch only. With Timber 0.1.2 no
  issue shows at all, since its records have no `issue` field. Raise the
  required version with the next Timber release, as for pull requests.
- **The Timber that issue suggestions need.** `__app-issues` is on Timber's
  main branch only. With Timber 0.1.3 the New worktree dialog shows no
  suggestions and a quiet hint that they need a Timber built from its main
  branch, and the issues board says the same. Raise the required version
  with the next Timber release, and name it in the board's message.
- **The Timber that Start work needs.** `timber new --branch`, `--assign`,
  and `--reassign`, the record's `assignment`, and `assignedToMe` in
  `__app-issues` are on Timber's main branch only (Timber's issues 214 and
  215). With Timber 0.1.4, Start work fails with "This Timber does not know
  --assign" and creates nothing, and no card can tell whose an issue is,
  so the question about another assignee comes only from Timber's refusal.
  Raise `REQUIRED_TIMBER_VERSION` to the first release that has them, as
  for `listWorkflows` above.
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
