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
src/bun        Bun main process: the window, Git queries, later sessions
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

1. **Read-only queries may call Git directly.** Listing worktrees and reading
   status is plain `git worktree list` and `git status`, invoked as an
   executable plus an argument array.
2. **Anything that changes a repository goes through Timber.** New, open,
   rebase, and done run the `timber` command, and the interface shows the
   command before it runs.

Timber itself rules out GUI work, a daemon, and a local API inside its own
repository. That is why this is a separate repository, and why the app's
long-running parts (sessions, file watching) live here in the main process
instead of in a `timber serve` mode.

To call Timber reliably the app needs machine-readable output from it, for
example a `--json` option on `timber ls` and on the `done` safety checks. That
is the main thing this app will ask of Timber. See the open decisions below.

## Milestones

1. **Sidebar, read-only (this scaffold).** Repositories and worktrees with
   branch status: commits to push and pull, never published, upstream deleted,
   modified and untracked counts.
2. **Sessions.** Agent and terminal panes. Each is a pseudo-terminal owned by
   the main process (`Bun.Terminal`), rendered by xterm.js. Several per
   worktree, and hidden panes keep running.
3. **Timber actions.** New and open, rebase with a base picker, done with the
   safe and "delete anyway" confirmations.
4. **Changes.** Diff against the base, the last commit, or a rebase backup.
5. **Settings.** Editor, coding assistant, scripts, layout.
6. **Background refresh.** File watching per worktree and periodic fetch.
   Detecting a force-push needs a fetch and the remote-tracking reflog.

## Open decisions

- **How the app calls Timber.** Spawn the `timber` executable and parse JSON,
  or import Timber's modules as a library. Spawning keeps the two releasable
  apart; importing avoids an output format but ties the app to Timber's
  internals.
- **Where the repository list lives.** For now it is the `TIMBER_APP_REPOS`
  environment variable or the starting folder. It needs to become app state.
- **Rebase backups.** The design shows them, but Timber does not create backup
  branches today. Either Timber gains that, or the app creates them.
- **Application identifier.** `electrobun.config.ts` holds a placeholder.
- **Fonts.** The design uses Geist. The app should bundle it instead of
  falling back to system fonts.

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

Not run yet:

- Anything on macOS or Linux desktops.
- The CI workflow.
