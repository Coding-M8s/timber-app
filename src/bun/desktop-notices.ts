import type { StatusNotice } from "../shared/status-notices";

/** How many notifications may wait for a click at once. Beyond it, the oldest stops waiting; it stays on screen but no longer answers a click. */
const WAITING_LIMIT = 16;

/**
 * A `notify-send` that fails within this long never showed its notification,
 * such as one too old for `--wait`. One that ends badly later did show it.
 */
const FAST_FAILURE_MILLISECONDS = 2000;

/** What a started `notify-send` looks like to this module. Tests pass their own. */
export interface NoticeProcess {
	/** What it printed once it ended (the action's name when the person clicked the notification), and how it ended. */
	result: Promise<{ output: string; exitCode: number | null }>;
	kill(): void;
}

export interface DesktopNoticeDependencies {
	/** The PATH the app was started with. */
	path: string;
	platform?: NodeJS.Platform;
	/** The clock. Tests pass their own. */
	now?: () => number;
	/** Start `notify-send` with these arguments, never through a shell. */
	spawn?: (argv: string[]) => NoticeProcess;
	/** Show a notification that cannot answer a click, as Electrobun's `Utils.showNotification` does. */
	fallback: (notice: { title: string; body: string }) => void;
	/** The person clicked the notification of this session. */
	onClick: (session: string) => void;
}

export interface DesktopNotices {
	show(notice: StatusNotice): void;
	/** Stop waiting for clicks, for quitting. */
	stopAll(): void;
}

/**
 * Text for a notification body, which the notification server may read as
 * markup and links: `&`, `<`, and `>` become entities, so a program's message
 * shows as plain text.
 */
export function plainBody(text: string): string {
	return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

/** The arguments for one notification that waits for a click on it. */
export function noticeArguments(executable: string, notice: Pick<StatusNotice, "title" | "body">): string[] {
	// `--` ends the options, so a title that starts with "-" is still the title.
	return [executable, "--app-name=Timber", "--wait", "--action=default=Show", "--", notice.title, plainBody(notice.body)];
}

function spawnNotice(argv: string[]): NoticeProcess {
	const child = Bun.spawn(argv, { stdin: "ignore", stdout: "pipe", stderr: "ignore" });
	return {
		result: Promise.all([new Response(child.stdout).text(), child.exited]).then(([output]) => ({ output, exitCode: child.exitCode })),
		kill: () => child.kill(),
	};
}

/**
 * Desktop notifications that select the session's worktree when clicked.
 *
 * On Linux, `notify-send` from libnotify (0.7.9 or later, for `--wait` and
 * `--action`) shows each one and waits; a click prints the action's name.
 * It runs as an executable plus arguments, never through a shell. Without
 * it, and on other systems, Electrobun shows the notification, which then
 * cannot answer a click. A `notify-send` that fails at once, such as one too
 * old for `--wait`, is not used again, and that notification goes to
 * Electrobun. Electrobun gets the body as it is: whether its notification
 * server reads markup is not known.
 */
export function createDesktopNotices(dependencies: DesktopNoticeDependencies): DesktopNotices {
	const { path, platform = process.platform, spawn = spawnNotice, now = Date.now, fallback, onClick } = dependencies;
	const waiting: NoticeProcess[] = [];
	/** Ones that stopped waiting because there were too many, which end with a signal. */
	const dropped = new WeakSet<NoticeProcess>();
	let stopped = false;
	let broken = false;

	return {
		show(notice) {
			if (stopped) return;
			const executable = platform === "linux" && !broken ? Bun.which("notify-send", { PATH: path }) : null;
			let started: NoticeProcess | null = null;
			if (executable !== null) {
				try {
					started = spawn(noticeArguments(executable, notice));
				} catch {
					started = null;
				}
			}
			if (started === null) {
				fallback({ title: notice.title, body: notice.body });
				return;
			}
			const process = started;
			const startedAt = now();
			waiting.push(process);
			while (waiting.length > WAITING_LIMIT) {
				const oldest = waiting.shift()!;
				dropped.add(oldest);
				oldest.kill();
			}
			const forget = () => {
				const at = waiting.indexOf(process);
				if (at !== -1) waiting.splice(at, 1);
			};
			process.result.then(({ output, exitCode }) => {
				forget();
				if (stopped || dropped.has(process)) return;
				if (exitCode !== 0) {
					// Only a quick failure means the notification never showed. A later one, such as a lost session bus, did show it.
					if (now() - startedAt >= FAST_FAILURE_MILLISECONDS) return;
					broken = true;
					fallback({ title: notice.title, body: notice.body });
				} else if (output.trim() === "default") onClick(notice.session);
			}, forget);
		},
		stopAll() {
			stopped = true;
			for (const process of waiting.splice(0)) process.kill();
		},
	};
}
