# Decision: status hooks for agents that do not report their status

Status: accepted, for issue #349. #350 built the installer with Cursor CLI
as its first agent (see "Status hooks" in docs/architecture.md); the other
agents follow in their own tickets (see [the work](#the-work)). Where the
build settled something this page left open, it says so below.

## The problem

An agent's state (working, needs you, done) reaches the sidebar, the chips,
the notifications, and the sounds only through the Program Status Protocol,
OSC 7501, which a program writes into its own terminal stream (see "Agent
status" in docs/architecture.md). An agent that does not write it shows only
running or exited.

Most of these agents can run a command or a plugin of the person's on
events of their own: a prompt sent, a turn ended, a tool about to run. A
command like that could tell the app the state. Using them means the app
writes into the agent's configuration, which the app has never done
("no agent config file is written", docs/architecture.md). This page decides
whether the app may, and how.

## Which agents need one

Spiked on 2026-11-22 (see [the spike](#the-spike)):

| Agent | Reports through OSC 7501 itself | Needs a hook |
| --- | --- | --- |
| Claude Code | yes, once the terminal answers its probe (issue 111) | no |
| Codex CLI 0.169.0 | yes, without a probe: idle, working, done | no |
| Grok Build 1.0.92 | yes, once the terminal answers its probe | no |
| Cursor CLI 2026.11.22 | no: none sent in a turn, and no `]7501` in its files | yes |
| Gemini CLI | not spiked: not installed here | to be found in #351 |
| OpenCode | not spiked: not installed here | to be found in #353 |
| GitHub Copilot CLI | not spiked: not installed here | to be found in #354 |
| Pi | yes, by its maker's account (issue 343) | no |

Codex's reports were missed before because it writes nothing until its
first screen (folder trust, sign-in) is passed; the earlier runs stopped
there. Grok Build reports by default: its own guide
(`~/.grok/docs/user-guide/05-configuration.md` in 1.0.92) gives
`program_status` the default `"auto"`, which reports where the terminal
answers the probe, as the app does, and the spike ran with nothing set.

So hooks are for Cursor for certain, and for Gemini, OpenCode, and Copilot
if their spikes find no native reports. For Codex and Grok Build no hook is
installed.

## What any choice must do

1. **Off changes nothing.** Until the person turns a hook on for an agent,
   no file outside the app's own folders is written, and sessions behave as
   today, but for one more variable in their environment (see below).
2. **The person sees the change first.** The exact file and the exact text
   added are shown before anything is written, in the spirit of the rule
   that every Timber command is shown before it runs.
3. **The person's own settings stay theirs.** Only the app's own entries are
   added or removed. Nothing the person or another tool wrote is changed,
   reordered, or dropped.
4. **User level only.** Never a file in a repository or a worktree, where it
   would be committed or run for others.
5. **Inert outside the app.** The same agent started in another terminal, or
   another program that reads the same file, gets nothing from the hook and
   is not slowed or broken by it.
6. **Reports only state.** The hook carries its agent and the event, and
   nothing the agent or the person typed, so the app still never reads what an agent prints
   or is told.
7. **Removable and checkable.** The app can show what it installed, take it
   out, and tell when it was changed or broken.
8. **Platforms** claimed only where tested.

## The options

### Transport: how a hook reaches the session

A hook is a separate process the agent starts. It must get its report to
the one session it belongs to.

**A. Write OSC 7501 to the terminal (`/dev/tty`).** The report would be read
by the scanner that already reads the stream.

- Cursor CLI starts its hooks in a session of their own with no controlling
  terminal: `tty` says "not a tty" and opening `/dev/tty` fails with "No
  such device or address". Codex's `notify` program keeps the terminal and
  could write to it. So it works for some agents only.

**B. Write OSC 7501 to the session's terminal by path**, passed in the
environment (`/dev/pts/N`).

- Works on Linux, for Cursor's hooks and Codex's `notify` alike: the
  reports came out of the session's stream.
- The agent draws its screen at the same time. A report written in the
  middle of one of its escape sequences breaks both: the scanner stops an
  OSC at any other escape, as xterm.js does.
- Windows is expected to have no such path, since a ConPTY session is not
  a device; not tried.

**C. A per-session socket**, Unix socket or named pipe, with its path in the
environment.

- Works wherever the environment reaches the hook, which it did for
  Cursor's hooks and Codex's `notify`, the two spiked.
- Needs a program to connect: `sh` has no socket client, so the hook would
  be a script run by the app's bundled Bun through a launcher path the app
  rewrites on each start, or depend on `python3` or `nc` being installed.
- A server per run of the app, with its own lifetime.

**D. A per-session file the hook appends one line to**, with its path in
the environment. The main process watches the folder and reads each file
from where it last stopped.

- Works wherever the environment reaches the hook.
- The hook is a few lines of `sh` that the person can read in full in the
  consent dialog. No runtime, launcher, or server.
- A line is appended with one `write` under `O_APPEND`, so two hooks firing
  together cannot interleave inside a line.
- The app already does something close: `timber new` and `timber open` in
  a session leave records in a private folder named by `TIMBER_APP_HANDOFF`
  (`src/bun/handoffs.ts`), which the main process watches. Those are whole
  files read once and deleted; reading a file from an offset as it grows is
  new.
- Watching can miss a change on some file systems; a slow poll backs it up,
  which the handoff folder does not have yet.

**Chosen: D.** It needs the least code and the least trust: the entry in the
agent's config runs a short script the person can read. B is kept out
because of the corrupted sequences and Windows; A because Cursor's hooks
have no terminal; C because the runtime it needs costs more than it gives,
for a report a few times per turn.

### Alternative: a bell or OSC 9 as "needs a look"

Any program can ring the bell or write OSC 9 or OSC 777, and the app could
show "needs a look" for it, with no config written at all.

- None of Codex, Grok Build, or Cursor CLI wrote a bell, OSC 9, or OSC 777
  in the spiked turns.
- A bell says nothing about which state, rings for other reasons (a shell's
  completion, `printf '\a'` in a build), and has no "done" or "working".
- Not chosen. It could come later as a separate, plainer signal for any
  program, not in place of hooks.

## Decision

### Consent

- Off by default, for every agent.
- Turned on in Settings, Agents, on a row whose agent has a hook (the row's
  picked or detected agent). This supersedes "Settings > Notifications" in
  #350: a hook belongs to an agent and its config folder, which is where a
  row says both. Settings, Notifications says, in one sentence, where to
  turn them on.
- A hook is per agent and config folder, not per row: two rows of the same
  agent and folder share one; a row with another config folder
  (`configFolder`, such as `CLAUDE_CONFIG_DIR` for Claude Code) gets its
  own. Today the Config folder field shows only for an agent with a
  `resume.conversations` folder variable (Claude Code, Codex, Cursor CLI's
  `CURSOR_CONFIG_DIR`, Grok Build's `GROK_HOME`). Gemini, OpenCode, and
  Copilot have no `resume`, so the registry needs a config folder variable
  of its own, apart from `resume`. Whether that variable also moves each
  agent's hook file (for Cursor, whether `CURSOR_CONFIG_DIR` moves
  `hooks.json`) is to be confirmed per agent, in its ticket. For Cursor
  CLI it does not: 2026.11.22 reads `~/.cursor/hooks.json` whatever
  `CURSOR_CONFIG_DIR` names (checked in #350), so its hook is one per
  agent, not per config folder.
- Before writing, a dialog shows the file's full path, whether it exists,
  and the exact text added, then Install and Cancel. Nothing is written on
  Cancel.

### Where it writes

User-level config only, each in the agent's home or config folder, never in
a repository or worktree:

| Agent | File (to confirm in its ticket) | How |
| --- | --- | --- |
| Cursor CLI | `~/.cursor/hooks.json` | entries added to a shared file |
| Gemini CLI | `~/.gemini/settings.json` | entries added to a shared file |
| GitHub Copilot CLI | `~/.copilot/hooks/` | a file of the app's own |
| OpenCode | `~/.config/opencode/plugins/` | a plugin file of the app's own |

The script the entries run lives in the app's own data folder, so the entry
in the agent's file stays one line.

- **A file of the app's own** is created and removed whole.
- **A shared file** is read and parsed; the app's entries are added to the
  arrays of the events it uses, and nothing else is touched. "Nothing else"
  means every other key and value parses the same after the write. Spacing
  and key order of the file may change on rewrite, since the agents read
  JSON; when the file holds comments or anything that would not survive
  being parsed and written again, the app does not write it and shows the
  entry to paste by hand.
- **The file is missing:** created with only the app's entries and what the
  format needs (Cursor's `"version": 1`). Removing the hook deletes a file
  the app created when nothing else is left in it.
- **The file is a link, or not writable** (a dotfiles repository, stow,
  chezmoi, home-manager): the app does not write it, since a rename would
  replace the link and its target may be in a repository. It shows the
  entry to paste by hand.
- **Written safely:** to a temporary file beside it with the same mode, then
  renamed over it, after reading it again to check nothing changed since it
  was shown. No backup copy is kept: the agents' settings files can hold
  secrets, and the change is only the app's own entries, which Remove takes
  out.

### What the hook does

One script, `status-hook`, takes its agent and its event as arguments:

1. Does not read its input: the agent writes an event's details there,
   and the hook needs none of them. Whether each agent copes with a hook
   that leaves its input unread (it should see a closed pipe at exit) is
   part of its spike; if one does not, the hook drains it, which is safe
   only where the agent closes its end.
2. Does nothing more unless `TIMBER_APP_STATUS` names a file. That variable
   is set only in the app's sessions, so the hook is inert in any other
   terminal.
3. Appends one line, `agent=<agent>:event=<event>`, to that file.
4. Prints nothing and exits 0, whatever happened. It does no waiting of
   its own, and its entry sets the agent's own timeout, where the agent has
   one, to a few seconds.
   Several agents read a hook's output or exit code as a decision (allow,
   deny, block); an observing hook must not make one. A hook that cannot
   find its script (the app was uninstalled) must also stay quiet and let
   the agent go on; whether each agent does so for a missing command is
   part of its spike.

The hook sends the event, not a state: the main process maps
`(agent, event)` to a state, so the hook never carries anything the
agent or the person wrote, and a mapping can be fixed in the app without
touching the person's files.

### What the main process does with a line

- Each session's environment gets `TIMBER_APP_STATUS`, a file of its own
  (named by the session id) in a private folder of the app's, mode 0700,
  beside the handoff folder. The name only routes a line to its session; it
  is not a secret. Any program of the person's can already write OSC 7501
  into a session.
- The main process creates the file, empty, when the session starts, and
  deletes it when the session ends. A line appended after that, by a
  program the session left running, makes a file the app does not know,
  which it deletes unread. A file past a size cap (64 KiB) is read no
  further until the session ends; a turn writes a few dozen bytes.
- The app's own environment may hold `TIMBER_APP_STATUS`, when it was
  started from one of its own terminals; `sessionEnvironment` replaces it,
  as it does `TIMBER_APP_HANDOFF`.
- A line is read with the same limits and malformed-pair rules as an OSC
  7501 report, and turned into a report of the session's root record (no
  `id`, no `msg`, no `title`). Its `app` is set by the main process from the
  line's `agent`, never taken from what a hook wrote beyond the agent id,
  so `agentBrand` gives the session that agent's mark.
- A line is dropped when the session is an agent session whose `program`
  is another agent. Grok Build's guide says it also runs the hooks in
  `~/.cursor/hooks.json` and `~/.claude/settings.json` (not tried), and
  this keeps a Cursor line out of a Grok session.
- In a session with no `program` (a shell where the person typed
  `cursor-agent`, an unrecognized wrapper, or the shell an agent ended
  into), a line is kept: the hook only runs where its agent runs.
- A line is also dropped once the session reported through its own
  stream, since the agent then reports natively (now or after an update),
  until a new shell prompt, a full reset, or the program's exit, so a shell
  where `claude` ran and quit takes `cursor-agent`'s lines afterwards.
  (As built in #350.)
- Records from lines end as records from the stream do: on exit, on a new
  shell prompt (OSC 133 `A`), and on a full reset.
- For a kept session (issue 171, whose decision record is not merged yet), the
  file is fixed in its environment when it starts, so the folder must be
  one that outlives a restart of the app, not the per-run folder the
  handoffs use. Decided when both are built.

### Which states a hook can reach

A hook can only report what its agent has an event for. Observing events
(a prompt was sent, a turn ended) come first. An event where the agent waits
for a hook's answer, such as Cursor's `beforeShellExecution`, is used only
after a spike shows an empty answer changes nothing, since it runs before
the agent asks the person.

- **Cursor CLI**, spiked: `sessionStart`, `beforeSubmitPrompt`, and `stop`
  ran. They give idle, working, and done. No event spiked says it waits for
  the person, so Needs you is not available for Cursor yet.
- **Gemini CLI, OpenCode, Copilot CLI:** not spiked. Their events are
  decided in their tickets.

Settings says, beside each hook, which states it can report, so a missing
Needs you is not a surprise.

### Removal and repair

The app keeps no record of its own about what it installed: it reads the
agent's file and looks for its entries, known by the path of its script.

- In Settings, Agents, a row's hook shows one of: Off; On; Changed (an entry
  of the app's is there but not as the app wrote it); Broken (the file does
  not parse, the script is missing, or it cannot be read).
- Remove takes out only the app's entries, after the same dialog as
  Install, showing what goes.
- Checked when Settings, Agents opens and when a session of that agent
  starts; never in the background.
- An agent that changes its hook format makes the app's entry fail to match
  what the registry row expects: shown as Changed, with the version the row
  was checked against.
- Uninstalling the app leaves the entries, inert: no session sets the
  variable. Where the uninstall removed the script too, the entry names a
  command that is missing, which each agent must take as a failed observer
  and go on (part of each spike). Settings is where they are removed, and
  docs say so.
- Several installs of the app (stable and canary) share one settings
  folder, so they share the script and its entries: one hook serves both,
  either can turn it on or take it out, and each session's variable names
  one app's file, so a line reaches only the app that started the session.
  (Settled in #350; this page first assumed a data folder per install.)

### Windows

The same design: the file is a path in the environment, which ConPTY passes
on. The hook needs a second form for Windows (`status-hook.cmd`, or
PowerShell), and the file locations of each agent there are to be
confirmed. Nothing is claimed for Windows or macOS until tested.

### Not covered

Sessions over ssh, in a container, or in WSL started from a session: the
variable and the folder do not reach the agent there.

### Codex

No hook: Codex reports through OSC 7501 itself. Were one ever needed, its
`notify` program in `config.toml` is a single key, so adding the app's would
replace the person's own, and its hooks (`hooks.json`) each need the
person's trust in Codex's own "Hooks need review" screen.

## The spike

Run on Linux x64 (Pop!_OS 24.04) on 2026-11-22. A Python script started each
agent in a pseudo terminal of 120 by 40 with `TERM=xterm-256color`, answered
cursor position, device attribute, and color queries and the OSC 7501 probe
as the app does, typed a short prompt as a bracketed paste and Enter, and
kept everything the agent wrote. The steps and results are in
docs/verification.md. In short:

- **Codex CLI 0.169.0:** no probe; `state=idle:app=codex` at its prompt
  (after a short `working` and `idle` as it starts), `working` during a
  turn, `done` after it, with `TERM_PROGRAM` unset, `Rex`, and the app's
  own `timber-app`. Its `notify` program, set with `-c` so no file was
  written, ran with the session's environment and the session's terminal:
  OSC 7501 written to `/dev/tty`, and to the terminal's path from the
  environment, both came out of the session's stream. `blocked` was not
  seen: this account approves commands without asking, and 0.169.0 no
  longer accepts `approval_policy = "untrusted"`.
- **Grok Build 1.0.92:** one probe, then `blocked:kind=permission` with
  "Trust this folder?", `idle`, `working` with a message, and `done`, all
  with `app=grok`, its config not touched.
- **Cursor CLI 2026.11.22:** no OSC 7501. A project `.cursor/hooks.json` in
  a scratch repository ran `sessionStart`, `beforeSubmitPrompt`, and `stop`;
  each hook had the session's environment but no terminal. Writing to the
  terminal's path from the environment reached the stream.
- **Gemini CLI, OpenCode, GitHub Copilot CLI:** not installed on this
  machine (the `copilot` on its `PATH` is VS Code's shim), so not spiked.

## Before the build

- Codex reports `idle` at its prompt without probing, but prompt readiness
  (`isReadyForPrompt` in `src/shared/agent-prompt.ts`) counts an agent as
  reporting only once it probed, so Codex still gets its first prompt by the
  quiet rule. A follow-up, not part of hooks.
- Each agent's ticket confirms its file, the variable that moves its config,
  its events, how it treats a missing hook command and unread input, and
  whether its hooks run when its folder is not trusted.
- Whether Cursor's `stop` runs for a turn that is interrupted (Esc, Ctrl+C)
  or fails. If not, a session stays Working until the agent exits or a new
  prompt starts working again; #352 finds out.

## The work

- #350, the installer: the folder, the variable, reading lines, the
  Settings, Agents part, Install and Remove, the checks. Its first agent is
  Cursor CLI, the only one spiked that needs a hook, not Codex, which
  reports itself.
- #351 Gemini CLI, #353 OpenCode, #354 Copilot CLI: spike first, then a
  hook only if it does not report natively.
- #352 Cursor CLI: folds into #350, or adds a Needs you event once one is
  found.
- #355 Grok Build: no hook. Its registry row now says it reports through
  OSC 7501; what is left is checking it in the desktop app.
- Each of them adds its capabilities to `src/shared/engine.ts`, the main
  process, the mock engine, and `src/shared/rpc.ts`, as AGENTS.md asks.
