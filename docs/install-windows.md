# Installing on Windows

How to get the Timber app onto a Windows x64 machine, where it ends up, and
how to remove it. Windows 11 Home x64 (10.0.26200) is the only Windows this
has been tried on; see [what has been verified](verification.md).

There are two ways in:

- **[From a release](#from-a-release)**: download the installer from GitHub.
  Use this once a release is published.
- **[From source](#from-source)**: build the same installer yourself with
  `bun run build`. Use this until then, or to try an unreleased change.

Either way you get the same installer, `Timber-Setup.exe`, and the same
installed app.

## What you need

- **Windows x64.** No other Windows architecture is built.
- **Git**, on PATH. [Git for Windows](https://git-scm.com/download/win) is
  what was tested (2.50.1).
- **Timber: nothing to do.** The installed app brings the pinned Timber
  (in `app\Resources\app\timber`) and uses it unless Settings, Timber,
  Executable picks another. See
  [the bundled Timber](architecture.md#the-bundled-timber).
- **WebView2**, which draws the window. Windows 11 already has it.
- **Agents as `.exe` files.** A coding agent must be its own executable,
  such as `claude.exe`, not a `.cmd` or `.bat` launcher; the app refuses
  those (see [agent sessions](architecture.md#agent-sessions)).

## From a release

1. Open [GitHub Releases](https://github.com/Coding-M8s/timber-app/releases)
   and download `win-x64-Timber-Setup.zip` and `SHA256SUMS.txt` from the
   newest release.
2. **Check the download.** The builds are not signed, so compare its hash
   with the line for it in `SHA256SUMS.txt`:

   ```powershell
   Get-FileHash .\win-x64-Timber-Setup.zip
   ```

3. **Extract the whole zip** (right-click, "Extract All..."). It holds
   `Timber-Setup.exe` and a `.installer` folder with the app itself. Run
   the installer from the extracted folder, not from inside the zip, so the
   two stay together.
4. **Run `Timber-Setup.exe`.** SmartScreen is expected to say "Windows
   protected your PC", because the installer is not signed. Choose "More
   info", then "Run anyway". It installs for your user only and starts the
   app.

As of 2026-11-24 no release has been published: the only one,
v0.1.0-beta.1, is still a draft, which only people with write access to the repository can see. Until
one is published, build from source.

## From source

You need Git and [Bun](https://bun.sh) 1.4.4 or newer. Install Bun in
PowerShell:

```powershell
powershell -c "irm bun.sh/install.ps1 | iex"
```

Then, in a new terminal so Bun is on PATH:

```powershell
git clone https://github.com/Coding-M8s/timber-app.git
cd timber-app
bun install --frozen-lockfile
bun run build
```

`bun run build` downloads the pinned Timber and checks it, downloads the
Electrobun toolchain on first use, and builds. When it ends:

- `build\stable-win-x64\Timber-Setup.exe` is the installer, ready to run
  where it is: double-click it, or `.\build\stable-win-x64\Timber-Setup.exe`.
- `artifacts\win-x64-Timber-Setup.zip` is the same installer zipped as a
  release ships it, for another machine.

An installer copied to another machine through a browser or chat counts as
downloaded there, so expect the SmartScreen step above.

To run the app from the source folder without installing it, use
`bun run start` instead; see the [commands](../README.md#commands). That copy
uses the Timber on your PATH, not a bundled one, unless
`bun run fetch:timber` ran first.

## Where it goes

Seen on the machine above after running `Timber-Setup.exe`:

| What | Where |
| --- | --- |
| The app | `%LOCALAPPDATA%\com.codingm8s.timber-app\stable\` |
| Its program | `...\stable\app\bin\launcher.exe` |
| Its uninstaller | `...\stable\uninstall.exe` |
| Shortcuts | `Timber` in the Start menu and on the desktop |
| Apps list entry | Settings, Apps, Installed apps: "Timber" |
| Saved repositories and settings | `%APPDATA%\timber-app\settings.json` |

Start it from the Start menu. Then use "Add repository" in the sidebar to
pick a repository folder.

## Updating

An installed app looks for a newer published release about 30 seconds after
it starts and every six hours, downloads it, and offers "Restart to update";
it never restarts by itself. Settings, About has "Check for updates". This
has not yet been tried from one release to the next; see
[updating the app](architecture.md#updating-the-app). A build from source
can also be updated by building again and running the new
`Timber-Setup.exe`.

## Removing it

Settings, About, Uninstall in the app removes it only on Linux so far; on
Windows it says so and has no button. Instead, use Settings, Apps, Installed
apps, then "Timber", then Uninstall. That entry runs
`%LOCALAPPDATA%\com.codingm8s.timber-app\stable\uninstall.exe --uninstall`.
Removing the app this way has not been tried yet.

The uninstaller does not know the app's own settings. To forget the saved
repository list too, delete `%APPDATA%\timber-app` afterwards. Your
repositories, worktrees, and Timber's own configuration are never touched.
Status hooks the app added for an agent stay; take them out first with
Remove in Settings, Agents (see [status hooks](architecture.md#status-hooks)).

## When something goes wrong

- **"Timber is not installed" or "too old".** The bundled Timber is used
  unless Settings, Timber, Executable picks another; set it back to the
  bundled one. A Timber on PATH that was installed after the app started is
  not seen until the app restarts, because the app keeps the PATH it started
  with.
- **Git is not found.** Install Git for Windows, then quit and start the app
  again, for the same reason.
- **An agent will not start.** Point the agent at its `.exe`, not a `.cmd`
  launcher.
- **Agents or terminals look wrong.** Every session inherits the app's
  environment. An app started from a terminal that set `NO_COLOR=1`, for
  one, shows agents without color; start it from the Start menu instead.
