/**
 * Terminal sessions: the data both sides agree on, and the pure rules about
 * them. The main process owns every session as a pseudo terminal; the
 * interface only draws what it prints and passes on what is typed.
 */

import type { ProgramStatus } from "./program-status";
import { isSafeText } from "./safe-text";

/** Whether a session's process still runs, or how it ended. */
export type TerminalState =
	| { kind: "running" }
	/** `exitCode` is null when a signal stopped the process, and then `signal` names it. */
	| { kind: "exited"; exitCode: number | null; signal: string | null };

/**
 * What a session runs: the person's shell, a coding agent from Settings or
 * from a workflow, which starts the agent's command instead of the shell, or
 * a Timber command such as `timber open --setup`.
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
	 * Run this worktree's setup scripts with `timber open --setup` instead of
	 * the shell (`worktreeSetupArguments` in ./worktree-commands.ts), with the
	 * workflow the worktree was made with, if any: Timber does not remember it.
	 * The main process runs the Timber it found. Not together with `agent`.
	 */
	timberWorktreeSetup?: { workflow?: string };
	/**
	 * Start the agent of this arena attempt instead of the shell, with the
	 * program, folder, and environment that `timber __app-arena launch` gives
	 * for it (see ../shared/arenas.ts). The main process asks Timber; the
	 * request never names a command. The worktree must be the attempt's own.
	 * Not together with `agent`, `timberWorktreeSetup`, or `workflowAgent`.
	 */
	arenaAttempt?: { arena: string; attempt: string };
	/**
	 * Start the agent of this named workflow instead of the shell. The main
	 * process reads the workflow again from Timber and takes the command from
	 * there only, never from the request. Not together with `agent`,
	 * `timberWorktreeSetup`, or `arenaAttempt`.
	 */
	workflowAgent?: { workflow: string };
}

export type OpenTerminalResult =
	| { outcome: "opened"; session: TerminalSession }
	/** The repository or worktree is not one Timber lists right now, or its folder is missing. */
	| { outcome: "not-listed"; message: string }
	/** Terminals cannot run on this operating system yet. */
	| { outcome: "unsupported"; message: string }
	/**
	 * The saved Settings have no agent with the requested name, Timber is not
	 * ready for setup, or the requested workflow is gone or sets no agent now.
	 * Nothing started, not even a shell.
	 */
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
	"Terminals need a pseudo terminal, which the Bun this app runs on does not offer here.";

/** The longest name a session can have, in characters. */
export const SESSION_NAME_LIMIT = 40;

const KIND_NAMES: Record<SessionKind, string> = { terminal: "Terminal", agent: "Agent", timber: "Timber" };

/** The name of a session that runs a worktree's setup scripts. */
export const WORKTREE_SETUP_SESSION_NAME = "Setup";

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
 * when it has none. Plain by default. A setup session is always "Setup".
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
 * The shell to start on Windows: PowerShell 7 (`pwsh.exe`) when it is on the
 * PATH, else Windows PowerShell, else `ComSpec` when it is a full path to an
 * executable, else cmd.exe from the system folder. `SHELL` is not read there:
 * Git Bash sets it to a POSIX path such as `/usr/bin/bash`. `which` finds a
 * name on the PATH and `isExecutable` checks a path; tests pass their own.
 */
export function pickWindowsShell(
	environment: Record<string, string | undefined>,
	which: (name: string) => string | null,
	isExecutable: (path: string) => boolean,
): string {
	const found = which("pwsh.exe") ?? which("powershell.exe");
	if (found !== null) return found;
	const comSpec = environment.ComSpec?.trim() ?? environment.COMSPEC?.trim();
	if (comSpec && /^[A-Za-z]:\\/.test(comSpec) && isExecutable(comSpec)) return comSpec;
	const systemRoot = environment.SystemRoot?.trim() || environment.SYSTEMROOT?.trim() || "C:\\Windows";
	return `${systemRoot}\\System32\\cmd.exe`;
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

/** The longest text a paste into a session may be, in characters. */
export const PASTE_TEXT_LIMIT = 100_000;

/**
 * What is wrong with text to paste into a session, or null when it can go.
 * It must not be blank, and may hold line breaks and tabs but no other
 * control or invisible character (`isSafeText`), so it cannot end the paste
 * early or hide what it says.
 */
export function pasteProblem(text: unknown): string | null {
	if (typeof text !== "string" || text.trim() === "") return "There is nothing to paste.";
	if (text.length > PASTE_TEXT_LIMIT) return `The text is longer than ${PASTE_TEXT_LIMIT} characters.`;
	if (text.includes("\r")) return "The text has a carriage return. Line breaks must be \\n.";
	if (!isSafeText(text)) return "The text has a control or invisible character. Only line breaks and tabs are allowed.";
	return null;
}

/**
 * The bytes a terminal sends for a paste while the program asked for
 * bracketed paste (mode 2004): the text between `ESC [200~` and `ESC [201~`,
 * each line break as the carriage return a terminal sends for Enter, as
 * xterm.js does. The program takes the line breaks as part of the text, not
 * as Enter. Only for text `pasteProblem` accepts.
 */
export function bracketedPaste(text: string): string {
	return `\x1b[200~${text.replace(/\n/g, "\r")}\x1b[201~`;
}

/** How a paste into a session went. */
export type PasteResult =
	| { outcome: "pasted" }
	/** The session is not there, or its program ended. */
	| { outcome: "gone"; message: string }
	/** The session is not an agent's. */
	| { outcome: "not-agent"; message: string }
	/** The program has not asked for bracketed paste, so a line break would act as Enter. Nothing was written. */
	| { outcome: "not-ready"; message: string }
	/** The text cannot be pasted (`pasteProblem`). Nothing was written. */
	| { outcome: "refused"; message: string };

export const PASTE_NOT_READY =
	"The agent has not turned on bracketed paste, so a line break would send the review early. Wait for its prompt and try again, or copy the review.";

/** The longest unfinished control sequence a paste mode scanner holds back between parts. */
const PENDING_LIMIT = 64;

/**
 * Follows whether a program asked its terminal for bracketed paste, from what
 * it prints: `CSI ? ... h` turns modes on and `CSI ? ... l` off, and mode 2004
 * may share the sequence with others (`ESC [?1049;2004h`). A sequence split
 * between two parts is read whole. A full reset (`ESC c`) turns it off.
 */
export interface PasteModeScanner {
	/** Read the next part of what the program printed. */
	scan(text: string): void;
	/** Whether bracketed paste is on now. */
	on(): boolean;
	/** Back to off, for a program that ended. */
	reset(): void;
}

export function createPasteModeScanner(): PasteModeScanner {
	let on = false;
	let pending = "";
	const SEQUENCE = /\x1b(?:\[\?([0-9;]*)([hl])|c)/g;
	return {
		scan(text) {
			const all = pending + text;
			pending = "";
			SEQUENCE.lastIndex = 0;
			for (const match of all.matchAll(SEQUENCE)) {
				if (match[2] === undefined) {
					on = false;
					continue;
				}
				if (match[1]!.split(";").includes("2004")) on = match[2] === "h";
			}
			// An escape near the end may be the start of a sequence that ends in the next part.
			const last = all.lastIndexOf("\x1b");
			if (last >= 0 && all.length - last <= PENDING_LIMIT && /^\x1b(?:\[(?:\?[0-9;]*)?)?$/.test(all.slice(last))) pending = all.slice(last);
		},
		on: () => on,
		reset() {
			on = false;
			pending = "";
		},
	};
}
