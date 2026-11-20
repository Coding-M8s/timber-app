# Design

The interface decisions agreed on the clickable prototype. Build toward these;
change them here first when they change.

## Layout

- One window: a sidebar of worktrees and, opposite it, the workspace for the
  selected worktree. Sidebar side (left or right) is a setting, not a button.
- No built-in code editor. "Open in editor" launches the configured one.
- A command palette (Ctrl+Shift+P, Cmd+Shift+P on macOS, or the title bar button) searches every action and worktree. It opens the same dialogs as the buttons, and shows an action that cannot run with the reason.

## Sidebar

- Worktrees are grouped under collapsible repository headers. Selecting a
  worktree in another repository switches to it.
- Drag a repository header to move its group; a line shows where it will
  land. Alt+Up and Alt+Down move a focused header one place. The order is
  remembered between runs.
- Each repository header has a control to create a worktree in it and a
  "Fetch now" control, and an "Add repository" control sits below the list.
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
  has the same action, once per repository. While there are merged
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
  branch), Description, Base (the saved base as Timber takes it,
  `origin/main`, or empty for Timber's own choice when the saved base is a
  local branch or none), and an "Open as a draft" switch. A quiet line says
  Timber publishes the branch and opens the pull request, and the app never
  pushes on its own. The exact `timber pr` command shows above "Publish and
  open" and changes as the fields change. While Timber runs, the fields and
  the button are disabled and a progress bar shows; leaving the tab or the
  worktree keeps the run and what was typed, and never starts a second
  run. Created: a toast, "Pull request #12 opened", and the tab shows the
  pull request as soon as GitHub lists it, with its number and "Open in
  browser" until then. Already open: a quiet line above that pull request
  says so, until the pull requests are read again. A new commit on the
  branch puts its subject in the title, unless one was typed. Refused or failed: Timber's reason stays in the form with the
  fields as typed, ready for a retry, with Timber's output in a details
  area that starts closed, and a line that says what happened to the
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
  without waiting for it, once the dialog has created the worktree. The
  footer shows each command that follows under Timber's. The Name hint names
  the issue forms Timber links, `github:123`, `jira:ENG-1`, and
  `linear:ENG-1`; the app passes the name as typed, only trimming spaces
  around it, and Timber alone decides whether it is an issue. In "New
  branch", a Tracker field under Name shows when two or more trackers are set
  up for the repository (GitHub with a GitHub remote, Jira with a site and a
  login, Linear with a login) and lists only those. It starts on "Default
  (GitHub)", named after Timber's default tracker, which passes the name
  unchanged. Picking a tracker turns a Name with the shape of its issue
  (`42`, `ENG-42`) into `github:42` or `jira:ENG-42` for this one creation,
  shown in the footer before it runs; a sentence or branch name passes
  unchanged, and Timber's default tracker never changes. Linear is listed
  when its login is saved, but has not been tested with a real Linear
  workspace. The dialog opens with the keyboard in Name, so typing at once
  fills it. Switching mode puts the keyboard in that mode's first field,
  unless New branch is offering "Run setup", which has none; Shift+Tab goes
  back to the switch, whose arrow keys change the mode. A run that failed
  puts the keyboard back in Name, or on "Run setup" once the worktree
  exists.
- **Rebase:** pick the base. The picker starts from the base Timber saved for
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
  worktree's `.timber/chops.json` shares, read-only, with the file's path
  and the branch, so a branch with other chops is plain to see. A personal
  chop with the same name, ignoring case, wins: the file's chop is listed
  as "Overridden by your chop". A worktree with no file gets a quiet hint
  naming where one would go; a damaged file gets its reason, quietly, and
  personal chops still work. "Read again" reads the file now. Running chops
  is not part of this section.
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
