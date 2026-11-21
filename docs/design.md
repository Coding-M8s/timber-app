# Design

The interface decisions agreed on the clickable prototype. Build toward these;
change them here first when they change.

## Layout

- One window: a sidebar of worktrees and, opposite it, the workspace for the
  selected worktree. Sidebar side (left or right) is a setting, not a button.
- No built-in code editor. "Open in editor" launches the configured one.
- A command palette (Ctrl+Shift+P, Cmd+Shift+P on macOS, or the title bar
  button) searches actions and worktrees. It opens the same dialogs as the
  buttons.
  - With a worktree selected it is scoped to that worktree's repository: a
    chip in the box names the repository and worktree, and rows do not
    repeat them. Backspace in the empty box, or the chip, widens it to every
    repository. With nothing selected it starts unscoped.
  - With nothing typed, entries are in sections: In the worktree (terminal,
    agents, Rebase, Open in editor, Done), In the repository (New worktree,
    Open existing branch, New arena, Fetch now, Clean up merged), the
    repository's worktrees with the current one marked and their sessions'
    marks, and App (next session, Settings, Add repository). Actions that
    cannot run now are left out and named in one line under the list.
  - Typing ranks matches. Scoped, this repository's come first, then other
    repositories' worktrees under "Other repositories", never their actions.
    An action that cannot run is found too, dimmed.
  - A line under the list says what the highlighted entry does, or why it
    cannot run.
- Ctrl+Shift+J (Cmd+Shift+J on macOS) shows the next session that needs
  you, in any repository, the one that has waited longest first, and after
  those the sessions that are done, the one that finished first first. It
  selects the worktree, shows the session, and gives it the keyboard;
  pressed again, it goes on to the next one and around. A done session
  goes from the list once it has been on screen and the person moved on,
  and one that finishes on screen never joins it. After the window
  reloads, those already waiting or done are taken in the order they
  started. While any are listed, the title bar says so, each part in its
  state's color with its shape: "2 need you", "1 done", or both, and a
  click does the same as the shortcut. With none the key does nothing and
  the title bar shows nothing. The command palette has "Show next session
  that needs you or is done", with the shortcut beside it.

## Sidebar

- Worktrees are grouped under collapsible repository headers. Selecting a
  worktree in another repository switches to it.
- A repository's header stands apart from its worktree rows: its name is
  in the main text color, a step larger and heavier than a worktree's, and
  each repository after the first has a hairline and extra space above it.
  An unavailable repository's name stays faint.
- Drag a repository header to move its group; a line shows where it will
  land. Alt+Up and Alt+Down move a focused header one place. The order is
  remembered between runs.
- Each repository header has a "+" that opens a small menu, "New
  worktree..." and "New arena (Beta)...", and a "Fetch now" control. An "Add
  repository" control sits below the list. New arena is disabled, with the
  reason, when the Timber found has no arenas for apps.
- An arena's attempts sit together under its header, "Arena <name>" with a
  "Beta" tag and a short detail ("2 attempts from main @ abc1234", or
  "1 attempt, codex-1 kept" after a pick). Each attempt's row shows its label
  instead of the branch, and its agent's state as any row does. A worktree
  belongs to an arena only when Timber lists it at that path and Git still
  has it as Timber created it, never because of its branch or folder name.
  Clicking the header opens Compare.
- The app fetches every repository in the background, on an interval from
  Settings that can be turned off. A failed fetch, such as while offline or
  without stored credentials, shows a quiet grey word beside the
  repository's name ("offline", "sign-in needed", "fetch failed") with the
  reason in its tooltip. Never a dialog, and never a prompt for credentials.
- Each row shows the branch, its state against the remote, each agent with
  its state, other running sessions as a count, and uncommitted changes. Its tooltip gives the path and the base Timber saved
  for the worktree, or "No saved base". Saved base metadata Timber cannot use
  is a warning, "base unknown", never a guess. A Timber that reports no base
  gets none shown. A worktree made from an issue adds the issue's key and the
  tracker's status to the tooltip, such as "(PROJ-123 · In Review)" or
  "(#153 · Open)" for GitHub, or the key and a quiet reason, such as
  "(PROJ-123, offline)", when the status could not be read. The row itself
  shows nothing more: its lines are full.
- Branch state follows VS Code conventions: a down arrow with a count for
  commits to pull, an up arrow for commits to push, "force-pushed" when the
  remote branch was rewritten, "upstream gone" when it was deleted, and "local
  only" when it was never published. "force-pushed" stays until the person
  has selected that worktree and moved on. Modified and untracked counts use
  the yellow `M` and green `U`.
- A row whose branch has a pull request shows it with its state, on the
  line under the branch: `#42` while open, or `#42 draft`, `#42 merged`,
  `#42 closed`. An open or draft one adds its checks ("checks pass",
  "checks fail", "checks running") and its review ("approved", "changes
  requested", "review required"). Each word has its sentence as a tooltip.
  They are grey, except failing checks and requested changes, which are red
  with their words. A merged or closed one shows only its number and state,
  so "merged" says the worktree can go. A branch with no pull request shows
  nothing.
- Pull requests that could not be read get a quiet grey word beside the
  repository's name, once, as one lookup answers for all its branches:
  "PRs offline", "PRs need sign-in", "not on GitHub", "PRs failed", or "PRs
  unknown" when Timber's answer could not be read. The reason is in its
  tooltip. Never a dialog, and never a prompt to sign in.
- An agent's state comes from the Program Status Protocol (OSC 7501) it
  writes to its terminal: Working, Needs you (approval, question, or
  sign-in), Done, Idle, Error, Stopped, or crashed with its code. Each has
  its own shape as well as its color; Needs you is a diamond, or a raised
  hand when the agent asks a question. A thin rounded outline in the state's
  color holds the shape and the agent's initial; the tooltip names the
  agent. Claude Code and Codex show their makers' official marks there
  instead of letters (Claude's spark, OpenAI's mark), and on their chip. An agent that reports nothing shows as running.
- A collapsed repository header sums up its agents, such as "1 needs you, 2
  working", Needs you first. An expanded one adds nothing.
- When an agent needs you, is done, reports an error, or crashes in a
  worktree that is not on screen, a desktop notification says so; clicking
  it shows that session. Never for the worktree on screen in a focused
  window. A session has at most one: its next one takes its place, and it
  goes away once it no longer holds, such as when its worktree comes on
  screen. A sound can say it too: off until a state is ticked for it.
  Settings, Notifications chooses which states notify, which play a sound,
  and the sound: one of three that come with the app, the system's, or a
  file of the person's own, with Play to hear it.
- Right-clicking a worktree row, or Shift+F10 or the context menu key on a
  focused row, opens a menu for that worktree, whichever one is selected.
  It holds Done, which opens the same Done dialog as the workspace header.
  For a primary checkout, or while Timber removes the worktree, Done is
  disabled, and the menu says why. The arrows
  move through the menu; Escape and Tab give the keyboard back to the row,
  as do scrolling the list, resizing the window, and leaving it. A click
  elsewhere puts the menu away.
- Right-clicking a repository's header, or Shift+F10 or the context menu
  key on it, opens a menu for that repository, which works the same way. It
  holds Clean up merged, disabled with the reason until at least one linked
  worktree of the repository has a merged pull request. The command palette
  has the same action, with how many merged: scoped, only its repository's,
  and unscoped, one per repository. With nothing typed it shows only when
  it can run. While there are merged
  worktrees, the header also shows a Clean up merged button before Fetch
  now, with how many there are, not counting those already being removed.
- Timber's backups are listed below a repository's worktrees, under
  "Backups", with their branch, how long ago they were made, and their
  size. Each has Restore, and Delete unless Timber protects it, which says
  "protected" and why. Unfinished deletions and entries that are not usable
  show Timber's reason and offer nothing. The section says backups can hold
  copies of ignored files such as `.env`. There is no section without
  backups, with a Timber that cannot list them, or while the filter has
  text. Backups that could not be read are a quiet grey word beside the
  repository's name, "backups unknown". Compare comes later.
- Settings is a cogwheel at the bottom of the sidebar.

## Workspace

- Three tabs: Workspace (panes), Changes (diff), and Pull request.
- A worktree holds any number of sessions: agents such as codex and claude,
  and terminals. Each session has a chip that shows or hides its pane; a hidden
  session keeps running. Closing an agent pane stops the agent. An agent's
  chip shows its state as on the sidebar, with its message, such as "approve
  Write: src/a.ts", in the tooltip.
- The header names the worktree's saved base beside its sync state and
  changes, in the same words as the row's tooltip.
- The header shows the worktree's pull request with the same words as its
  row, and "Open pull request" opens it in the browser. When pull requests
  could not be read, the header has the same quiet word as the repository.
- The header shows the issue the worktree belongs to, after the base, as a
  quiet underlined link: "PROJ-123 · In Review", the key and the tracker's
  own status name, which opens the issue in the browser. The full title,
  status, and assignee are in its tooltip. An issue in progress is blue,
  always with its words. When the status could not be read, the link is the
  key from the saved link, with a quiet grey word beside it ("offline",
  "sign-in needed", "issue not found", "no access", "issue not read") and
  Timber's reason in the tooltip. Never a dialog, and never a prompt to sign
  in. Link metadata Timber cannot use is a warning, "Issue unknown", with no
  link. A worktree without a link, or a Timber that reports none, shows no
  issue.
- The header has one quiet item for the worktree's ports, such as "6
  ports", or "no ports". It opens a list grouped by source: Docker, each
  service of the worktree's Compose project with `host port -> container
  port`, and Sessions, each port a process in one of the worktree's
  sessions listens on, with the session's name. Each line has "Open in
  browser" and "Copy" for `http://localhost:<port>`. A host port another
  worktree also claims says so in red with that worktree's name, "also
  feat/b", and only then does the sidebar row show a small "port clash"
  with the ports and names in its tooltip. No Docker, Docker stopped, or no
  permission to use it means no Docker group and a quiet reason in the
  item's tooltip, never a dialog.
- The Pull request tab shows the worktree's pull request: its title, state,
  number, and base, "Open in browser", then Review (the review decision in
  a word and a sentence, then each reviewer with where it stands,
  "team" or "bot" beside the name, and an Open link), Checks (a summary line, then each run with its
  status and an Open link when it has one), and Description, as plain text
  with its lines kept, never as markup. Hairlines part the sections.
  Failing checks and requested changes are red with their words, and so
  is a reviewer who asked for changes. With no reviewers, or some Timber's
  login could not read, a quiet line says so. Showing a pull request runs
  no command, and only opens links. Offline, sign-in needed, not on
  GitHub, or an answer that could not be read is said in its place with
  the reason, never as a dialog. It follows each new read.
- A worktree on a branch with no pull request yet gets a form in the tab,
  "Open a pull request": Title (the last commit's subject, else the
  branch; with a saved Jira or Linear link it starts with the issue's key,
  as `PROJ-123: subject`, unless it already does, and a GitHub link adds
  nothing, since Timber mentions that issue in the body), Description
  (with a saved link, a quiet line under it says what Timber adds, such as
  "Timber adds Refs ENG-42 unless the description already mentions it",
  or `Refs #102`, and `owner/repo#102` when the pull request opens in
  another repository, for GitHub; without a saved link there is no line,
  and the app never guesses from the branch name), Base (the saved base as Timber takes it, `origin/main`, or empty for
  Timber's own choice when the saved base is a local branch or none),
  Reviewers (logins or `org/team`, separated by commas or spaces; while it has the
  focus, the people and teams the repository's pull requests already list
  show under it, narrowed by the name being typed, without the ones already
  typed, and a pick takes the place of that name), and
  an "Open as a draft" switch. A quiet line says
  Timber publishes the branch and opens the pull request, and the app never
  pushes on its own. The exact `timber pr` command shows above "Publish and
  open" and changes as the fields change. While Timber runs, the fields and
  the button are disabled and a progress bar shows; leaving the tab or the
  worktree keeps the run and what was typed, and never starts a second
  run. Each reviewer is its own `--reviewer` in the command. Created: a
  toast, "Pull request #12 opened", and the tab shows the
  pull request as soon as GitHub lists it, with its number and "Open in
  browser" until then. Already open: a quiet line above that pull request
  says so, until the pull requests are read again. A reviewer Timber could
  not request adds "1 reviewer could not be requested." to the toast, and
  a red line in the tab, "Review could not be requested from bob." with
  Timber's reason, under what says the pull request was opened or already
  open and above the pull request once it shows, so it never hides that
  the pull request was created. It stays, through later reads, until
  "Dismiss" or the next run, and shows even while GitHub does not list the
  pull request yet or the pull requests cannot be read. While Timber runs,
  no reviewer is offered. A new commit on the
  branch puts its subject in the title, and a link attached, changed, or
  removed makes the title again, unless one was typed. Refused or failed:
  Timber's reason stays in the form with the fields as typed, ready for a
  retry, with Timber's output in a details area that starts closed, and a line that says what happened to the
  branch: nothing was pushed (refused), the branch was published before
  the failure, or that it is unknown. A detached HEAD keeps the quiet
  placeholder.
- Above the pull request, in every state of the tab, an Issue section shows
  the linked issue: its title, the tracker with the key and status, the
  assignee or "Unassigned", and "Open in browser". When the status could not
  be read it shows the key, the quiet word, and Timber's reason. Text from
  the tracker is plain text, never markup.
- Changes has a "Compare with" switch: Base or Uncommitted. Base is
  everything the branch changed since it left its saved base, committed or
  not, so the work stays visible after an agent commits; commits on the base
  after the branch point do not show. Uncommitted is what `git status`
  lists. The list's header says what is compared, such as
  `origin/main @ a1b2c3d`, or "Last commit". Base is the default when the
  worktree has a saved base Timber and Git can use. Without one (no saved
  base, metadata Timber cannot use, a ref that is not there, or no shared
  history), Base is disabled, a quiet line under the switch gives the
  reason, and the tab shows Uncommitted. The choice is remembered for each
  worktree. Comparing with a backup comes later.
- Review notes: in the Changes tab, clicking a line's numbers (or Enter on
  them) starts a note on that line, in either comparison, and Shift+click
  or Shift+Enter on another line of the same hunk makes it a range. A note
  shows under its lines. Lines without numbers, such as Git's own notes or
  a conflict's combined diff, and binary or very large files, take no
  notes. Notes collect in a Review list under the files, with a count on
  the Changes tab: each shows where it is (`path:line`) and its first line,
  shows its lines when clicked, and has Edit and Delete. Discard asks
  first. Nothing is sent while writing.
- Send review opens a preview of the whole review as one message, exactly
  as it will be pasted: each note as `path:line` (removed lines say they
  use the old numbers), the quoted lines with Git's `+` and `-`, and the
  note. Before the preview the noted files are read again, and a note
  whose lines changed or left the diff is marked "outdated" and still sent
  with its old lines. The dialog lists the worktree's running agents, the
  only one picked, each with its state, and warns when the picked one is
  waiting for an answer, which the paste would go into. Send pastes the
  review into the agent's input as one bracketed paste, so line breaks do
  not submit it, and presses no Enter: the toast says to press Enter there,
  and the agent's pane shows. An agent that has not turned on bracketed
  paste gets nothing, with the reason. Text already in the agent's input
  stays in front of the review. With no agent running, Copy review puts
  the same text on the clipboard. The notes stay with the worktree, also
  while another one is selected, until sent or discarded, and go when the
  worktree leaves the list. They live in the window only: a reload or a
  quit drops them, since they quote the files. Files are never changed.
- A repository that was never set up for Timber shows a quiet prompt above
  the tabs: Timber's defaults work, setup is optional, "Set up Timber", and
  "Not now". The button opens the setup wizard: the choices of
  `timber setup`, one step at a time (where to save, editor, coding
  assistant, branch and remote and folder, scripts, issue tracking), and a
  last step that lists them and shows the exact save command before Save.
  It saves once, through Timber, as Settings > Repository does. Cancel
  saves nothing. The prompt goes once settings exist or it is dismissed.
- With no repository yet, the workspace makes "Add repository" the first
  step.

## Dialogs

- Every dialog that runs Timber shows the exact command in its footer.
- While the command runs, the dialog shows progress, its controls are
  disabled, and it cannot be submitted again. It cannot be closed either.
  Done and Clean up merged are the exceptions: their removals go on in the
  background, so Remove closes the dialog at once.
- A command that worked closes the dialog, if it is still open, and leaves a
  toast, such as "Worktree created", which disappears on its own.
- A command that failed keeps the dialog open with Timber's diagnostic, so the
  person can correct and retry. What the command printed sits in a details
  area that starts closed.
- Opening a dialog puts the keyboard in its first field, past anything in its
  header. A dialog with no field leaves it on its first button. A dialog
  whose command deletes work puts it on the button that keeps everything
  instead. After a run that failed, the keyboard goes back to the first text
  field, to correct it, or to the submit button when there is none.
- **New arena (Beta):** a name or ticket key, the task, one or more groups of
  attempts (a tool with an optional model and effort, or a saved preset, and
  how many runs), and an optional start point. The footer shows the exact
  `timber arena new ... --no-editor --no-agent --result-file` command, with
  `<task file>` where the task goes: the task reaches Timber only in a
  private temporary file and never appears in a command. Under it, the
  `timber __app-arena launch` the app asks next. Once every attempt is ready
  the dialog closes, the first attempt is selected, and each attempt with an
  agent gets its own session, started with exactly the command Timber gives.
  A create that stopped part of the way starts no agent, says what Timber
  kept, and does not offer the same name again.
- **Compare (Beta):** one row per attempt, from `timber arena pick <arena>
  --inspect --json`, shown in the footer: the agent's state in this app and
  Timber's, commits, committed and uncommitted changes against the arena's
  base, and untracked files as their own count. "Open in Changes" selects the
  attempt and shows its Changes tab; "Start agent" starts its agent when none
  runs. "Keep this one" compares again, then shows the exact `timber arena
  pick <arena> --winner <label>`, which attempts it removes, which of the
  app's sessions it ends first (every one in the other attempts, agents and
  shells), and which it keeps open (the chosen attempt's), behind a button
  marked as deleting. Running agents never block the choice. After the
  pick each row says what happened to it (kept as the winner, removed,
  removed with its work saved under a ref, or kept by Timber with its
  reason), and the comparison and the list are read again.
- **New or open:** a name or sentence becomes a branch; pick the start point.
  One dialog, opened from the "+" of a repository and named after it, with a
  switch between "New branch" and "Existing branch". The dialog closes as
  soon as the worktree exists: setup scripts run afterwards in a "Setup"
  terminal in the worktree, where they can be watched, and never hold the
  window. When Timber created the worktree but stopped before setup, the
  dialog says so and offers "Run setup" instead of creating again. A
  Workflow field, None by default, lists the repository's workflows with
  their descriptions; a pick adds `--workflow <name>`, and the Setup
  terminal and "Run setup" repeat it. With no workflows there is no field,
  and a list that cannot be read leaves a short note. An Agent field, the
  first saved agent by default or None, starts that agent beside setup,
  without waiting for it, once the dialog has created the worktree. A
  workflow that sets an agent, or turns it off, decides instead: the Agent
  field follows it, locked, and says why. The footer shows each command
  that follows under Timber's. The Name hint names
@@REST@@- **Rebase:** pick the base. The picker starts from the base Timber saved for
  the worktree. A worktree with uncommitted changes is refused, as Timber
  does. The dialog says how the rebase ended. One that stops on conflicts
  lists the files and offers a terminal in the worktree, leaving the rebase
  paused for the person to finish or abort.
- **Restore backup:** the backup's branch, age, source folder, and ID, and
  the folder for the new worktree, by default beside the primary checkout.
  Says that the branch is `recovery/<id>`, that changes come back unstaged
  or untracked with ignored files, and that nothing runs. A partial restore
  says what is left, not to use it, and shows Timber's cleanup commands as
  text.
- **Delete backup:** "Delete backup of <branch>?" with Keep as the default.
  When the backup changed since it was chosen, only Close. A partial
  deletion shows what is left and "Delete again".
- **Done:** a clean, published worktree gets a summary of what is removed,
  including ignored files. One with unsaved work gets "Delete anyway?" with
  Keep as the default. Remove closes the dialog: the removal goes on, the
  worktree's row says "removing" and its actions are off, and a toast says
  how it ended. A failure stays on the row, or in the repository's group
  once the worktree left the list, with Details to read it.
- **Clean up merged:** every linked worktree of one repository whose pull
  request merged, previewed with Timber's defaults, as Ready or Skipped with
  the reason. Anything that would need "Delete anyway?", except a deleted
  upstream, and a live session make a row Skipped, with Open Done for its
  own dialog. A Ready row with a deleted upstream says that commits only on
  its branch go with it. One `apply` per Ready row shows before Remove.
  Remove closes the dialog and the removals run one at a time; queued rows
  say "waiting to be removed", each ends as for Done, and one toast sums
  the run up.
- **Settings:** sections for editor, agents, chops, notifications, fetching, Jira, setup scripts,
  pre-done scripts, starting branch, remote, worktree folder, and layout.
  Presets where they help, but every value is editable free-form, and every
  section has Save.
  Timber's own settings are edited in a Machine and a Repository section,
  in groups (editor, coding assistant, branch and remote and folder,
  scripts, issue tracking) that each have their own Save and show the exact
  Timber command it runs. Timber validates and writes; its messages show at
  the field they name. A tracked `.timber.toml` is changed only when the
  person ticks the box for that save. Issue tracking has "Test connection"
  for GitHub, Jira, and Linear.
- **Chops:** a Settings section for saved commands and prompts to run in a
  worktree. A chop has a name, a kind (Command or Prompt), its text, and an
  optional description; a prompt can name the agent that gets it, or the
  first saved agent. The person's own chops are rows with Remove and "Add a
  chop", each for every repository or for one, saved with the section's
  Save. Below, "From the repository" lists the chops the selected
  worktree's repository shares in `.timber/chops.json` in its main
  checkout, read-only, with the file's path. Chops belong to a repository,
  not to a worktree: every worktree of it shows the same list, and a
  branch's change to the file shows once it reaches the main checkout. A
  personal chop with the same name, ignoring case, wins: the file's chop is
  listed as "Overridden by your chop". A main checkout with no file gets a
  quiet hint naming where one would go; a damaged file gets its reason,
  quietly, and personal chops still work. A change to the file shows on its
  own; "Read again" reads it now.
- **Running a chop:** a command chop runs in the active worktree only; to
  run it elsewhere, switch worktree first. The Workspace "+" menu has a
  Chops part listing the repository's command chops by name, with the
  description in the tooltip, and a worktree with no session yet has a
  "Run" button for each. The command palette lists "Run chop: <name>",
  found by name and description, and shows one that cannot run now with
  the reason. Running one opens a new session named after it, types the
  text into the shell, and runs it; the shell stays when the command ends,
  so its output can be read and the command run again. A chop from the
  repository's file is code from the repository: the first time it runs,
  and again whenever its text changes, a dialog shows the exact text and
  the file it comes from, with Cancel first, and runs it only on Run.
  Personal chops run straight away. Right-clicking a session's chip, or
  Shift+F10 or the context menu key on it, offers "Insert chop: <name>",
  which types the chop's text into that session without Enter, so it can be
  edited first.
- **Terminal:** a Settings section for the terminal's font, as a name to
  type with Geist Mono as the default, its text size, and the cursor, a
  block or a thin bar. A font that is not installed gets a note under the
  field that terminals use Geist Mono. "Name new sessions after" chooses
  how new terminal and agent sessions are named: "Terminal or the agent"
  (the default), "Branch" (`feature-login`, `Codex: feature-login`), or
  "Issue key" (`GH-122`, `Codex: GH-122`, `#122` for a branch that starts
  with a number, or the branch when it has no key). It is saved with the section's Save and names only sessions opened
  after it; open sessions keep their names, and any session can still be
  renamed.
- **Theme:** a Settings section with a card for each theme, a small
  picture of the app drawn in it. Choosing one shows it at once; Close
  without Save goes back to the saved one. Below the cards, "Your themes"
  lists the person's own with Edit, Export, and Delete, and a theme to
  start a new one from. Delete asks first, in place, and says when the
  theme is in use. Import a theme file adds it and shows it; a file that is
  not a whole theme is refused with the reason and changes nothing.
- **Theme maker:** the Theme section's place while a theme is made or
  changed, in a wider dialog. Name, dark or light, and every color, each
  with a picker and its text, which also takes `rgba()`. Previews of the
  sidebar, a diff, buttons, a toast, and a real terminal showing the mock
  shell's `sample` follow every change. The contrast check, at WCAG AA or
  AAA, lists the colors too close to their surfaces and marks their rows;
  it warns and never blocks. Save adds a new theme and uses it; Cancel
  leaves everything as it was.
- **Restart:** a setting the app reads only when it starts, such as the
  DMA-BUF renderer, offers "Restart now" and "Later" under its section once
  saved. Later changes nothing. While terminals run, Restart now asks first
  and says how many end, with focus on Cancel. A copy that cannot restart
  itself says why.
- **Uninstall:** at the end of Settings, About. The first button only shows
  what would be removed and the command; "Uninstall and quit" is the
  dangerous one, and Cancel has the focus. The saved repository list stays
  unless a box is ticked. Repositories and worktrees are never touched.

## Look

Dark, neutral surfaces with hairline dividers instead of boxed cards. One
typeface for the interface and a monospace face only for terminals, diffs,
paths, and commands. Color carries meaning only: amber for incoming commits
and for an agent that needs you, blue for outgoing commits and running or
working agents, yellow and green for file changes (green also for an agent
that is done), red for destructive or rewritten state, for errors, and for a
crashed agent. The one color not from a theme is Claude's own orange in its
spark, which is part of its mark.

Every color is a theme's. Timber Dark is the look above and the default;
Timber Light and a few well known palettes come with the app. A theme keeps
the meanings: each has its own incoming, outgoing, change, and error colors,
and every built-in theme passes the contrast check (text 4.5:1, meaning
colors 3:1, on every surface). Settings, Theme picks one theme, or one for
the system's light setting and one for its dark setting. A theme shows as
soon as it is chosen, terminals included, and Save keeps it. The colors live
in `src/shared/builtin-themes.ts`; `src/mainview/styles.css` has none of its
own.
