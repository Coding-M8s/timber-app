/**
 * Terminal sessions: the data both sides agree on, and the pure rules about
 * them. The main process owns every session as a pseudo terminal; the
 * interface only draws what it prints and passes on what is typed.
 */

/** Whether a session's process still runs, or how it ended. */
export type TerminalState =
	| { kind: "running" }
	/** `exitCode` is null when a signal stopped the process, and then `signal` names it. */
	| { kind: "exited"; exitCode: number | null; signal: string | null };

/** One terminal, in one worktree. A worktree has at most one. */
export interface TerminalSession {
	/** Made by the main process. Never reused while the app runs. */
	id: string;
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`), which the selection holds too. */
	worktree: string;
	/** The worktree's registered path, where the shell started. */
	path: string;
	/** The shell that runs, as an executable path. */
	shell: string;
	state: TerminalState;
}

/** Start a terminal in a worktree, or find the one it has. Named as for "Open in editor". */
export interface OpenTerminalRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The size of the pane, so the first prompt is drawn for it. */
	cols: number;
	rows: number;
}

export type OpenTerminalResult =
	/** `started` is false when the worktree already had a session, which is answered as it is. */
	| { outcome: "opened"; session: TerminalSession; started: boolean }
	/** The repository or worktree is not one Timber lists right now, or its folder is missing. */
	| { outcome: "not-listed"; message: string }
	/** Terminals cannot run on this operating system yet. */
	| { outcome: "unsupported"; message: string }
	| { outcome: "failed"; message: string };

/**
 * Part of what a session printed. `seq` counts the parts of one session from
 * 1, so a reader that also asked for a snapshot can tell which parts the
 * snapshot already holds.
 */
export interface TerminalOutput {
	id: string;
	seq: number;
	data: string;
	/**
	 * The window fell behind, so parts were kept and not sent. This part is
	 * what is kept, up to `seq`, to draw on a fresh screen.
	 */
	reset?: boolean;
}

/** The end of what a session printed, as far as it is kept, up to and including part `seq`. */
export interface TerminalSnapshot {
	data: string;
	seq: number;
}

/** A session that started, changed state, or is gone (`session` null). */
export interface TerminalChange {
	id: string;
	session: TerminalSession | null;
}

/** How much of what a session printed is kept for drawing it again, in UTF-16 code units. */
export const SCROLLBACK_LIMIT = 512 * 1024;

/** The largest size a pane may ask for. Anything bigger is a mistake, not a screen. */
export const MAX_COLUMNS = 1000;
export const MAX_ROWS = 500;

export const TERMINAL_UNSUPPORTED_REASON =
	"Terminals need a pseudo terminal, which Bun offers on Linux and macOS only. Windows is not supported yet.";

/** The size to use for a requested one: whole numbers within limits, and 80 by 24 for anything unreadable. */
export function clampTerminalSize(cols: unknown, rows: unknown): { cols: number; rows: number } {
	const clamp = (value: unknown, fallback: number, max: number) =>
		typeof value === "number" && Number.isFinite(value) ? Math.min(max, Math.max(1, Math.floor(value))) : fallback;
	return { cols: clamp(cols, 80, MAX_COLUMNS), rows: clamp(rows, 24, MAX_ROWS) };
}

/**
 * The shell to start: `SHELL` when it is a full path to an executable,
 * otherwise `/bin/sh`. `isExecutable` checks a path; tests pass their own.
 */
export function pickShell(environment: Record<string, string | undefined>, isExecutable: (path: string) => boolean): string {
	const shell = environment.SHELL?.trim();
	if (shell && shell.startsWith("/") && isExecutable(shell)) return shell;
	return "/bin/sh";
}

/**
 * The link to hand to the person's browser, written out in full by the URL
 * parser, or null when it is not one to open. Only `http` and `https` links
 * from a terminal are opened. A link with spaces or control characters
 * around or in it is refused rather than cleaned up, because the text came
 * from whatever a program printed.
 */
export function webLink(url: string): string | null {
	if (typeof url !== "string" || /[\u0000-\u0020\u007f]/.test(url)) return null;
	try {
		const parsed = new URL(url);
		return parsed.protocol === "http:" || parsed.protocol === "https:" ? parsed.href : null;
	} catch {
		return null;
	}
}

export const isWebLink = (url: string): boolean => webLink(url) !== null;

/**
 * The end of a session's output, kept within `limit` code units. Whole parts
 * are dropped from the front; a single part longer than the limit keeps its
 * end. Every part takes the next `seq`.
 */
export interface Scrollback {
	append(data: string): number;
	snapshot(): TerminalSnapshot;
}

export function createScrollback(limit: number = SCROLLBACK_LIMIT): Scrollback {
	const parts: string[] = [];
	let length = 0;
	let seq = 0;
	return {
		append(data) {
			seq += 1;
			const kept = data.length > limit ? data.slice(data.length - limit) : data;
			parts.push(kept);
			length += kept.length;
			while (length > limit && parts.length > 1) length -= parts.shift()!.length;
			return seq;
		},
		snapshot: () => ({ data: parts.join(""), seq }),
	};
}

/** The words for how a session ended, such as "Exited with code 0". */
export function describeTerminalExit(state: Extract<TerminalState, { kind: "exited" }>): string {
	if (state.exitCode !== null) return `Exited with code ${state.exitCode}`;
	return state.signal ? `Stopped by ${state.signal}` : "Exited";
}

/** The question before quitting while terminals run. */
export function describeQuitRequest(live: number): { title: string; text: string } {
	const count = live === 1 ? "A terminal is" : `${live} terminals are`;
	return {
		title: "Quit Timber?",
		text: `${count} still running. Quitting ends ${live === 1 ? "it" : "them"} and everything running in ${live === 1 ? "it" : "them"}.`,
	};
}
