/**
 * Terminal sessions: the data both sides agree on, and the pure rules about
 * them. The main process owns every session as a pseudo terminal; the
 * interface only draws what it prints and passes on what is typed.
 */

import type { ProgramStatus } from "./program-status";

/** Whether a session's process still runs, or how it ended. */
export type TerminalState =
	| { kind: "running" }
	/** `exitCode` is null when a signal stopped the process, and then `signal` names it. */
	| { kind: "exited"; exitCode: number | null; signal: string | null };

/**
 * What a session runs: the person's shell, a coding agent from Settings,
 * which starts the agent's command instead of the shell, or a Timber
 * command such as `timber rebase`.
 */
export const SESSION_KINDS = ["terminal", "agent", "timber"] as const;
export type SessionKind = typeof SESSION_KINDS[number];

/** One session in a pseudo terminal, in one worktree. A worktree can have several. */
export interface TerminalSession {
	/** Made by the main process. Never reused while the app runs. */
	id: string;
	kind: SessionKind;
	/**
	 * What its chip says, such as "Terminal 2", or "feature-login 2" when
	 * Settings names new sessions after the branch. Set once when the session
	 * opens. The person can rename it.
	 */
	name: string;
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`), which the selection holds too. */
	worktree: string;
	/** The worktree's registered path, where the shell started. */
	path: string;
	/** The executable that runs, as a full path: the shell, or the agent's executable as found on the PATH. */
	shell: string;
	/** What was started, as one line for showing, such as `/usr/bin/zsh` or `/usr/local/bin/codex --full-auto`. */
	command: string;
	state: TerminalState;
	/**
	 * What the program in the session last reported about itself through the
	 * Program Status Protocol (OSC 7501), as its root record, or null when it
	 * reported nothing or its record ended (see ./program-status.ts). Any
	 * session can have one, agent or shell.
	 */
	status: ProgramStatus | null;
}

/** Start another session in a worktree. Named as for "Open in editor". */
export interface OpenTerminalRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The size of the pane, so the first prompt is drawn for it. */
	cols: number;
	rows: number;
	/**
	 * The name of an agent in the saved Settings to start instead of the
	 * shell. The main process takes its command from the saved setting only,
	 * never from the request. Left out for the shell.
	 */
	agent?: string;
	/**
	 * Start `timber rebase` for this worktree instead of the shell, onto the
	 * given base, or the one Timber saved when `onto` is null
	 * (`rebaseArguments` in ./rebase-command.ts). The main process runs the
	 * Timber it found. Not together with `agent`.
	 */
	timberRebase?: { onto: string | null };
}

export type OpenTerminalResult =
	| { outcome: "opened"; session: TerminalSession }
	/** The repository or worktree is not one Timber lists right now, or its folder is missing. */
	| { outcome: "not-listed"; message: string }
	/** Terminals cannot run on this operating system yet. */
	| { outcome: "unsupported"; message: string }
	/** The saved Settings have no agent with the requested name, or Timber is not ready for setup. Nothing started, not even a shell. */
	| { outcome: "not-configured"; message: string }
	/** The agent's executable is not on the PATH, or not at the full path given. `command` is what would have run. */
	| { outcome: "not-found"; command: string; executable: string; message: string }
	/** `command` is what was to run, when it was known. */
	| { outcome: "failed"; message: string; command?: string };

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

/** The longest name a session can have, in characters. */
export const SESSION_NAME_LIMIT = 40;

const KIND_NAMES: Record<SessionKind, string> = { terminal: "Terminal", agent: "Agent", timber: "Timber" };

/** What a `timber rebase` session is called. */
export const TIMBER_REBASE_SESSION_NAME = "Rebase";

/** What a kind of session is called, such as "Terminal". */
export function sessionKindName(kind: SessionKind): string {
	return KIND_NAMES[kind];
}

/**
 * The name for a new session: `base`, such as "Terminal" or an agent's name,
 * then "Terminal 2", "Terminal 3", and so on, the first that no other session
 * in the worktree has. `taken` are the names of the worktree's sessions. A
 * numbered name is cut to fit `SESSION_NAME_LIMIT` before its number.
 */
export function defaultSessionName(base: string, taken: readonly string[]): string {
	const names = new Set(taken);
	// The base is cut so that the name with its number still fits `SESSION_NAME_LIMIT`.
	const numbered = (number: number) => {
		const suffix = ` ${number}`;
		return `${Array.from(base).slice(0, SESSION_NAME_LIMIT - suffix.length).join("").trimEnd()}${suffix}`;
	};
	if (!names.has(base)) return base;
	let number = 2;
	while (names.has(numbered(number))) number += 1;
	return numbered(number);
}

/**
 * How a new terminal or agent session is named: "plain" after the shell or
 * the agent ("Terminal", "Codex"), "branch" after the worktree's branch,
 * "issue" after the issue key in the branch, such as GH-122, or the branch
 * when it has none. Plain by default. A `timber rebase` session is always
 * "Rebase".
 */
export const SESSION_NAMINGS = ["plain", "branch", "issue"] as const;
export type SessionNaming = typeof SESSION_NAMINGS[number];

/** The naming, or undefined when what came from outside is not one. */
export function readSessionNaming(value: unknown): SessionNaming | undefined {
	return (SESSION_NAMINGS as readonly unknown[]).includes(value) ? value as SessionNaming : undefined;
}

/**
 * The issue key in a branch, or null when there is none. Looked for in this
 * order, the first that matches:
 *
 * 1. A key that starts the branch or one of its parts after a slash, in any
 *    case, uppercased: `gh-122-option-to-name-tab` gives GH-122, and
 *    `feature/PROJ-42-login` gives PROJ-42.
 * 2. A key written in capitals anywhere after a hyphen or an underscore:
 *    `feature/login-PROJ-42` gives PROJ-42. Only capitals, so a branch such
 *    as `fix-login-2` gives no key.
 * 3. A number that starts the branch or one of its parts, as `#` and the
 *    number: `122-fix-login` and `fix/122-login` give #122.
 *
 * A key is letters and digits that start with a letter, a hyphen, and a
 * number. A key or a number is never followed by a dot, so a version such
 * as `react-18.2.0` is not one.
 */
export function issueKeyOf(branch: string): string | null {
	const start = /(?:^|\/)([A-Za-z][A-Za-z0-9]*-\d+)(?=$|[-_/])/.exec(branch);
	if (start) return start[1]!.toUpperCase();
	const capitals = /[-_]([A-Z][A-Z0-9]*-\d+)(?=$|[-_/])/.exec(branch);
	if (capitals) return capitals[1]!;
	const number = /(?:^|\/)(\d+)(?=$|[-_/])/.exec(branch);
	return number ? `#${number[1]}` : null;
}

/** An agent's name needs room for this many characters of the branch, or it is used alone. */
const LEAST_LABEL = 4;

/**
 * What a new session is called before it is numbered: `kindBase`, such as
 * "Terminal" or the agent's name, under the "plain" naming, without a
 * branch, or when the branch leaves nothing to show. Otherwise the branch
 * or its issue key, after the agent's name and a colon for an agent, such
 * as "Codex: feature-login". It is cut to `SESSION_NAME_LIMIT` from the
 * end, so the branch is cut before the agent's name, and an agent's name
 * that leaves too little room is used alone. The result is a name
 * `cleanSessionName` keeps as it is. `defaultSessionName` numbers it.
 */
export function sessionNameBase(naming: SessionNaming, kindBase: string, branch: string | null, agent: boolean): string {
	if (naming === "plain" || branch === null) return kindBase;
	const raw = naming === "issue" ? issueKeyOf(branch) ?? branch : branch;
	const label = raw.replace(/\p{Cf}+/gu, "").replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, " ").trim();
	if (label === "") return kindBase;
	const prefix = agent ? `${kindBase}: ` : "";
	if (Array.from(prefix).length + LEAST_LABEL > SESSION_NAME_LIMIT) return kindBase;
	return Array.from(`${prefix}${label}`).slice(0, SESSION_NAME_LIMIT).join("").trimEnd();
}

/**
 * A name the person typed, made fit for a chip: invisible format characters
 * such as zero-width spaces are dropped, control characters and runs of
 * white space become one space, the ends are trimmed, and it is cut to
 * `SESSION_NAME_LIMIT` characters. Null when nothing is left, or when it is
 * not text.
 */
export function cleanSessionName(name: unknown): string | null {
	if (typeof name !== "string") return null;
	const clean = Array.from(name.replace(/\p{Cf}+/gu, "").replace(/[\s\u0000-\u001f\u007f-\u009f]+/gu, " ").trim()).slice(0, SESSION_NAME_LIMIT).join("").trim();
	return clean === "" ? null : clean;
}

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

/** The question before quitting while sessions run. */
export function describeQuitRequest(live: number): { title: string; text: string } {
	const count = live === 1 ? "A session is" : `${live} sessions are`;
	return {
		title: "Quit Timber?",
		text: `${count} still running. Quitting ends ${live === 1 ? "it" : "them"} and everything running in ${live === 1 ? "it" : "them"}.`,
	};
}
