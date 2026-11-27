# Decision: keeping sessions running after the app quits

Status: agreed, for issue #171. Nothing here is built yet. The answers to
the questions asked before the build are under [answered](#answered).

## The problem

Every terminal and agent session is a pseudo terminal the main process owns
(`src/bun/terminals.ts`, `src/bun/pseudo-terminal.ts`). Quitting ends them
all. Since #137 the next launch starts them again, and an agent goes back to
its conversation, but whatever ran at quit (a build, a test run, an agent in
the middle of a task) is cut off.

Issue #171 asks for a setting, "Keep sessions running when Timber quits", off
by default. With it on, sessions outlive the app, and the next launch
reattaches to them with their live output. This page compares three ways to
hold a session while the app is gone, picks one, and says how it fits the
code that is there.

## What any choice must do

1. **Off changes nothing.** With the setting off, sessions start, end, and
   come back exactly as today.
2. **Unchanged output.** The window draws with xterm.js, and the main process
   reads the Program Status Protocol (OSC 7501) and OSC 133 prompts
   (`createStatusScanner` in `src/shared/program-status.ts`) and bracketed
   paste (`createPasteModeScanner` in `src/shared/terminal.ts`) out of the
   output.
   Whatever holds the session must pass the program's output through as it
   came.
3. **Output from while the app was away.** On reattach the window must draw
   the recent past, as it does after a reload from what the main process
   keeps (`SCROLLBACK_LIMIT` in `src/shared/terminal.ts`, 512 Ki UTF-16 code
   units of decoded text, called 512 KiB below).
4. **Everything the app knows about a session survives.** Kind, name, agent,
   conversation id, worktree id, restore tag, start time.
5. **A way to stop them.** Kept sessions must always be visible and
   stoppable, also when the app is never started again.
6. **Private.** Whatever can type into a session can run anything as the
   person. Only the person's own app may reach it.
7. **Platforms** claimed only where tested.

## The options

### A. A small host of the app's own

A second Bun process, started detached by the app, owns the pseudo terminals
with the same code that owns them today (`startPseudoTerminal`). It keeps,
per session, the last 512 KiB of output and a record of what the app told it
about the session. It listens on a private local socket. The app connects as
its only client: it starts sessions there, writes, resizes, and closes them,
and gets their output. When the app quits, it disconnects; the host and its
sessions go on. The next launch connects again, lists what is there, and
reattaches.

- **Unchanged output:** yes. The host never interprets the output, so OSC
  7501, OSC 133, bracketed paste, the alternate screen, mouse reports, and
  OSC 8 links all pass as today.
- **Past output:** yes, the host's buffer, replayed into the existing drawing
  path, which already copes with a replay that starts in the middle of a
  full-screen program's picture.
- **Windows:** the same pseudo terminal code, with a named pipe for the
  socket, but with open problems (see [platforms](#platforms)).
- **Cost:** one more Bun process, tens of MB resident, only while at least
  one session is kept, plus a second copy of each session's 512 KiB buffer
  while the app runs. Nothing runs with the setting off.
- **Work:** a protocol, the host, a client, and the lifecycle around them.
  The most code of the three, all of it TypeScript in this repository and
  testable with the same tools.

### B. tmux underneath

Each session runs as a tmux window on a private tmux server (`tmux -L
timber-app -f /dev/null`), and the app attaches a client to it in its own
pseudo terminal.

- **Unchanged output: no.** tmux is a terminal emulator itself. The window
  would draw tmux's picture of the program, not the program. OSC 7501 and
  other unknown sequences are dropped unless passthrough is on, and
  passthrough (`allow-passthrough`, tmux 3.3 and later) needs the program to
  wrap them, which agents do not. Mouse reports, the clipboard (OSC 52), the
  scrollback, and bracketed paste all go through tmux's own handling.
- **Past output:** `capture-pane`, which gives tmux's rendered lines, not the
  output, so status reports in the past are gone.
- **Windows: no.** tmux runs only under WSL or Cygwin there.
- **Dependency:** installed by default on no supported system, and the
  installed version decides behavior. Bundling it means building and
  shipping a C program and its libraries for each platform.
- **Cost:** small, a few MB for the server.

### C. dtach underneath

Each session runs under `dtach`, which holds one pseudo terminal and passes
output through unchanged to whoever attaches.

- **Unchanged output:** yes, it does not emulate a terminal.
- **Past output: no.** dtach keeps no scrollback. A client that attaches
  gets only what comes next; it can ask the program to redraw (a resize or
  Ctrl+L), which works for full-screen programs and not for a build log. The
  app would need a buffer of its own somewhere, which is option A again.
- **Windows: no.**
- **Dependency:** not installed by default anywhere; it would have to be
  built and bundled per platform.
- **Cost:** the smallest, well under a MB per session.

### Compared

|                         | A: own host     | B: tmux        | C: dtach |
| ----------------------- | --------------- | -------------- | -------- |
| Output passes unchanged | yes             | no             | yes      |
| OSC 7501 after reattach | yes             | no             | partly   |
| Output from while away  | yes             | rendered lines | no       |
| Windows                 | later, unproven | no             | no       |
| Something to bundle     | a script        | a C program    | a C program |
| Memory while kept       | tens of MB      | a few MB       | < 1 MB   |
| Code in this repository | most            | some           | some     |

One host per session was also considered: a simpler protocol, but tens of MB
per session.

## Decision

**Option A, a host of the app's own, on Linux first.** It is the only one that
keeps the window's view of a session the same after reattaching (unchanged
output, status, past output), and it adds nothing to install. Its extra
memory is paid only while sessions are kept, by people who turned the
setting on. The protocol carries nothing Linux-specific, so macOS and
Windows can follow, each once it is tested there.

## How it works

### The host

- **What it is.** A Bun script with its own entry point,
  `src/bun/session-host.ts`, built by its own `bun build` step beside the main
  process's bundle (Electrobun 2.0.6 builds one entry, so the `build`, `start`,
  and `dev` scripts get the step and `electrobun.config.ts` a `copy` line; `bun
  run dev` rebuilds it on a change too, since its watcher rebuilds only the main
  entry). It never loads `electrobun/main`. The installed app's own Bun
  (`app/bin/bun`) runs it.
- **Started** by the app the first time a session starts with the setting on,
  detached in a process session of its own (`Bun.spawn` with `detached`), so
  it does not get the app's hang-up, as the restart waiter outlives the app
  today (`spawnWaiter` in `src/bun/restart.ts`). The app's environment, which
  can hold secrets, goes to it as its environment, never in its arguments,
  and is never logged. The host's own environment is not used for sessions:
  each start request carries the session's whole environment as the app
  builds it today (`sessionEnvironment` and `withChanges` in
  `src/bun/terminals.ts`, with an arena attempt's own changes), so a session
  started after a relaunch gets the new app's environment.
- **Where it listens.** A Unix socket in a folder only the person can open
  (mode 0700), under `$XDG_RUNTIME_DIR`, falling back to the app's settings
  folder, named for the app's channel (stable or canary), so a copy run from
  source never reaches the installed app's sessions. Every copy run from
  source is channel `dev` (`src/bun/index.ts`), so there the name also holds
  a short hash of the checkout's folder, and two worktrees running `bun run
  dev` keep apart. The
  path stays within the 108 bytes a socket path allows, and tests pass their
  own. The connection also carries a random token from a file only the
  person can read.
- **What it keeps per session:** an id of its own, which lasts as long as the
  session; the pseudo terminal; the last 512 KiB of output, decoded as the
  main process decodes it; how the program ended, once it did, and which
  processes were left in the shell's session right then (as `leftovers` are
  taken today, `src/bun/terminals.ts`), so the app can end them after a
  relaunch without signalling a reused process id; whether the program last
  turned bracketed paste on or off, since the switch can be older than the
  buffer; and an opaque record from the
  app (kind, name, agent, conversation, worktree id, restore tag, start
  time, the handoff folder), which it stores and gives back and never reads.
- **Protocol.** Length-prefixed frames with a JSON header and the output as
  the body, so output needs no escaping. Parsing and writing frames is a pure
  module with its own tests. The first frame from each side names a protocol
  version.
- **Flow.** The host reads every pseudo terminal all the time, so a program
  never stalls on a missing app. What it sends to the app is capped: past the
  cap, it stops sending and, once the app catches up, sends what its buffer
  holds in one part that starts the screen afresh, as the main process does
  for the window today.
- **One client.** A second app of the same channel that connects takes over,
  and the first is told it lost the sessions. Two windows never type into
  one session.
- **Ends itself** when it holds no session and no client is connected, and when
  it is told to stop all. A session that ended while no app was connected is
  still held, with its exit and its output, until an app has reattached and the
  person dismissed it, as an ended session stays today. A host that crashes
  takes every kept session with it, as the app does today.
- **Stopping without the app.** `session-host --stop-all` connects, stops
  every session, and ends the host, for a person who will not start the app
  again.

### The seam in the app

`terminals.ts` changes in four places. With the setting off and no host
there, none of them runs, and today's code path is untouched. At launch the
app always looks for a host of its channel, whatever the setting says (see
[the setting](#the-setting)); finding none costs one failed connect.

- **Starting.** `PseudoTerminal.pid` and `ended()` are synchronous
  (`src/bun/pseudo-terminal.ts`), so a kept session's start waits for the
  host's answer with its pid before the `PseudoTerminal` exists. After that,
  `write`, `resize`, and `close` are messages to the host, and output and the
  exit come back from it. Everything that reads the output stays in the main
  process: the status scanner, the paste mode, chop and prompt typing, and
  the window's flow control.
- **Ending.** Signalling stays in the app: the shell's session members, the
  SIGHUP, two seconds, then kill (`src/bun/process-session.ts`), which works
  from any process of the same user. Only closing the pseudo terminal and
  telling the exit need the host.
- **Adopting.** A reattached session never goes through `open()`. A new path
  builds the session's state from the host's record and output, with a new
  session id, and tells the window as an opened session does.
- **Quitting.** Today quitting ends every session (the `endAll` dependency of
  `src/bun/quit-guard.ts`, and `closeAll` and `killAll` of
  `src/bun/terminals.ts`, called from `src/bun/index.ts`). With kept sessions,
  quitting detaches from them instead, and ends only sessions the host does not
  hold.

### Replaying is not live

On reattach, the host's buffered output goes through the status scanner, so a
session's status is known again, and to the window, so it draws the past.
Nothing in it may act as if it had just arrived:

- the main process answers no status probe found in it
  (`src/bun/terminals.ts`, where a probe gets `probeAnswer` written back);
- the window sends no answer xterm.js makes while drawing it, such as for
  device attributes, the cursor position, or colors
  (`src/mainview/terminal-view.ts`, which passes every answer on), while
  the person's typing still goes through, since xterm.js gives both on the
  same `onData`;
- no chop or prompt is typed, and no notification or sound fires.

Live output after the replay is treated as today. Paste mode comes from the
host's record, not from the replay. A status report older than the 512 KiB
the host keeps is lost; the program's next report puts it right.

### While the app is away

Nobody answers a status probe, and Claude Code takes one missed answer as
"no protocol" (see [agent status](architecture.md#agent-status)). So a
program that starts while the app is away may report no status until it
starts again. No notification fires while the app is closed; that is not a
goal here.

### The handoff folder

`timber new` typed in a session hands the app its worktree through a folder
made for each run and removed at quit (`src/bun/handoffs.ts`, passed as
`TIMBER_APP_HANDOFF`). A kept shell would keep the old path, so a kept
session gets a folder of the host's instead: made by the host with `mkdtemp`
and mode 0700 under `$XDG_RUNTIME_DIR`, or the system's temporary folder,
named in the host's record, and removed when the host ends. Never a fixed
name another user could make first. The app watches the host's folder while
connected, beside its own folder for sessions it holds itself, so with no
host nothing changes. Records left there while the app was away are read at
launch outside the burst limit (`BURST_LIMIT` in `src/bun/handoffs.ts`), up
to a count of their own, so a launch does not drop them.

### Reattaching and the saved layout

At launch, with a host there, the app connects before the window takes the
saved layout (`takeSavedSessions`). Each kept session comes back as a session
of its worktree, with its record, its buffered output, and its state:
running, or ended with its code while the app was away. A restore tag
names a place in the file read at launch, so it cannot match a kept session:
instead `sessions.json` saves, for a kept session, the host's id for it.
Saved sessions that a kept session stands for, by that id, are not started
again, and count as opened again, so the carry of saved sessions that did
not open (`SAVED_MISS_LIMIT` in `src/bun/session-layout.ts`) does not count
them as missed. The rest restore as today. The selected worktree and the
chip that shows still come from `sessions.json`.

### The setting

`keepSessions`, a boolean preference, off by default, in Settings, Terminal.

- **Turned on:** sessions that run now stay in the app and end at quit as
  before; it applies to sessions that start from then on. That needs no
  restart, so it is not marked `restart: true` and saving it offers none.
  The setting's hint says it applies to sessions started after it is turned
  on.
- **Turned off with sessions kept:** they keep running and keep showing, and
  the next quit asks as today and ends them. Nothing new is kept.
- **A host left by an earlier run** is reattached and shown whatever the
  setting says, so its sessions can always be seen and stopped.

### Quitting

With kept sessions, the Quit dialog says how many keep running and how many
end (a session the host does not hold). Its buttons are "Quit" (they keep
running), "Stop all and quit", and "Cancel".

- **Stop all and quit** ends the kept sessions the way closing a session
  does, from the app, and quits once the host says they ended, so the stop
  never waits on a message that the quitting app may not send.
- **The last-moment quit** in `guardQuit` (`src/bun/index.ts`), which ends
  sessions synchronously because there is no time to wait, ends only the
  sessions the app holds itself and only detaches from the host.
- **A quit the window could not ask about**, which the quit guard cannot
  tell apart from SIGTERM (`src/bun/quit-guard.ts`), keeps them, as the
  person agreed to that by turning the setting on. With the setting since
  turned off, it keeps them too: ending sessions without anyone agreeing is
  worse than leaving them shown at the next launch.
- **Restart now** from Settings (#134) quits through the quit guard. It keeps
  kept sessions, since the app reattaches at once, and its question says
  how many keep running and how many end.
- **The setting off with kept sessions** asks as today, with "Stop all and
  quit" and "Quit" (they keep running) as for the setting on.

### Updates and uninstalling

An update replaces the bundle the host runs from, and a new app may speak
another protocol version. An update asks first and ends kept sessions, as
installing an update ends every session today. The app never uses a host of
another version: it lists that host's sessions, offers to stop them, and starts
a new host for new ones. Uninstalling stops the host first
(`src/bun/uninstall.ts`).

### When the app never comes back

The host does not end sessions on a timer: a long task is the reason to keep
it. Instead:

- **Stop all and quit** in the Quit dialog, every time the app quits with
  kept sessions.
- **Settings, Terminal** shows "N sessions running in the background" with
  "Stop all" whenever a host runs.
- **`session-host --stop-all`**, which needs no app.
- **Logging out** on Linux is expected to end the host: an app started from
  the desktop runs under the person's systemd user manager, which stops its
  processes when the person's last login ends, unless lingering is on. This
  depends on how the app was started and is one of the trials below. A
  reboot ends everything.
- Starting the app again always reattaches and shows the sessions as chips,
  so nothing runs unseen once the app is open.

## Platforms

- **Linux:** built and tested in this work, claimed once a kept session has
  survived a quit and a relaunch of the installed app, recorded in
  `docs/verification.md`.
- **macOS:** the host would run as on Linux, but ending a session finds only
  the shell's process group there, and nothing has been tried. Not built.
- **Windows:** not built. Two problems are unsolved. Bun may not be able to
  set a named pipe's access list, so the token alone would guard it, and it
  would also have to prove the host to the app against another program
  taking the pipe's name first. And a running host holds `bun.exe` and
  node-pty's `conpty.dll` and `OpenConsole.exe` open, which would likely make
  an update fail to replace them.

With the setting on where it is not built, Settings says so and sessions run
in the app as today.

## Before the build

Two short trials, whose results are recorded here:

1. **The host outlives the app.** From the installed app on Linux, a detached
   host started as above keeps a session running for 30 minutes after the
   app quits through `Utils.quit()`.
2. **The bundle runs it.** The installed `app/bin/bun` runs the separately
   built host script.
3. **Its cost.** The host's resident memory with no session, and with five
   sessions printing, measured, to replace "tens of MB" above.
4. **Logging out.** Whether the host ends when the person logs out, for the
   app started from the desktop and from a terminal.

## The work, in three pull requests

1. **This record**, agreed. Meets the issue's first criterion.
2. **The host, the protocol, and the client**, not wired into the app. Tested
   at host level: start a session, kill the client's process, connect again,
   and the output goes on. That is the survive test, with no window.
3. **Wiring:** the preference, adopting, the replay rules, the Quit dialog,
   Settings' Stop all, uninstalling, updates, the handoff folder, the saved
   layout, a test that the setting off changes nothing, `docs/architecture.md`
   and `docs/verification.md`, and a run of the installed app on Linux.

## Answered

Asked before the build, and answered for #171:

1. **Restart.** No restart offer. The setting's hint says it applies to
   sessions started after it is turned on.
2. **Updates.** Installing an update asks, then ends kept sessions.
3. **A command to stop all** without the app: yes, `session-host --stop-all`.
4. **Notifications while the app is closed:** not in this work. How much it
   would take is below, to decide on as a setting of its own later.

## Later: notifications while the app is closed

Not built here. It would be a setting of its own, "Notify while Timber is
closed", off by default, Linux first. What it takes:

- **The host reads status while no app is connected.** It runs the same
  pure scanner (`src/shared/session-status.ts`) on output only while it has
  no client, answers status probes then, so an agent started while the app
  is away still reports, and hands each session's records to the app when it
  connects. While an app is connected, the app reads status as before, so no
  notice is shown twice.
- **The host shows the notice.** The notices are worked out by pure code
  (`src/shared/status-notices.ts`), and on Linux are sent over D-Bus by code
  with no tie to Electrobun (`src/bun/desktop-notices.ts`, `src/bun/dbus.ts`),
  so the host can reuse both. Sounds would wait for a later step.
- **A click starts the app.** Clicking a notice while the app is closed
  starts it and shows that session, which needs the host to know how to
  start the installed app, as the restart waiter does (`src/bun/restart.ts`).

It is about one more pull request after the wiring, mostly in the host,
which grows from passing output through to reading it. The cost is that the
host and the app then share session logic across two versions, which the
update rule above keeps to one version at a time.

## Not chosen, and why not

- **Ending kept sessions after a time.** It would cut off the long task the
  setting is for. The visible Stop all is the answer instead.
- **Moving the status scanner into the host for good.** It would split
  session logic over two processes. Replaying the buffer through the app's
  scanner is enough while the app is open; the host reads status only while
  the app is away, and only in the later step above.
- **systemd user units or launchd agents.** They would let the system own the
  host, but they differ on every platform, and Windows has none.
