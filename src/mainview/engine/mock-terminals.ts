import { terminalSample } from "../terminal-sample";
import { type AgentSetting, agentCommand, findAgent } from "../../shared/agent";
import { describeCommandLine } from "../../shared/command-line";
import type { Engine } from "../../shared/engine";
import type { TimberStatus, Worktree } from "../../shared/model";
import {
	type OpenTerminalResult, type Scrollback, type TerminalChange, type TerminalOutput, type TerminalSession, cleanSessionName, createScrollback,
	defaultSessionName, isWebLink, TIMBER_REBASE_SESSION_NAME, TIMBER_SETUP_SESSION_NAME,
} from "../../shared/terminal";
import { rebaseArguments } from "../../shared/rebase-command";
import { notFoundOnPath } from "../../shared/search-path";
import { TIMBER_CONFIG_SCOPES, type TimberConfigScope, timberSetupArguments } from "../../shared/timber-config";

/** The part of the engine about terminals, and how they are acted out. */
export type TerminalCapabilities = Pick<Engine,
	| "listTerminals" | "openTerminal" | "renameTerminal" | "readTerminal" | "drawnTerminal" | "writeTerminal" | "resizeTerminal" | "closeTerminal"
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
	/** Act out these agent executables, by the name a command starts with, as not found on the PATH. Empty for all found. */
	missingExecutables(executables: readonly string[]): void;
	/** The links a terminal asked to open. */
	openedLinks(): string[];
	/** The last part of a session the window said it drew. */
	drawnUpTo(id: string): number;
	/** Make every later pretend `timber rebase` end by itself with this exit code (0 at first), or keep running when null. */
	endRebases(exitCode: number | null): void;
}

interface Acted {
	session: TerminalSession;
	scrollback: Scrollback;
	line: string;
	typed: string;
	size: { cols: number; rows: number };
	drawn: number;
	/** Which settings a pretend `timber setup` saves. Null for any other session. */
	setup: TimberConfigScope | null;
	/** A pretend `timber rebase`, which takes no input. */
	rebase: boolean;
}

const SETUP_QUESTION = "Save Timber settings? Type save, cancel, or exit: ";

/** The PATH the mock acts out looking on. */
export const MOCK_PATH = "/usr/local/bin:/usr/bin:/bin";

/**
 * Terminals acted out in memory, for the browser build and tests. Each one is
 * a pretend shell that echoes what is typed and knows `pwd`, `clear`, and
 * `exit`. An agent session is the same pretend program, started from the
 * agents that `agents` answers, as the saved preferences. A Timber setup
 * session is a pretend `timber setup` that asks one question: `save` acts
 * out saving through `saveSetup`, and `cancel` or `exit` acts out
 * cancelling; each ends it with exit code 0, as Timber does. Output arrives
 * a moment later, as it would over the bridge.
 */
export function createMockTerminals(
	findWorktree: (repository: string, path: string) => Worktree | null,
	agents: () => readonly AgentSetting[] = () => [],
	timber: () => TimberStatus = () => ({ state: "not-found", override: null }),
	saveSetup: (scope: TimberConfigScope, repository: string) => void = () => {},
): TerminalCapabilities & TerminalControls {
	const sessions = new Map<string, Acted>();
	const output = new Set<(output: TerminalOutput) => void>();
	const changes = new Set<(change: TerminalChange) => void>();
	const quitListeners = new Set<(live: number) => void>();
	let lastId = 0;
	let failing: Exclude<OpenTerminalResult, { outcome: "opened" }> | null = null;
	let missing: readonly string[] = [];
	let confirmed = false;
	let rebaseExit: number | null = 0;
	let clipboard = "";
	const links: string[] = [];

	const later = (task: () => void) => void Promise.resolve().then(task);
	const live = () => [...sessions.values()].filter(acted => acted.session.state.kind === "running").length;
	const prompt = (acted: Acted) => acted.setup !== null ? SETUP_QUESTION
		: acted.session.kind !== "terminal" ? "\x1b[35m>\x1b[0m " : `\x1b[32m${acted.session.path.split("/").at(-1)}\x1b[0m $ `;

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

	/** A line typed into a pretend `timber setup`. */
	function answerSetup(acted: Acted, scope: TimberConfigScope, answer: string): void {
		if (answer === "save") {
			saveSetup(scope, acted.session.repository);
			print(acted, "\r\nSaved.\r\n");
			end(acted, 0);
		} else if (answer === "cancel" || answer === "exit") {
			// Timber ends a cancelled setup with exit code 0 too, so how it ended never says whether it saved.
			print(acted, "\r\nCancelled.\r\n");
			end(acted, 0);
		} else {
			print(acted, `\r\n${prompt(acted)}`);
		}
	}

	function run(acted: Acted, command: string): void {
		if (acted.setup !== null) return answerSetup(acted, acted.setup, command.trim());
		const [name] = command.trim().split(/\s+/);
		if (name === "exit") {
			print(acted, "\r\n");
			end(acted, 0);
			return;
		}
		if (name === "clear") print(acted, "\x1b[2J\x1b[H");
		else if (name === "pwd") print(acted, `\r\n${acted.session.path}\r\n`);
		else if (name === "sample") print(acted, `\r\n${terminalSample()}`);
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
			let agent: AgentSetting | null = null;
			if (request.agent !== undefined) {
				if (typeof request.agent !== "string") return { outcome: "not-configured", message: "The request names no agent. Nothing was started." };
				agent = findAgent(agents(), request.agent);
				if (agent === null) return { outcome: "not-configured", message: `No agent called "${request.agent}" is set in Settings, Agents. Nothing was started.` };
			}
			let setup: string[] | null = null;
			if (request.timberSetup !== undefined) {
				if (agent !== null || request.timberRebase !== undefined || !TIMBER_CONFIG_SCOPES.includes(request.timberSetup)) return { outcome: "failed", message: "The request for Timber setup cannot be read. Nothing was started." };
				const status = timber();
				if (status.state !== "ready") return { outcome: "not-configured", message: "No usable Timber was found, so setup cannot start. Nothing was started." };
				setup = [status.path, ...timberSetupArguments(request.timberSetup)];
			}
			const rebase = request.timberRebase;
			if (rebase !== undefined) {
				const onto = rebase?.onto;
				if (agent !== null || (onto !== null && (typeof onto !== "string" || onto === ""))) return { outcome: "failed", message: "The request for Timber rebase cannot be read. Nothing was started." };
				const status = timber();
				if (status.state !== "ready") return { outcome: "not-configured", message: "No usable Timber was found, so the rebase cannot start. Nothing was started." };
				setup = [status.path, ...rebaseArguments({ worktree: request.worktree, onto })];
			}
			const worktree = findWorktree(request.repository, request.worktree);
			const notStarted = agent ? `${agent.name} was not started.` : rebase !== undefined ? "The rebase was not started." : setup ? "Timber setup was not started." : "No terminal was started.";
			if (!worktree) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. ${notStarted} Refresh the list.` };
			let shell = "/bin/mock-shell";
			let args: string[] = [];
			if (agent) {
				const built = agentCommand(agent);
				if (!built.ok) return { outcome: "failed", message: `${built.message} Change it in Settings, Agents. Nothing was started.` };
				const command = describeCommandLine([built.executable, ...built.arguments]);
				if (!built.executable.startsWith("/") && /[\\/]/.test(built.executable)) {
					return {
						outcome: "failed",
						command,
						message: `The command of ${agent.name} starts with the relative path ${built.executable}. Use a command found on the PATH, or a full path, in Settings, Agents.`,
					};
				}
				if (missing.includes(built.executable)) {
					return {
						outcome: "not-found",
						command,
						executable: built.executable,
						message: `Could not start ${agent.name}. ${notFoundOnPath([built.executable], MOCK_PATH, ":")} A change to PATH needs a restart of the app, or use the full path in Settings, Agents.`,
					};
				}
				shell = built.executable.startsWith("/") ? built.executable : `/usr/local/bin/${built.executable}`;
				args = built.arguments;
			}
			if (setup) [shell, ...args] = setup as [string, ...string[]];
			const taken = [...sessions.values()].filter(acted => acted.session.worktree === worktree.id).map(acted => acted.session.name);
			const session: TerminalSession = {
				id: `mock-terminal-${++lastId}`,
				kind: agent ? "agent" : setup ? "timber" : "terminal",
				name: defaultSessionName(agent ? agent.name : rebase !== undefined ? TIMBER_REBASE_SESSION_NAME : setup ? TIMBER_SETUP_SESSION_NAME : "Terminal", taken),
				repository: request.repository,
				worktree: worktree.id,
				path: worktree.path,
				shell,
				command: describeCommandLine([shell, ...args]),
				state: { kind: "running" },
			};
			const acted: Acted = {
				session, scrollback: createScrollback(), line: "", typed: "", size: { cols: request.cols, rows: request.rows }, drawn: 0,
				setup: setup && rebase === undefined ? request.timberSetup! : null,
				rebase: rebase !== undefined,
			};
			sessions.set(session.id, acted);
			announce({ id: session.id, session });
			if (acted.rebase) {
				print(acted, `A pretend timber rebase in ${session.path}, started as ${session.command}. Nothing runs in the browser.\r\n`);
				const exitCode = rebaseExit;
				if (exitCode !== null) later(() => end(acted, exitCode));
				return { outcome: "opened", session: structuredClone(session) };
			}
			const greeting = setup
				? `A pretend ${session.name} in ${session.path}, started as ${session.command}. Nothing runs in the browser.\r\n`
				: agent
				? `A pretend ${session.name} in ${session.path}, started as ${session.command}. Nothing runs in the browser. Try exit.\r\n`
				: `A pretend shell in ${session.path}. Try pwd, clear, or exit.\r\n`;
			print(acted, `${greeting}${prompt(acted)}`);
			return { outcome: "opened", session: structuredClone(session) };
		},
		async renameTerminal(id, name) {
			const acted = sessions.get(id);
			const clean = cleanSessionName(name);
			if (!acted || clean === null) return null;
			if (clean !== acted.session.name) {
				acted.session = { ...acted.session, name: clean };
				announce({ id, session: acted.session });
			}
			return structuredClone(acted.session);
		},
		readTerminal: async id => sessions.get(id)?.scrollback.snapshot() ?? null,
		drawnTerminal(id, seq) {
			const acted = sessions.get(id);
			if (acted) acted.drawn = Math.max(acted.drawn, seq);
		},
		drawnUpTo: id => sessions.get(id)?.drawn ?? 0,
		endRebases(exitCode) {
			rebaseExit = exitCode;
		},
		writeTerminal(id, data) {
			const acted = sessions.get(id);
			// A pretend rebase reads nothing, as Timber reads nothing from the terminal while it rebases.
			if (acted && acted.session.state.kind === "running" && !acted.rebase) type(acted, data);
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
		missingExecutables(executables) {
			missing = [...executables];
		},
		openedLinks: () => [...links],
	};
}
