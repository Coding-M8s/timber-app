<p align="center"><img src="src/mainview/assets/logo.png" width="120" alt="Timber logo"></p>

# Timber app

The desktop app for [Timber](https://github.com/Coding-M8s/timber): every
repository, worktree, agent, and terminal in one window. It is a window onto
Timber, not a replacement for it, and it has no code editor of its own.

**Status: early scaffold.** The sidebar lists real repositories with the
worktrees Timber lists and their branch status, remembers the repositories you add, and creates a worktree on a new branch (`timber new`) or opens an existing branch as one (`timber open`) from the "+" on a repository. Done removes a worktree
after a preview of what would be lost. Rebasing worktrees, agent
and terminal panes, the diff view, and settings are designed but not built.
See the [architecture](docs/architecture.md) and [design](docs/design.md) notes.

## Quick start

You need Git, Bun 1.4.2, and for the desktop app
[Timber](https://github.com/Coding-M8s/timber#quick-start) 0.1.1 or newer on
your PATH.

```bash
bun install --frozen-lockfile
bun run dev:web
```

`dev:web` opens the interface in a browser with sample data, which is the
fastest way to work on the UI.

For the desktop app:

```bash
bun run dev
```

The first run downloads the Electrobun toolchain into `.hutch/`. Use "Add
repository" in the sidebar to pick a repository folder; the app remembers the
list, see [saved repository list](docs/architecture.md#saved-repository-list).
Without a usable Timber the app shows install guidance instead; see
[finding Timber](docs/architecture.md#finding-timber).

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev:web` | Interface in a browser, sample data, hot reload |
| `bun run dev` | Desktop app, rebuilt and relaunched on change |
| `bun run dev:hmr` | Desktop app with interface hot reload |
| `bun test` | Unit tests, including Git tests in temporary repositories. The ones that list real repositories need Timber and are skipped without it |
| `bun run typecheck` | Type check without the Electrobun toolchain |
| `bun run typecheck:desktop` | Type check against the real Electrobun SDK |
| `bun run build:web` | Build the interface only |
| `bun run build` | Build the desktop app |

## More

- [Architecture](docs/architecture.md): layers, the boundary with Timber, milestones, and what has been verified
- [Design](docs/design.md): the agreed interface decisions
- [Development guidance](AGENTS.md)
