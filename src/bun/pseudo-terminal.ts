import { existsSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import type * as NodePty from "node-pty";
import { signalName } from "./signal-name";

/**
 * One program in a pseudo terminal, whichever starts it: `Bun.Terminal`, or
 * on Windows node-pty with the ConPTY it ships (see `startPseudoTerminal`).
 */
export interface PseudoTerminal {
	readonly pid: number;
	/** How the program ended, or null while it runs. */
	ended(): { exitCode: number | null; signal: string | null } | null;
	/** Settles once the program ended. */
	readonly exited: Promise<void>;
	/** Settles once the terminal has no more output, which may never happen while a program left in the background holds it open. */
	readonly drained: Promise<void>;
	write(data: string): void;
	resize(cols: number, rows: number): void;
	/** Hang up: on Linux and macOS the shell's session gets SIGHUP, on Windows the pseudo console closes and what is attached to it is told to close. */
	close(): void;
	/** Kill the program itself at once. */
	kill(): void;
}

export interface PseudoTerminalOptions {
	argv: readonly string[];
	cwd: string;
	env: Record<string, string | undefined>;
	cols: number;
	rows: number;
	/** Gets the output as text, in order. */
	data(text: string): void;
}

/** The primary device attributes xterm.js answers with: a VT100 with advanced video. */
export const CONPTY_ATTRIBUTES = "\x1b[?1;2c";

const ATTRIBUTES_QUERY = "\x1b[c";
/** The startup query comes first, with a few modes, before the program can print. Beyond this it is not looked for. */
const STARTUP_LIMIT = 256;
const STARTUP_WAIT_MILLISECONDS = 3000;

/**
 * Finds the pseudo console's own startup query at the start of the output and
 * takes it out. Only the first `CSI c` within the first `STARTUP_LIMIT` code
 * units counts; every later one is the program's and passes on unchanged.
 */
export function createStartupQuery(): { take(data: string): { text: string; answer: boolean }; flush(): string } {
	let seen = "";
	let done = false;
	return {
		/** Stop looking, and give what was held back. */
		flush() {
			if (done) return "";
			done = true;
			return seen;
		},
		take(data) {
			if (done) return { text: data, answer: false };
			seen += data;
			const at = seen.indexOf(ATTRIBUTES_QUERY);
			if (at >= 0) {
				done = true;
				return { text: seen.slice(0, at) + seen.slice(at + ATTRIBUTES_QUERY.length), answer: true };
			}
			if (seen.length >= STARTUP_LIMIT) {
				done = true;
				return { text: seen, answer: false };
			}
			// Held back while the query may still come, maybe split: the start is only a few modes.
			return { text: "", answer: false };
		},
	};
}

/** Starts a program in a pseudo terminal, or throws when it cannot. */
export type StartPseudoTerminal = (options: PseudoTerminalOptions) => PseudoTerminal;

/** `Bun.Terminal`: the pseudo terminal on Linux and macOS, and Windows' own ConPTY where node-pty is missing. */
export const startBunTerminal: StartPseudoTerminal = options => {
	const decoder = new TextDecoder();
	let drain: () => void = () => {};
	const drained = new Promise<void>(resolve => {
		drain = resolve;
	});
	const child = Bun.spawn([...options.argv], {
		cwd: options.cwd,
		env: options.env,
		terminal: {
			cols: options.cols,
			rows: options.rows,
			name: "xterm-256color",
			data: (_terminal, bytes) => options.data(decoder.decode(bytes, { stream: true })),
			exit: () => {
				const rest = decoder.decode();
				if (rest !== "") options.data(rest);
				drain();
			},
		},
	});
	return {
		pid: child.pid,
		ended: () => child.exitCode === null && child.signalCode === null ? null : { exitCode: child.exitCode, signal: signalName(child.signalCode) },
		exited: child.exited.then(() => {}),
		drained,
		write: data => child.terminal?.write(data),
		resize: (cols, rows) => child.terminal?.resize(cols, rows),
		close: () => child.terminal?.close(),
		kill: () => child.kill("SIGKILL"),
	};
};

/**
 * node-pty with `useConptyDll`: the `conpty.dll` and `OpenConsole.exe` it
 * ships, newer than the ConPTY in Windows. Windows' own ConPTY answers a
 * program's primary device attributes query (`CSI c`) itself, at once, so a
 * program that sends it right after the status probe takes the protocol as
 * unsupported before the app's answer arrives. This one passes the query on,
 * and the window answers it after the probe's answer, as on Linux.
 *
 * Two of its ways are kept from the app:
 * - When it starts, this ConPTY asks the terminal for its primary device
 *   attributes (`CSI c`) and holds the program back until the answer comes,
 *   or for 3 seconds. That query is its own, not the program's, so it is
 *   answered here, as xterm.js would (`CONPTY_ATTRIBUTES`), and taken out of
 *   the output: a session the window does not show starts at once too, and
 *   the window does not answer a second time.
 * - Writing or resizing after the program ended throws, so neither is done then.
 */
export function nodePtyTerminal(pty: typeof NodePty): StartPseudoTerminal {
	return options => {
		const [file, ...args] = options.argv;
		if (file === undefined) throw new Error("Nothing to start.");
		const env: Record<string, string> = {};
		for (const [key, value] of Object.entries(options.env)) if (value !== undefined) env[key] = value;
		const terminal = pty.spawn(file, args, { name: "xterm-256color", cols: options.cols, rows: options.rows, cwd: options.cwd, env, useConptyDll: true });
		let state: { exitCode: number | null; signal: string | null } | null = null;
		let closed = false;
		const startup = createStartupQuery();
		const give = (text: string) => {
			if (text !== "") options.data(text);
		};
		// ConPTY itself waits no longer than this for its answer.
		const giveUp = setTimeout(() => give(startup.flush()), STARTUP_WAIT_MILLISECONDS);
		terminal.onData(data => {
			const { text, answer } = startup.take(data);
			if (answer) terminal.write(CONPTY_ATTRIBUTES);
			give(text);
		});
		const exited = new Promise<void>(resolve => {
			terminal.onExit(({ exitCode }) => {
				clearTimeout(giveUp);
				give(startup.flush());
				// Ended from here on, so nothing is written to it, while its exit code may still be on its way.
				const ended = { exitCode: null as number | null, signal: null };
				state = ended;
				void exitCodeOf(terminal, exitCode).then(code => {
					ended.exitCode = code;
					resolve();
				});
			});
		});
		const close = () => {
			if (closed) return;
			closed = true;
			try {
				terminal.kill();
			} catch {
				// Already gone.
			}
		};
		return {
			pid: terminal.pid,
			ended: () => state,
			exited,
			// node-pty tells no end of output apart from the exit, so the session waits its short while for the last of it.
			drained: new Promise<void>(() => {}),
			write: data => {
				if (state === null && !closed) terminal.write(data);
			},
			resize: (cols, rows) => {
				if (state === null && !closed) terminal.resize(cols, rows);
			},
			close,
			kill: () => {
				if (state !== null) return;
				try {
					process.kill(terminal.pid, "SIGKILL");
				} catch {
					// Already gone.
				}
				close();
			},
		};
	};
}

/** How long an exit code node-pty did not have when it told the exit is waited for. */
export const EXIT_CODE_WAIT_MILLISECONDS = 2000;

/**
 * The exit code of a node-pty program that ended. With `useConptyDll`,
 * node-pty tells the exit when the program's output pipe closes, with the
 * code ConPTY's own notice of the exit gave it. On a busy machine the pipe
 * can close first, and the code comes as undefined. The notice still comes
 * moments later, so the code is read again from node-pty's agent (not part of
 * its typed interface) until it is there, for at most
 * EXIT_CODE_WAIT_MILLISECONDS. After that it is unknown: null.
 */
export async function exitCodeOf(terminal: unknown, told: number | undefined, wait = EXIT_CODE_WAIT_MILLISECONDS): Promise<number | null> {
	if (typeof told === "number") return told;
	const agent = (terminal as { _agent?: { exitCode?: unknown } })._agent;
	const end = Date.now() + wait;
	while (true) {
		const code = agent?.exitCode;
		if (typeof code === "number") return code;
		if (agent === undefined || Date.now() >= end) return null;
		await Bun.sleep(10);
	}
}

/**
 * node-pty, loaded only on Windows, when it is there with the ConPTY it ships
 * for this machine's architecture; otherwise null. Its install scripts are not
 * run (`trustedDependencies` in package.json), so its prebuilt files are used.
 * It is required at run time, never bundled: the desktop build copies it
 * beside the main process's bundle (see electrobun.config.ts).
 */
export function loadNodePty(): typeof NodePty | null {
	try {
		const require = createRequire(import.meta.url);
		const folder = dirname(require.resolve("node-pty/package.json"));
		const prebuilt = join(folder, "prebuilds", `${process.platform}-${process.arch}`);
		if (!existsSync(join(prebuilt, "conpty", "conpty.dll")) || !existsSync(join(prebuilt, "conpty", "OpenConsole.exe"))) return null;
		return require("node-pty") as typeof NodePty;
	} catch {
		return null;
	}
}

/**
 * How sessions start on this platform: `Bun.Terminal` on Linux and macOS;
 * node-pty with its own ConPTY on Windows, or `Bun.Terminal` (Windows' own
 * ConPTY) where node-pty cannot be loaded; null where there is neither.
 */
export function startPseudoTerminal(platform: NodeJS.Platform = process.platform, load: () => typeof NodePty | null = loadNodePty): StartPseudoTerminal | null {
	if (platform !== "win32") return startBunTerminal;
	const pty = load();
	if (pty !== null) return nodePtyTerminal(pty);
	return typeof Bun.Terminal === "function" ? startBunTerminal : null;
}
