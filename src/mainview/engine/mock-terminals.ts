import { terminalSample } from "../terminal-sample";
import { type AgentSetting, agentCommand, findAgent } from "../../shared/agent";
import { type ArenaLaunch, isArenaName, isAttemptLabel } from "../../shared/arenas";
import { type ResumableAgent, agentStartArguments, conversationMissingNote, resumableAgent } from "../../shared/agent-resume";
import type { Attention } from "../../shared/attention";
import { describeCommandLine } from "../../shared/command-line";
import type { Engine } from "../../shared/engine";
import type { TimberStatus, Worktree } from "../../shared/model";
import {
	type OpenTerminalResult, type Scrollback, type TerminalChange, type TerminalOutput, type TerminalSession, cleanSessionName, createScrollback,
	defaultSessionName, isWebLink, type SessionNaming, sessionNameBase, WORKTREE_SETUP_SESSION_NAME, type PasteModeScanner, PASTE_NOT_READY, CHOP_NOT_TYPED,
	type OpenTerminalRequest, type PasteResult, chopRunBytes, createPasteModeScanner, pasteProblem, promptBytes,
} from "../../shared/terminal";
import { recordsForWindow } from "../../shared/session-status";
import { PROMPT_STILL_STARTING, promptEndedMessage } from "../../shared/agent-prompt";
import { PROBE_ANSWER, type StatusRecords, type StatusScanner, createStatusRecords, createStatusScanner } from "../../shared/program-status";
import {
	type LiveSession, type RestoreTag, type SavedSessions, buildSavedSessions, createSavedCarry, isConversationId, isRestoreTag, parseSavedSessions, serializeSavedSessions,
} from "../../shared/saved-sessions";
import { notFoundOnPath } from "../../shared/search-path";
import { type WorkflowList, isWorkflowName } from "../../shared/workflows";
import { worktreeSetupArguments } from "../../shared/worktree-commands";
import { type MockSessionStorage, memorySessionStorage } from "./mock-session-storage";

/** The part of the engine about terminals, and how they are acted out. */
export type TerminalCapabilities = Pick<Engine,
	| "listTerminals" | "openTerminal" | "renameTerminal" | "readTerminal" | "drawnTerminal" | "writeTerminal" | "pasteTerminal" | "resizeTerminal" | "closeTerminal"
	| "onTerminalOutput" | "onTerminalChanged" | "onQuitRequested" | "confirmQuit" | "writeClipboard" | "readClipboard" | "openLink" | "takeSavedSessions"
	| "forgetSavedSessions"
>;

/** A chop to start a session with, as the main process's `ChopInput`. */
export type MockChopInput = { kind: "command"; name: string; text: string } | { kind: "prompt"; text: string; review?: boolean };

/**
 * What `runChop` uses, as the main process's `TerminalSessions` does: start a
 * shell with a command chop typed into it, or an agent with a prompt to
 * send, and send a prompt to a running agent. Not part of the engine.
 */
export interface ChopTerminals {
	openChopTerminal(request: OpenTerminalRequest, chop: MockChopInput): Promise<OpenTerminalResult>;
	sendPrompt(id: string, repository: string, worktreePath: string, text: string): PasteResult;
	sessionById(id: string): TerminalSession | null;
}

export interface TerminalControls {
	/**
	 * Act out the person quitting the app or closing its window. As the main
	 * process does, the interface is asked only while a terminal runs or a
	 * file has unsaved edits.
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
	/** Every text pasted into a session with `pasteTerminal`, or sent to it as a prompt, in order, exactly as given. */
	pastedInto(id: string): string[];
	/** Every prompt sent to a session, followed by Enter, in order, exactly as given. */
	promptsSentTo(id: string): string[];
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
	/** Act out the save at quit without quitting. */
	saveSessionsNow(): void;
	/** Act out these conversations as gone from the agent's own storage. */
	missingConversations(ids: readonly string[]): void;
	/** The conversation each running agent session is in, by session id. */
	conversationOf(id: string): string | null;
	/** The most openTerminal requests that were being answered at once. */
	mostOpeningAtOnce(): number;
	/**
	 * Act out new agents that are not ready at once, such as on a first-run
	 * screen: while held, an agent started with a prompt chop or a review
	 * keeps it pending until `agentReady`. Not held at first.
	 */
	holdNewAgents(hold: boolean): void;
	/** Act out a held agent becoming ready: it gets its prompt or review now. */
	agentReady(id: string): void;
}

export interface MockTerminalOptions {
	/** Where the open sessions are kept between runs. A second engine made with the same storage is the app after a restart. Memory of its own when left out. */
	savedSessions?: MockSessionStorage;
	/** How long an acted openTerminal takes. None by default. */
	terminalMilliseconds?: number;
	/** How many files the window last said it holds unsaved edits of. Quitting asks while there are any, as in the main process. */
	unsavedFiles?: () => number;
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
	/** The agent's name in Settings, or null. */
	agent: string | null;
	resumable: ResumableAgent | null;
	conversation: string | null;
	/** Whether the person gave the session its name. */
	renamed: boolean;
	/** The saved session it opened again, when it did. */
	restored: RestoreTag | null;
	/** Every prompt sent, with Enter after it, in order, as given. */
	prompts: string[];
	/** The prompt or review this agent was started with, while it waits to be ready. */
	waiting: { text: string; review: boolean } | null;
}

/** What a pretend setup script prints when it fails. */
export const MOCK_SETUP_FAILURE = "bun install v1.4.2\r\nerror: lockfile had changes, but lockfile is frozen\r\nerror: Setup post_create step 1 failed (exit code 1).\r\n";

/** Session ids count across engines, so a second engine, the app after a restart, never gives out an id of the first, as the main process does not. */
let lastId = 0;

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
 * a moment later, as it would over the bridge. The sessions that run are
 * saved to `savedSessions` when quitting, as the main process saves them,
 * and handed out once by `takeSavedSessions`; agents go back to their
 * conversations as the main process has them do.
 */
const osc7501 = (pairs: string) => `\x1b]7501;${pairs}\x1b\\`;
const base64 = (text: string) => btoa(String.fromCharCode(...new TextEncoder().encode(text)));
/**
 * What `subagents` typed in a mock session prints: the program working, with
 * four tasks, one with a task of its own under it that needs the person.
 * Claude Code's own ids are flat; the nested one shows the tree.
 */
const SUBAGENT_REPORTS = [
	`state=working:msg=${base64("Running 4 tasks")}`,
	`state=working:progress=40:id=review:title=${base64("Review the diff")}`,
	`state=blocked:kind=permission:id=review/tests:title=${base64("Run the tests")}:msg=${base64("approve Bash: bun test")}`,
	`state=working:id=dev-server:title=${base64("bun run dev:web")}`,
	`state=done:id=docs:title=${base64("Update the docs")}`,
].map(osc7501).join("");
/** `subagents clear`: a clear without an id removes every record, the program's own too. */
const SUBAGENT_CLEAR = osc7501("state=clear");

export function createMockTerminals(
	findWorktree: (repository: string, path: string) => Worktree | null,
	agents: () => readonly AgentSetting[] = () => [],
	timber: () => TimberStatus = () => ({ state: "not-found", source: "path", path: null }),
	sessionNaming: () => SessionNaming = () => "plain",
	arenaLaunch: (repository: string, worktree: string, arena: string, attempt: string) => ArenaLaunch = () => ({ outcome: "failed", message: "Arena attempts cannot start here. Nothing was started." }),
	workflows: (repository: string) => Promise<WorkflowList> = async () => ({ ok: false, message: "Workflows cannot be read here." }),
	options: MockTerminalOptions = {},
): TerminalCapabilities & TerminalControls & ChopTerminals & { attendSessions(attention: Attention): void } {
	const sessions = new Map<string, Acted>();
	const output = new Set<(output: TerminalOutput) => void>();
	const changes = new Set<(change: TerminalChange) => void>();
	const quitListeners = new Set<(live: number) => void>();
	let failing: Exclude<OpenTerminalResult, { outcome: "opened" }> | null = null;
	let missing: readonly string[] = [];
	let confirmed = false;
	let worktreeSetupExit: number | null = 0;
	let clipboard = "";
	const links: string[] = [];
	const storage = options.savedSessions ?? memorySessionStorage();
	// What the last run saved, read once, as the main process reads sessions.json at launch.
	let saved: SavedSessions | null = (() => {
		const text = storage.read();
		const read = text === null ? null : parseSavedSessions(text);
		return read?.ok && Object.keys(read.saved.worktrees).length > 0 ? read.saved : null;
	})();
	// What became of those in this run, so the save keeps what did not open again, as the main process does.
	const carry = createSavedCarry(saved);
	let goneConversations: readonly string[] = [];
	// The shown chip of each worktree and the selected worktree, from what the window attends to.
	const shown: Record<string, string> = {};
	let selectedId: string | null = null;
	let opening = 0;
	let mostOpening = 0;
	let holdAgents = false;

	function saveSessions(): void {
		const running = [...sessions.values()].flatMap((acted): LiveSession[] => {
			const { session } = acted;
			if (session.state.kind !== "running" || (session.kind !== "terminal" && session.kind !== "agent")) return [];
			return [{ id: session.id, worktree: session.worktree, kind: session.kind, agent: acted.agent, conversation: acted.conversation, name: acted.renamed ? session.name : null, restored: acted.restored }];
		});
		storage.write(serializeSavedSessions(buildSavedSessions(running, shown, selectedId, carry)));
	}

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
			acted.session = { ...acted.session, ...recordsForWindow(acted.records) };
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
		const unsent = acted.waiting;
		acted.waiting = null;
		const dropped = unsent === null ? {} : { prompt: { state: "not-sent" as const, message: promptEndedMessage(acted.session.name, unsent.review ? "review" : "prompt"), ...(unsent.review ? { what: "review" as const } : {}) } };
		acted.session = { ...acted.session, state: { kind: "exited", exitCode, signal: null }, ...recordsForWindow(acted.records), ...dropped };
		announce({ id: acted.session.id, session: acted.session });
	}

	function run(acted: Acted, command: string): void {
		const [name] = command.trim().split(/\s+/);
		if (name === "exit") {
			print(acted, "\r\n");
			end(acted, 0);
			return;
		}
		if (name === "subagents" && command.trim().split(/\s+/)[1] === "clear") print(acted, `\r\n${SUBAGENT_CLEAR}cleared the tasks\r\n`);
		else if (name === "clear") print(acted, "\x1b[2J\x1b[H");
		else if (name === "pwd") print(acted, `\r\n${acted.session.path}\r\n`);
		else if (name === "sample") print(acted, `\r\n${terminalSample()}`);
		else if (name === "subagents") print(acted, `\r\n${SUBAGENT_REPORTS}acted out four tasks; type "subagents clear" to clear them\r\n`);
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
	async function open(request: OpenTerminalRequest, chop?: MockChopInput): Promise<OpenTerminalResult> {
		if (failing) return structuredClone(failing);
		if (chop?.kind === "prompt" && (typeof request.agent !== "string" || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined || request.workflowAgent !== undefined)) {
			return { outcome: "failed", message: "A prompt goes to an agent from Settings only. Nothing was started." };
		}
		if (chop?.kind === "command" && (request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined || request.workflowAgent !== undefined)) {
			return { outcome: "failed", message: "A chop runs in a shell, not with an agent, setup, a workflow, or an arena attempt. Nothing was started." };
		}
		// As the main process does: a review from the window goes to a fresh agent from Settings only, as a prompt with no Enter.
		if (request.review !== undefined) {
			const fresh = chop === undefined && typeof request.agent === "string" && request.timberWorktreeSetup === undefined && request.arenaAttempt === undefined
				&& request.workflowAgent === undefined && request.resume === undefined && request.restore === undefined;
			if (!fresh) return { outcome: "failed", message: "A review goes to a new agent from Settings only. Nothing was started." };
			const problem = pasteProblem(request.review);
			if (problem !== null) return { outcome: "failed", message: `The review cannot be pasted: ${problem} Nothing was started.` };
			chop = { kind: "prompt", text: request.review, review: true };
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
		const notStarted = attempt ? `${attempt.label} was not started.` : agent ? `${agent.name} was not started.` : workflowAgent !== undefined ? `The agent of the ${workflowAgent.workflow} workflow was not started.` : worktreeSetup ? "Setup was not started." : chop?.kind === "command" ? `${chop.name} was not started.` : "No terminal was started.";
		if (!worktree) return { outcome: "not-listed", message: `Timber lists no worktree at ${request.worktree} in ${request.repository}. ${notStarted} Refresh the list.` };
		let shell = "/bin/mock-shell";
		let args: string[] = [];
		// As the main process reads them: a conversation only as a UUID and for an agent from Settings, a name only cleaned, and neither for a Timber command, an arena attempt, or a workflow's own agent.
		const resume = agent !== null && isConversationId(request.resume) ? request.resume : null;
		const savedName = chop === undefined && setup === null && attempt === null && (agent !== null || workflowAgent === undefined) ? cleanSessionName(request.name) : null;
		const restored: RestoreTag | null = setup === null && attempt === null && (agent !== null || workflowAgent === undefined) && isRestoreTag(request.restore)
			? { worktree: request.restore.worktree, index: request.restore.index } : null;
		let resumable: ResumableAgent | null = null;
		let conversation: string | null = null;
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
		if (agent) {
			resumable = resumableAgent(launch!.executable, launch!.arguments);
			const exists = (id: string) => !goneConversations.includes(id);
			if (resumable !== null && resume !== null && exists(resume)) {
				args = agentStartArguments(resumable, args, { resume });
				conversation = resume;
			} else if (resumable !== null) {
				// A fresh Codex has no id of the app's choosing; this one stands in for what the main process reads from Codex's files at quit.
				conversation = crypto.randomUUID();
				args = agentStartArguments(resumable, args, { fresh: conversation });
			}
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
				chop?.kind === "command" ? chop.name : attempt ? attempt.label : worktreeSetup ? WORKTREE_SETUP_SESSION_NAME
					: savedName ?? sessionNameBase(sessionNaming(), launch ? launch.name : "Terminal", worktree.branch, launch !== null),
				taken,
			),
			repository: request.repository,
			worktree: worktree.id,
			path: worktree.path,
			shell,
			command: describeCommandLine([shell, ...args]),
			state: { kind: "running" },
			status: null,
			children: [],
			...(chop?.kind === "prompt" ? { prompt: { state: "pending" as const, ...(chop.review ? { what: "review" as const } : {}) } } : {}),
		};
		const acted: Acted = {
			session, scrollback: createScrollback(), line: "", typed: "", size: { cols: request.cols, rows: request.rows }, drawn: 0,
			scanner: createStatusScanner(), records: createStatusRecords(), answers: [], pasteMode: createPasteModeScanner(), pasted: [], prompts: [],
			agent: agent?.name ?? null, resumable, conversation, renamed: savedName !== null, restored,
			waiting: chop?.kind === "prompt" ? { text: chop.text, review: chop.review === true } : null,
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
		const note = agent !== null && resume !== null && conversation !== resume ? conversationMissingNote(agent.name) : "";
		// A pretend agent asks for bracketed paste, as Claude Code and Codex do, so a pasted review keeps its line breaks.
		print(acted, `${note}${greeting}${launch ? "\x1b[?2004h" : ""}${prompt(acted)}`);
		// The pretend shell never asks for bracketed paste, so a chop is typed line by line, as into dash or PowerShell.
		// The pretend agent is ready at once, unless held: bracketed paste is on and nothing more is printed. The prompt goes a moment later.
		if (chop?.kind === "prompt" && !holdAgents) later(() => sendWaiting(acted));
		if (chop?.kind === "command") {
			const bytes = chopRunBytes(chop.text, acted.pasteMode.on());
			if (bytes === null) print(acted, `\r\n\x1b[2m${CHOP_NOT_TYPED}\x1b[0m\r\n`);
			else type(acted, bytes);
		}
		return { outcome: "opened", session: structuredClone(session) };
	}

	/** Send an agent the prompt or review it waits for, as the main process does once it is ready: a review with no Enter. */
	function sendWaiting(acted: Acted): void {
		const waiting = acted.waiting;
		if (waiting === null || acted.session.state.kind !== "running" || !sessions.has(acted.session.id)) return;
		acted.waiting = null;
		const sent = deliver(acted, waiting.text, !waiting.review);
		const tag = waiting.review ? { what: "review" as const } : {};
		acted.session = { ...acted.session, prompt: sent.outcome === "pasted" ? { state: "sent", ...tag } : { state: "not-sent", message: sent.message, ...tag } };
		announce({ id: acted.session.id, session: acted.session });
	}

	/** Paste text in, as the main process's `deliver` does, and with `enter`, Enter after it. */
	function deliver(acted: Acted, text: string, enter: boolean): PasteResult {
		const problem = pasteProblem(text);
		if (problem !== null) return { outcome: "refused", message: problem };
		const bytes = promptBytes(text, acted.pasteMode.on());
		if (bytes === null) return { outcome: "not-ready", message: PASTE_NOT_READY };
		acted.pasted.push(text);
		acted.typed += bytes.paste;
		// Shown in the pretend input, line by line, and not run until Enter.
		acted.line += text;
		print(acted, text.replace(/\n/g, "\r\n"));
		if (enter) {
			acted.prompts.push(text);
			// The pretend program takes the whole paste as one line.
			acted.typed += bytes.enter;
			print(acted, "\r\n");
			acted.line = "";
			print(acted, prompt(acted));
		}
		return { outcome: "pasted" };
	}

	return {
		listTerminals: async () => [...sessions.values()].map(acted => structuredClone(acted.session)),
		async forgetSavedSessions(worktrees) {
			carry.forget(worktrees);
		},
		async takeSavedSessions() {
			const taken = saved;
			saved = null;
			return taken === null ? null : structuredClone(taken);
		},
		attendSessions(attention) {
			if (attention.selected === null) return;
			selectedId = attention.selected.id;
			if (attention.session !== null) shown[attention.selected.id] = attention.session;
		},
		saveSessionsNow: () => saveSessions(),
		missingConversations(ids) {
			goneConversations = [...ids];
		},
		conversationOf: id => sessions.get(id)?.conversation ?? null,
		mostOpeningAtOnce: () => mostOpening,
		holdNewAgents(hold) {
			holdAgents = hold;
		},
		agentReady(id) {
			const acted = sessions.get(id);
			if (acted) sendWaiting(acted);
		},
		openTerminal(request) {
			// Straight through when nothing is held back or counted, so a session starts as soon as it would without saved sessions.
			if (!options.terminalMilliseconds && !isRestoreTag(request.restore)) return open(request);
			return (async () => {
				opening += 1;
				mostOpening = Math.max(mostOpening, opening);
				try {
					if (options.terminalMilliseconds) await new Promise(resolve => setTimeout(resolve, options.terminalMilliseconds));
					// As the main process does: what came of opening a saved session tells the save whether to keep the saved one.
					let result: OpenTerminalResult;
					try {
						result = await open(request);
					} catch (error) {
						if (isRestoreTag(request.restore)) carry.miss(request.restore);
						throw error;
					}
					if (isRestoreTag(request.restore)) {
						if (result.outcome === "opened" || result.outcome === "not-configured") carry.settle(request.restore);
						else carry.miss(request.restore);
					}
					return result;
				} finally {
					opening -= 1;
				}
			})();
		},
		openChopTerminal: (request, chop) => open(request, chop),
		sendPrompt(id, repository, worktreePath, text) {
			const acted = sessions.get(id);
			if (!acted || acted.session.state.kind !== "running") return { outcome: "gone", message: "The session has ended." };
			if (acted.session.kind !== "agent" || acted.session.path !== worktreePath || acted.session.repository !== repository) return { outcome: "not-agent", message: "That session is not an agent of this worktree." };
			if (acted.waiting !== null) return { outcome: "not-ready", message: PROMPT_STILL_STARTING };
			return deliver(acted, text, true);
		},
		sessionById: id => {
			const acted = sessions.get(id);
			return acted ? structuredClone(acted.session) : null;
		},
		promptsSentTo: id => [...(sessions.get(id)?.prompts ?? [])],
		async renameTerminal(id, name) {
			const acted = sessions.get(id);
			const clean = cleanSessionName(name);
			if (!acted || clean === null) return null;
			acted.renamed = true;
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
			// As the main process does: an agent still waiting for the text it was started with may be on a first-run screen.
			if (acted.waiting !== null) return { outcome: "not-ready", message: PROMPT_STILL_STARTING };
			return deliver(acted, text, false);
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
			// As the main process does: the sessions are saved while they still run, then ended.
			if (!confirmed) saveSessions();
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
			if (confirmed || (count === 0 && (options.unsavedFiles?.() ?? 0) === 0)) {
				// Quitting at once saves what runs, which is nothing, so closed sessions stay closed.
				if (!confirmed) saveSessions();
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
