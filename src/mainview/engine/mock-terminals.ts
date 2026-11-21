import { terminalSample } from "../terminal-sample";
import { type AgentSetting, agentCommand, findAgent } from "../../shared/agent";
import { type ArenaLaunch, isArenaName, isAttemptLabel } from "../../shared/arenas";
import { describeCommandLine } from "../../shared/command-line";
import type { Engine } from "../../shared/engine";
import type { TimberStatus, Worktree } from "../../shared/model";
import {
	type OpenTerminalResult, type Scrollback, type TerminalChange, type TerminalOutput, type TerminalSession, cleanSessionName, createScrollback,
	defaultSessionName, isWebLink, type SessionNaming, sessionNameBase, WORKTREE_SETUP_SESSION_NAME, type PasteModeScanner, PASTE_NOT_READY, CHOP_NOT_TYPED,
	type OpenTerminalRequest, chopRunBytes, createPasteModeScanner, pasteBytes, pasteProblem,
} from "../../shared/terminal";
import { PROBE_ANSWER, type StatusRecords, type StatusScanner, createStatusRecords, createStatusScanner } from "../../shared/program-status";
import { notFoundOnPath } from "../../shared/search-path";
import { type WorkflowList, isWorkflowName } from "../../shared/workflows";
import { worktreeSetupArguments } from "../../shared/worktree-commands";

/** The part of the engine about terminals, and how they are acted out. */
export type TerminalCapabilities = Pick<Engine,
	| "listTerminals" | "openTerminal" | "renameTerminal" | "readTerminal" | "drawnTerminal" | "writeTerminal" | "pasteTerminal" | "resizeTerminal" | "closeTerminal"
	| "onTerminalOutput" | "onTerminalChanged" | "onQuitRequested" | "confirmQuit" | "writeClipboard" | "readClipboard" | "openLink"
>;

/** Start a shell with a chop typed into it, as the main process's `TerminalSessions.open` does. Not part of the engine: only `runChop` calls it. */
export interface ChopTerminals {
	openChopTerminal(request: OpenTerminalRequest, chop: { name: string; text: string }): Promise<OpenTerminalResult>;
}

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
	/**
	 * Act out the program in a session reporting its status through OSC 7501:
	 * `report` is what goes after `7501;`, such as
	 * `state=blocked:kind=permission:msg=YXBwcm92ZQ==`, or `?` for the probe.
	 * It is printed as the sequence and read as the main process reads it.
	 */
	agentStatus(id: string, report: string): void;
	/** Every text pasted into a session with `pasteTerminal`, in order, exactly as given. */
	pastedInto(id: string): string[];
	/** Act out the program in a session printing this, read as the main process reads it, such as `\x1b[?2004l` to turn bracketed paste off. */
	printInto(id: string, data: string): void;
	/** What was written into a session as the answer to a probe, in order. */
	probeAnswers(id: string): string[];
	/**
	 * Make every later pretend worktree setup (`timber open --setup`) end by
	 * itself with this exit code (0 at first), or keep running when null. A
	 * nonzero code prints a failing setup script first.
	 */
	endWorktreeSetups(exitCode: number | null): void;
}

interface Acted {
	session: TerminalSession;
	scrollback: Scrollback;
	line: string;
	typed: string;
	size: { cols: number; rows: number };
	drawn: number;
	scanner: StatusScanner;
	records: StatusRecords;
	answers: string[];
	/** Whether the pretend program asked for bracketed paste, read from what it printed as the main process reads it. */
	pasteMode: PasteModeScanner;
	/** Every text pasted in, in order, as given. */
	pasted: string[];
}

/** What a pretend setup script prints when it fails. */
export const MOCK_SETUP_FAILURE = "bun install v1.4.2\r\nerror: lockfile had changes, but lockfile is frozen\r\nerror: Setup post_create step 1 failed (exit code 1).\r\n";

/** The PATH the mock acts out looking on. */
export const MOCK_PATH = "/usr/local/bin:/usr/bin:/bin";

/**
 * Terminals acted out in memory, for the browser build and tests. Each one is
 * a pretend shell that echoes what is typed and knows `pwd`, `clear`, and
 * `exit`. An agent session is the same pretend program, started from the
 * agents that `agents` answers, as the saved preferences, or from the agent
 * of a named workflow, read again from `workflows` as the main process reads
 * Timber's settings. New sessions
 * are named as `sessionNaming` answers, as the saved preferences. Output arrives
 * a moment later, as it would over the bridge.
 */
export function createMockTerminals(
	findWorktree: (repository: string, path: string) => Worktree | null,
	agents: () => readonly AgentSetting[] = () => [],
	timber: () => TimberStatus = () => ({ state: "not-found", override: null }),
	sessionNaming: () => SessionNaming = () => "plain",
	arenaLaunch: (repository: string, worktree: string, arena: string, attempt: string) => ArenaLaunch = () => ({ outcome: "failed", message: "Arena attempts cannot start here. Nothing was started." }),
	workflows: (repository: string) => Promise<WorkflowList> = async () => ({ ok: false, message: "Workflows cannot be read here." }),
): TerminalCapabilities & TerminalControls & ChopTerminals {
	const sessions = new Map<string, Acted>();
	const output = new Set<(output: TerminalOutput) => void>();
	const changes = new Set<(change: TerminalChange) => void>();
	const quitListeners = new Set<(live: number) => void>();
	let lastId = 0;
	let failing: Exclude<OpenTerminalResult, { outcome: "opened" }> | null = null;
	let missing: readonly string[] = [];
	let confirmed = false;
	let worktreeSetupExit: number | null = 0;
	let clipboard = "";
	const links: string[] = [];

	const later = (task: () => void) => void Promise.resolve().then(task);
	const live = () => [...sessions.values()].filter(acted => acted.session.state.kind === "running").length;
	const prompt = (acted: Acted) => acted.session.kind !== "terminal" ? "\x1b[35m>\x1b[0m " : `\x1b[32m${acted.session.path.split("/").at(-1)}\x1b[0m $ `;

	function print(acted: Acted, data: string): void {
		acted.pasteMode.scan(data);
		// What the program prints is read for status first, as the main process does.
		let statusChanged = false;
		for (const event of acted.scanner.scan(data)) {
			if (event.type === "probe") {
				if (acted.session.state.kind === "running") acted.answers.push(PROBE_ANSWER);
			} else if (acted.records.apply(event)) statusChanged = true;
		}
		if (statusChanged && acted.session.state.kind === "running") {
			acted.session = { ...acted.session, status: acted.records.root() };
			announce({ id: acted.session.id, session: acted.session });
		}
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
		acted.records.exited();
		acted.pasteMode.reset();
		acted.session = { ...acted.session, state: { kind: "exited", exitCode, signal: null }, status: acted.records.root() };
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

	/** Start a session as the main process would. With `chop`, a pretend shell named after the chop, with the chop's text typed in. */
	async function open(request: OpenTerminalRequest, chop?: { name: string; text: string }): Promise<OpenTerminalResult> {
		if (failing) return structuredClone(failing);
		if (chop !== undefined && (request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined || request.workflowAgent !== undefined)) {
			return { outcome: "failed", message: "A chop runs in a shell, not with an agent, setup, a workflow, or an arena attempt. Nothing was started." };
		}
		// As the main process does: only names are read from the request, the workflow's and the pick's.
		const workflowAgent = request.workflowAgent;
		if (workflowAgent !== undefined) {
			const readable = typeof workflowAgent === "object" && workflowAgent !== null && isWorkflowName(workflowAgent.workflow)
				&& (workflowAgent.agent === undefined || typeof workflowAgent.agent === "string")
				&& request.agent === undefined && request.timberWorktreeSetup === undefined && request.arenaAttempt === undefined;
			if (!readable) return { outcome: "failed", message: "The request for a workflow's agent cannot be read. Nothing was started." };
		}
		// As the main process does: Timber says what an arena attempt runs, and the request never does.
		let attempt: { label: string; argv: string[] } | null = null;
		const wanted = request.arenaAttempt;
		if (wanted !== undefined) {
			if (request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.workflowAgent !== undefined || !isArenaName(wanted.arena) || !isAttemptLabel(wanted.attempt)) {
				return { outcome: "failed", message: "The request for an arena attempt cannot be read. Nothing was started." };
			}
			const launch = arenaLaunch(request.repository, request.worktree, wanted.arena, wanted.attempt);
			if (launch.outcome === "failed") return { outcome: "failed", message: launch.message };
			if (launch.outcome === "no-agent") return { outcome: "not-configured", message: `${wanted.attempt} is a manual attempt, so it has no agent to start. Open a terminal in it instead. Nothing was started.` };
			if (launch.cwd !== request.worktree) return { outcome: "failed", message: `Timber gives ${launch.cwd} as the folder of ${wanted.attempt}, not ${request.worktree}. Nothing was started.` };
			attempt = { label: wanted.attempt, argv: launch.argv };
		}
		let agent: AgentSetting | null = null;
		if (request.agent !== undefined) {
			if (typeof request.agent !== "string") return { outcome: "not-configured", message: "The request names no agent. Nothing was started." };
			agent = findAgent(agents(), request.agent);
			if (agent === null) return { outcome: "not-configured", message: `No agent called "${request.agent}" is set in Settings, Agents. Nothing was started.` };
		}
		let setup: string[] | null = null;
		const worktreeSetup = request.timberWorktreeSetup;
		if (worktreeSetup !== undefined) {
			if (agent !== null || typeof worktreeSetup !== "object" || worktreeSetup === null
				|| (worktreeSetup.workflow !== undefined && !isWorkflowName(worktreeSetup.workflow))) return { outcome: "failed", message: "The request for Timber setup cannot be read. Nothing was started." };
			const status = timber();
			if (status.state !== "ready") return { outcome: "not-configured", message: "No usable Timber was found, so setup cannot start. Nothing was started." };
			setup = [status.path, ...worktreeSetupArguments(request.worktree, worktreeSetup.workflow)];
		}
		// The agent to start: from Settings, or what the workflow sets now, never what the window saw.
		let launch: { name: string; executable: string; arguments: string[]; command: string; section: string } | null = null;
		if (workflowAgent !== undefined) {
			const name = workflowAgent.workflow;
			const list = await workflows(request.repository).catch((error): WorkflowList => ({ ok: false, message: `${error instanceof Error ? error.message : String(error)}.` }));
			const workflow = list.ok ? list.workflows.find(candidate => candidate.name === name) : undefined;
			if (workflow?.agent.kind === "command") {
				launch = {
					name, executable: workflow.agent.command, arguments: [...workflow.agent.args],
					command: `The agent command of the ${name} workflow`, section: "Timber's settings",
				};
			} else if (workflow?.agent.kind === "none") return { outcome: "not-configured", message: `The ${name} workflow now starts no agent (agent = false). Nothing was started.` };
			else if (workflowAgent.agent !== undefined) {
				// Timber does not say the workflow sets an agent: the one the person picked starts, as the dialog showed it.
				agent = findAgent(agents(), workflowAgent.agent);
				if (agent === null) return { outcome: "not-configured", message: `No agent called "${workflowAgent.agent}" is set in Settings, Agents. Nothing was started.` };
			} else if (!list.ok) return { outcome: "failed", message: `Could not read the agent of the ${name} workflow: ${list.message} Nothing was started.` };
			else if (workflow === undefined) return { outcome: "not-configured", message: `Timber lists no workflow called "${name}" for ${request.repository} now. Nothing was started.` };
			else return { outcome: "not-configured", message: `The ${name} workflow no longer sets an agent. Nothing was started. Start one from the "+" menu.` };
		}
		const worktree = findWorktree(request.repository, request.worktree);
		const notStarted = attempt ? `${attempt.label} was not started.` : agent ? `${agent.name} was not started.` : workflowAgent !== undefined ? `The agent of the ${workflowAgent.workflow} workflow was not started.` : worktreeSetup ? "Setup was not started." : chop ? `${chop.name} was not started.` : "No terminal was started.";
		if (!worktree) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. ${notStarted} Refresh the list.` };
		let shell = "/bin/mock-shell";
		let args: string[] = [];
		if (agent) {
			const built = agentCommand(agent);
			if (!built.ok) return { outcome: "failed", message: `${built.message} Change it in Settings, Agents. Nothing was started.` };
			launch = { name: agent.name, executable: built.executable, arguments: built.arguments, command: `The command of ${agent.name}`, section: "Settings, Agents" };
		}
		if (launch) {
			const what = agent ? launch.name : `the agent of the ${launch.name} workflow`;
			const command = describeCommandLine([launch.executable, ...launch.arguments]);
			if (!launch.executable.startsWith("/") && /[\\/]/.test(launch.executable)) {
				return {
					outcome: "failed",
					command,
					message: `${launch.command} starts with the relative path ${launch.executable}. Use a command found on the PATH, or a full path, in ${launch.section}.`,
				};
			}
			if (missing.includes(launch.executable)) {
				return {
					outcome: "not-found",
					command,
					executable: launch.executable,
					message: `Could not start ${what}. ${notFoundOnPath([launch.executable], MOCK_PATH, ":")} A change to PATH needs a restart of the app, or use the full path in ${launch.section}.`,
				};
			}
			shell = launch.executable.startsWith("/") ? launch.executable : `/usr/local/bin/${launch.executable}`;
			args = launch.arguments;
		}
		if (setup) [shell, ...args] = setup as [string, ...string[]];
		if (attempt) {
			const [program, ...rest] = attempt.argv as [string, ...string[]];
			shell = program.startsWith("/") ? program : `/usr/local/bin/${program}`;
			args = rest;
		}
		const taken = [...sessions.values()].filter(acted => acted.session.worktree === worktree.id).map(acted => acted.session.name);
		const session: TerminalSession = {
			id: `mock-terminal-${++lastId}`,
			kind: launch || attempt ? "agent" : setup ? "timber" : "terminal",
			name: defaultSessionName(
				chop ? chop.name : attempt ? attempt.label : worktreeSetup ? WORKTREE_SETUP_SESSION_NAME : sessionNameBase(sessionNaming(), launch ? launch.name : "Terminal", worktree.branch, launch !== null),
				taken,
			),
			repository: request.repository,
			worktree: worktree.id,
			path: worktree.path,
			shell,
			command: describeCommandLine([shell, ...args]),
			state: { kind: "running" },
			status: null,
		};
		const acted: Acted = {
			session, scrollback: createScrollback(), line: "", typed: "", size: { cols: request.cols, rows: request.rows }, drawn: 0,
			scanner: createStatusScanner(), records: createStatusRecords(), answers: [], pasteMode: createPasteModeScanner(), pasted: [],
		};
		sessions.set(session.id, acted);
		announce({ id: session.id, session });
		if (worktreeSetup) {
			const exitCode = worktreeSetupExit;
			print(acted, `A pretend setup in ${session.path}, started as ${session.command}. Nothing runs in the browser.\r\n${exitCode ? MOCK_SETUP_FAILURE : ""}`);
			if (exitCode !== null) later(() => end(acted, exitCode));
			return { outcome: "opened", session: structuredClone(session) };
		}
		const greeting = launch || attempt
			? `A pretend ${session.name} in ${session.path}, started as ${session.command}. Nothing runs in the browser. Try exit.\r\n`
			: `A pretend shell in ${session.path}. Try pwd, clear, or exit.\r\n`;
		// A pretend agent asks for bracketed paste, as Claude Code and Codex do, so a pasted review keeps its line breaks.
		print(acted, `${greeting}${launch ? "\x1b[?2004h" : ""}${prompt(acted)}`);
		// The pretend shell never asks for bracketed paste, so a chop is typed line by line, as into dash or PowerShell.
		if (chop) {
			const bytes = chopRunBytes(chop.text, acted.pasteMode.on());
			if (bytes === null) print(acted, `\r\n\x1b[2m${CHOP_NOT_TYPED}\x1b[0m\r\n`);
			else type(acted, bytes);
		}
		return { outcome: "opened", session: structuredClone(session) };
	}

	return {
		listTerminals: async () => [...sessions.values()].map(acted => structuredClone(acted.session)),
		openTerminal: request => open(request),
		openChopTerminal: (request, chop) => open(request, chop),
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
		endWorktreeSetups(exitCode) {
			worktreeSetupExit = exitCode;
		},
		writeTerminal(id, data) {
			const acted = sessions.get(id);
			if (acted && acted.session.state.kind === "running") type(acted, data);
		},
		async pasteTerminal(id, text) {
			const acted = sessions.get(id);
			if (!acted || acted.session.state.kind !== "running") return { outcome: "gone", message: "The session has ended." };
			const problem = pasteProblem(text);
			if (problem !== null) return { outcome: "refused", message: problem };
			const bytes = pasteBytes(text, acted.pasteMode.on());
			if (bytes === null) return { outcome: "not-ready", message: PASTE_NOT_READY };
			acted.pasted.push(text);
			acted.typed += bytes;
			// Shown in the pretend input, line by line, and not run: no Enter came.
			acted.line += text;
			print(acted, text.replace(/\n/g, "\r\n"));
			return { outcome: "pasted" };
		},
		pastedInto: id => [...(sessions.get(id)?.pasted ?? [])],
		printInto(id, data) {
			const acted = sessions.get(id);
			if (acted && acted.session.state.kind === "running") print(acted, data);
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
		agentStatus(id, report) {
			const acted = sessions.get(id);
			if (acted && acted.session.state.kind === "running") print(acted, `\x1b]7501;${report}\x1b\\`);
		},
		probeAnswers: id => [...(sessions.get(id)?.answers ?? [])],
	};
}
