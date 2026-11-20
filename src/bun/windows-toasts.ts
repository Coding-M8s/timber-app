import type { NotificationRequest, NotificationServer } from "./notification-server";

/*
 * Desktop notifications on Windows, as toasts that answer a click.
 *
 * Electrobun 2.0.6 shows a notification on Windows as a tray balloon it
 * cannot click through, replace, or withdraw. Instead the main process keeps
 * one Windows PowerShell running with a fixed script that shows WinRT toasts
 * for the app's own AppUserModelID. Windows PowerShell cannot subscribe to
 * WinRT events itself, so the script compiles a small C# class that adds the
 * handlers by reflection and prints each event.
 *
 * The app and the script talk in lines. The app sends `show <tag> <silent>
 * <title> <body>`, with the texts as base64 of UTF-8, `withdraw <tag>`, and
 * `stop`. The script answers `ready` once it can show toasts, then
 * `activated <tag>` and `dismissed <tag> <reason>`. A tag is a number the app
 * chose, so no text from a session is ever part of the script or a command
 * line, and the texts go into the toast as XML text nodes, never as markup.
 * A toast shown again with the same tag takes the place of the one before.
 */

/** The environment variables that hand the script its identity, never as part of its text. */
export const TOAST_VARIABLES = { aumid: "TIMBER_TOAST_AUMID", name: "TIMBER_TOAST_NAME", icon: "TIMBER_TOAST_ICON" } as const;

/** The group every toast of the app is in. */
const GROUP = "timber";

/** How long the script may take to start, compile its handlers, and say it is ready. */
export const TOAST_READY_MILLISECONDS = 20_000;

/**
 * The fixed script. It registers the AppUserModelID for the current user
 * under HKCU\Software\Classes\AppUserModelId, which lets an app without a
 * Start menu shortcut show toasts under its own name and icon, then reads
 * commands until `stop` or the end of its input, and takes the app's toasts
 * away before it ends.
 */
export const TOAST_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
$aumid = $env:${TOAST_VARIABLES.aumid}
$key = 'HKCU:\Software\Classes\AppUserModelId\' + $aumid
New-Item -Path $key -Force | Out-Null
New-ItemProperty -Path $key -Name DisplayName -Value $env:${TOAST_VARIABLES.name} -PropertyType String -Force | Out-Null
if ($env:${TOAST_VARIABLES.icon}) { New-ItemProperty -Path $key -Name IconUri -Value $env:${TOAST_VARIABLES.icon} -PropertyType String -Force | Out-Null }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public sealed class TimberToastEvents {
    [DllImport("user32.dll")] private static extern bool AllowSetForegroundWindow(int processId);
    private readonly string tag;
    private TimberToastEvents(string tag) { this.tag = tag; }
    public static void Say(string line) { lock (Console.Out) { Console.Out.WriteLine(line); Console.Out.Flush(); } }
    public void Activated(object sender, object args) { AllowSetForegroundWindow(-1); Say("activated " + tag); }
    public void Dismissed(object sender, object args) {
        int reason = -1;
        try { reason = Convert.ToInt32(args.GetType().GetProperty("Reason").GetValue(args, null)); } catch {}
        Say("dismissed " + tag + " " + reason);
    }
    public static void Watch(object toast, string tag) {
        var target = new TimberToastEvents(tag);
        foreach (var name in new[] { "Activated", "Dismissed" }) {
            var info = toast.GetType().GetEvent(name);
            var handler = Delegate.CreateDelegate(info.EventHandlerType, target, typeof(TimberToastEvents).GetMethod(name));
            info.GetAddMethod().Invoke(toast, new object[] { handler });
        }
    }
}
'@
[void][Windows.UI.Notifications.ToastNotificationManager, Windows.UI.Notifications, ContentType = WindowsRuntime]
[void][Windows.Data.Xml.Dom.XmlDocument, Windows.Data.Xml.Dom, ContentType = WindowsRuntime]
$notifier = [Windows.UI.Notifications.ToastNotificationManager]::CreateToastNotifier($aumid)
$history = [Windows.UI.Notifications.ToastNotificationManager]::History
$shown = @{}
function Read-Text($text) { [Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($text)) }
[TimberToastEvents]::Say('ready')
while ($true) {
    $line = [Console]::In.ReadLine()
    if ($null -eq $line -or $line -eq 'stop') { break }
    $parts = $line.Split(' ')
    try {
        if ($parts[0] -eq 'show' -and $parts.Length -eq 5) {
            $xml = New-Object Windows.Data.Xml.Dom.XmlDocument
            $xml.LoadXml('<toast><visual><binding template="ToastGeneric"><text></text><text></text></binding></visual></toast>')
            $texts = $xml.GetElementsByTagName('text')
            [void]$texts.Item(0).AppendChild($xml.CreateTextNode((Read-Text $parts[3])))
            [void]$texts.Item(1).AppendChild($xml.CreateTextNode((Read-Text $parts[4])))
            if ($parts[2] -eq '1') {
                $audio = $xml.CreateElement('audio')
                $audio.SetAttribute('silent', 'true')
                [void]$xml.DocumentElement.AppendChild($audio)
            }
            $toast = New-Object Windows.UI.Notifications.ToastNotification $xml
            $toast.Tag = $parts[1]
            $toast.Group = '${GROUP}'
            [TimberToastEvents]::Watch($toast, $parts[1])
            $shown[$parts[1]] = $toast
            $notifier.Show($toast)
        } elseif ($parts[0] -eq 'withdraw' -and $parts.Length -eq 2) {
            $toast = $shown[$parts[1]]
            $shown.Remove($parts[1])
            if ($null -ne $toast) { try { $notifier.Hide($toast) } catch {} }
            $history.Remove($parts[1], '${GROUP}', $aumid)
        }
    } catch {
        [TimberToastEvents]::Say('error')
    }
}
try { $history.Clear($aumid) } catch {}
`;

/** How much of the script's error output is kept. */
const ERROR_OUTPUT_LIMIT = 600;

/** Why the script ended: its exit code and the end of its error output, on one line. */
export function endReason(exitCode: number | null, errorOutput: string): string {
	const output = errorOutput.replace(/\s+/g, " ").trim();
	return `exit code ${exitCode ?? "none"}${output === "" ? "" : `: ${output}`}`;
}

/** A tag: a positive whole number the app chose. */
const TAG = /^[1-9][0-9]{0,9}$/;

/** The line that shows a toast with this tag, replacing one shown with it before. */
export function showLine(tag: number, title: string, body: string, silent: boolean): string {
	const text = (value: string) => Buffer.from(value, "utf8").toString("base64");
	return `show ${tag} ${silent ? 1 : 0} ${text(title)} ${text(body)}\n`;
}

/** The line that takes a toast off the screen and out of the notification center. */
export function withdrawLine(tag: number): string {
	return `withdraw ${tag}\n`;
}

export type ToastEvent = { kind: "ready" } | { kind: "error" } | { kind: "activated"; tag: number } | { kind: "dismissed"; tag: number; reason: number };

/** Read one line the script printed. Anything else is null. */
export function parseToastLine(line: string): ToastEvent | null {
	const parts = line.trim().split(" ");
	if (parts.length === 1 && (parts[0] === "ready" || parts[0] === "error")) return { kind: parts[0] };
	if (parts.length < 2 || !TAG.test(parts[1]!)) return null;
	const tag = Number(parts[1]);
	if (parts[0] === "activated" && parts.length === 2) return { kind: "activated", tag };
	if (parts[0] === "dismissed" && parts.length === 3 && /^-?[0-9]$/.test(parts[2]!)) return { kind: "dismissed", tag, reason: Number(parts[2]) };
	return null;
}

/**
 * Whether a dismissal takes the toast away for good. A toast that timed out
 * (2) stays in the notification center, where a click still reaches the app.
 * The person closing it (0) or the app hiding it (1) does not.
 */
export function dismissalEndsToast(reason: number): boolean {
	return reason !== 2;
}

/** The started script, as this module sees it. Tests pass their own. */
export interface ToastProcess {
	write(text: string): void;
	/** Each line it prints. */
	onLine(handler: (line: string) => void): void;
	/** Its exit code once it ended. */
	exited: Promise<number | null>;
	/** The end of what it wrote to its error output, for saying why it failed. */
	errorOutput(): string;
	kill(): void;
}

export interface ToastHostOptions {
	/** `powershell.exe`, found on the PATH. */
	powershell: string;
	/** The AppUserModelID toasts are shown for. */
	aumid: string;
	/** The name Windows shows on each toast. */
	displayName: string;
	/** An image for the toasts, or null for none. */
	iconFile: string | null;
	spawn?: (argv: string[], environment: Record<string, string>) => ToastProcess;
	readyMilliseconds?: number;
	/** Hears why the script ended while it was in use. Never the text of a toast. */
	onProblem?: (message: string) => void;
}

/** The arguments that start the script. It goes in as -EncodedCommand, UTF-16LE in base64, so no quoting can change it. */
export function toastArguments(powershell: string): string[] {
	return [powershell, "-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-EncodedCommand", Buffer.from(TOAST_SCRIPT, "utf16le").toString("base64")];
}

function spawnToastProcess(argv: string[], environment: Record<string, string>): ToastProcess {
	const child = Bun.spawn(argv, { stdin: "pipe", stdout: "pipe", stderr: "pipe", env: { ...process.env, ...environment }, windowsHide: true });
	const handlers: ((line: string) => void)[] = [];
	void (async () => {
		const decoder = new TextDecoder();
		let pending = "";
		for await (const chunk of child.stdout) {
			pending += decoder.decode(chunk, { stream: true });
			let end: number;
			while ((end = pending.indexOf("\n")) !== -1) {
				const line = pending.slice(0, end).replace(/\r$/, "");
				pending = pending.slice(end + 1);
				for (const handler of handlers) handler(line);
			}
		}
	})().catch(() => {});
	let errors = "";
	void (async () => {
		const decoder = new TextDecoder();
		for await (const chunk of child.stderr) errors = (errors + decoder.decode(chunk, { stream: true })).slice(-ERROR_OUTPUT_LIMIT);
	})().catch(() => {});
	return {
		write(text) {
			child.stdin.write(text);
			child.stdin.flush();
		},
		onLine: handler => void handlers.push(handler),
		exited: child.exited.then(() => child.exitCode),
		errorOutput: () => errors,
		kill: () => child.kill(),
	};
}

/**
 * Start the toast script and resolve once it can show toasts. It acts as a
 * notification server with the `actions` and `body` capabilities and no
 * `body-markup`, since a toast never reads its text as markup. An id is the
 * toast's tag: a notification that replaces another keeps its tag, so
 * Windows puts it in the same place. Rejects when the script ends, fails, or
 * takes too long before it is ready.
 */
export function connectToastHost(options: ToastHostOptions): Promise<NotificationServer> {
	const { powershell, aumid, displayName, iconFile, spawn = spawnToastProcess, readyMilliseconds = TOAST_READY_MILLISECONDS, onProblem = () => {} } = options;
	const environment: Record<string, string> = { [TOAST_VARIABLES.aumid]: aumid, [TOAST_VARIABLES.name]: displayName, [TOAST_VARIABLES.icon]: iconFile ?? "" };
	const child = spawn(toastArguments(powershell), environment);
	const actionHandlers: ((id: number, actionKey: string) => void)[] = [];
	const closedHandlers: ((id: number, reason: number) => void)[] = [];
	const goneHandlers: (() => void)[] = [];
	let next = 1;
	let ended = false;
	let stopping = false;

	return new Promise<NotificationServer>((resolve, reject) => {
		let ready = false;
		const timer = setTimeout(() => {
			if (ready) return;
			child.kill();
			reject(new Error("The toast script did not start in time"));
		}, readyMilliseconds);
		void child.exited.then(exitCode => {
			ended = true;
			clearTimeout(timer);
			if (!ready) {
				reject(new Error(`The toast script ended before it was ready (${endReason(exitCode, child.errorOutput())})`));
				return;
			}
			if (stopping) return;
			onProblem(`The toast script ended (${endReason(exitCode, child.errorOutput())})`);
			for (const handler of goneHandlers) handler();
		});
		child.onLine(line => {
			const event = parseToastLine(line);
			if (event === null) return;
			if (event.kind === "ready" && !ready) {
				ready = true;
				clearTimeout(timer);
				resolve(server);
			} else if (event.kind === "error") {
				onProblem("The toast script could not show or withdraw a toast");
			} else if (event.kind === "activated") {
				for (const handler of actionHandlers) handler(event.tag, "default");
			} else if (event.kind === "dismissed" && dismissalEndsToast(event.reason)) {
				for (const handler of closedHandlers) handler(event.tag, event.reason);
			}
		});

		const send = (text: string) => {
			if (ended || stopping) throw new Error("The toast script is not running");
			child.write(text);
		};
		const server: NotificationServer = {
			async capabilities() {
				return ["actions", "body"];
			},
			async notify(request: NotificationRequest) {
				const tag = request.replacesId !== 0 ? request.replacesId : next++;
				const silent = request.hints["suppress-sound"]?.value === true;
				send(showLine(tag, request.summary, request.body, silent));
				return tag;
			},
			async close(id) {
				if (ended || stopping) return;
				send(withdrawLine(id));
			},
			onActionInvoked: handler => void actionHandlers.push(handler),
			// Windows sends no activation token, and the script is never replaced while it runs.
			onActivationToken: () => {},
			onClosed: handler => void closedHandlers.push(handler),
			onRestart: () => {},
			onDisconnect: handler => void goneHandlers.push(handler),
			disconnect() {
				if (ended || stopping) return;
				// `stop` makes the script take every toast of the app away before it ends.
				try {
					child.write("stop\n");
				} catch {
					child.kill();
				}
				stopping = true;
			},
		};
	});
}
