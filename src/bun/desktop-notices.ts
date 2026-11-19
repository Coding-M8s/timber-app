import type { StatusNotice } from "../shared/status-notices";
import { DBusTimeoutError } from "./dbus";
import type { NotificationServer } from "./notification-server";

/** How long after a failed connection to the session bus the next notification tries it again. */
const RECONNECT_MILLISECONDS = 60_000;

/** How many activation tokens are kept for notifications not yet clicked. */
const TOKEN_LIMIT = 64;

/** The name of the installed desktop entry, `Timber.desktop`, which servers use for the icon and grouping. */
const DESKTOP_ENTRY = "Timber";

export interface DesktopNoticeDependencies {
	/** The PATH the app was started with. */
	path: string;
	platform?: NodeJS.Platform;
	now?: () => number;
	/** Connect to the notification server on the session bus. Linux only. Tests pass their own. */
	connect?: () => Promise<NotificationServer>;
	/** Start a program, never through a shell, without waiting for it. Tests pass their own. */
	spawn?: (argv: string[]) => void;
	/** Show a notification that cannot answer a click, as Electrobun's `Utils.showNotification` does. macOS and Windows. */
	fallback: (notice: { title: string; body: string }) => void;
	/** The person clicked the notification of this session. The token, when the server sent one, lets the window come forward on Wayland. */
	onClick: (session: string, token: string | null) => void;
}

export interface ShowOptions {
	/** The app plays its own sound with it, so the server is asked to keep quiet. */
	withSound: boolean;
}

export interface DesktopNotices {
	/** Show a session's notification, replacing its earlier one. */
	show(notice: StatusNotice, options: ShowOptions): void;
	/** Take a session's notification off the screen, where that can be done. */
	withdraw(session: string): void;
	/** Withdraw every notification and let go of the bus, for quitting. Best effort. */
	stopAll(): Promise<void>;
}

/**
 * Text for a notification body, which a server that lists `body-markup` reads
 * as markup and links: `&`, `<`, and `>` become entities, so a program's
 * message shows as plain text.
 */
export function plainBody(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/**
 * The body as sent to a server: escaped unless the server said it reads no
 * markup. A server that did not answer is taken to read it, so a wrong guess
 * shows `&lt;` as written, never markup.
 */
export function serverBody(text: string, capabilities: readonly string[] | null): string {
	return capabilities !== null && !capabilities.includes("body-markup") ? text : plainBody(text);
}

/** The arguments for one `notify-send` that does not wait: the fallback on Linux when the bus cannot be used. */
export function noticeArguments(executable: string, notice: Pick<StatusNotice, "title" | "body">): string[] {
	// `--` ends the options, so a title that starts with "-" is still the title.
	return [executable, "--app-name=Timber", "--", notice.title, plainBody(notice.body)];
}

function spawnDetached(argv: string[]): void {
	Bun.spawn(argv, { stdin: "ignore", stdout: "ignore", stderr: "ignore" });
}

/**
 * Desktop notifications that select the session's worktree when clicked.
 *
 * On Linux the main process talks to `org.freedesktop.Notifications` on the
 * session bus itself (./notification-server.ts): each session has at most one
 * notification, which a newer one replaces (`replaces_id`) and which is
 * closed once it no longer holds. A click arrives as `ActionInvoked`, after
 * the `ActivationToken` the server sends for it. Operations for one session
 * run in order, since the server answers a notification's id only later.
 * Without a bus, `notify-send` shows it by argv, and a click does nothing.
 * On macOS and Windows Electrobun shows it, which can neither answer a click
 * nor be replaced or withdrawn: Electrobun 2.0.6 has no way to.
 */
export function createDesktopNotices(dependencies: DesktopNoticeDependencies): DesktopNotices {
	const { path, platform = process.platform, now = Date.now, connect, spawn = spawnDetached, fallback, onClick } = dependencies;
	/** The id of each session's notification on screen, and the session of each id. */
	const ids = new Map<string, number>();
	const sessions = new Map<number, string>();
	const tokens = new Map<number, string>();
	/** The last operation queued for each session, so the next one waits for it. */
	const queues = new Map<string, Promise<void>>();
	let server: Promise<{ server: NotificationServer; capabilities: string[] | null } | null> | null = null;
	/** The connected server once it answered, so quitting can close notifications without waiting. */
	let live: NotificationServer | null = null;
	let failedAt: number | null = null;
	let stopped = false;

	const forget = (id: number) => {
		const session = sessions.get(id);
		sessions.delete(id);
		tokens.delete(id);
		if (session !== undefined && ids.get(session) === id) ids.delete(session);
	};

	const bus = () => {
		if (platform !== "linux" || connect === undefined || stopped) return Promise.resolve(null);
		if (server !== null) return server;
		if (failedAt !== null && now() - failedAt < RECONNECT_MILLISECONDS) return Promise.resolve(null);
		server = connect().then(async connected => {
			connected.onActionInvoked((id, action) => {
				const session = sessions.get(id);
				if (session === undefined || action !== "default" || stopped) return;
				const token = tokens.get(id) ?? null;
				forget(id);
				onClick(session, token);
			});
			connected.onActivationToken((id, token) => {
				if (!sessions.has(id)) return;
				tokens.set(id, token);
				while (tokens.size > TOKEN_LIMIT) tokens.delete(tokens.keys().next().value!);
			});
			connected.onClosed(id => forget(id));
			// The ids of a server that went away, or was replaced by another, mean nothing any more.
			const forgetAll = () => {
				ids.clear();
				sessions.clear();
				tokens.clear();
			};
			connected.onRestart(forgetAll);
			connected.onDisconnect(() => {
				server = null;
				live = null;
				forgetAll();
			});
			const capabilities = await connected.capabilities().catch(() => null);
			failedAt = null;
			live = connected;
			return { server: connected, capabilities };
		}).catch(() => {
			server = null;
			failedAt = now();
			return null;
		});
		return server;
	};

	const withoutBus = (notice: StatusNotice) => {
		if (platform !== "linux") {
			fallback({ title: notice.title, body: notice.body });
			return;
		}
		const executable = Bun.which("notify-send", { PATH: path });
		if (executable === null) return;
		try {
			spawn(noticeArguments(executable, notice));
		} catch {
			// Nothing more can be done: the sidebar still shows the status.
		}
	};

	const queue = (session: string, operation: () => Promise<void>) => {
		const next = (queues.get(session) ?? Promise.resolve()).then(operation).catch(() => {});
		queues.set(session, next);
		void next.then(() => {
			if (queues.get(session) === next) queues.delete(session);
		});
	};

	return {
		show(notice, options) {
			if (stopped) return;
			queue(notice.session, async () => {
				const connected = await bus();
				if (stopped) return;
				if (connected === null) {
					withoutBus(notice);
					return;
				}
				const { server: notifications, capabilities } = connected;
				const replaces = ids.get(notice.session) ?? 0;
				const hints: Parameters<NotificationServer["notify"]>[0]["hints"] = {
					"urgency": { signature: "y", value: 1 },
					"desktop-entry": { signature: "s", value: DESKTOP_ENTRY },
				};
				if (options.withSound) hints["suppress-sound"] = { signature: "b", value: true };
				const supportsActions = capabilities === null || capabilities.includes("actions");
				try {
					const id = await notifications.notify({
						appName: "Timber",
						replacesId: replaces,
						icon: "",
						summary: notice.title,
						body: serverBody(notice.body, capabilities),
						actions: supportsActions ? ["default", "Show"] : [],
						hints,
						timeout: -1,
					});
					// Quitting began while the server answered: take it away again instead of leaving it behind.
					if (stopped) {
						void notifications.close(id).catch(() => {});
						return;
					}
					if (replaces !== 0 && replaces !== id) forget(replaces);
					ids.set(notice.session, id);
					sessions.set(id, notice.session);
				} catch (error) {
					// A call that timed out may still show later, so showing it again another way would show it twice.
					if (!(error instanceof DBusTimeoutError)) withoutBus(notice);
				}
			});
		},
		withdraw(session) {
			if (stopped) return;
			queue(session, async () => {
				const id = ids.get(session);
				if (id === undefined) return;
				forget(id);
				const connected = await bus();
				await connected?.server.close(id);
			});
		},
		async stopAll() {
			if (stopped) return;
			stopped = true;
			const open = [...sessions.keys()];
			sessions.clear();
			ids.clear();
			tokens.clear();
			const connected = live;
			if (connected === null) {
				// A connection still being made is let go once it is made.
				void server?.then(made => made?.server.disconnect());
				return;
			}
			// Each close is written to the bus at once, before anything is awaited, since the app may go away right after.
			const closing = open.map(id => connected.close(id).catch(() => {}));
			await Promise.race([Promise.all(closing), new Promise(resolve => setTimeout(resolve, 500))]);
			connected.disconnect();
		},
	};
}
