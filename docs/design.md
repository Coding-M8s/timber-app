# Design

The interface decisions agreed on the clickable prototype. Build toward these;
change them here first when they change.

## Layout

- One window: a sidebar of worktrees and, opposite it, the workspace for the
  selected worktree. Sidebar side (left or right) is a setting, not a button.
- No built-in code editor. "Open in editor" launches the configured one.
- A command palette searches every action and worktree.

## Sidebar

- Worktrees are grouped under collapsible repository headers. Selecting a
  worktree in another repository switches to it.
- Each repository header has a control to create a worktree in it and a
  "Fetch now" control, and an "Add repository" control sits below the list.
- The app fetches every repository in the background, on an interval from
  Settings that can be turned off. A failed fetch, such as while offline or
  without stored credentials, shows a quiet grey word beside the
  repository's name ("offline", "sign-in needed", "fetch failed") with the
  reason in its tooltip. Never a dialog, and never a prompt for credentials.
- Each row shows the branch, its state against the remote, running agents, and
  uncommitted changes.
- Branch state follows VS Code conventions: a down arrow with a count for
  commits to pull, an up arrow for commits to push, "force-pushed" when the
  remote branch was rewritten, "upstream gone" when it was deleted, and "local
  only" when it was never published. "force-pushed" stays until the person
  has selected that worktree and moved on. Modified and untracked counts use
  the yellow `M` and green `U`.
- Rebase backups are listed below the worktrees with compare, restore, and
  delete.
- Settings is a cogwheel at the bottom of the sidebar.

## Workspace

- Two tabs: Workspace (panes) and Changes (diff).
- A worktree holds any number of sessions: agents such as codex and claude,
  and terminals. Each session has a chip that shows or hides its pane; a hidden
  session keeps running. Closing an agent pane stops the agent.
- Changes compares against the base, the last commit, or a rebase backup.
- A repository that was never set up for Timber shows a quiet prompt above
  the tabs: Timber's defaults work, setup is optional, the command
  `timber setup`, "Set up Timber", and "Not now". The button runs Timber's
  guided setup in a session of its primary checkout, until an in-app wizard
  replaces it. The prompt goes once settings exist or it is dismissed.
- With no repository yet, the workspace makes "Add repository" the first
  step.

## Dialogs

- Every dialog that runs Timber shows the exact command in its footer.
- While the command runs, the dialog shows progress, its controls are
  disabled, and it cannot be closed or submitted again.
- A command that worked closes the dialog and leaves a toast, such as
  "Worktree created", which disappears on its own.
- A command that failed keeps the dialog open with Timber's diagnostic, so the
  person can correct and retry. What the command printed sits in a details
  area that starts closed.
- **New or open:** a name or sentence becomes a branch; pick the start point.
  One dialog, opened from the "+" of a repository and named after it, with a
  switch between "New branch" and "Existing branch". When the worktree was
  created but its setup failed, the dialog says so and offers "Open with
  setup" instead of creating again. An Agent field, the first saved agent
  by default or None, starts that agent in the worktree once the dialog has
  created it, and the footer shows its command under Timber's.
- **Rebase:** pick the base. A worktree with uncommitted changes is refused,
  as Timber does.
- **Done:** a clean, published worktree gets a summary of what is removed,
  including ignored files. One with unsaved work gets "Delete anyway?" with
  Keep as the default.
- **Settings:** sections for editor, agents, fetching, Jira, setup scripts,
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

## Look

Dark, neutral surfaces with hairline dividers instead of boxed cards. One
typeface for the interface and a monospace face only for terminals, diffs,
paths, and commands. Color carries meaning only: amber for incoming commits,
blue for outgoing commits and running agents, yellow and green for file
changes, red for destructive or rewritten state and for errors. The tokens
live at the top of `src/mainview/styles.css`.
