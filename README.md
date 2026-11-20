<p align="center"><img src="src/mainview/assets/logo.png" width="120" alt="Timber logo"></p>

# Timber app

The desktop app for [Timber](https://github.com/Coding-M8s/timber): every
repository, worktree, agent, and terminal in one window. It is a window onto
Timber, not a replacement for it, and it has no code editor of its own.

**Status: early scaffold.** The sidebar lists real repositories with the
worktrees Timber lists and their branch status, remembers the repositories you add, and creates a worktree on a new branch (`timber new`) or opens an existing branch as one (`timber open`) from the "+" on a repository. Done removes a worktree
after a preview of what would be lost. Settings, from the cog, puts the
sidebar on the left or the right and chooses the editor that "Open in
editor" starts on a worktree. Each worktree can run several terminals and
coding agents, such as Claude Code and Codex, in the Workspace tab, one chip
each, started from the "+" menu (tested on Linux and Windows 11; on
Windows an agent must be its own `.exe`, not a `.cmd` launcher). Settings,
Agents lists the agents. The Changes tab lists a
worktree's staged, unstaged, and untracked files and shows the diff of each,
read-only. Settings also edits Timber's own settings for the machine and
each repository, saved and checked by Timber itself. Settings, About can
uninstall an installed copy (Linux only so far). The app fetches each
repository in the background (Settings, Fetching) or on "Fetch now",
updating only remote-tracking branches, and marks branches whose upstream
moved, was force-pushed, or was deleted. Rebase, in the workspace header,
runs `timber rebase` in a new session after showing the command. Comparing
against the base is designed but not built.
See the [architecture](docs/architecture.md) and [design](docs/design.md) notes.

## Quick start

You need Git, Bun 1.4.2, and for the desktop app
the newest [Timber](https://github.com/Coding-M8s/timber#quick-start) release
on your PATH.

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

On Linux the desktop app uses the system WebKitGTK 4.1 and GTK 3, and links
the Ayatana app indicator library. In clean Ubuntu 24.04, Fedora 43, and
Arch containers these two packages were enough; the package manager brings
GTK 3 and the rest with them:

```bash
# Ubuntu 24.04 (other Debian-based systems were not tested)
sudo apt install libwebkit2gtk-4.1-0 libayatana-appindicator3-1
# Fedora
sudo dnf install webkit2gtk4.1 libayatana-appindicator-gtk3
# Arch
sudo pacman -S webkit2gtk-4.1 libayatana-appindicator
```

Desktop notifications about agents go to the notification server on the
session bus, and a click shows the session. Optional: `notify-send`
(`libnotify-bin` on Debian and Ubuntu, `libnotify` on Fedora and Arch) shows
them, without a click, when the bus cannot be reached. Sounds play through
`pw-play` or `paplay`, or `aplay` for WAV files. Tested on Pop!_OS 24.04
(COSMIC) only.

When a library is missing, the app names it and suggests a longer list
(`libgtk-3-0 ... librsvg2-2`). That message comes from Electrobun; the list
above is the one tested. Its Fedora line names `libappindicator-gtk3`, which
is not the library the app links; use `libayatana-appindicator-gtk3`. Git
and Timber are needed too, but not to start the window.

The window is always an X11 window, so a Wayland session needs XWayland; see
[display server on Linux](docs/architecture.md#display-server-on-linux).
See [what has been verified](docs/architecture.md#what-has-been-verified).

The first run downloads the Electrobun toolchain into `~/.hutch/` and the
SDK into the project's `.hutch/`. Use "Add
repository" in the sidebar to pick a repository folder; the app remembers the
list, see [saved repository list](docs/architecture.md#saved-repository-list).
Without a usable Timber the app shows install guidance instead; see
[finding Timber](docs/architecture.md#finding-timber).

## Commands

| Command | What it does |
| --- | --- |
| `bun run dev:web` | Interface in a browser, sample data, hot reload |
| `bun run start` | Desktop app, built once; ends when the window closes |
| `bun run dev` | Desktop app, rebuilt and relaunched on change. [Keeps watching](docs/architecture.md#desktop-development-commands) after the window closes (Ctrl+C stops it) |
| `bun run dev:hmr` | Desktop app with interface hot reload; ends when the window closes |
| `bun test` | Unit tests, including Git tests in temporary repositories. The ones that list real repositories need Timber and are skipped without it |
| `bun run typecheck` | Type check without the Electrobun toolchain |
| `bun run typecheck:desktop` | Type check against the real Electrobun SDK |
| `bun run build:web` | Build the interface only |
| `bun run build` | Build the desktop app |
| `bun run icons` | Remake the [app icons](docs/architecture.md#app-identity) from the logo (needs ImageMagick) |

## Linux build

`bun run build` makes an installer, not an app that runs in place. Running
`build/stable-linux-x64/Timber/bin/launcher` installs without asking: the app
to `~/.local/share/com.codingm8s.timber-app/stable/`, a menu entry to
`~/.local/share/applications/Timber.desktop`, and a shortcut to
`~/Desktop/Timber.desktop` (Electrobun has no way to skip it yet).
Details in [installing the Linux build](docs/architecture.md#installing-the-linux-build).

To remove it, use Settings, About, Uninstall: it shows what will go and the
command, removes the app with its web data and cache, and quits. The saved
repository list in `~/.config/timber-app/` stays unless you tick the box.
When the app does not start, run
`~/.local/share/com.codingm8s.timber-app/stable/uninstall --quiet --delete-data`
(without `--delete-data` the web data and cache stay). See
[uninstalling from the app](docs/architecture.md#uninstalling-from-the-app).

## More

- [Architecture](docs/architecture.md): layers, the boundary with Timber, milestones, and what has been verified
- [Design](docs/design.md): the agreed interface decisions
- [Development guidance](AGENTS.md)
