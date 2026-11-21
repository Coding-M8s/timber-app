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
- The chops panel sits on the workspace's right, wherever the sidebar is.
  The title bar's Chops button, or Ctrl+Shift+K (Cmd+Shift+K on macOS),
  shows or hides it from any focus, also from a terminal. Shown that way,
  it takes the keyboard; hidden while it has the keyboard, the keyboard
  goes back where it was, or to the Chops button when that is gone. Its
  Close button only hides it. Its left edge resizes it like the sidebar's
  (240 to 560 pixels, never above a third of the window), and whether it
  shows and its width are remembered. It has a Commands and a Prompts
  tab, each with its count, and a filter over names and text that says
  when nothing matches. Each row shows the chop's name, where it comes from
  (`.timber`, this repository, every repository), its text in mono, so what
  runs shows before it runs, and Run, Send, or Copy, which go through the
  palette's path and ask before a `.timber/chops.json` chop's first run.
  The footer says where the next run goes: a new terminal in the selected
  worktree, the agent a prompt goes to, a new agent, or the person's pick;
  or, when nothing can run, why. With no worktree selected the chops last
  read stay listed, and Run is disabled with the reason. Running a command
  or sending a prompt shows the Workspace tab; copying leaves the view as
  it is. Making and ordering chops from the panel come later. "Use chops" in
  Settings, Chops, turns the feature off: no button, panel, or chop
  shortcut, and no chops in the palette, the "+" menu, the empty pane, or
  "Insert chop". The saved chops are kept. The mock's Ctrl+Alt+C was a
  placeholder: on Windows AltGr reaches the page as Ctrl+Alt, so it would
  take characters such as the Polish "ć", and in a terminal it is Escape
  then Ctrl+C to the program. Ctrl+Shift+K keeps the app's pattern and
  takes nothing from a terminal program, which cannot tell it from Ctrl+K.
  Chosen by analysis; not yet checked against each desktop. The design
  mock's "can be changed in Settings" is not built: no shortcut in the app
  can be changed yet (#258).

## Sidebar

- Worktrees are grouped under collapsible repository headers. Selecting a
  worktree in another repository switches to it.
- A repository's header stands apart from its worktree rows: its name is
  in the main text color, a step larger and heavier than a worktree's, and
  each repository after the first has a hairline and extra space above it.
  An unavailable repository's name stays faint.
- Drag a repository header to move it; a line shows where it will land.
  Alt+Up and Alt+Down move a focused header one place. The order is
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
- Each repository header also has a More button (three dots). It opens the
  repository's menu, as do a right-click on the header and Shift+F10 or the
  context menu key on it: "Clean up merged" first, then "Add to" or "Move to"
  each group, "New group...", "Take out of" its group, and "Remove from the
  list", which only changes the app's list. A missing folder still offers its
  own Remove.
- Repositories can be gathered into named groups, such as Work and Personal.
  There are none until the person makes one, and with none the sidebar looks
  as before. "New group" sits beside Refresh; it, "New group..." in a
  repository's menu, and "Rename" in a group's menu type the name in place:
  Enter saves, Escape cancels. An empty name or one another group has,
  ignoring case, is said under the field. Loose repositories come first, then
  each group in order with its repositories indented; an empty group shows.
- A group header folds and unfolds the whole group, by click, Enter, or
  Space, and the fold is remembered. A folded group sums up its agents as a
  repository does, and says "check" when one of its repositories has a
  removal, a failed listing, or a missing folder. While a filter is typed, a
  group with a match opens and a group without one is hidden.
- The group's More button, a right-click, or Shift+F10 opens Rename and
  Delete group. Deleting never asks, because its repositories stay in the
  list, loose.
- Dragging a repository header can reorder it, put it in a group (over the
  group's header, or anywhere in an open one), or take it out (above the
  first group). Alt+Up and Alt+Down move it among the repositories of its
  group, or among the loose ones. Group headers drag, and Alt+Up and Alt+Down
  move them, among the groups.
- Grouping only changes the app's saved list. No Git or Timber command runs,
  and nothing in a repository is touched.
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
- A branch that is behind and not ahead gets a Pull control in place of its
  down arrow and count: the same arrow and count, outlined as a button,
  beside the row. It opens a dialog that shows `git fetch <remote>` and
  `git merge --ff-only --no-autostash <upstream>` before they run. Pull is
  also in the row's menu and the command palette while it applies.
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
- An agent's tasks (subagents and background tasks) that still run, or
  reported an error, show as a small count beside its mark, on the row and
  the chip, in the shape and color of the most urgent one, so a task that
  needs you shows its diamond. An agent that says Done or Idle while tasks
  run says "tasks still running".
- Once the person has seen a Done, Error, or crashed agent, its mark turns
  quiet: the same shape in the theme's quietest text color, with a dashed
  outline on the row, and its tooltip and description say "seen", such as
  "Codex: Done, seen". Seen means the session itself was on screen (its
  chip shows in the selected worktree, on the Workspace tab) in a window
  that shows and has the focus. That is stricter than the notification
  rule, which looks at the worktree: a second agent whose chip never showed
  stays unseen. Needs you is never seen, because the agent still waits. A
  new state from the agent, such as Working then Done again, starts unseen.
  Seen lasts until the app restarts.
- A collapsed repository header sums up its agents' unseen states, such as
  "1 needs you, 2 working", Needs you first, so "1 done" drops out once
  seen; an agent with a task that needs you counts as needing you, seen or
  not. An expanded one adds nothing.
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

## Issues board

Each repository's work that is waiting, read by Timber with its own
logins. The app never reads a tracker login and never signs in.

- An "Issues" row sits first in each repository in the sidebar, with the
  sprint's name beside it once a read found one. It opens the board in place
  of the workspace, the way a worktree row opens its workspace; the title bar
  says "repository / Issues". Choosing a worktree puts the board away. Its
  sessions keep running meanwhile. While a filter is typed, the row steps
  aside with the backups.
- A picker at the top chooses the list: Current sprint (Jira's active sprint
  of a board or a saved query, a GitHub project's current iteration or an
  open milestone, Linear's current cycle), Assigned to me, or Open issues.
  The pick is remembered per repository between runs. A list Timber says is
  not set up leaves the picker, the next one shows, and a quiet line under
  the picker says so in Timber's words, which name the setting that adds it. The remembered
  pick is kept, so a list set up later comes back on the next Refresh.
- A Tracker field shows only when two or more trackers are set up. It starts
  on Timber's default tracker, else the first set up, and a pick lasts for
  the run.
- Columns are Open, In progress, and Done, each with the tracker's own
  status names beside it. GitHub issues are only open or closed, so a
  GitHub board has Open and Done. Assigned to me and Open issues hold only
  issues that are not done, so they have no Done column. An issue whose
  status falls elsewhere still gets its column; none is ever left out.
- Each card shows the key, the tracker's status (blue while in progress,
  always with its words), a control that opens the issue in the browser,
  the title, and the assignee, or "Unassigned". A card whose issue has a
  worktree has a pill with its branch that shows that worktree. A card
  whose issue has an open pull request and no worktree here has Check out
  PR (below). The others have Start work, which is off for now; starting
  work from the board is its own issue (156).
- Check out PR opens a pull request someone is already working on, for
  review. The pull requests are the ones the tracker itself links to the
  issue, as Timber lists them; the app never guesses them from branch
  names. A done card, a card whose links could not be read, and a card
  with a worktree here have no Check out PR. It opens a small dialog like
  New worktree: the pull request by number and branch (a list to pick from
  when there are several, with draft and fork marked), and the exact
  command, `timber open --issue <tracker>:<key> --no-setup --result-file
  <temporary file> --no-editor --no-agent -- <branch>`, before anything
  runs. `--issue` links the worktree to the issue, so the card shows its
  pill on the next read. Timber never asks anything there: an ambiguous
  branch, a worktree linked to another issue, or an issue it cannot look up
  fails with Timber's reason, which stays in the dialog. Once the worktree
  exists it is selected on its Pull request tab, and setup scripts Timber
  left run in a terminal beside it, as for Existing branch.
- A fork's pull request, a github.com pull request of another repository
  (any, when this repository is not on github.com), and every pull request
  of a GitHub issue from another repository (a project's sprint can hold
  them) shows in the dialog with the reason it cannot be opened here, and
  its button stays off. A card whose pull requests are all refused still
  opens the dialog, so the reason can be read; its tooltip says so. This is the app's reason, not Timber's: `timber open`
  resolves a bare branch name in this repository only, so it could open an
  unrelated branch of the same name and link it to the issue. Where the
  tracker cannot tell a fork (Jira here, Linear always), Timber is asked
  and its answer stands. When no branch has the exact name, Timber may open
  one by its ticket prefix and link that; the toast then names the branch
  Timber opened. Linking needs one tracker lookup, so offline or signed
  out, Check out PR fails with Timber's reason where a plain open would
  not. When the list read afterwards does not show the worktree, the toast
  says so, and neither its tab nor setup starts.
- The board reads when it opens, when another list or tracker is picked,
  and on Refresh. There is no timer. "Read 2 minutes ago" says when. Each
  column scrolls on its own and a long sprint draws only the cards in view.
  A sprint comes whole, up to Timber's 500; the other lists show the first
  50, and a cut-off list says so at its end.
- Each failure to read is a quiet word or line in the view, never a
  dialog. (Check out PR runs a Timber command, so like New worktree it is a
  dialog, and its failure stays in it.) A failed refresh keeps the last
  list on screen with a grey word beside the title ("offline", "sign-in needed", "no access", "not found") and Timber's
  reason in its tooltip. A first read that fails says so in a line, with
  Timber's reason, and `timber setup` when a login is missing. No current
  sprint, an empty list, and no tracker set up each say so in one line.
- A Timber without `__app-issues` shows that the board needs a Timber built
  from its main branch. No Timber release has the command yet; the message
  names a version once one does.

## Workspace

- Three tabs: Workspace (panes), Changes (diff), and Pull request.
- A worktree holds any number of sessions: agents such as codex and claude,
  and terminals. Each session has a chip that shows or hides its pane; a hidden
  session keeps running. Closing an agent pane stops the agent. An agent's
  chip shows its state as on the sidebar, with its message, such as "approve
  Write: src/a.ts", in the tooltip. Beside the shown agent's state, a button
  such as "4 tasks" opens the list of its tasks as a tree, each with its
  state, progress, title, and message.
- Quitting and opening the app again brings every worktree's running
  sessions back in their places, with the same chip showing; agents go back
  to their conversations, terminals start a fresh shell.
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
  Timber's own choice when the saved base is a local branch, a commit, or
  none),
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
  `origin/main @ a1b2c3d`, or "Last commit". A commit base shows as
  `a1b2c3d` when the branch starts there, or as `a1b2c3d @ 9f8e7d6` when
  the branch left its history earlier. Base is the default when the
  worktree has a saved base Timber and Git can use. Without one (no saved
  base, metadata Timber cannot use, a ref or commit that is not there, or
  no shared history), Base is disabled, a quiet line under the switch gives the
  reason, and the tab shows Uncommitted. The choice is remembered for each
  worktree. Comparing with a backup comes later.
- While the Changes tab reads again (its Refresh, the sidebar's Refresh, a
  change the repository watcher reports, or a switch of "Compare with"), a
  small spinner shows beside the counts in the bar: the working ring of a
  session, turning, and standing still when the system asks for less
  motion. The list on screen stays, slightly dimmed, so nothing jumps. The
  first read, and a switch of "Compare with", which reads a different list,
  have no list to keep: the bar says "Reading changes" instead, and nothing
  is dimmed or announced as a refresh. Refresh keeps its label and is
  disabled while the spinner shows. A hidden polite status says
  "Refreshing…" once for each refresh: the spinner stays a moment after a
  read ends, so the reload of the repository and the read of its changes
  that follows count as one.
- At the end of the Compare with row, a quiet "Set base…" (no saved base,
  or one Timber cannot use) or "Change base…" (a saved base) opens the Set
  base dialog. Once Timber saves the base, the tab moves to Base, its header
  shows the new base as elsewhere in Changes (`name @ hash`, or a commit
  base by its short hash), and the workspace header and the row's tooltip
  name the new base. A remote base shows there only once it is fetched.
- File viewer: a File tab after Pull request shows one file of the worktree,
  read-only, with line numbers, in the terminal's font. The tab is there only
  while a file is open in that worktree, named after the file, with a close
  button beside it; closing goes back to the tab the file was opened from.
  A file opens from "View file" beside the diff in the Changes tab, or by
  a plain click on a file path in a terminal, read from the worktree's
  folder. A web link still needs Ctrl+click (Cmd+click on macOS), since it
  leaves the app; a file stays in it. Binary files, files over 1 MB or 20,000 lines,
  missing files, folders, and paths outside the worktree get a plain notice
  in place of the text. "Read again" reads it as it is now. Other files are
  read-only: this is a viewer, not an editor.
- Markdown reader: a `.md` or `.markdown` file opens rendered, in the
  interface's font, with a Rendered / Source / Edit switch in the File tab's
  title line. Source is the read-only view with line numbers. Edit is one
  plain text box over the source (no search, highlighting, or undo history
  beyond the text box's own), with Save (Ctrl+S, Cmd+S on macOS) and
  Discard; once saved, Discard reads "Done". "Unsaved" shows while the text
  differs from the file. The edits are kept when another tab or worktree
  shows, and Rendered shows them before they are saved. Saving writes only
  that file, with its own line endings. When the file changed on disk since
  it was opened, as when an agent wrote it, nothing is written: the reason
  shows above the text with "Save over it", and the edits stay. Closing the
  file, Read again, or opening another file in its place asks first while
  edits are unsaved (Save, Discard, or Keep editing, focus on Save), and so
  do quitting, closing the window, Restart now in Settings, restarting into
  an update, and uninstalling, even with no session running. An open file
  whose worktree leaves the list is dropped with its edits. Rendered
  Markdown runs nothing: HTML written in the file shows as text, images show
  their description and are never loaded, a web link opens in the browser,
  a relative link opens that file of the worktree in the File tab, a `#`
  link goes to the heading, and any other link is plain text with its
  address in the tooltip.
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
  with its old lines. The dialog lists the worktree's running agents,
  each with its state, and warns when the picked one is
  waiting for an answer, which the paste would go into. Send pastes the
  review into the agent's input as one bracketed paste, so line breaks do
  not submit it, and presses no Enter: the toast says to press Enter there,
  and the agent's pane shows. An agent that has not turned on bracketed
  paste gets nothing, with the reason. Text already in the agent's input
  stays in front of the review. The dialog also offers a new agent, the
  first one saved in Settings, with the command that starts it, and picks
  as a prompt chop does: the new agent when none runs, the only one when
  it does not wait on the person and is not still starting, and otherwise
  nothing, so the person
  picks; Cancel sends nothing. Send with the new agent starts it in a new
  session, which shows and says "Waiting to paste the review", and the
  review is pasted once the agent is ready, with no Enter: an agent that
  asks to trust the folder keeps waiting until it is answered. Its notes
  go once it is pasted; one added or changed meanwhile stays. If it is not
  ready in two minutes or ends first, a toast says so and the notes stay.
  While it waits, Send review starts no second agent there. Copy review
  puts the same text on the clipboard, and is the only way when no agent
  runs and none is saved. The notes stay with the worktree, also
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
  the issue forms Timber links, `github:123`, `jira:ENG-1`, and
  `linear:ENG-1`; the app passes the name as typed, only trimming spaces
  around it, and Timber alone decides whether it is an issue. In "New
  branch", a Tracker field under Name shows when two or more trackers are set
  up for the repository (GitHub with a GitHub remote, Jira with a site and a
  login, Linear with a login) and lists only those. It starts on "Default
  (GitHub)", named after Timber's default tracker, which passes the name
  unchanged. Picking a tracker turns a Name with the shape of its issue
  (`42`, `ENG-42`, or `eng-42` in any case) into `github:42`, `jira:ENG-42`,
  or `jira:eng-42` for this one creation, shown in the footer before it
  runs; Timber uppercases the key. A sentence, a branch name, or a name with
  a prefix already passes unchanged, and Timber's default tracker never
  changes. With Jira or Linear picked, a branch name shaped like a key, such
  as `fix-2`, reads as a key too; Default or `feature/fix-2` keeps it a
  branch. Linear is listed when its login is saved, but has not been tested
  with a real Linear workspace. While a Name is typed in "New branch", close matches from the
  tracker picked there (or Timber's default, or the only one set up) list
  under it, once typing pauses: each with its key, title, and status, and
  "Has a worktree" when one already exists for it. Timber matches key
  prefixes such as `ENG-4` and title words such as `login`. Nothing is
  highlighted until an arrow key moves there, so Enter on typed text still
  creates; Enter or a click on a suggestion fills Name with `jira:ENG-42` or
  `github:42`, and Timber still decides the branch. Escape closes the list
  and leaves the dialog open. Typing never waits for the list. Offline,
  sign-in needed, or a Timber without issue search shows no list, only a
  quiet line under Name. The dialog opens with the keyboard in Name, so
  typing at once fills it. Switching mode puts the keyboard in that mode's
  first field, unless New branch is offering "Run setup", which has none; Shift+Tab goes
  back to the switch, whose arrow keys change the mode. A run that failed
  puts the keyboard back in Name, or on "Run setup" once the worktree
  exists.
- **Rebase:** pick the base. The picker starts from the base Timber saved for
  the worktree. A worktree with uncommitted changes is refused, as Timber
  does. The dialog says how the rebase ended. One that stops on conflicts
  lists the files and offers a terminal in the worktree, leaving the rebase
  paused for the person to finish or abort.
- **Set base:** a Base field filled with the saved base, with the
  repository's branches as suggestions, and the exact `timber base --set`
  command under it. It says that only Timber's record of the base changes,
  never the branch or files, that a remote branch is checked over the
  network and compared with only once fetched, and that a commit is given
  by its full hash. Saved metadata Timber cannot use shows as a warning. A refusal
  stays in the dialog with Timber's reason and what was typed.
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
  The dialog keeps one size. The list down its side, each section with an
  icon, groups them under Appearance, Workflow, Activity, and Timber, with
  About on its own at the foot. A section opens with its title and what it
  is for, sets its settings in one panel a row each, shows a choice of a
  few as chips and an on or off setting as a switch, and keeps its Save in
  a bar along the bottom while the rest scrolls.
  Timber's own settings are edited in a Machine and a Repository section,
  in groups (editor, coding assistant, branch and remote and folder,
  scripts, issue tracking) that each have their own Save and show the exact
  Timber command it runs. Timber validates and writes; its messages show at
  the field they name. A tracked `.timber.toml` is changed only when the
  person ticks the box for that save. Issue tracking has "Test connection"
  for GitHub, Jira, and Linear.
- **Chops:** a Settings section for saved commands and prompts to run in a
  worktree. A "Use chops" switch at its top, on by default, saved with the
  section's Save (on its own while the rows are as saved), removes the
  chops panel, its title bar button, the chop shortcuts, and every other
  place chops are offered when off, and keeps the saved chops. A chop has a name, a kind (Command or Prompt), its text, and an
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
  "Run" button for each. The chops panel runs or sends each with one
  click. The command palette lists "Run chop: <name>",
  found by name and description, and shows one that cannot run now with
  the reason. Running one opens a new session named after it, types the
  text into the shell, and runs it; the shell stays when the command ends,
  so its output can be read and the command run again. A chop from the
  repository's file is code from the repository: the first time it runs,
  and again whenever its text changes, a dialog shows the exact text and
  the file it comes from, with Cancel first, and runs it only on Run.
  Personal chops run straight away. A prompt chop is listed beside the
  commands, marked "Prompt", and the palette says "Send prompt: <name>". It
  always goes to an agent in the active worktree, as typed input: one
  paste, so its line breaks do not submit it early, then Enter. With no
  agent running there, it starts the chop's agent, or the first saved
  agent, in a new session, with nothing added to its command line, and
  sends the prompt once the agent is ready: when it reports it is idle, or,
  for an agent that reports nothing, once it has drawn its input and gone
  quiet. A toast says when it was sent, or why not. With one agent running,
  the prompt goes there, also while it is busy. With several, or one that
  waits for an answer or is still starting for a prompt of its own, a
  dialog lists them with their state and "A new
  <agent>", with nothing picked, and warns when the picked agent waits for
  an answer. With no agent saved in Settings, the chop shows "Copy prompt",
  which puts exactly its text on the clipboard. A prompt from the
  repository's file asks first, as a command does, with Send, and says
  where it goes, naming the agent a new session starts; a change to its
  text or its agent asks again. Right-clicking a session's chip, or
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
- **App updates:** once a newer release of the app is downloaded, a banner
  across the top says "Timber app 0.2.0 is downloaded. Restart the app to
  install it." with "Later" and "Restart to update". Later hides it until
  another version is ready. While sessions run, Restart to update asks
  first, says how many end and that they open again, with focus on Cancel.
  The app never restarts by itself. Settings, About has an Updates part:
  where updating stands and "Check for updates". A look that failed, such
  as offline, is said there in plain text and nowhere else: no banner, no
  alert, no dialog.
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
