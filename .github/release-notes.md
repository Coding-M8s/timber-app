The desktop app for [Timber](https://github.com/Coding-M8s/timber), in beta.
It needs Git on your PATH, and brings its own Timber.

**These builds are not signed.** Check a download against `SHA256SUMS.txt`
before running it:

```bash
sha256sum --check --ignore-missing SHA256SUMS.txt
```

On Windows, `Get-FileHash win-x64-Timber-Setup.zip` prints the hash to
compare by eye.

**Linux x64.** Install WebKitGTK 4.1 and the Ayatana app indicator library
as the [README](https://github.com/Coding-M8s/timber-app#quick-start) shows,
then:

```bash
tar -xzf linux-x64-Timber-Setup.tar.gz
./installer
```

The installer asks nothing. It puts the app in
`~/.local/share/com.codingm8s.timber-app/stable/`, a menu entry in
`~/.local/share/applications/`, and a shortcut in `~/Desktop` when that
folder exists.

**Windows x64.** Extract all of `win-x64-Timber-Setup.zip` and run
`Timber-Setup.exe` from the extracted folder. Because the installer is not
signed, Windows SmartScreen is expected to show "Windows protected your PC". Choose "More info", then
"Run anyway". The app installs to
`%LOCALAPPDATA%\com.codingm8s.timber-app\stable` with a Start menu entry.
More in [installing on Windows](https://github.com/Coding-M8s/timber-app/blob/main/docs/install-windows.md).

**Updates.** This build looks for a newer release a little after it starts
and every six hours, downloads it, and offers "Restart to update". It never
restarts by itself. Settings, About has "Check for updates". The `stable-*`
files of this release are what installed apps update from. Updating is new
in this beta and has not yet been tried from one release to the next.

To remove the app, use Settings, About, Uninstall on Linux, and Settings,
Apps, Installed apps, Timber on Windows.
