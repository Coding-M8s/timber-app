# What has been verified

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
  [the GLXBadWindow line at start](architecture.md#the-glxbadwindow-line-at-start)).
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
    [the GLXBadWindow line at start](architecture.md#the-glxbadwindow-line-at-start).
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
  [the GLXBadWindow line at start](architecture.md#the-glxbadwindow-line-at-start).
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
  [installing the Linux build](architecture.md#installing-the-linux-build).
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

Run for the backups section (issue 20), Linux x64 (Pop!_OS) with Bun
1.4.2, on 2026-11-19:

- `bun test`: 1887 pass, 12 skip, 0 fail, with the installed Timber 0.1.2,
  which has no backup list. Its test that the list is `unsupported` ran
  against it.
- `TIMBER_APP_TIMBER_PATH=<build of Timber main at 1e145a0> bun test
  tests/backups.test.ts tests/backups-parse.test.ts
  tests/backups-store.test.tsx`: 53 pass, 1 skip, 0 fail, including a real
  repository where a backup with a changed file and an ignored `.env` was
  listed without changing any file or ref, restored into a new worktree
  with both, refused for a wrong digest, and deleted with no ref left.
- With that build the whole suite has 4 failures in
  `tests/workflows.test.ts`, which this issue does not touch: Timber's
  main branch leaves `home`, `state`, or `data` folders after a settings
  read.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- The fixtures in `tests/fixtures/timber-backup` were recorded from that
  build, as described in `tests/support/timber.ts`.

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
  [the GLXBadWindow line at start](architecture.md#the-glxbadwindow-line-at-start).
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
  [the GLXBadWindow line at start](architecture.md#the-glxbadwindow-line-at-start)).
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

Run for reviewers in the Pull request tab (issue 101), on 2026-11-20,
Linux x64 (Omarchy, Arch) with Bun 1.4.5 and Timber 0.1.3:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`, on `be57108`: 1954 passed, 14 skipped, 0 failed.
- `bun run build:web`: built.
- `timber __app-pr` from Timber 0.1.3 in this repository: each found pull
  request carried `reviewers` (empty, as none had reviews) and
  `reviewersComplete: true`. The reviewers in `found.json` are written to
  Timber's contract.
- `bun run dev:web` in headless Chromium 157, driven by a temporary script
  (not committed), each sample worktree selected and the Pull request tab
  clicked: #38 listed example/maintainers (requested, "team"), bob
  (changes requested, in red), and carol (dismissed), each with Open; #42
  alice (approved) and the Copilot bot (commented, "bot", no Open); #17
  dana (approved); the draft #8 erin (requested) with "Some reviewers could
  not be read with Timber's GitHub login, such as a team it cannot see.";
  and the closed #5 "No reviewers were requested, and no one has reviewed
  it." No console errors other than the dev server's missing favicon.
- Not run: the desktop window, and reviewers of a real pull request read
  by the app from GitHub.

Run for notifications that answer a click on Windows (issue 123), on
2026-11-20, Windows 11 Home build 26200 on x64 with Bun 1.4.4 and Windows
PowerShell 5.1:

- `bun test`: 1737 passed, 260 skipped, 54 failed. The same 54 fail on
  `main` on this machine, all tests with POSIX stand-ins (shell scripts
  as a fake Timber or player, `notify-send`); none is new. The new tests
  cover the toast lines, the script's start, failure, and end, tags kept
  on replacing, clicks and dismissals, and the notices on Windows with a
  fake script; one more runs PowerShell on a real ConPTY and sees a report
  set the session's status.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- The toast script through `connectToastHost` and `createDesktopNotices`,
  from a scratch script outside the app, with the real PowerShell: ready
  in about 0.8 seconds. Two toasts showed as "Timber" with the app's icon;
  a person clicked each and the click reached `onClick` with its session.
  One shown and withdrawn 3 seconds later went away. After `stop` no toast
  of the app was left in the notification center, and no script was left
  running. A toast titled `Needs you: <i>Claude</i> & Co` with the body
  `In other: <b>not bold</b> & plain &amp; ünïcödé ✓ 🌲` showed every
  character as written, nothing in italics or bold.
- Sounds with the real spawn: the chime, ping, and knock that come with
  the app and the system's `Windows Notify.wav` played through
  `SoundPlayer` and were heard; a missing own file answered "missing",
  and a second sound while one played "busy". No player is offered for an
  MP3 file.
- The desktop window (`bun run start`, started from a terminal of the
  person's own): a shell session in one worktree printed `state=working`,
  then `state=done`, while another worktree was selected and another
  window was in front. The toast showed as "Timber"; a person clicked it,
  and Timber came to the front and showed that worktree and its shell.
  Before the `Path` fix the same run showed Electrobun's balloon, named
  "Bun", because `PATH` is empty in the process Electrobun starts.
- Claude Code 2.1.329 in an agent session, from a scratch script through
  `createTerminalSessions`: it sent the probe and no report, since ConPTY
  dropped the answer (issue 149).
- Not run: macOS; a toast replaced in place while still on screen (the
  person clicked the first before its replacement came); quitting the
  desktop window with a toast on screen; a policy that blocks `Add-Type`.

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

Run for restarting after a setting that needs it (issue 134), on
2026-11-19, Pop!_OS on Linux x64 (COSMIC on Wayland, the window through
XWayland) with Bun 1.4.5 and Electrobun 2.0.6:

- `bun test`: 1946 passed, 2 skipped, 0 failed. `tests/restart.test.ts`
  runs the waiter for real: it waited for a process to end, then started
  the command with its arguments, environment, and working folder.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build`, then an install with
  `env -i PATH=/usr/bin:/bin HOME=<temporary folder>`, then the installed
  `app/bin/launcher --spike-arg` started from a folder of its own with a
  marker variable in its environment. A temporary hook, not committed,
  saved the DMA-BUF renderer as Off through the main process's
  `preferences.save` and called the same `restarter.restart()` that
  "Restart now" calls. The first run had Auto (off on this machine's
  Intel-only graphics, decided by Auto). It quit, and a new launcher
  started with `--spike-arg`, the same working folder, and the marker
  variable, and its run reported the renderer decided by the choice, Off.
  The installed copy's settings file held `"dmabuf": "off"`.
- Not run: the buttons clicked in the desktop window, the question while
  terminals run in the desktop window (only static markup and the store),
  the waiter giving up after 20 seconds, Windows and macOS.

Run for the window icon on Windows, on 2026-11-19, Windows 11 Home x64
(10.0.26200) with Bun 1.4.4, Git 2.50.1, Electrobun 2.0.6, and Timber 0.1.3
(`timber-v0.1.3-windows-x64.exe` from the release, its SHA-256 checked
against `SHA256SUMS-windows-x64`, in `%LOCALAPPDATA%\Programs\Timber` on the
user PATH):

- `bun install --frozen-lockfile`, `bun run typecheck`, and
  `bun run typecheck:desktop`: no errors.
- `bun test`: 1674 passed, 258 skipped, 54 failed, 4 errors between tests.
  The failures were there before this change (1671 passed, 54 failed). They
  are in tests that expect Linux: sounds, the repository watcher, Done,
  restart, rebase, workflows, theme files, pull requests, issues, fetching,
  and desktop notices. `tests/window-icon.test.ts` passed, including a real
  window that got both icons and kept none from a missing file.
- `bun run build`: completed, with `build\stable-win-x64\Timber-Setup.exe`.
  The installer put the app in
  `%LOCALAPPDATA%\com.codingm8s.timber-app\stable`.
- The installed app before the change: the title bar showed Windows'
  default icon. After it: the title bar and the taskbar showed the Timber
  icon, and `WM_GETICON` answered a small and a big icon for the window.
- The installed app first said "Timber is not installed". It had been
  started by the installer from a shell whose PATH was older than the
  Timber install, and Retry reads the same PATH again. Started with the
  current user PATH, it found Timber 0.1.3 and showed "No repository yet".
  `findTimber` with that PATH answered ready with
  `%LOCALAPPDATA%\Programs\Timber\timber.exe` and 0.1.3.
- Not run: adding a repository and the rest of the app on Windows.

Run for terminal and agent sessions on Windows (issue 140), on 2026-11-19,
on the same Windows 11 Home x64 machine with Bun 1.4.4 (also the Bun in the
build's `app\bin`), Git 2.50.1, Electrobun 2.0.6, and Timber 0.1.3:

- Before the change, a trial outside the app: `Bun.spawn` with `terminal`
  started PowerShell on ConPTY, typed input reached it, colored output came
  back, a resize reached it (`$Host.UI.RawUI.WindowSize.Width` 100, then
  140), and `exit` ended it with 0. `terminal.close()` ended the shell and a
  `ping -t` in it within about 10 ms; killing only the shell left the ping
  running. `Bun.spawn` of a `.cmd` file threw for an argument with `&`.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test tests/terminals-windows.test.ts`: 8 passed, six runs in a row, on
  a real ConPTY in a temporary repository with a linked worktree whose path
  has spaces: cmd.exe in the worktree's folder, typed input, a resize seen
  by `mode con`, a shell that exits with 3 kept with how it ended, Close and
  quitting each ending the shell and a `ping` it started, `where.exe` as an
  agent, a `.cmd` agent refused with nothing started, and PowerShell as the
  shell with the real environment.
- `bun test`: 1684 passed, 258 skipped, 54 failed, the same 54 as before
  (see the window icon run above), none in terminal tests.
- `bun run build`, installed with `Timber-Setup.exe`. A person added this
  repository, opened a Terminal (Windows PowerShell 5.1) and a Claude Code
  session (`claude.exe` 2.1.329) in it, and reported both working. Claude
  Code drew without color: the app had been started by the installer from
  a Claude Code session whose environment had `NO_COLOR=1`, which every
  session inherits. That is the app passing on its environment as designed.
- Not run in the desktop window: Codex, closing a session with a program
  running, and quitting with sessions running. The tests cover them on a
  real ConPTY only.

Run for agent status on Windows (issue 149), on 2026-11-20, on the same
Windows 11 Home x64 machine (build 26200) with Bun 1.4.4 and Claude Code
2.1.329 (`claude.exe`):

- Before the change, scratch scripts: a Bun child in raw mode on ConPTY,
  sent a short OSC 7501 answer by `terminal.write`, read nothing when it was
  written as it is, and exactly the answer, once, when it was written as
  win32-input-mode key presses only or as presses and releases. ConPTY
  printed `ESC [ ? 9001 h` first in every run.
- A child that printed `ESC [ > 0 q`, `ESC [ ? u`, the probe, and `ESC [ c`,
  as Claude Code does, read ConPTY's own
  `ESC [ ? 61 ; 6 ; 7 ; 21 ; 22 ; 23 ; 24 ; 28 ; 32 ; 42 c` before the
  answer. `ESC [ c` never reached the output.
- `claude.exe` read as text: its probe settles as "no reply to OSC 7501 ; ?"
  once the reply to the `CSI c` it sends after its queries arrives. Before
  it asks, its program status support starts as "not asked yet", or as off
  with `CLAUDE_CODE_DISABLE_TERMINAL_TITLE`, as a background worker, or in a
  terminal known to print unknown sequences. Only an answer turns it on.
- With the answer sent as key events on Windows' own ConPTY, the real
  Claude Code started through `createTerminalSessions` in a new temporary
  repository, for 15 seconds, no prompt: one probe (`ESC ] 7501 ; ? BEL`),
  its folder trust screen, and no report; the session's status stayed null.
  The same with the answer also written before the probe. The late answer
  did not show on its screen.
- node-pty 1.1.0 (`npm install` in a scratch folder, with Node 24.13.1 and
  then Bun) with `useConptyDll`, so ConPTY 1.23.251008001: the same child
  as above. `ESC [ c` reached the output unanswered, and the child read the
  answer, written as it is or as key events. Under Bun, in a Worker as the
  app runs: `exit 3` gave exit code 3, a resize reached cmd.exe (`mode con`),
  `kill()` ended cmd.exe and a `ping` in it, and the process quit once the
  Worker ended. This ConPTY printed `ESC [ 1 t` and `ESC [ c` first and held
  `where.exe` back 3 seconds when nothing answered, 20 ms when answered. A
  resize right after starting worked once the query was answered.
- The real Claude Code on that ConPTY from a Node script answering both
  `CSI c` it saw: it reported
  `state=blocked:app=claude-code:kind=permission` with "trust this folder".
- `bun add node-pty@1.1.0` ran its install scripts. With
  `"trustedDependencies": []` added, `rm -rf node_modules/node-pty` and
  `bun install`: its install scripts were blocked, no `build` folder was
  made, and it loaded its prebuilt files and ConPTY.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test tests/terminals-windows.test.ts tests/pseudo-terminal.test.ts`:
  17 passed, six runs in a row, on a real ConPTY: the earlier tests, a
  program that probes and then sends `CSI c` reading the probe's answer and
  then the window's reply to `CSI c` (failed with `Bun.Terminal` in its
  place), the same probe on Windows' own ConPTY through `Bun.Terminal` with
  the answer as key events, and `where.exe` starting within 2 seconds with
  the startup query not in the output. Before the close test listed
  processes in one call, it timed out once.
- The close and quit tests, 45 runs: once, after quitting, the shell had
  ended and its `ping` still ran 4 seconds later, because the pseudo console
  was closed before the process tree was killed, and taskkill follows the
  tree only through a running shell. Quitting now kills first and then
  closes: 30 runs in a row passed. Closing the pseudo console alone, 10
  times from a scratch script, ended cmd.exe, its `ping`, and
  `OpenConsole.exe` within 26 ms each time.
- `bun test`: 1758 passed, 148 skipped, 78 failed, 17 errors. Without this
  change on the same machine: 1747 passed, 78 failed, 15 errors. The failing
  tests are the same apart from two that are flaky without this change too
  (a real Timber saved bases test, and adding the same repository twice,
  which passed once and failed once alone without it); none are terminal
  tests. Rebased on `main` at `388ebee`: 1897 passed, 156 skipped, 80
  failed, 17 errors, none in terminal tests; the Windows failures are
  issue 163, and CI runs the tests on Windows without failing the run.
- The real Claude Code 2.1.329 started through `createTerminalSessions` (the
  main process's own module, with node-pty) in a new temporary repository,
  for 15 seconds, no prompt, nothing answering `CSI c`: it reported
  `blocked`, kind `permission`, app `claude-code`, message "trust this
  folder", which reached the session's `status`, within 0.4 seconds.
- `bun run build`: the stable build holds `node-pty`'s `lib`, `package.json`,
  and `prebuilds/win32-x64` without debug symbols (1.9 MB) under
  `Resources/app/bun/node_modules`, and `licenses/node-pty.txt`. The
  bundled `index.js` requires `node-pty` at run time. From the unpacked
  build, a script beside `index.js` resolved node-pty there and ran cmd.exe
  on its ConPTY.
- The build installed with `Timber-Setup.exe` and run by a person: Claude
  Code opened in a new project reported its status in the app, and the
  person reported it working.
- CI on the pull request: the Linux `check` job passed, 2105 tests and none
  failed, so the terminal tests on Linux ran through `startBunTerminal`.
  The Windows job failed only in tests listed in issue 163, none of them
  terminal tests.
- Not run: notifications on Windows, a session the window does not show,
  Codex, Windows on arm64, and macOS.

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
- Terminals on Windows with neither node-pty nor a Bun that has
  `Bun.Terminal`: they answer that they are not supported, and that answer
  was only acted out in tests. A Windows build without node-pty, falling
  back to `Bun.Terminal`, was run only in tests.
- Copying with Ctrl+Shift+C and opening a link with Ctrl+click in the
  desktop window. Both were checked as functions only.
- A real X11 login session, and GNOME and KDE, on real hardware. They
  were run in virtual machines only (see issue 66 above); on real hardware
  only COSMIC was run by a person. A native Wayland window is not possible
  with Electrobun 2.0.6 (see issue 63 above and
  [display server on Linux](architecture.md#display-server-on-linux)).
- An NVIDIA GPU known to be drawing the window.
- Pull requests in the desktop window, and so `readPullRequests` over the
  RPC bridge, "Open pull request" clicked, and the refresh after a real
  background fetch. Only the main process module, the store, and static
  markup were run.
- The backups section and its dialogs in the desktop window, or in a
  browser with `bun run dev:web`. Only the main process module, the store,
  and static markup were run. No Timber release has the backup list yet.
- A partial restore or delete from a real Timber. Their records in the
  tests are recorded ones edited to that shape.
- A found pull request read by the app's own code from GitHub. That was run
  with Timber by hand only, and the tests use `found.json`.
- A portal file chooser other than Files on Omarchy and COSMIC's on Pop!_OS,
  and Files on the real desktop rather than a nested Hyprland (see issues 75
  and 66 above).

Run for setup in a terminal (issue 106), Linux x64 (Omarchy, Arch Linux)
with Bun 1.4.4 and Git 2.56.1. No Timber release has `--no-setup` yet, so
Timber ran from the branch of Coding-M8s/timber#158, compiled with `bun
build --compile`, behind a wrapper named by `TIMBER_APP_TIMBER_PATH` that
answers `--version` with 0.1.3:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `TIMBER_APP_TIMBER_PATH=<wrapper> bun test`: 1471 tests passed, 1 was
  skipped, none failed. Against that Timber on temporary repositories:
  `timber new --no-setup` and `timber open --no-setup` created worktrees
  without running a configured script and reported `setupSkipped: true`,
  without scripts reported none, and opening again left refs, worktrees,
  and files unchanged. A "Setup" session ran `timber open --setup
  --no-editor --no-agent -- <path>` in the worktree: a script's output
  showed in the session, it ran in the worktree's folder, and a failing
  script ended the session with exit code 1 and left the worktree.
- `bun test` with the installed Timber 0.1.2: 1377 passed, 111 skipped,
  none failed. The tests that need a real Timber are skipped, because 0.1.2
  is now too old.
- `bun run build:web`: built.
- Not run: the desktop window, so the dialog closing while a long setup
  runs, the Setup and agent sessions side by side, and the RPC bridge for
  `timberWorktreeSetup` were seen only through the store and the mock
  engine. Windows and macOS.

Run again after rebasing onto main with workflows (issue 52), Linux x64
(Omarchy) with Bun 1.4.5, Git 2.56.1, and the released Timber 0.1.3
installed:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 1999 passed, 14 skipped, none failed. The skipped tests need
  Timber commands that 0.1.3 does not have, or run only in CI. Against
  Timber 0.1.3 on a temporary repository: with only a workflow's
  `post_create` script, `timber new --workflow review --no-setup` ran
  nothing and reported `setupSkipped: true`; the Setup session's command
  with `--workflow review` ran the ordinary script and then the workflow's,
  and without it only the ordinary one, so the session passes the workflow
  again.
- `bun run build:web`: built.
- Not run: the desktop window, Windows, and macOS, as above.

Run for opening a pull request from the Pull request tab (issue 102), Linux
x64 (Omarchy) with Bun 1.4.5, Git 2.56.1, and the released Timber 0.1.3
installed:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2046 passed, 14 skipped, none failed. Against Timber 0.1.3 on
  a temporary repository whose `origin` is a bare repository on disk:
  `timber pr` was refused as not on github.com, and again with no title,
  and neither changed a file or ref in the worktree, the primary checkout,
  or the remote. `--title '-x<newline>y'` reached Timber as the title, which
  refused it as more than one line, so a value that starts with a dash is
  not read as an option. Reading the last commit's subject changed nothing.
- `bun run build:web`: built.
- Not run: creating a real pull request on GitHub (the created, exists, and
  failed records are written by hand from the contract), the form in a
  browser or the desktop window, Windows, and macOS.

Run for the app's identity on Windows and under WSLg (issue 27), on
2026-11-20, Windows 11 Home x64 (10.0.26200) with Bun 1.4.4, Git 2.50.1,
Electrobun 2.0.6, WebView2 157.0.4341.60, and Timber 0.1.3. Geist was not
installed: neither `C:\Windows\Fonts` nor the user's fonts folder held a
Geist file. The app was the build of 2026-11-19 installed with
`Timber-Setup.exe` (app 0.0.1) to
`%LOCALAPPDATA%\com.codingm8s.timber-app\stable`. The window and taskbar
icons were seen in the window icon run above.

- The installer made `Timber.lnk` in the Start menu's Programs folder and on
  the desktop. Both point at `app\bin\launcher.exe` and take its first
  icon. That icon, read with `System.Drawing.Icon.ExtractAssociatedIcon`,
  and the one on `Timber-Setup.exe` were the Timber logo.
- `app\Resources\app\licenses` held `geist-fonts-OFL.txt`,
  `timber-logo.txt`, and `theme-palettes.txt`, and
  `app\Resources\app\views\mainview\assets` the `Geist-Variable` and
  `GeistMono-Variable` WOFF2 files. `Resources\version.json` named
  `com.codingm8s.timber-app` and 0.0.1.
- The installed app started with
  `WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS=--remote-debugging-port=9333` and
  read over the DevTools protocol: the page was `views://mainview/index.html`
  titled Timber, `document.fonts` listed Geist and Geist Mono as loaded, and
  no resource came from anywhere but `views://`. `CSS.getPlatformFontsForNode`
  answered Geist, a custom font, for the heading and body text, and Geist
  Mono, a custom font, for the worktree path. The network was not turned
  off, but no font could come from it.
- Settings, About in the desktop window: "Timber app 0.0.1", "Timber 0.1.3"
  with `%LOCALAPPDATA%\Programs\Timber\timber.exe`, and the licenses text.
- Under WSLg (WSL 2.6.3, WSLg 1.0.71) on Ubuntu 24.04.5 with Bun 1.4.2 and
  WebKitGTK 2.52.6, Geist not installed (`fc-list | grep -ic geist`: 0): a
  fresh clone of main at `82a13fe`, `bun install --frozen-lockfile`, and
  `bun --bun run start` (plain `bun run start` ran Vite on the system's
  Node 18, which failed on `styleText` from `node:util`). The window opened
  on "Timber is too old", for the Timber 0.1.1 installed there, with its text
  in Geist and the update command in Geist Mono, seen in a capture of the
  window from Windows next to the Windows window. The window frame drawn by
  WSLg showed a generic icon. With `WEBKIT_INSPECTOR_HTTP_SERVER` set, the
  inspector port took connections but answered nothing and the window did
  not open, so the typeface there was judged by eye only.
- Not run: the network turned off on Windows, and anything on macOS (issue
  158).

Run for the test suite on Windows (issue 163), on 2026-11-20, Windows 11 Home
x64 (10.0.26200) with Bun 1.4.4, Git 2.50.1, and Timber 0.1.3 installed at
`%LOCALAPPDATA%\Programs\Timber\timber.exe`:

- Before the change, `bun test` on `main` at `05160e1`: 79 failed, 16
  errors, 156 skipped. The first `test-windows` CI run (pull request 164)
  had 60 failed.
- `bun run typecheck`: no errors.
- `bun test`: 1997 passed, 138 skipped, none failed, 2135 tests, in 455
  seconds, with the tests that run the installed Timber among them. Four of
  those stay skipped on Windows, for the reasons below.
- As the CI job runs it: `bun test` with Timber's folder taken off PATH,
  `CI=true`, and TEMP and TMP set to the short 8.3 name of a folder in
  `%TEMP%` (`TIA81E~1`): 1895 passed, 264 skipped, none failed. With
  `bunfig.toml` moved away, the same short TEMP failed `commonDirectory`, the
  saved preferences, and the saved layout, the three failures seen only on
  CI.
- Now run on Windows, and skipped there before: watching a real repository
  with `fs.watch` (passed five runs in a row), the worktree stamps on real
  repositories, fetching from real repositories (three runs in a row; the
  check of what a fetch may change now reads paths with this system's
  separator), `readBackups` with a stand-in, and saving Timber's settings
  and a login through the real Timber.
- What the failures were. None was a bug in the app. The tests assumed
  POSIX paths in recordings, expectations, and stand-ins; `.cmd` stand-ins,
  which cmd.exe cannot give a line break and which leave Bun running when
  stopped; stand-in players without `.exe`; Bun's five-second default against
  the installed Timber; a `/proc` that needs symbolic links; and a timer
  that took longer than the test allowed for. See
  [tests on Windows](architecture.md#tests-on-windows).
- Found along the way, outside this app: `timber backup list --json` took
  4.3 seconds and `timber backup create` 5.7 on a new repository, where
  `timber ls --json` took 0.6. On this machine the user's temporary folder
  also allows another local group, so Timber refuses private records written
  there unless their folder is made private first.
- Still skipped on Windows, each with its reason in the test: restarting the
  app (Linux only), terminal sessions and setup sessions on a POSIX pseudo
  terminal, the shell-script stand-ins of the editor, link opener,
  uninstaller, Git runner, and a remote that asks for a password,
  permission-bit and read-only-folder tests, symbolic links, and the editor
  and setup script checks of `timber new`, which are POSIX commands.
- Not run: Linux and the CI jobs for this change before it was pushed, and
  anything on macOS.

Run for chops (issue 173), Linux x64 with Bun 1.4.5 and Git 2.43.0:

- `bun test`: 2138 tests passed, 18 skipped, 0 failed, including
  `tests/chops.test.ts` against a real temporary repository with linked
  worktrees on branches with different `.timber/chops.json` files: a file
  changed between reads, a missing file with no `.timber` created, the
  file's bytes and modification time unchanged by a read, and a symbolic
  link to the file and to the folder, a folder, a named pipe, a file that
  is not UTF-8, and one over 256 KB each reported as damaged without
  hanging.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- Not run: the desktop app or the browser build by eye, Windows (the
  file tests that use links and pipes are skipped there), and macOS.

Run for ports of a worktree (issue 169), Linux x64 with Bun 1.4.5, Git
2.56.1, and Docker 29.10.0 (client and server), rebased on main at
d0e7908:

- `bun test`: 2171 tests passed, 18 skipped, 0 failed, including
  `tests/ports-parse.test.ts`, `tests/ports-view.test.tsx`, and
  `tests/ports.test.ts`, which reads ports for linked worktrees of a real
  temporary repository through a stand-in `docker`, checks that the
  repository's files and refs are unchanged after a read, that a worktree
  Git does not list or a repository outside the list is refused before
  Docker is asked, that a hidden
  window and a read within 5 seconds start no `docker`, a pretend `/proc`,
  and a real listener started under `setsid`, found through the real
  `/proc`.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- `createPorts` against the real Docker, Git, and `/proc`, with the real
  worktrees of a private repository with five worktrees (listed through
  `git worktree list`, not Timber) and the test shell's own session as a
  terminal's: the one running a Compose project listed its 8 published
  ports (6 services), the other four listed none, and 25 reads took 33 ms
  each at the median and 38 ms at most.
- The same reader with `DOCKER_HOST` at a missing socket and at a socket
  that refuses connections answered "Docker is not running", at a socket
  with no permissions "No permission to use Docker", and with no `docker`
  on the PATH "Docker is not installed here", each with Docker's own words
  after it.
- A container created and never started, labeled with this worktree as its
  Compose working directory and asking for a host port another worktree's
  running container publishes: the read listed no port for this worktree
  and reported the clash, and `clashMarksOf` marked both worktrees, each
  with the other's name. The container was removed afterwards.
- Not run: the desktop window or the browser build by eye (the list's
  opening, Open in browser, and Copy were not clicked), Windows (the
  `/proc` tests are skipped there), and macOS. Ports of sessions are read
  on Linux only.

Run for Clean up merged and Done closing on Remove (issue 162), Linux x64
with Bun 1.4.5, against the mock engine only:

- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: all passed, none failed.
- `bun run build:web`: built.
- Not run: the desktop window, or a real `timber __ide-done` run of more
  than one worktree in a row.

Run for `timber new` in an app terminal (issue 96), Linux x64 with Bun
1.4.5, with the Timber side from Coding-M8s/timber#190 (merged as `fd1d7a8`):

- `bun test` in the app: all passed, none failed. `tests/handoffs.test.ts`
  makes a real temporary repository with a linked worktree, has `/bin/sh`
  with a session's environment write a record into `TIMBER_APP_HANDOFF` as
  Timber does, and checks that it is heard once, deleted, and that refs,
  worktrees, and files are unchanged. `tests/worktree-handoff-store.test.ts`
  covers the window against the mock engine.
- In Timber, `tests/app-handoff.integration.test.ts` runs `timber new` and
  `timber open` from source in a real pseudo terminal on temporary
  repositories, with and without the variable.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- End to end without a window: `openHandoffFolder` and `sessionEnvironment`
  from this branch, with Timber's `main` at `fd1d7a8` run from source in a
  real pseudo terminal on a temporary repository whose agent is enabled.
  `timber new feat/e2e --no-editor` printed `Opening <path> in the Timber app
  with its agent.`, started no agent, and the folder passed on
  `{ repository, worktree, agent: true }` for the new worktree.
- Not run: the desktop window, and a released Timber binary with the handoff.

Run for focus in the new worktree dialog (issue 195), Linux x64 with Bun
1.4.5, against the mock engine only:

- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2285 passed, 18 skipped, none failed. The new ones cover
  `focusFirstField` (first enabled control, disabled, hidden, and non-control
  entries skipped, nothing moved when there is no control), `openModal`
  (showModal first, then the first field; no field for a destructive
  dialog; an open dialog not shown again), `focusAfterFailure` (the first
  enabled text field past buttons, selects, and boxes, else the submit
  button) and, in the markup of both modes, the switch in the header before
  the fields with Name and the branch field as each mode's first field.
- `bun run build:web`, then the built interface driven in headless Chrome
  151 by a temporary script (not committed). The "+" opened the dialog with
  the focus in Name, and typing at once filled it. Shift+Tab reached the
  switch; the right arrow chose "Existing branch" and put the focus in its
  branch field; Shift+Tab and the left arrow chose "New branch" and put it
  back in Name, with the typed name kept. Clicking either side of the switch
  put the focus in that mode's first field. With `timberMock.endCommands`,
  a refused run in New branch put the focus back in Name, and typing went on
  in it; a run that stopped after creating the worktree put it on "Run
  setup"; a refused run in Existing branch put it in the branch field. The
  same script against the build before the change found the focus on the
  switch and Name empty after typing (the failed-run steps were not run
  against that build).
- Not run: the desktop window (WebKitGTK), Windows, and macOS.

Run for review notes sent to an agent (issue 168), Linux x64 with Bun
1.4.5, rebased on main at 9e3a5b6:

- `bun test`: 2335 tests passed, 18 skipped, 0 failed, including
  `tests/review.test.ts` (the message, a cut that never splits a character,
  choosing and stretching lines, where a note is, quoting and
  cleaning, outdated notes, `pasteProblem`, `bracketedPaste`, and the paste
  mode scanner with compound and split sequences), `tests/review-notes.test.tsx`
  (the store and the mock engine: notes on two files pasted once, the
  pasted text equal to the preview and written as one bracketed paste with
  no Enter, nothing pasted before Send, outdated notes marked before the
  preview and sent with their old lines, an agent with bracketed paste off
  given nothing, a session that is not an agent of the worktree given
  nothing, Copy review, notes kept across worktrees and dropped with a
  worktree that left the list), and `tests/terminals.test.ts`, where a
  pretend agent in a real pseudo terminal turns on mode 2004 and prints the
  bytes it was pasted: exactly `bracketedPaste` of the text. An agent that
  never turned it on, a terminal session, an ended session, and text with
  an escape got nothing.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- Claude Code 2.1.329, started in a real pseudo terminal (`Bun.spawn` with
  `terminal`, 120 by 40) in an empty temporary Git repository: it turned on
  mode 2004 before its prompt. A ten-line review sent as `bracketedPaste`
  showed as `[Pasted text #1 +9 lines]` in its input, and in the 5 seconds
  after nothing was submitted. It was quit with Ctrl+C, never given Enter.
- Codex 0.169.0, started the same way: it turned on mode 2004, but in that
  bare pseudo terminal it showed its sign-in screen even though `codex
  login status` said it was signed in, so the paste into its prompt was not
  tried. Not verified with Codex.
- Not run: the desktop window or the browser build by eye (notes were not
  clicked in a real window, so focus, the arrows, and Shift+click were not
  tried; the component tests render markup only), Windows, and macOS.

Run for the next session that needs you or is done (issue 170), Linux x64
with Bun 1.4.5, against the mock engine only:

- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2356 passed, 18 skipped, none failed, across 145 files, after
  rebasing on main.
  `tests/waiting.test.tsx` covers the orders, the cycling, and the words as
  pure functions, and on the mock engine agents in `timber` and
  `api-server`: Needs you oldest first, around again, each leaving once
  answered or closed and rejoining at the end when it waits again; finished
  sessions after those, in the order they finished, each leaving once seen
  by a jump or a selection, or once closed, exited, or needing you, and
  joining again when it finishes again; the key always taken from the page
  and once per press; nothing with none listed, behind a dialog, the quit
  question, or a Timber that is not ready; and the palette entry and the
  title bar's words.
- `bun run build:web`: built.
- By hand: the person who asked for the change tried it in the app and it
  worked. Which platform and build, and which cases were pressed, were not
  recorded.
- Not run by the implementer: the desktop window or the browser build by
  eye, Windows, and macOS.

Run for arenas (issue 172), Linux x64 with Bun 1.4.5 and Git 2.56, with the
installed Timber 0.1.3 and with Timber's main branch at 6f64db7 built with
`bun build src/index.ts --compile` (it also calls itself 0.1.3):

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test` with the installed 0.1.3: 2417 passed, 20 skipped, 0 failed.
  The real-repository arena test skips, because 0.1.3 answers `error:
  unknown command '__app-arena'`.
- `TIMBER_APP_TIMBER_PATH=<main build> bun test`: 2418 passed, 18 skipped,
  0 failed. In a temporary repository with a stub wrapper preset, the app's
  own commands created an arena with one stub and one manual attempt, Timber's
  private snapshot held the task byte for byte, and list, launch, and inspect
  left every file, ref, and worktree as they were (`fingerprint`). A pick
  whose sessions in the other attempts did not end changed nothing; then a
  pick archived the attempt with work under `refs/timber/arena/demo/stub-1`.
- The person who filed the issue ran the app against that build with
  `TIMBER_APP_TIMBER_PATH` and created, compared, and picked an arena. Their
  testing led to the change that pick ends the other attempts' sessions
  instead of waiting for them. They ran that version the same way and
  reported that it works: keeping one ended the other attempts' sessions and
  kept the chosen attempt's agent running.
- The records in `tests/fixtures/timber-arena` were recorded by hand with
  that build on Linux. None holds the task text.
- Not run: the desktop window with arenas, and the browser build in a
  browser. The layout of the New arena and Compare dialogs is not checked by
  eye yet.

Run for keeping background reloads cheap (issue 138), Linux x64 with Bun
1.4.5, Git 2.43.0, and Timber 0.1.3:

- The issue's first cause did not reproduce. In a temporary repository with
  two linked worktrees and stale file times, and in a private repository
  with eight linked worktrees, the inode of every `index` file was the same
  before and after `timber ls --json`, `timber backup list --json`, and
  `timber settings --json`, and nothing in the common Git directory got
  newer. A plain `git status` in a worktree did replace its index. Timber
  runs its Git calls with `GIT_OPTIONAL_LOCKS=0`. On the private
  repository, `timber ls --json` took 2.76 s and about 7 s of CPU.
- `GIT_OPTIONAL_LOCKS=0 git diff --name-status -z -M <commit> --` and
  `GIT_OPTIONAL_LOCKS=0 git diff --no-textconv -- <file>` both replaced the
  index after a file was touched. With `-c diff.autoRefreshIndex=false` in
  front, neither did. Without the refresh, `--name-status` listed the
  touched but unchanged file and `--numstat` did not.
- New test in `tests/file-changes-base.test.ts`: with stale file times in a
  worktree read for the first time, comparing with the base and every diff
  leave the index bytes unchanged and list only the file whose content
  changed. Without `diff.autoRefreshIndex=false` it fails at the index.
- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2438 passed, 20 skipped, none failed, after rebasing on main
  at `71ade8f`.
- `bun run build:web`: built.
- Not run: the desktop window with this change, so the issue's measures on
  a repository with 10 or more worktrees (no `git status` while idle apart
  from the stamp check, no index writes under `inotifywait`, idle CPU under
  5% of one core) were not taken. The cost of each `timber ls` is
  unchanged; it is Timber's part.

Run for the command palette scoped to the repository (issue 209), Linux x64
with Bun 1.4.5:

- New tests in `tests/palette.test.ts` cover the view: scoped with nothing
  typed (only the repository and the app, in four sections, the current
  worktree marked), unavailable actions left out and named in one line,
  typing finding them with their reason, other repositories' worktrees
  after this repository's and never their actions, unscoped and no
  selection, Clean up merged with its count, the limit never dropping
  this repository's matches or, with nothing typed, the actions and the
  app's entries (500 worktrees), and what each row names when no chip or
  heading does. `tests/command-palette.test.tsx` checks the
  chip, the headings, the line under the list, and that only rows are
  options, numbered in order.
- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2463 passed, 20 skipped, none failed.
- `bun run build:web`: built.
- In the mock engine (`vite --port 5174`) in headless Chromium: Ctrl+Shift+P
  opened the palette scoped to timber with the box focused; typing "rate"
  listed New worktree, then feat/rate-limit-headers under Other
  repositories; Backspace in the empty box removed the chip and listed every
  repository's worktrees; typing "done" showed Done dimmed with "The primary
  checkout is never removed." under the list. ArrowDown went through rows 0
  to 6 across the "In timber" heading with `aria-activedescendant` moving by
  one each time and the box keeping focus; End went to the last row, Add
  repository, in view; Home went back to Open terminal. Enter on Start
  Claude Code started it, and the palette opened again showed main's
  session mark. Enter on feat/github-issue-lookup selected it and closed the
  palette.
- Arrow Up right after opening, with the pointer resting over the list,
  wrapped to Add repository, and a mouse move at the same place, as WebKit
  sends after the list scrolls under a still pointer, then took the
  highlight to fix/macos-portability. With moves at the same place ignored,
  Add repository kept it, and a real move still took it.
- Not run: the desktop window.

Run for issue suggestions in the New worktree dialog (issue 161), Linux x64
with Bun 1.4.5, Timber 0.1.3 installed, and Timber's main branch at
`d64021f` built with `bun build src/index.ts --compile`:

- New tests: `tests/issue-search-parse.test.ts` reads records recorded from
  Timber's main branch (found with a linked worktree, truncated, no matches,
  Jira sign-in needed, offline, and 0.1.3's "unknown command") and refuses
  records that do not add up. `tests/issue-search.test.ts` runs a stand-in
  Timber (arguments, text after `--`, standard input closed, timeout,
  refusals, nothing logged) and the mock engine.
  `tests/issue-suggestions.test.ts` covers debouncing, one search at a time
  with only the latest waiting, older answers never shown, kept lists,
  hints, the keys, and closing on blur. `tests/new-worktree-suggestions.test.tsx` covers the
  dialog, including a search that never answers while Name, the footer, and
  Create still work.
- `TIMBER_APP_TIMBER_PATH=<main build> bun test tests/issue-search.test.ts`:
  12 passed, including the real-Timber test on a temporary repository (Jira
  sign-in needed, GitHub without a GitHub remote failed, files and refs
  unchanged).
- `timber __app-issues search --tracker github -- <text>` from the main build
  in this repository took 742, 714, 746, 620, and 621 ms for `16`, `1`,
  `worktree`, `sugg iss`, and `zzzqqq` (`timber --version` alone: 56 ms, so
  most of it is GitHub). `16` found #16 and #161, and #161 was marked with
  its worktree. Suggestions therefore show about 0.9 s after typing pauses
  (250 ms pause plus the search). Jira and Linear answered sign-in needed
  here, so their matching was not tried against a real tracker.
- In the mock engine (`vite --port 5173`) in Chrome, with every search held
  700 ms: typing "issue look" started one search, not ten, and listed #41
  with "Has a worktree". Event handling per key press: keydown median
  0.2 ms (max 2.3), keypress 2.1 ms (max 3.6), input 1.6 ms (max 2.6),
  over 10 key presses. ArrowDown highlighted #41. A keydown of Escape in
  Name closed the list, was marked handled, and left the dialog open. (The
  automation's own Escape key did not reach the page, so a real Escape was
  not checked here.)
- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2528 passed, 23 skipped, none failed, after rebasing on main
  at `a279c08`.
- `bun run build:web`: built.
- Not run: the desktop window.

Run for a workflow's agent in place of the app's agent (issue 54), Linux x64
with Bun 1.4.5 and Git 2.56.1, after rebasing on main at `ca3607b`:

- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`: 2567 passed, 24 skipped, none failed.
  `tests/workflow-agent-session.test.ts` starts real pretend agents in a
  temporary Git repository and covers a workflow's command starting as
  Timber reports it now, a command or token in the request never used,
  `agent = false`, the picked agent named with the workflow starting when
  Timber does not report a command (unset, gone, or unreadable), and an
  arena attempt in the same request refused before either Timber read.
  `tests/new-worktree-workflow.test.tsx` and
  `tests/new-worktree-agent.test.tsx` cover the locked Agent field, the
  footer, and what starts after creation in the mock engine.
- `bun run build:web`: built.
- Not run: the desktop window, and the Windows batch-file test for a
  workflow's agent, which skips on Linux.

Run for running command chops (issue 174), Linux x64 with Bun 1.4.5, bash
5.2.21, and Git 2.43.0:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2603 passed, 24 skipped, 0 failed, after rebasing on main at
  `0ba893c` (2485 passed, 20 skipped before the rebase). An earlier run on a
  machine with a load average near 50 had two five-second timeouts in
  `tests/saved-base.test.ts` and `tests/repository-list.test.ts`, which this
  change does not touch; run alone then, both files passed.
- `bun run build:web`: built.
- New tests run real shells: a chop typed line by line into `/bin/sh`, which
  never turns on bracketed paste, runs, and the shell stays; into bash, which
  does, it goes in as one bracketed paste within a moment, with both line
  by line waits set to a minute; into `/bin/sh` with the longest wait set to
  a minute, it is typed once the prompt is quiet; a tab without bracketed paste is not typed, and
  the session says why. `tests/chops.test.ts` lists a real repository's
  chops from its main checkout while a linked worktree's branch has other
  ones, and runs a repository chop only after its text was approved, asking
  again once the file changed. `tests/chops-watcher.test.ts` hears a real
  `.timber/chops.json` made and edited, and not a file written beside
  `.timber`.
- Not run: the desktop window or the browser build by eye, so the "+" menu,
  the chip's menu, and the approval dialog were not seen drawn. Windows and
  macOS were not tested: how PowerShell and ConPTY take a chop is unknown.

Run for sessions after a restart (issue 137), Linux x64 with Bun 1.4.5,
Claude Code 2.1.330, and Codex CLI 0.171.0 installed, after rebasing on
main at `0ba893c` and addressing the review:

- `claude --help`, `codex --help`, and `codex resume --help` read on this
  machine: `codex resume` takes the same options as `codex`, and
  `-i, --image <FILE>...` takes several values, so the app's words go first.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2695 passed, 24 skipped, none failed. Timings the tests
  printed: the quit save of 200 worktrees of 5 sessions 5.2 ms and 86 KB;
  the worst case, a real Codex search in 200 worktrees over 600 session
  files, 299.6 ms in all, stopped by its budget; the Codex search of 300
  files 4.5 ms; the restore of 20 sessions in 5 worktrees with each start
  taking 30 ms: `start()` 0.1 ms, all running after 243 ms, at most 3 starts
  at once, and no gap in the event loop over 5.5 ms.
- `bun run build:web`: built.
- Read only, without starting an agent: the first lines of the Codex
  session files on this machine, which gave the `source` values in
  docs/architecture.md.
- Not run: the desktop window, so quitting and starting the real app with
  real Claude Code and Codex sessions, and the reload check in
  `bun run dev:web`, were seen only through the tests of the main process
  parts, the store, and the mock engine. Windows and macOS.

Run for the command chop tests' shell (issue 221), Linux x64 (Omarchy) with
Bun 1.4.5, where `/bin/sh` is bash 5.3.20, which turns on bracketed paste
even when started as `sh`, on main at `b664d18`:

- Before: `bun test tests/terminals.test.ts` on main at `4f913bd` had 63
  passed, 1 failed,
  1 error. The tab test's chop went in as a bracketed paste and ran, so the
  message it waited for never came. Its wait of 5 seconds matched the test's
  own timeout, so it gave up only after the next test had cleared the
  output, which is why the error showed `Printed: ""`.
- The tab test, the line by line test, and the quiet prompt test now start a
  stand-in shell that prompts and runs each line it reads, and never asks
  for bracketed paste. The chop tests' wait is 4 seconds, inside the test.
- Broken on purpose, then restored: with `chopRunBytes` typing a tab, the tab
  test failed; with it always pasting, those three tests failed.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2806 passed, 24 skipped, 0 failed, no errors.
- `bun run build:web`: built.
- Not run here: a machine where `/bin/sh` is dash. CI runs `bun test` on
  ubuntu-24.04, where it is.

Run for prompt chops (issue 175), Linux x64 with Bun 1.4.5, bash 5.2.21,
and Git 2.43.0, after rebasing on main at `6ce7d27`:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2837 passed, 24 skipped, 0 failed (before the rebase, on
  main at `640ae42`: 2651 passed with the change, 2644 without it).
- `bun run build:web`: built.
- New tests run real pseudo terminals with pretend agents: one that never
  probes gets the prompt as one bracketed paste and then Enter once it
  asked for bracketed paste and went quiet, started with the same command
  line as without a prompt; one that probes and reports `blocked` gets
  nothing while blocked, then the prompt once it reports `idle`; one that
  is never ready, or ends first, gets nothing and its session says why; a
  prompt is refused for a shell, setup, and text a paste must not hold;
  `sendPrompt` writes at once to a running agent and refuses a shell,
  another worktree or repository, a session that is gone, multi-line text
  without bracketed paste, and an agent still waiting for its own prompt.
  `tests/chops.test.ts` runs prompt chops against a real repository's
  `.timber/chops.json`, approval included.
- Claude Code 2.1.330, by hand, through `createTerminalSessions` with the
  probe answered and the window's replies to its other queries acted out:
  in a trusted folder it probed, reported `idle` about 0.8 seconds after
  start, got a two-line prompt as one paste and Enter, and answered it in
  one turn (`working`, then `done`); in a folder it did not trust it
  reported `blocked` with "trust this folder" and the prompt stayed
  pending, unanswered. Sent to a running Claude Code with `sendPrompt`,
  the two-line prompt was also answered in one turn. Enter 0 ms and 100
  ms after the paste both submitted it whole; 100 ms is kept.
- Codex 0.169.0: not verified. Started the same way, it never probed and
  turned on bracketed paste at once, then showed its sign-in screen in
  this environment although `codex login status` says it is logged in, so
  no prompt was sent to it. This is the limit the readiness rule documents:
  for an agent that reports nothing, the app cannot tell its input from a
  first-run screen that takes Enter.
- Not run: the desktop window or the browser build by eye, so the "+" menu,
  the Send prompt dialog, and the approval dialog were not seen drawn.
  Windows and macOS were not tested.

Run for the issues board (issue 155), Linux x64 (Omarchy, Hyprland) with
Bun 1.4.5, Timber 0.1.3 installed, and Timber's main branch at `4c42ed0`
built with `bun run build` and run with Bun through a wrapper named by
`TIMBER_APP_TIMBER_PATH` (main still calls itself 0.1.3):

- New tests: `tests/issue-lists-parse.test.ts` reads records recorded from
  that build (GitHub assigned with a linked worktree, open cut off at 3, an
  empty Linear assigned list, a GitHub project iteration holding issues of
  another repository, an empty milestone, a missing milestone, a sprint not
  set up, no tracker named, Jira sign-in needed, offline, and 0.1.3's
  "unknown command") and refuses records that do not add up.
  `tests/issue-lists.test.ts` runs a stand-in Timber (arguments, standard
  input closed, a 500-issue sprint, timeout, refusals, nothing logged), the
  mock engine, and the real Timber on a temporary repository with nothing
  set up, checking that files and refs are left as they were.
  `tests/issue-board.test.tsx` covers the columns (none ever dropped), the
  words, which list and tracker show, the remembered list in the layout, and
  the board in the window: nothing read until it opens, a list not set up
  leaving the picker and coming back on Refresh, late answers kept on their
  own list, offline keeping the last list, and the unsupported message.
- The app's `listIssues` (`src/bun/issue-lists.ts`) against real trackers,
  from this repository's primary checkout: GitHub assigned found 3 with #155
  marked with its worktree (1067 ms); GitHub open found 23 (950 ms); GitHub
  sprint not configured (89 ms); Jira sprint sign-in needed, as this machine
  has no Jira site (89 ms); Linear assigned found 0 with Linear's real login
  (268 ms); Linear sprint not configured, as no team is set (94 ms). In a
  clone with `.timber.toml` naming `[github].project = "Coding-M8s/2"`: the
  current iteration "Iteration 1", 3 issues from Coding-M8s/timber (1354
  ms). With `[github].milestone = "10 Shipping"`: 4 issues (933 ms). With a
  milestone that does not exist: not found (422 ms). `git status` of the
  primary checkout was clean before and after.
- Jira, in another repository on this machine that has a Jira site and
  login set up in Timber: assigned found 8 (2032 ms), two marked with their
  worktrees, with statuses in both open and in-progress categories. With
  `[jira].project` and `[jira].sprint_jql` (`project = <key> AND sprint in
  openSprints()`) added to its local, untracked `.timber.toml` for the run
  and then restored byte for byte (checksum matched, refs unchanged): the
  sprint, a saved Jira query with no name, found 57 (1491 ms), sorted by
  `boardColumns` into Open 7, In progress 12, Done 38 in 0.19 ms; open found
  50 and truncated (1274 ms), into Open 39 and In progress 11. Those records
  hold a company's issues, so they were read and deleted, not kept as
  fixtures. A Jira board sprint (`[jira].board`) was not tried.
- Linear, with Timber's real Linear login and `[linear].team` naming a real
  team, in the clone: sprint none, as the team has no active cycle (224 ms,
  kept as `linear-sprint-none.json`); open found 4, all "Todo" (239 ms);
  assigned found 0 (235 ms). A found Linear cycle was not tried.
- In the mock engine (`vite --port 5191`) in Chrome: opening timber's
  Issues row showed the v0.3 milestone in Open and Done with #41's worktree
  pill; switching the Tracker field to Jira showed TIM Sprint 14 in three
  columns with "To Do, Selected for Dev", "In Review, In Progress", and
  "Done, Won't Do". Offline on Refresh kept the 7 cards with "offline" and
  Timber's reason as its tooltip. A sprint not set up left the picker with
  Assigned to me shown and the hint, and came back on Refresh once set up.
  The pill showed its worktree and put the board away. Picking a list saved
  it in the layout. Switching between a 3-issue list and a cached sprint,
  measured from the click to a forced layout: 140 issues 13.5 to 23.6 ms
  (three runs; a long-task observer over two switches reported none), and
  500 issues 33 and 51 ms (two runs, no long-task observer). Sorting 500
  issues into columns stays under 50 ms in `tests/issue-board.test.tsx`.
- `bun run typecheck`: no errors.
- `bun run typecheck:desktop`: no errors.
- `bun test`, after rebasing on main at `0ba893c`: 2619 passed, 27
  skipped, none failed, with the installed Timber 0.1.3. With
  `TIMBER_APP_TIMBER_PATH` naming the main build: 2622 passed, 19 skipped,
  none failed.
- `bun run build:web`: built.
- Not run: the desktop window.
Run for repository groups (issue 130), on 2026-11-20, Linux x64 (Fedora 44,
sway) with Bun 1.4.2, Git 2.56.1, Timber 0.1.3, and Google Chrome 157:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 2216 passed, 18 skipped, none failed, in 65.99 seconds. Before
  the change, on the base it started from, the same machine ran 1999 tests in
  69.5 seconds.
- `bun run build:web`: built.
- `tests/repository-groups-browser.test.ts` drives the installed Chrome over
  its debugging protocol, with the app on the mock engine served by Vite: 9
  tests in about 4 seconds, 25 runs in a row with none failing, and 8 more
  together with the terminal tests. They cover
  what a test without a window cannot: the keyboard going to the name field
  and back, typing a name, the keys in a menu, and pointer drags. Each of the
  three faults found by hand (a click lost after a drag across groups, the
  keyboard lost after a menu move, a refused name field left behind) was put
  back in turn, and each made a test here fail.
- `bun run start` on a private headless display (weston 15 with Xwayland,
  input through XTest), with `XDG_CONFIG_HOME` at a temporary folder holding
  four real repositories, reading the settings file after each step. Two
  groups were made by clicking New group and typing; a repository was added
  from its menu; two were dragged onto group headers; a group was folded by a
  click, Enter, and Space; one was renamed from its menu; groups were
  reordered by a drag and by Alt+Down; Shift+F10 opened a group's menu. After
  quitting and starting again the groups, their order, their repositories,
  and the folded one were as left. Delete group then left its repositories
  in the list, loose, and forgot that it was folded, and Take out of the
  group made a repository loose. Each step was in the file as expected.
- CI on Windows (`test-windows`, which may fail without failing the run):
  1933 passed and 58 failed, the same 58 tests by name that fail on main at
  `05160e1` (1830 passed, 58 failed).
- CI on Linux ran the browser tests too, and all 9 passed there. One run of
  `check` failed once in `tests/terminals.test.ts` ("after the shell ended by
  itself, a program started with nohup goes on until the session is
  dismissed"), which this change does not touch; the other run of the same
  commit passed, and so did the failed one when run again unchanged.
- Not run: the browser tests on Windows, where they are skipped; the desktop
  app by hand on Windows, macOS, or under WSLg.
- After main moved by 49 commits (arenas, Clean up merged, port warnings, and
  the Changes comparison in the layout), the change was put on top of it again
  on 2026-11-20. The repository's menu now starts with main's "Clean up
  merged", and the section keeps main's "+" menu, arenas, and port warnings.
  `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built. `bun test` with Bun 1.4.2: 2641 passed, 23
  skipped, none failed, the nine browser tests among them. Not run again after
  this: the desktop app by hand.
- Put on top of main again on 2026-11-20, at `26f5536` (16 more commits:
  the issues board, chops, sessions after a restart, and the repository
  header's look). Each repository section now starts with main's Issues
  row, its rows take the seen statuses, and a folded group sums up only
  unseen ones. The layout keeps main's `issueLists` beside `collapsedGroups`.
  Bun 1.4.5: `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built. `bun test`: 3002 passed, 27 skipped, none
  failed, the nine browser tests among them. Not run again after this: the
  desktop app by hand.

Run for shipping Timber inside the app (issue 30), on 2026-11-21, Linux x64
(Omarchy) with Bun 1.4.5, Git 2.56.1, and Timber 0.1.4:

- `bun scripts/fetch-timber.ts`: downloaded `timber-v0.1.4-linux-x64`,
  `LICENSE`, and `THIRD_PARTY_NOTICES.txt` from the v0.1.4 release, each
  matching `timber-pin.json`, into `vendor/timber/v0.1.4/linux-x64`. The
  binary printed 0.1.4. A run with a wrong checksum fails and keeps nothing
  (`tests/fetch-timber.test.ts`, against a fake download).
- `bun run build`: a first build left the `timber` folder out, because
  Electrobun reads `electrobun.config.ts` from a folder of its own and the
  check was relative. The check now starts from the config's own folder,
  and `tests/bundled-timber-build.test.ts` reads the config from another
  folder. Built again: the packed app (`Resources/*.tar.zst`, unpacked)
  holds `Resources/app/timber/` with `timber` (mode 755), `LICENSE`, and
  `THIRD_PARTY_NOTICES.txt`, and that `timber` printed 0.1.4.
  `linux-x64-Timber-Setup.tar.gz` grew from 52 MB to 93 MB.
- `TIMBER_APP_REQUIRE_BUNDLED_TIMBER=1 electrobun build --env=dev`, as the
  release workflow builds: with the `vendor` folder moved away it failed
  with "vendor/timber/v0.1.4/linux-x64 is missing"; with it back it built,
  with `timber` in the app.
- The built app's bundled Timber, through `chooseTimber` and `checkTimber`
  with `PATH=/usr/bin:/bin` and no timber on it: ready, source `bundled`,
  0.1.4. `listWorktrees` with it listed a new temporary repository.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built. `bun test`: 3050 passed, 19 skipped, none
  failed. Again with only the pinned binary on PATH (no `~/.local/bin`), as
  CI now runs: 3050 passed, 19 skipped, none failed.
- Settings opens from the Timber notice's Choose Timber, the one dialog that
  opens without a usable Timber (`tests/app-shell.test.tsx`).
- Not run: the installed desktop app by hand (New, Open, Done, and Rebase
  through the window with no Timber installed, switching Settings, Timber,
  Executable, and About), the Windows build, and macOS, which is not built.

Run for updating the app from GitHub releases (issue 32), Linux x64 with
Bun 1.4.5 and Git 2.56.1:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3087 passed, 19 skipped, none failed. The updater is stood in
  for (`tests/app-updates.test.ts`), the store and window run through the
  mock engine (`tests/app-update-view.test.tsx`), and the quit guard's
  `confirmWith` and the release workflow's files have their own tests.
- `bun run build`: wrote `stable-linux-x64-Timber.tar.zst` (90 MB),
  `stable-linux-x64-update.json`, and `stable-linux-x64-update-v2.json`
  beside the installer, and printed "delta patch generation disabled". The
  bundle's `Resources/version.json` has `"baseUrl":
  "https://github.com/Coding-M8s/timber-app/releases/latest/download"`.
- `curl -sIL` of a `releases/latest/download/<asset>?0123abcd` address of
  a public release (Timber's `LICENSE`): 200 after GitHub's redirect, so
  the updater's added query does not break the address.
- Not run: an installed build updating to a newer published one on Linux
  or Windows, an interrupted update, and being offline in the installed
  app. The first release that can update is the first built with the update
  address, and it needs a later published release to update to.

Run for passing a lowercase Jira or Linear key when that tracker is picked
(issue 196), Linux x64 with Bun 1.4.5, Git 2.43.0, and Timber 0.1.4:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- `bun test`: 3090 passed, 19 skipped, none failed. `issueSelector` cases
  are in `tests/issue-trackers.test.ts`; the dialog's footer and request
  with `eng-42` and Jira, and `eng-7` and Linear, are in
  `tests/new-worktree-tracker.test.tsx`.
- Timber 0.1.4 in a new temporary repository, with an empty home so no
  saved settings applied: `timber new jira:eng-42` stopped with "Jira site
  settings are missing or disabled" and `timber new linear:eng-42` with
  "Linear credentials are missing", so both read as selectors; `timber new
  jira:eng` still stopped with "Invalid Jira issue selector". No worktree
  or branch was made.
- With no `default_tracker` set, the Tracker field's Default is now plain
  "Default", even with a Jira site, since Timber 0.1.4 reads every bare
  name as a branch then (`tests/issue-trackers.test.ts`,
  `tests/issue-trackers-reader.test.ts`).
- Not run: a lowercase key against a real Jira site or Linear workspace,
  and the installed desktop app by hand.

Run for Check out PR on the issues board (issue 211), Linux x64 with Bun
1.4.5, Git 2.56.1, and Timber 0.1.4 installed:

- `timber __app-issues open --tracker github --limit 100` in this
  repository: `found`, 37 issues, every one with `pullRequests: []` (none
  null). The repository had no open pull request, so no card offered Check
  out PR against the real tracker. The recorded GitHub project iteration
  fixture (`tests/fixtures/timber-app-issue-lists/sprint-iteration.json`)
  holds a real linked pull request (#139 of Coding-M8s/timber, a draft),
  and `tests/issue-lists-parse.test.ts` reads it.
- `timber __app-issues sprint --tracker jira` here: `failed`,
  `sign-in-needed`, "Jira is not set up for this repository." Jira was not
  tested against a real site; only the mock engine's Jira sample was.
  Linear was not tested and is not claimed.
- In a fresh clone of this repository in a temporary folder,
  `timber open --issue github:203 --no-setup --result-file <file>
  --no-editor --no-agent -- GH-203-show-an-agent-s-status-as-seen-once-you-visit-its-session`
  with standard input closed: exit 0, record `succeeded`, `materialized`
  true, the worktree on that branch with `issue` linked to `github:203`.
  `timber __app-issues search --tracker github -- 203` then gave issue 203
  that worktree, which is what gives a card its pill. The pull request's
  head branch named without its remote opened the remote branch.
- In the same clone, the same branch with `--issue github:131`: `failed`,
  "This worktree is already linked to github:203; nothing was changed.
  Rerun with --replace-issue to replace the link." A branch that does not
  exist (`patch-1-from-a-fork`): `failed`, "No existing branch or worktree
  matches ...". Neither asked anything. Timber 0.1.4's `open` never chooses
  a base, so there is no base question to refuse; the app runs it with
  standard input ignored and no chooser, so anything ambiguous fails with
  Timber's text.
- `tests/worktree-commands.test.ts` against the real Timber: a bare head
  branch name opens `origin/<branch>`; with a stand-in Timber, `--issue
  <selector>` comes first among the options and anything but a whole
  selector is refused before Timber runs.
- Against this pull request (#257), linked to issue 211 by "Closes
  #211", in a fresh clone of this repository with no worktree for it:
  `timber __app-issues open --tracker github --limit 100` gave issue 211
  `worktree: null` and `pullRequests` [#257, head
  `GH-211-check-out-an-issue-s-open-pull-request-from-the-board`,
  `fromFork: false`, `draft: false`]. The app's own `readIssueListRecord`,
  `githubRemoteRepository` (`Coding-M8s/timber-app`), and `checkOutChoice`
  on that record offered Check out PR on 211 only, and
  `openWorktreeArguments` built `open --issue github:211 --no-setup
  --result-file <file> --no-editor --no-agent -- <that branch>`. Running
  exactly those arguments with standard input closed: exit 0, `succeeded`,
  `materialized` true, linked to `github:211`, upstream
  `origin/GH-211-...`. Reading the list again gave 211 that worktree, so
  the card shows its pill and no Check out PR.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built. `bun test`: 3118 passed, 19 skipped, none
  failed.
- Not run: the desktop window or the browser build by eye, so the card,
  the dialog, and the Pull request tab after a check out were not seen
  drawn (the GitHub check out above ran the app's logic and the exact
  command, not the window); Jira and Linear against real trackers; Windows
  and macOS.

Run for comparing with a commit base (issue 192), Linux x64 with Bun
1.4.5, Git 2.43.0, and Timber 0.1.4:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- `bun test`, after rebasing onto main: 3134 passed, 19 skipped, none
  failed. One earlier full run had `tests/worktree-pr.test.ts` stop at its
  5 second limit while running the installed Timber; it passed alone twice
  and in the next full run, and this change touches only a comment in the
  code it covers.
  `tests/timber-ls-parse.test.ts` reads a commit base by its full SHA-1
  or SHA-256 hash and refuses the list for an abbreviated, uppercase, or
  misnamed one.
- `tests/file-changes-base.test.ts`, in a real temporary repository: a
  commit made on a detached HEAD, which `git for-each-ref --contains`
  shows no branch or tag contains, compares from `git merge-base <commit>
  HEAD`, the same files and diffs as the branch's own base, and leaves
  files, index, and refs as they were. A commit HEAD descends from is its
  own branch point. A hash not in the repository, a tag object's hash,
  and a tree's hash cannot be used, each with its reason.
- `tests/saved-base.test.ts`, with the installed Timber 0.1.4:
  `timber new feat/commit --base <hash>` of a commit no branch contained
  is listed by `timber ls --json` as a commit base, shown as `Base
  <first seven characters>`, and starts the Rebase dialog's Onto as the
  full hash. Its `beforeAll` now allows four times the per-test limit,
  since four runs of Timber took about 1.7 seconds each here.
- Not run: the installed desktop app by hand, a SHA-256 repository with
  real Git, and a partial clone.

Run for showing that the Changes tab refreshes (issue 191), Linux x64 with
Bun 1.4.5 and Git 2.43:

- `bun run typecheck`: no errors.
- `bun test`: 3142 passed, 19 skipped, none failed.
  `tests/changes-tab.test.tsx` renders the bar at rest and during each kind
  of read (the tab's Refresh, the sidebar's Refresh, a reported change, a
  read of the changes, and a switch of "Compare with"), checks the pure
  refresh span for a first read, a refresh, and a switch mid-refresh, and
  checks the reduced-motion rules in `styles.css`.
- `bun run build:web`: built.
- Not yet looked at in a window or with a screen reader: the 300 ms hold runs
  in an effect, which the markup tests do not run.

Run for setting the base from the Changes tab (issue 190), Linux x64 with
Bun 1.4.5, Git 2.43, and Timber 0.1.4:

- `bun install --frozen-lockfile`, then `bun run typecheck` and `bun run
  typecheck:desktop`: no errors. `bun run build:web`: built.
- `bun test`: 3192 passed, 19 skipped, 0 failed.
- `tests/fixtures/timber-base` was recorded from `timber base --set
  --result-file` in temporary repositories: set from none, over another
  base, over stale metadata, and to a commit; refused for a missing local
  branch, the worktree's own branch, and malformed metadata; and failed for
  a remote given by a relative URL that could not be checked.
  `tests/timber-base-parse.test.ts` maps each one.
- `tests/worktree-set-base.test.ts`, with the installed Timber: a base is
  saved, changed, set to a commit, and replaces stale metadata, each read
  back by the list; the worktree's files, its index as Git lists it, and
  the refs are unchanged after a set; a refusal leaves those and the saved
  metadata as they were; malformed metadata is refused and kept.
- Timber was also asked by hand: it reads a plain name such as `main` as
  a remote branch and saves `origin/main`, refuses one no remote has with
  "Remote base is missing or ambiguous; use --set <remote/branch>.", and
  refuses `refs/heads/main` for the primary checkout on `main` as the
  worktree's own branch.
- Not run: the installed desktop app by hand, and a remote base checked
  over a real network.

Run for the chops panel (issue 250), Linux x64 with Bun 1.4.5, Git 2.43,
and headless Google Chrome over the mock engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3231 passed, 19 skipped, 0 failed, after a rebase onto main. The
  layout and the `useChops` preference round-trip through the settings
  file in the main process (`tests/saved-layout.test.ts`,
  `tests/preferences.test.ts`), the store over the mock engine remembers
  them across a new store (`tests/chops-panel.test.tsx`), and
  `tests/chops-panel-browser.test.ts` drives the button, Ctrl+Shift+K,
  Close, focus return, the edge's keys, a dialog blocking the key, and the
  "Use chops" switch in Settings in Chrome. With it off, the palette,
  "Insert chop", and `runChop` offer and run no chop
  (`tests/chop-run.test.tsx`).
- `bun run build:web`: built.
- Not run: the desktop window on any platform, a real terminal session
  pressing Ctrl+Shift+K (the terminal's key handler uses the same tested
  `takesChopsPanelKey`), a pointer drag of the panel's edge, and whether
  any desktop on Linux, macOS, or Windows takes Ctrl+Shift+K or
  Cmd+Shift+K before the app. The shortcut was chosen by analysis.

Run for running a chop from the chops panel (issue 251), Linux x64 with
Bun 1.4.5, Git 2.43, and headless Google Chrome over the mock engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3287 passed, 19 skipped, 0 failed, after a rebase onto main. `tests/chops-panel.test.tsx`
  covers the list (counts, rows with source and text, the tabs' keys), the
  filter (names and text, the no-match words), and the run target (the
  footer for commands, for a prompt with no agent, one, or several
  running, and with no agent saved), the shared `chopBlockedReason` with
  the palette, Run disabled with the reason and still focusable with no
  worktree selected, and, over the mock engine, a run through `runChopIn`:
  a personal command opens a terminal in the selected worktree, a
  `.timber/chops.json` chop asks first, Run puts the issues board away,
  Copy leaves the view, a prompt goes to the only agent running after it
  is approved, and nothing runs with "Use chops" off.
  `tests/chops-panel-browser.test.ts` clicks Run in Chrome, types in the
  filter, moves the tabs by keyboard, checks the keyboard stays in the
  panel after Run, that a repository chop asks before its first run, and
  that a click on a blocked Run starts nothing and opens nothing.
- `bun run build:web`: built.
- Not run: the desktop window on any platform, and a real shell or agent
  getting a chop from the panel (the path is the palette's, tested over
  the mock engine and, for the main process, by its own tests).

Run for making, changing, and deleting chops in the panel (issue 252),
Linux x64 with Bun 1.4.5, Git 2.43, and headless Google Chrome over the
mock engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- `bun test`: 3408 passed, 19 skipped, 0 failed, after a rebase onto main.
  `tests/chops-panel-edit.test.tsx` covers the rules the panel saves
  under (`chopsWithSaved`, `chopsWithout`): a new chop at the end, an
  edit kept in its place, a rename, a move to every repository, names
  unique ignoring case within a group and allowed across groups, the
  text and description limits, control characters, bidirectional
  overrides and lone carriage returns, the chop limit, and an edit of a
  chop gone from the settings. A `.timber/chops.json` chop is never a
  target and its menu has only View. Over the mock engine, a chop made,
  changed, and deleted is the list Settings, Chops draws, and the file's
  chops stay listed. Against real temporary repositories, a personal chop
  that overrides the file's chop, changed and deleted through the main
  process's preferences, leaves the file's bytes, its time, and the
  repository's files unchanged, and a chop saved for a repository with
  no file creates no `.timber` folder.
  `tests/chops-panel-browser.test.ts` drives in Chrome: New chop and a
  double Enter that saves once, a half typed form kept across hiding and
  showing the panel, Escape, a double click that edits in place with
  Settings showing the change, Shift+F10 and the actions button opening
  a row's menu, Delete asking first with Cancel on the keyboard, a file
  chop's View with no field to change, Escape giving the keyboard back
  to the row, a file chop asked for while a form is open leaving the form
  as typed, a failed save keeping the form with the reason, and Cancel on
  a delete asked from the edit form going back to the form.
- Not run: the desktop window on any platform, a right click with a real
  pointer (the browser tests open the menu by key and by its button), and
  the WebKitGTK webview.

Run for Pull from a worktree's row (issue 260), Linux x64 with Bun 1.4.5,
Git 2.56.1, and headless Chromium 158 over the mock engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- `bun test`: 3354 passed, 19 skipped, 0 failed, after a rebase onto main.
- `tests/sync-actions.test.ts`, against real temporary repositories with a
  local bare remote: a fast-forward that includes a commit pushed after the
  last background fetch, with no merge commit; a remote that cannot be
  reached (its URL set to a missing local path) still fast-forwards to the
  last fetched commit and reports the fetch failure; a diverged branch is
  refused with Git's message and its commit, status, and merge count
  unchanged; local changes in the way are refused with the modified and
  untracked files, the status, and the stash as they were, also with
  `merge.autostash` set (that test fails without `--no-autostash`); a
  changed upstream, an unlisted worktree, and an incomplete request run
  nothing, not even the fetch.
- `tests/fetcher.test.ts`: a sync action's fetch waits for a running fetch
  and the next one waits for it, runs in the worktree's folder, marks a
  force-push it brings in against real repositories, and puts a failure on
  the repository's fetch state without counting a success.
- `tests/sync-action-browser.test.ts` in Chromium: the control is beside
  the row's button, not inside it; the dialog shows both commands; after
  the pull the control goes, the toast says so, and the keyboard is on the
  row; a failed fetch gives a problem toast with Git's words; a diverged
  refusal stays in the dialog and points to Rebase; Shift+F10 on the row
  opens its menu with Pull first, and Enter opens the dialog.
- Not run: the desktop window on any platform, a real network or sign-in
  failure (the unreachable remote was a missing local path), and a pull
  over SSH or HTTPS.

Run for showing review notes in a panel beside the diff (issue 228), Linux
x64 with Bun 1.4.5 and Git 2.43:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors. `bun run
  build:web`: built.
- `bun test`: 3396 passed, 19 skipped, 0 failed, after a rebase onto main.
  `tests/review-notes.test.tsx` renders the panel after the diff and out of
  the file list's column, with its count, Discard, and Send review; each
  reference with its label (", outdated" when it is), folder, name and
  lines, "removed line" or "removed lines", and its first line ("empty
  line" when blank); the chosen reference with `aria-current`, and its
  lines marked in the diff until the mark is cleared; the Review button
  with `aria-expanded`, `aria-controls`, and the count; and no panel or
  button without notes. The store tests cover the chosen note kept until
  another is chosen or it goes, the outdated message only when none of the
  old lines are left, and a note on its way into view let go when another
  file, comparison, or worktree is chosen first. `tests/review.test.ts`
  covers `noteSpan`, `quotedParts`, and `noteLinesShown`.
  `tests/review-panel-browser.test.ts` in Chromium, at the harness's
  1300 by 900, which is too narrow for the panel beside the diff: the panel
  is hidden and the Review button names the count; the button opens the
  panel over the diff with the keyboard on Close; Escape and Close each
  close it and give the keyboard back to the button; choosing a reference
  closes it, shows the file, marks the line, and the mark goes after a
  moment; deleting a note gives the keyboard to the next reference, and the
  last one going takes the panel and its button and gives the keyboard to
  the diff.
- `bun run dev:web` in headless Chrome 151, driven with puppeteer-core on
  the sample data, nine notes on four files:
  - 1440 by 900: the panel is 300px at the right of the diff. Scrolling its
    list leaves the diff's scroll and the file list where they were.
    Choosing a reference showed its file, marked its 3 lines, focused its
    note, and the marks went after 1.5 seconds while the reference stayed
    chosen. Delete gave the keyboard to the next reference, Cancel in Edit
    to the note's reference, Keep to Discard, and Discard of the last
    notes to the diff.
  - 1100 by 760: the panel is hidden and the Review button shows. It opened
    the panel over the diff with the keyboard on Close; Escape closed it
    and gave the keyboard back to the button; choosing a reference closed
    it and showed the lines.
  - 620 by 760, the stacked layout: the panel opens over the diff, 300px.
  - No page errors, and the page never scrolled sideways at any size.
- Not yet checked: the desktop window by eye, and a screen reader.

Run for starting a review note from a `+` in the diff's gutter (issue 229),
Linux x64 with Bun 1.4.5, Git 2.43, and Google Chrome 151:

- `bun install --frozen-lockfile`, then `bun test` before the change: 3424
  passed, 19 skipped, 0 failed.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3447 passed, 19 skipped, 0 failed. This includes
  `tests/review-drag.test.ts` (the row under the pointer, where a dragged
  range ends and why, and its label) and a markup test that each line that
  takes a note has an `aria-hidden` `+` in its numbers button, with the
  button's name unchanged, and that Git's note and the hunk's header have
  neither.
- `tests/review-gutter-browser.test.ts` in headless Chrome, 12 passed, over
  a file with a 42-line hunk and a second hunk ending in Git's note:
  hovering lights the row and shows its `+`, and Git's note shows neither;
  a click on `+` starts a one-line note, in Base and in Uncommitted; a drag
  over three lines shows "Lines 3-5" beside the pointer and the bar on
  three rows, and letting go opens "Note on 3 lines, ending at line 5"
  with no text selected, in Base and in Uncommitted; a drag stops at 30
  lines ("Lines 2-31 (30 lines at most)") and at the hunk's edge, down
  into the next hunk and up past the header; a drag back to its line
  starts a one-line note, and no label shows before the range reaches
  another line; an upward drag opens the field under the bottom line and
  keeps the text typed; Escape lets go of a drag and starts nothing, also
  when the pointer is then let go on the line pressed, and the note being
  written keeps its text; Enter, the arrows, and Shift+Enter still start
  notes and ranges, in both comparisons, and the `+` shows on the focused
  numbers. The Escape test fails with the click after Escape let through.
- Screenshots of the hover, drag, and let-go states in headless Chrome with
  Timber Dark matched the approved mock.
- Not yet checked: the desktop window by eye, which draws with WebKitGTK,
  not Chrome; whether the `+` hides the first digit of 3 and 4 digit old
  line numbers there; and a screen reader.

Run for the File tab's editor (issue 238), Linux x64 with Bun 1.4.5 and
Google Chrome 151 (headless):

- A plain text box was tried first. In headless Chrome, with the rest of the
  window hidden, a keystroke in a text box took about 3.6 ms at 100 lines,
  9.6 ms at 1,000, 47 ms at 3,000, and 451 ms at 10,000 lines, so it could
  not meet "typing stays smooth in a 10,000 line file". The editor moved to
  CodeMirror 6.
- `bun run dev:web` in headless Chrome, driven over the DevTools protocol,
  with `src/long.ts` (10,000 lines, 607,788 characters) in Edit: 100
  keystrokes in the middle took about 7 ms each, the protocol's round trip
  included. Ctrl+Z, Ctrl+Shift+Z, Tab, Enter, Ctrl+F with Enter to the
  match and Escape back to the text, the history after Workspace and back,
  Ctrl+S, and Ctrl+Shift+P for the palette all worked.
- `bun test tests/text-editor-browser.test.ts`: 10 passed: the same steps
  as a test, typing held under 50 ms a keystroke, and Ctrl+S and Ctrl+F
  from the search field, the first edit after a save reaching the store at
  once, a bar left open coming back without the keyboard, and
  Ctrl+Shift+K deleting no line.
- `bun test`, run twice: 3,445 passed, 19 skipped, 0 failed each time;
  after rebasing on main, 3,475 passed, 19 skipped, 0 failed.
  `bun run typecheck` and `bun run typecheck:desktop`: no errors.
  `bun run build:web`: built.
- Not yet checked: the desktop window (WebKitGTK, WKWebView, WebView2) by
  hand, typing with an input method, and a screen reader.

Run for the review of the File tab's editor (issue 238: code files open
straight in the editor, coloring by language, brackets, and Ctrl+/), Linux
x64 with Bun 1.4.5 and Google Chrome 151 (headless):

- `bun test tests/text-editor-browser.test.ts`: 14 passed. `src/long.ts`
  (10,000 lines) opens straight in the editor with no switch, colored as
  TypeScript, keywords in the theme's magenta and strings in its green;
  saving Nord, then a custom theme with magenta `#ff0000`, recolored the
  open file. 100 keystrokes in the middle of the colored file took about
  14 ms each, the protocol's round trip included (7 ms before coloring).
  The matching bracket was marked, `(` and `"` closed themselves, and
  Ctrl+/ put a `//` comment on the line and took it away. Read again
  after the file changed on disk showed the new text, and a save wrote
  only that plus the typing.
- `bun test tests/editor-language.test.ts`: TypeScript, JavaScript, JSON,
  Markdown, CSS, HTML, Python, Rust, Go, shell, YAML, and TOML each picked
  and colored; loading Rust's parser loaded no other language's; an
  unknown kind and a file over 15,000 lines stay plain with the reason.
- Screenshots of a `.tsx` file in Timber Dark, Timber Light, and Gruvbox
  Dark, looked at by eye.
- `bun test`: 3,486 passed, 19 skipped, 0 failed; after rebasing on main,
  3,622 passed, 19 skipped, 0 failed. `bun run typecheck` and
  `bun run typecheck:desktop`: no errors. `bun run build:web`: built, each
  language in its own chunk.
- Not yet checked: the desktop window by hand.

Run for keeping hand-set keys inside a table a settings group saves (issue
275), Linux x64 with Bun 1.4.5, Git 2.43, and Timber 0.1.4:

- `bun install --frozen-lockfile`, then `bun test` before the change: 3447
  passed, 19 skipped, 0 failed.
- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3450 passed, 19 skipped, 0 failed. The two new tests in
  `tests/timber-settings.test.tsx` and the new one in
  `tests/setup-wizard.test.ts` failed with the old `valuesWith` and pass
  with the new one. After rebasing onto main: 3457 passed, 19 skipped, 0
  failed, and both typechecks without errors.
- Against the real Timber 0.1.4, in a temporary repository with an
  untracked `.timber.toml` and a temporary `HOME`: a script read the
  repository scope with `timber __app-config read`, set the default tracker
  to Jira through `draftsOf` and `valuesWith("tracking", ...)`, and saved
  with `timber __app-config apply`, as Settings does.
  - With the old code, the saved `[jira]` lost `board = 123` and
    `project = "TIM"`.
  - With the change, `[jira]` kept `board` and `project`, `[agent]` kept
    `resolve_handoff` and `resolve_instructions`, and `default_tracker`
    became `"jira"`. A second file with `sprint_jql` kept it too.
- Not yet checked: the same save through the desktop window, and the setup
  wizard against the real Timber (it saves through the same `valuesWith`).

Run for the file explorer in the side panel (issue 239), Linux x64 with
Bun 1.4.4, Git 2.56, and headless Google Chrome over the mock engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun test`: 3497 passed, 19 skipped, 0 failed, after a rebase onto main.
  `tests/worktree-folders.test.ts` lists folders of a real temporary
  repository with a linked worktree: folders first, `.git` left out,
  ignored entries hidden or marked, a tracked file never ignored, an
  ignored folder opened, links listed and never followed, a submodule asked
  what it ignores, and paths outside, missing, a file, and unlisted
  worktrees refused. Every listing, ignored entries shown and hidden,
  leaves files, refs, worktrees, status, and both index files as they were.
  A real watch hears an untracked and an ignored file made and removed, and
  stops for a folder no longer asked for. `tests/files-panel.test.tsx`
  covers the store over the mock engine (the two views, chops off, reading
  and watching, changes, ignored entries, stale answers), and
  `tests/files-panel-browser.test.ts` drives the Files button,
  Ctrl+Shift+E, the switch, Ignored, clicks, and the tree's keys in Chrome.
- Not run: the desktop window on any platform, a real terminal session
  pressing Ctrl+Shift+E (the terminal's key handler uses the same tested
  `takesFilesPanelKey`), and whether any desktop takes Ctrl+Shift+E or
  Cmd+Shift+E before the app; some Linux input methods, such as IBus, use
  Ctrl+Shift+E for emoji. The shortcut was chosen by analysis.

Run for Push from a worktree's row (issue 261), Linux x64 with Bun 1.4.5,
Git 2.56.1, Timber 0.1.4 on the PATH, and headless Chromium over the mock
engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- `bun test`: 3541 passed, 19 skipped, 0 failed, after a rebase onto main.
- By hand, `timber publish --result-file <file> -- <worktree>` in a
  temporary repository with a local bare remote wrote records with
  `publish.result` `published` and then `up-to-date` (outcome succeeded,
  exit 0), `refused` when another clone had pushed first (outcome failed,
  exit 1, "has moved on ... Nothing was pushed and no local ref changed"),
  and `failed` with the remote URL set to an HTTPS host that does not
  resolve (outcome failed, exit 1, "Git push to origin/main failed"). `tests/timber-publish.test.ts` reads
  records of those shapes, plus a missing file, a record for another
  worktree, and a publish object that is missing, unknown, or does not go
  with the outcome.
- `tests/sync-actions.test.ts`, with the real Timber against real temporary
  repositories and a local bare remote: an ahead branch is pushed, the
  remote's branch is the worktree's commit, the list reads the branch as
  level with no fetch, the worktree's files are as they were, and the
  remote's `main` did not move; a remote branch that moved on is refused
  with Timber's words, and every ref of the clone and the remote is
  unchanged; a remote that cannot be reached (its URL set to a missing
  local path) fails with Timber's words and Git's in the details, and no
  ref changed; a Timber that is not ready and a changed upstream run
  nothing.
- `tests/fetcher.test.ts`: a push waits for the fetch that runs, and the
  next fetch waits for the push; a repository not in the list runs no push.
- `tests/sync-action-ui.test.tsx`: the Push control replaces the ahead
  marker; it and the menu entry are not offered for a behind, diverged,
  level, force-pushed, gone, unpublished, or detached branch, nor while
  Timber removes the worktree; the dialog shows the `timber publish`
  command; through the store and the mock engine, a push leaves the row
  level with no refresh, and a refusal, an offline or sign-in failure, and
  a missing result leave the counts as they were.
- `tests/sync-action-browser.test.ts` in Chromium: the Push control on
  `feat/github-issue-lookup` shows the `timber publish` command, and after
  the push the control goes, the toast says so, and the keyboard is on the
  row; a moved-on refusal and an offline failure stay in the dialog with
  Timber's words and the control stays; Shift+F10 on the row opens its
  menu with Push first, and Enter opens the dialog. On a row that is not
  selected, the point where the control is drawn is still the control once
  the pointer is there. That test fails with the layout from issue 260, in
  which the control moved left as the row's other controls showed and the
  open-in-editor button took its place; now the control stays put on rows
  with other controls, for Pull too.
- `tests/sidebar-row-width-browser.test.ts`: every sample row still fits
  with the two new Push controls, since only the first line keeps the
  extra room.
- `tests/palette.test.ts`: Push is listed for the ahead worktree with the
  Timber command in its hint, and Pull only for the behind one.
- Not run: the desktop window on any platform, a push over SSH or to a
  real HTTPS host, and a real sign-in failure (the app's push tests used a
  missing local path as the unreachable remote).

Run for favorites and ordering in the chops panel (issue 253), Linux x64
with Bun 1.4.5, Git 2.43.0, and headless Google Chrome 151 over the mock
engine:

- `bun run typecheck` and `bun run typecheck:desktop`: no errors.
- `bun run build:web`: built.
- `bun test`: 3593 passed, 19 skipped, 0 failed, after a rebase onto main.
  The run before it had one failure, a timeout in
  `tests/worktree-pr.test.ts` while the installed Timber listed worktrees
  under load; that file passed alone (9 passed) and in the full rerun.
  `tests/chop-order.test.tsx` covers the order logic: favorites first,
  then the rest, then chops neither list names, in listed order; a move
  before a chop or to the end of a part; a drop into Favorites that pins
  and out of them that unpins; the star's place at the end of Favorites
  and the top of the rest; names not listed kept after the listed ones,
  and dropped first at the limit; Alt+Up and Alt+Down taking the place of
  the row shown next to it, with the other tab's chops and rows hidden by
  the filter left in place, never crossing between the parts, and
  stopping at the ends; the words the live region says; the drop place
  for a pointer position; reading a change whole or not at all, and
  salvaging a hand-edited file; and renames for one repository or every
  repository, two chops swapping names, a rename onto a deleted chop's
  name, a chop for every repository hidden by one for a repository under
  its old or new name, and the renames Settings, Chops finds by row among
  moved, added, and removed rows; the oldest repository's order dropped
  past 200; handles and stars off with the reason while the saved settings
  cannot be read; a renamed chop keeping its place until the list is read
  again; a chop for a repository deleted in the same save not holding back
  a rename to its name; no empty "Other chops" heading; and how fast the
  list scrolls for a drag at each distance from its edges. Over the mock engine, quick moves add up before their saves
  answer, a failed save shows the saved order again, and the panel draws
  Favorites first with a pressed star and a handle on each row. Against a
  real temporary repository, a `.timber/chops.json` chop starred through
  the main process's preferences is read back by a new settings holder,
  as at a restart, for that repository only, and the file's bytes, its
  time, and the repository's files are unchanged.
  `tests/chops-panel-browser.test.ts` drives in Chrome: Alt+Up on a
  handle and Alt+Down on a Run button move the chop, keep the keyboard on
  that control, say the new place, and save; Alt+Up at the top says the
  chop is already first; the star pins a file chop to the top with the
  keyboard on the star; dragging a handle onto the Favorites drop zone
  pins the chop; dragging reorders within Favorites and drops a chop out
  of them; Escape puts a drag away; a press let go beside the handle
  leaves no drag behind for a later hover or a later press elsewhere; a
  rename whose save fails leaves the rows where they were; the last of 32
  chops dragged to the top of the list scrolls it to its top and lands
  first; the same words
  said twice
  change the live region; a starred chop renamed in the panel's form
  keeps its place and star with no frame where it jumps; and a chop
  renamed in Settings, Chops keeps its place in the panel.
- Not run: the desktop window on any platform, the WebKitGTK webview, and
  a screen reader.
