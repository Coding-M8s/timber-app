<p align="center"><img src="src/mainview/assets/logo.png" width="120" alt="Timber logo"></p>

# Timber app

The desktop app for [Timber](https://github.com/Coding-M8s/timber): every
repository, worktree, agent, and terminal in one window. It is a window onto
Timber, not a replacement for it. Its File tab has a small text editor for
quick fixes; real work happens in your own editor.

**Status: early scaffold.** What works today:

- **Sidebar:** your repositories with the worktrees Timber lists and their
  branch status. "+" creates a worktree (`timber new`), opens a branch as
  one (`timber open`), or starts an arena (`timber arena new`); Done removes one after a preview of what would be lost.
- **Workspace tab:** several terminals and coding agents, such as Claude Code
  and Codex, per worktree. On Windows an agent must be its own `.exe`, not a
  `.cmd` launcher.
- **Changes tab:** staged, unstaged, and untracked files with a read-only diff.
- **Fetching:** in the background or on "Fetch now", updating only
  remote-tracking branches, with marks for upstreams that moved, were
  force-pushed, or were deleted.
- **Rebase:** runs `timber rebase` after showing the command.
- **Settings:** layout, editor, agents, fetching, and Timber's own machine and
  repository settings, saved and checked by Timber.

Comparing against the base is designed but not built. See the
[architecture](docs/architecture.md), [design](docs/design.md), and
[what has been verified](docs/verification.md).

## Quick start

You need Git and Bun 1.4.4. An installed app brings its own Timber. A
development build uses the newest
[Timber](https://github.com/Coding-M8s/timber#quick-start) release on your
PATH, or the pinned one after `bun run fetch:timber` (see
[the bundled Timber](docs/architecture.md#the-bundled-timber)).

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
See [what has been verified](docs/verification.md).

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
| `bun test` | Unit tests, including Git tests in temporary repositories. The ones that list real repositories need Timber and are skipped without it. A few drive an installed Chrome or Chromium (`CHROME_BIN` names another) and are skipped without one |
| `bun run typecheck` | Type check without the Electrobun toolchain |
| `bun run typecheck:desktop` | Type check against the real Electrobun SDK |
| `bun run build:web` | Build the interface only |
| `bun run build` | Build the desktop app |
| `bun run icons` | Remake the [app icons](docs/architecture.md#app-identity) from the logo (needs ImageMagick) |

## Releases

Linux and Windows installers are attached to
[GitHub Releases](https://github.com/Coding-M8s/timber-app/releases), with a
`SHA256SUMS.txt` to check them against. They are not signed during the
beta. On Windows, SmartScreen is expected to say "Windows protected your
PC" for an unsigned installer; choose "More info", then "Run anyway". Each
release's notes give the install steps. How a release is made:
[releasing](docs/releasing.md).

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
- [Releasing](docs/releasing.md): one tag builds unsigned Linux and Windows installers into a draft release
- [Development guidance](AGENTS.md)
- [Contributing](CONTRIBUTING.md) and [security policy](SECURITY.md)
