import type { Engine } from "../../shared/engine";
import type { Worktree } from "../../shared/model";
import {
	type OpenTerminalResult, type Scrollback, type TerminalChange, type TerminalOutput, type TerminalSession, createScrollback, isWebLink,
} from "../../shared/terminal";

/** The part of the engine about terminals, and how they are acted out. */
export type TerminalCapabilities = Pick<Engine,
	| "listTerminals" | "openTerminal" | "readTerminal" | "drawnTerminal" | "writeTerminal" | "resizeTerminal" | "closeTerminal"
	| "onTerminalOutput" | "onTerminalChanged" | "onQuitRequested" | "confirmQuit" | "writeClipboard" | "readClipboard" | "openLink"
>;

export interface TerminalControls {
	/**
	 * Act out the person quitting the app or closing its window. As the main
	 * process does, the interface is asked only while a terminal runs.
	 * Answers whether the app quit right away.
	 */
	requestQuit(): boolean;
	/** Whether the app was told to quit, after the person agreed. */
	quitConfirmed(): boolean;
	/** Act out the shell of a session ending by itself, with this exit code. */
	endTerminal(id: string, exitCode: number): void;
	/** Everything typed into a session, in order. */
	typedInto(id: string): string;
	/** The last size a session was given. */
	terminalSize(id: string): { cols: number; rows: number } | null;
	/** Make every later start of a terminal answer this way, or null to start them again. */
	failTerminals(result: Exclude<OpenTerminalResult, { outcome: "opened" }> | null): void;
	/** The links a terminal asked to open. */
	openedLinks(): string[];
	/** The last part of a session the window said it drew. */
	drawnUpTo(id: string): number;
}

interface Acted {
	session: TerminalSession;
	scrollback: Scrollback;
	line: string;
	typed: string;
	size: { cols: number; rows: number };
	drawn: number;
}

/**
 * Terminals acted out in memory, for the browser build and tests. Each one is
 * a pretend shell that echoes what is typed and knows `pwd`, `clear`, and
 * `exit`. Output arrives a moment later, as it would over the bridge.
 */
export function createMockTerminals(findWorktree: (repository: string, path: string) => Worktree | null): TerminalCapabilities & TerminalControls {
	const sessions = new Map<string, Acted>();
	const output = new Set<(output: TerminalOutput) => void>();
	const changes = new Set<(change: TerminalChange) => void>();
	const quitListeners = new Set<(live: number) => void>();
	let lastId = 0;
	let failing: Exclude<OpenTerminalResult, { outcome: "opened" }> | null = null;
	let confirmed = false;
	let clipboard = "";
	const links: string[] = [];

	const later = (task: () => void) => void Promise.resolve().then(task);
	const live = () => [...sessions.values()].filter(acted => acted.session.state.kind === "running").length;
	const prompt = (acted: Acted) => `\x1b[32m${acted.session.path.split("/").at(-1)}\x1b[0m $ `;

	function print(acted: Acted, data: string): void {
		const seq = acted.scrollback.append(data);
		const part = { id: acted.session.id, seq, data };
		later(() => {
			for (const listener of [...output]) listener(part);
		});
	}

	function announce(change: TerminalChange): void {
		const copy = structuredClone(change);
		later(() => {
			for (const listener of [...changes]) listener(copy);
		});
	}

	function end(acted: Acted, exitCode: number): void {
		if (acted.session.state.kind !== "running") return;
		acted.session = { ...acted.session, state: { kind: "exited", exitCode, signal: null } };
		announce({ id: acted.session.id, session: acted.session });
	}

	function run(acted: Acted, command: string): void {
		const [name] = command.trim().split(/\s+/);
		if (name === "exit") {
			print(acted, "\r\n");
			end(acted, 0);
			return;
		}
		if (name === "clear") print(acted, "\x1b[2J\x1b[H");
		else if (name === "pwd") print(acted, `\r\n${acted.session.path}\r\n`);
		else if (name) print(acted, `\r\nmock shell: ${name}: acted out in the browser, nothing runs\r\n`);
		else print(acted, "\r\n");
		print(acted, prompt(acted));
	}

	function type(acted: Acted, data: string): void {
		acted.typed += data;
		for (const character of data) {
			if (character === "\r") {
				run(acted, acted.line);
				acted.line = "";
				if (acted.session.state.kind !== "running") return;
			} else if (character === "\x7f") {
				if (acted.line.length > 0) {
					acted.line = acted.line.slice(0, -1);
					print(acted, "\b \b");
				}
			} else if (character >= " ") {
				acted.line += character;
				print(acted, character);
			}
		}
	}

	return {
		listTerminals: async () => [...sessions.values()].map(acted => structuredClone(acted.session)),
		async openTerminal(request) {
			if (failing) return structuredClone(failing);
			const worktree = findWorktree(request.repository, request.worktree);
			if (!worktree) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. No terminal was started. Refresh the list.` };
			const existing = [...sessions.values()].find(acted => acted.session.worktree === worktree.id);
			if (existing) return { outcome: "opened", session: structuredClone(existing.session), started: false };
			const session: TerminalSession = {
				id: `mock-terminal-${++lastId}`,
				repository: request.repository,
				worktree: worktree.id,
				path: worktree.path,
				shell: "/bin/mock-shell",
				state: { kind: "running" },
			};
			const acted: Acted = { session, scrollback: createScrollback(), line: "", typed: "", size: { cols: request.cols, rows: request.rows }, drawn: 0 };
			sessions.set(session.id, acted);
			announce({ id: session.id, session });
			print(acted, `A pretend shell in ${session.path}. Try pwd, clear, or exit.\r\n${prompt(acted)}`);
			return { outcome: "opened", session: structuredClone(session), started: true };
		},
		readTerminal: async id => sessions.get(id)?.scrollback.snapshot() ?? null,
		drawnTerminal(id, seq) {
			const acted = sessions.get(id);
			if (acted) acted.drawn = Math.max(acted.drawn, seq);
		},
		drawnUpTo: id => sessions.get(id)?.drawn ?? 0,
		writeTerminal(id, data) {
			const acted = sessions.get(id);
			if (acted && acted.session.state.kind === "running") type(acted, data);
		},
		resizeTerminal(id, cols, rows) {
			const acted = sessions.get(id);
			if (acted && acted.session.state.kind === "running") acted.size = { cols, rows };
		},
		async closeTerminal(id) {
			if (!sessions.delete(id)) return;
			announce({ id, session: null });
		},
		onTerminalOutput(listener) {
			output.add(listener);
			return () => void output.delete(listener);
		},
		onTerminalChanged(listener) {
			changes.add(listener);
			return () => void changes.delete(listener);
		},
		onQuitRequested(listener) {
			quitListeners.add(listener);
			return () => void quitListeners.delete(listener);
		},
		async confirmQuit() {
			confirmed = true;
			for (const id of [...sessions.keys()]) {
				sessions.delete(id);
				announce({ id, session: null });
			}
		},
		writeClipboard: async text => {
			clipboard = text;
		},
		readClipboard: async () => clipboard === "" ? null : clipboard,
		async openLink(url) {
			if (!isWebLink(url)) return false;
			links.push(url);
			return true;
		},
		requestQuit() {
			const count = live();
			if (confirmed || count === 0) {
				confirmed = true;
				return true;
			}
			for (const listener of [...quitListeners]) listener(count);
			return false;
		},
		quitConfirmed: () => confirmed,
		endTerminal(id, exitCode) {
			const acted = sessions.get(id);
			if (acted) end(acted, exitCode);
		},
		typedInto: id => sessions.get(id)?.typed ?? "",
		terminalSize: id => {
			const acted = sessions.get(id);
			return acted ? { ...acted.size } : null;
		},
		failTerminals(result) {
			failing = result;
		},
		openedLinks: () => [...links],
	};
}
