import { accessSync, constants } from "node:fs";
import { type ArenaLaunch, isArenaName, isAttemptLabel } from "../shared/arenas";
import { type AgentSetting, agentCommand, findAgent } from "../shared/agent";
import { describeCommandLine } from "../shared/command-line";
import type { TimberStatus } from "../shared/model";
import {
	type OpenTerminalRequest, type OpenTerminalResult, type PasteModeScanner, type PasteResult, type Scrollback, type SessionNaming, type TerminalChange, type TerminalOutput, type TerminalSession,
	type TerminalSnapshot, TERMINAL_UNSUPPORTED_REASON, WORKTREE_SETUP_SESSION_NAME, clampTerminalSize, cleanSessionName, createScrollback, defaultSessionName, pickShell,
	pickWindowsShell, sessionNameBase, PASTE_NOT_READY, bracketedPaste, createPasteModeScanner, pasteProblem,
} from "../shared/terminal";
import { PROBE_ANSWER, type StatusRecords, type StatusScanner, createStatusRecords, createStatusScanner } from "../shared/program-status";
import { HANDOFF_VARIABLE } from "../shared/handoff";
import { asWin32KeyEvents } from "../shared/win32-input";
import { type Workflow, type WorkflowList, isWorkflowName } from "../shared/workflows";
import { worktreeSetupArguments } from "../shared/worktree-commands";
import { type ExecutableWords, findExecutable, isWindowsBatch } from "./find-executable";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { killProcessTree, sessionMembers, signalEach, signalGroup } from "./process-session";
import { type PseudoTerminal, type StartPseudoTerminal, startPseudoTerminal } from "./pseudo-terminal";
import { messageOf } from "../shared/error-message";

/** How long a closed session's processes get to end after a hang-up, before they are killed. */
const CLOSE_MILLISECONDS = 2000;
/** Output is gathered this long before it is sent, so a busy program sends a few large parts, not many small ones. */
const FLUSH_MILLISECONDS = 4;
/** A part is sent at once when it reaches this many code units. */
const PART_LIMIT = 64 * 1024;
/**
 * How much may be sent that the window has not drawn yet. Beyond it, output
 * is only kept, and once the window caught up it gets what is kept in one
 * part that starts the screen afresh. So a program that prints without end
 * cannot bury the window, and Ctrl+C still gets through.
 */
const UNDRAWN_LIMIT = 1024 * 1024;
/** The least time between two answers to the status probe of one session. */
const PROBE_INTERVAL_MILLISECONDS = 100;
/** After the shell ended, how long to wait for the last output still in the terminal. */
const DRAIN_MILLISECONDS = 250;

export interface TerminalDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
	/**
	 * The agents as saved in Settings. An agent's command comes only from
	 * here, never from the interface. None when left out.
	 */
	agents?: () => Promise<readonly AgentSetting[]>;
	/**
	 * How new terminal and agent sessions are named, as saved in Settings.
	 * Plain when left out, or when it cannot be read.
	 */
	sessionNaming?: () => Promise<SessionNaming>;
	/** Where Timber is, for worktree setup sessions. Setup never starts while it is not ready. */
	timber?: () => Promise<TimberStatus>;
	/**
	 * What Timber says an arena attempt's agent runs (`timber __app-arena
	 * launch`, see ./arenas.ts). The only source of an attempt's command.
	 * Without it, no attempt starts.
	 */
	arenaLaunch?: (request: { repository: string; worktree: string; arena: string; attempt: string }) => Promise<ArenaLaunch>;
	/**
	 * A repository's workflows as Timber reports them now (see ./workflows.ts).
	 * A workflow's agent command comes only from here, never from the
	 * interface. Its arguments can hold tokens: never log them. Unreadable when
	 * left out.
	 */
	workflows?: (repository: string) => Promise<WorkflowList>;
	/** Hears every part of output, in order per session. */
	onOutput: (output: TerminalOutput) => void;
	/** Hears every session that started, ended, or is gone. */
	onChange: (change: TerminalChange) => void;
	/** The environment the app was started with. The shell gets all of it, with `TERM` set. */
	environment?: Record<string, string | undefined>;
	/**
	 * The folder where `timber new` typed in a session hands the app the
	 * worktree it created (see ./handoffs.ts), or null when there is none.
	 * Waited for before a session starts, so one opened while the app starts
	 * gets it too. Every session gets it as `TIMBER_APP_HANDOFF`; one
	 * inherited from the app's own environment is never passed on.
	 */
	handoffFolder?: () => Promise<string | null>;
	/** The operating system, as `process.platform` names it. Tests pass another. */
	platform?: NodeJS.Platform;
	/**
	 * How a session's program starts in a pseudo terminal, or null where
	 * there is none: see `startPseudoTerminal` in ./pseudo-terminal.ts. Tests
	 * pass null to see the refusal, or another way to start.
	 */
	startTerminal?: StartPseudoTerminal | null;
	/** Tests change the waits and the limit. */
	closeMilliseconds?: number;
	flushMilliseconds?: number;
	undrawnLimit?: number;
}

/** The main process side of terminal sessions. A worktree can have several. */
export interface TerminalSessions {
	/** Every session, running or exited, in the order they started. */
	list(): TerminalSession[];
	/** Start another shell, an agent from Settings, or a workflow's agent, in a listed worktree, beside the sessions it has. */
	open(request: OpenTerminalRequest): Promise<OpenTerminalResult>;
	/** Give a session another name. Null for a session that is gone, or a name with nothing in it. */
	rename(id: string, name: string): TerminalSession | null;
	/** The end of what a session printed. Null for a session that is gone. */
	read(id: string): TerminalSnapshot | null;
	/** The window drew a session's parts up to and including `seq`. */
	drawn(id: string, seq: number): void;
	/** Pass typed text on to a running session. Anything else is ignored. */
	write(id: string, data: string): void;
	/**
	 * Paste text into a running agent session as one bracketed paste, only
	 * when its program asked for bracketed paste and the text has nothing a
	 * paste must not hold (`pasteProblem`). Nothing is written otherwise.
	 */
	paste(id: string, text: string): PasteResult;
	resize(id: string, cols: number, rows: number): void;
	/**
	 * End a session and forget it. Everything in the shell's session is hung
	 * up on, as when a terminal window closes, and whatever is still there
	 * after a moment is killed. Answers once the shell has ended. Safe to
	 * call again.
	 */
	close(id: string): Promise<void>;
	/** Close every session, for quitting once the person agreed. */
	closeAll(): Promise<void>;
	/** Kill everything in every session at once and forget them, for quitting with no time to wait. */
	killAll(): void;
	/** How many sessions still run. */
	liveCount(): number;
	/** Each running session's shell, which leads the session's processes, for looking up what they listen on. Read-only. */
	leaders(): SessionLeader[];
}

/** A running session and the process that leads its process session. */
export interface SessionLeader {
	id: string;
	name: string;
	/** The worktree's registered path. */
	path: string;
	pid: number;
}

interface Live {
	session: TerminalSession;
	process: PseudoTerminal;
	scrollback: Scrollback;
	pending: string;
	flushTimer: ReturnType<typeof setTimeout> | null;
	/** Parts sent and not drawn yet, oldest first. */
	undrawn: { seq: number; size: number }[];
	undrawnSize: number;
	/** Output is kept but not sent until the window catches up. */
	held: boolean;
	/**
	 * What was left in the shell's session right after the shell ended, or
	 * null while it runs. Once the session is empty its id is free for the
	 * system to give to another process, so after the shell ended only these
	 * are ever signalled.
	 */
	leftovers: number[] | null;
	ended: Promise<void>;
	/** Reads OSC 7501 reports, OSC 133 prompts, and full resets out of the output. */
	scanner: StatusScanner;
	records: StatusRecords;
	/** Whether the program asked for bracketed paste (mode 2004), read from all of its output. */
	pasteMode: PasteModeScanner;
	/** When the last probe was answered. A flood of probes, such as from a file shown with `cat`, gets one answer at a time. */
	probedAt: number;
	/** The root record changed since the window was last told. Told with the next flush, so a stream of progress is one change per part. */
	statusChanged: boolean;
}

/**
 * An agent's executable and arguments, ready to be looked up on the PATH:
 * from Settings, from a workflow, or from an arena attempt.
 */
interface AgentLaunch {
	/** The session's base name, and the name in messages: the agent's name, the workflow's, or the attempt's label. */
	name: string;
	executable: string;
	arguments: string[];
	/** For the messages when the executable is not found. */
	words: ExecutableWords;
	/** Where to change the command, for the batch-file message, such as "Settings, Agents". */
	section: string;
	/** The session is named `name` as it is, not by the naming setting: an arena attempt, named by its label everywhere. */
	fixedName?: boolean;
	/** Set on top of the session's environment, and taken out of it, as Timber asks for an arena attempt. */
	environment?: Record<string, string>;
	unset?: string[];
}

/** An agent from Settings, its command split without a shell (`agentCommand` in ../shared/agent.ts). */
function launchOfSetting(agent: AgentSetting): { ok: true; launch: AgentLaunch } | { ok: false; result: OpenTerminalResult } {
	const built = agentCommand(agent);
	if (!built.ok) return { ok: false, result: { outcome: "failed", message: `${built.message} Change it in Settings, Agents. Nothing was started.` } };
	const section = "Settings, Agents";
	return {
		ok: true,
		launch: { name: agent.name, executable: built.executable, arguments: built.arguments, words: { what: agent.name, command: `The command of ${agent.name}`, section }, section },
	};
}

/**
 * A workflow's agent, as Timber reports it: one executable and its arguments,
 * kept apart and never split again.
 */
function launchOfWorkflow(name: string, agent: Extract<Workflow["agent"], { kind: "command" }>): AgentLaunch {
	const section = "Timber's settings";
	return {
		name,
		executable: agent.command,
		arguments: [...agent.args],
		words: { what: `the agent of the ${name} workflow`, command: `The agent command of the ${name} workflow`, section },
		section,
	};
}

/** An arena attempt's agent, as Timber said to start it: its program and arguments as they are, and its environment. */
function launchOfAttempt(label: string, argv: readonly string[], environment: Record<string, string>, unset: string[]): AgentLaunch {
	const [program, ...rest] = argv;
	const section = "Timber's arena presets";
	return {
		name: label,
		executable: program ?? "",
		arguments: rest,
		words: { what: label, command: `The command Timber gives for ${label}`, section },
		section,
		fixedName: true,
		environment,
		unset,
	};
}

function isExecutable(path: string): boolean {
	try {
		accessSync(path, constants.X_OK);
		return true;
	} catch {
		return false;
	}
}

const wait = (milliseconds: number) => new Promise<void>(resolve => setTimeout(resolve, milliseconds));

/** An environment with `set` put on top and `unset` taken out, as Timber asks for an arena attempt. */
function withChanges(base: Record<string, string | undefined>, set: Record<string, string> = {}, unset: readonly string[] = []): Record<string, string | undefined> {
	const changed: Record<string, string | undefined> = { ...base, ...set };
	for (const name of unset) delete changed[name];
	return changed;
}

const running = (child: PseudoTerminal) => child.ended() === null;

/**
 * The processes of a session that may be signalled now. While the shell runs
 * its session id is its own, so every member counts; after it ended, only
 * the ones left right then. Null where they cannot be listed.
 */
function members(live: Live): number[] | null {
	const now = sessionMembers(live.process.pid);
	if (now === null || live.leftovers === null) return now;
	return now.filter(pid => live.leftovers!.includes(pid));
}

/**
 * Signal everything in a session. Where members cannot be listed, the shell's
 * process group stands in, but only while the shell runs, because only then
 * is that group surely its own.
 */
function signalSession(live: Live, signal: NodeJS.Signals): void {
	const now = members(live);
	if (now !== null) signalEach(now, signal);
	else if (running(live.process)) signalGroup(live.process.pid, signal);
}

/** What a session's program gets: the app's environment, with the terminal's own variables and the handoff folder. */
export function sessionEnvironment(environment: Record<string, string | undefined>, handoff: string | null): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "timber-app" };
	// A folder from the app's own environment, as when it was started from one of its terminals, belongs to another run.
	delete env[HANDOFF_VARIABLE];
	if (handoff !== null) env[HANDOFF_VARIABLE] = handoff;
	return env;
}

/**
 * Terminal sessions owned by the main process.
 *
 * - A session is the person's shell (`SHELL`, or `/bin/sh`) in a pseudo
 *   terminal (`Bun.Terminal`), started in the worktree's folder with the
 *   app's environment, `TERM=xterm-256color`, and the handoff folder in
 *   `TIMBER_APP_HANDOFF` (see `sessionEnvironment`). The shell leads a
 *   session of processes of its own.
 * - An agent session starts an agent's command from the saved Settings in
 *   place of the shell, split without a shell, its executable found on the
 *   app's PATH. A request names the agent, never the command. An agent whose
 *   executable is not there starts nothing, and no session is kept. What an
 *   agent prints is handled as any terminal's output and never read.
 * - A workflow agent session starts the agent a named workflow sets, in
 *   place of the shell, read again from Timber when it opens (see
 *   ./workflows.ts). A request names the workflow, never the command. The
 *   executable and its arguments are used as Timber reports them, never
 *   split again, and found as an agent's are. A workflow that turns the
 *   agent off now starts nothing. Otherwise, unless Timber reports a command,
 *   the saved agent the request names with the workflow starts, as the
 *   dialog showed it; with none named, a workflow that is gone, that cannot
 *   be read, or that leaves the agent unset starts nothing. Its arguments
 *   can hold tokens, so nothing about it is logged.
 * - Every session's output, shown or not, passes a scanner for the Program
 *   Status Protocol (OSC 7501, see ../shared/program-status.ts) before it is
 *   kept: a control sequence a program addresses to the terminal, like a
 *   title or a bell, never text on screen. A probe is answered on the
 *   session's input; a report sets the session's `status`. Nothing from a
 *   report is run or echoed back, and the output goes on unchanged.
 * - A worktree setup session runs `timber open --setup [--workflow <name>]
 *   --no-editor --no-agent -- <path>` for the worktree, in its folder
 *   (`worktreeSetupArguments` in ../shared/worktree-commands.ts), so setup
 *   scripts run where they can be watched and nothing waits for them. What
 *   they print is never read.
 * - Only a worktree Timber lists, in a repository in the app's list, with its
 *   folder there, gets one. Each request starts another, beside the ones the
 *   worktree has, named after the shell or the agent ("Terminal",
 *   "Terminal 2", "Codex", ...), or, as Settings says, after the worktree's
 *   branch or its issue key ("feature-login", "Codex: GH-122"). A setup
 *   session is always "Setup". The name is set once, when the session opens.
 * - Output is kept, up to `SCROLLBACK_LIMIT`, so the interface can draw a
 *   session again, and is sent in numbered parts, never far ahead of what
 *   the window drew (`UNDRAWN_LIMIT`).
 * - When the shell ends by itself, what it left running is hung up on, as a
 *   terminal does when it closes. The session stays, with how it ended,
 *   until it is closed.
 * - On Windows the pseudo terminal is the ConPTY that node-pty ships, or
 *   Windows' own through `Bun.Terminal` where node-pty cannot be loaded (see
 *   ./pseudo-terminal.ts). The shell is PowerShell (see `pickWindowsShell`).
 *   There are no sessions or
 *   process groups to signal: closing the pseudo console hangs up everything
 *   attached to it, and what still runs after the wait is ended with the
 *   shell's whole process tree (`killProcessTree`). An agent whose executable
 *   is a `.cmd` or `.bat` file is refused (see `isWindowsBatch`). The probe
 *   answer is written as win32-input-mode key events (`asWin32KeyEvents`),
 *   since Windows' own ConPTY drops an OSC written as it is; node-pty's
 *   reads it as well. Where there is no pseudo terminal, nothing starts.
 */
export function createTerminalSessions(dependencies: TerminalDependencies): TerminalSessions {
	const {
		findRepository, onOutput, onChange, agents = async () => [], sessionNaming = async (): Promise<SessionNaming> => "plain", timber = async (): Promise<TimberStatus> => ({ state: "not-found", override: null }), environment = process.env, handoffFolder = async () => null, platform = process.platform,
		arenaLaunch = async () => ({ outcome: "failed", message: "Arena attempts cannot start here. Nothing was started." }),
		workflows = async (): Promise<WorkflowList> => ({ ok: false, message: "Workflows cannot be read here." }),
		startTerminal = startPseudoTerminal(platform),
		closeMilliseconds = CLOSE_MILLISECONDS, flushMilliseconds = FLUSH_MILLISECONDS, undrawnLimit = UNDRAWN_LIMIT,
	} = dependencies;
	const windows = platform === "win32";
	/** ConPTY drops an OSC written as it is, so on Windows the answer goes in as typed keys. */
	const probeAnswer = windows ? asWin32KeyEvents(PROBE_ANSWER) : PROBE_ANSWER;
	const sessions = new Map<string, Live>();

	/** Hang up on what runs in a session. On Windows closing the pseudo console does that, and there is nothing to signal. */
	function hangUp(live: Live): void {
		if (!windows) signalSession(live, "SIGHUP");
	}

	/** The shell a terminal session starts. */
	function shellOf(): string {
		if (!windows) return pickShell(environment, isExecutable);
		const search = environment.PATH ?? environment.Path ?? "";
		return pickWindowsShell(environment, name => Bun.which(name, { PATH: search }), isExecutable);
	}

	const inWorktree = (worktreeId: string) => [...sessions.values()].filter(live => live.session.worktree === worktreeId);

	function send(live: Live, output: TerminalOutput): void {
		live.undrawn.push({ seq: output.seq, size: output.data.length });
		live.undrawnSize += output.data.length;
		if (live.undrawnSize > undrawnLimit) live.held = true;
		onOutput(output);
	}

	/**
	 * Take in printed text: read the status sequences out of it, answer a
	 * probe on the session's input, and keep the text to send. The text
	 * itself is not changed.
	 */
	function take(live: Live, text: string): void {
		live.pasteMode.scan(text);
		for (const event of live.scanner.scan(text)) {
			if (event.type === "probe") {
				const now = Date.now();
				if (live.session.state.kind === "running" && now - live.probedAt >= PROBE_INTERVAL_MILLISECONDS) {
					live.probedAt = now;
					live.process.write(probeAnswer);
				}
			} else if (live.records.apply(event)) live.statusChanged = true;
		}
		live.pending += text;
	}

	function flush(live: Live): void {
		if (live.flushTimer !== null) clearTimeout(live.flushTimer);
		live.flushTimer = null;
		if (live.statusChanged) {
			live.statusChanged = false;
			// A session closed meanwhile is already gone and stays gone.
			if (sessions.get(live.session.id) === live) changed(live, { ...live.session, status: live.records.root() });
		}
		if (live.pending === "") return;
		const data = live.pending;
		live.pending = "";
		const seq = live.scrollback.append(data);
		if (!live.held) send(live, { id: live.session.id, seq, data });
	}

	function changed(live: Live, session: TerminalSession | null): void {
		if (session) live.session = session;
		onChange({ id: live.session.id, session: session ? { ...session } : null });
	}

	/** What a session starts with: the shell, or an agent's executable as found on the PATH, with its arguments. */
	type Start =
		| { ok: true; kind: TerminalSession["kind"]; base: string; argv: string[]; command: string; environment?: Record<string, string>; unset?: string[] }
		| { ok: false; result: OpenTerminalResult };

	function startOf(launch: AgentLaunch | null, run: TimberRun | null): Start {
		if (run !== null) {
			const argv = [run.timber, ...run.arguments];
			return { ok: true, kind: "timber", base: run.name, argv, command: describeCommandLine(argv) };
		}
		if (launch === null) {
			const shell = shellOf();
			return { ok: true, kind: "terminal", base: "Terminal", argv: [shell], command: describeCommandLine([shell]) };
		}
		const command = describeCommandLine([launch.executable, ...launch.arguments]);
		const lookup = findExecutable(launch.executable, environment.PATH ?? environment.Path ?? "", launch.words);
		if (!lookup.ok) {
			return {
				ok: false,
				result: lookup.reason === "relative"
					? { outcome: "failed", command, message: lookup.message }
					: { outcome: "not-found", command, executable: launch.executable, message: lookup.message },
			};
		}
		const argv = [lookup.path, ...launch.arguments];
		if (windows && isWindowsBatch(lookup.path)) {
			return {
				ok: false,
				result: {
					outcome: "failed",
					command: describeCommandLine(argv),
					message: `${lookup.path} is a batch file, which Windows runs through cmd.exe, so the app does not start ${launch.name} with it. Use ${launch.name}'s own .exe, as a full path if needed, in ${launch.section}. Nothing was started.`,
				},
			};
		}
		return { ok: true, kind: "agent", base: launch.name, argv, command: describeCommandLine(argv), ...(launch.environment ? { environment: launch.environment } : {}), ...(launch.unset ? { unset: launch.unset } : {}) };
	}

	/** A Timber command to run in place of the shell: a worktree's setup, with the Timber the app found. */
	interface TimberRun {
		timber: string;
		arguments: string[];
		name: string;
		what: string;
	}

	/** Ask Timber what the attempt runs. Null with a result when nothing may start. */
	async function attemptOf(request: OpenTerminalRequest): Promise<{ launch: AgentLaunch | null; refused: OpenTerminalResult | null }> {
		const wanted = request.arenaAttempt;
		if (wanted === undefined) return { launch: null, refused: null };
		if (request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.workflowAgent !== undefined || typeof wanted !== "object" || wanted === null || !isArenaName(wanted.arena) || !isAttemptLabel(wanted.attempt)) {
			return { launch: null, refused: { outcome: "failed", message: "The request for an arena attempt cannot be read. Nothing was started." } };
		}
		let launch: ArenaLaunch;
		try {
			launch = await arenaLaunch({ repository: request.repository, worktree: request.worktree, arena: wanted.arena, attempt: wanted.attempt });
		} catch (error) {
			return { launch: null, refused: { outcome: "failed", message: `Could not ask Timber how to start ${wanted.attempt}: ${messageOf(error)}. Nothing was started.` } };
		}
		if (launch.outcome === "failed") return { launch: null, refused: { outcome: "failed", message: launch.message } };
		if (launch.outcome === "no-agent") return { launch: null, refused: { outcome: "not-configured", message: `${wanted.attempt} is a manual attempt, so it has no agent to start. Open a terminal in it instead. Nothing was started.` } };
		// Timber names the folder; it must be the worktree the request is for, or the agent would work somewhere else.
		if (launch.cwd !== request.worktree) {
			return { launch: null, refused: { outcome: "failed", message: `Timber gives ${launch.cwd} as the folder of ${wanted.attempt}, not ${request.worktree}. Nothing was started.` } };
		}
		return { launch: launchOfAttempt(wanted.attempt, launch.argv, launch.environment, launch.unset), refused: null };
	}

	/** An agent saved in Settings, by name. */
	async function savedAgent(name: string): Promise<{ ok: true; agent: AgentSetting } | { ok: false; result: OpenTerminalResult }> {
		let saved: readonly AgentSetting[];
		try {
			saved = await agents();
		} catch (error) {
			return { ok: false, result: { outcome: "failed", message: `Could not read the agents in Settings: ${messageOf(error)}. Nothing was started.` } };
		}
		const agent = findAgent(saved, name);
		if (agent === null) return { ok: false, result: { outcome: "not-configured", message: `No agent called "${name}" is set in Settings, Agents. Nothing was started.` } };
		return { ok: true, agent };
	}

	async function open(request: OpenTerminalRequest): Promise<OpenTerminalResult> {
		if (startTerminal === null) return { outcome: "unsupported", message: TERMINAL_UNSUPPORTED_REASON };
		// Only names are read from the request, the workflow's and the pick's: the command comes from Timber, read again below.
		const workflowAgent = request.workflowAgent;
		if (workflowAgent !== undefined) {
			const readable = typeof workflowAgent === "object" && workflowAgent !== null && isWorkflowName(workflowAgent.workflow)
				&& (workflowAgent.agent === undefined || typeof workflowAgent.agent === "string")
				&& request.agent === undefined && request.timberWorktreeSetup === undefined && request.arenaAttempt === undefined;
			if (!readable) return { outcome: "failed", message: "The request for a workflow's agent cannot be read. Nothing was started." };
		}
		// Timber is asked first, since nothing may wait between finding the worktree and keeping the session.
		const attempt = await attemptOf(request);
		if (attempt.refused) return attempt.refused;
		// An agent is looked up first: a request for one never falls back to a shell.
		let agent: AgentSetting | null = null;
		if (request.agent !== undefined) {
			if (typeof request.agent !== "string") return { outcome: "not-configured", message: "The request names no agent. Nothing was started." };
			const found = await savedAgent(request.agent);
			if (!found.ok) return found.result;
			agent = found.agent;
		}
		// A worktree's setup runs the Timber the app found, and only that one.
		let run: TimberRun | null = null;
		if (request.timberWorktreeSetup !== undefined) {
			const worktreeSetup = request.timberWorktreeSetup;
			// A workflow is only ever a workflow name, so it can never read as an option. Whether it exists is Timber's to say.
			const readable = agent === null && typeof worktreeSetup === "object" && worktreeSetup !== null
				&& (worktreeSetup.workflow === undefined || isWorkflowName(worktreeSetup.workflow));
			if (!readable) return { outcome: "failed", message: "The request for Timber setup cannot be read. Nothing was started." };
			let status: TimberStatus;
			try {
				status = await timber();
			} catch (error) {
				return { outcome: "failed", message: `Could not find Timber: ${messageOf(error)}. Nothing was started.` };
			}
			if (status.state !== "ready") return { outcome: "not-configured", message: "No usable Timber was found, so setup cannot start. Nothing was started." };
			run = { timber: status.path, arguments: worktreeSetupArguments(request.worktree, worktreeSetup.workflow), name: WORKTREE_SETUP_SESSION_NAME, what: "Setup" };
		}
		// A workflow's agent is what Timber reports now, never what the window saw when it was picked.
		let workflowLaunch: AgentLaunch | null = null;
		if (workflowAgent !== undefined) {
			const name = workflowAgent.workflow;
			const list = await workflows(request.repository).catch((error): WorkflowList => ({ ok: false, message: `${messageOf(error)}.` }));
			const workflow = list.ok ? list.workflows.find(candidate => candidate.name === name) : undefined;
			if (workflow?.agent.kind === "command") workflowLaunch = launchOfWorkflow(name, workflow.agent);
			else if (workflow?.agent.kind === "none") return { outcome: "not-configured", message: `The ${name} workflow now starts no agent (agent = false). Nothing was started.` };
			else if (workflowAgent.agent !== undefined) {
				// Timber does not say the workflow sets an agent: the one the person picked starts, as the dialog showed it.
				const found = await savedAgent(workflowAgent.agent);
				if (!found.ok) return found.result;
				agent = found.agent;
			} else if (!list.ok) return { outcome: "failed", message: `Could not read the agent of the ${name} workflow: ${list.message} Nothing was started.` };
			else if (workflow === undefined) return { outcome: "not-configured", message: `Timber lists no workflow called "${name}" for ${request.repository} now. Nothing was started.` };
			else return { outcome: "not-configured", message: `The ${name} workflow no longer sets an agent. Nothing was started. Start one from the "+" menu.` };
		}
		// Naming is a convenience: when it cannot be read, the session is named as it always was.
		const naming = run === null ? await sessionNaming().catch((): SessionNaming => "plain") : "plain";
		const handoff = await handoffFolder().catch(() => null);
		const consequence = attempt.launch ? `${attempt.launch.name} was not started.`
			: agent ? `${agent.name} was not started.`
			: workflowAgent !== undefined ? `The agent of the ${workflowAgent.workflow} workflow was not started.`
			: run ? `${run.what} was not started.` : "No terminal was started.";
		const listed = await findListedWorktree(findRepository, request.repository, request.worktree, consequence);
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };
		// From here to the new session being kept nothing waits, so two sessions that start at once get different names.
		let launch = attempt.launch ?? workflowLaunch;
		if (agent !== null) {
			const setting = launchOfSetting(agent);
			if (!setting.ok) return setting.result;
			launch = setting.launch;
		}
		const start = startOf(launch, run);
		if (!start.ok) return start.result;
		// An attempt's session is named after its label, which is how the arena names it everywhere.
		const base = run === null && !launch?.fixedName ? sessionNameBase(naming, start.base, listed.worktree.branch, launch !== null) : start.base;
		const name = defaultSessionName(base, inWorktree(listed.worktree.id).map(live => live.session.name));

		const shell = start.argv[0]!;
		const { cols, rows } = clampTerminalSize(request.cols, request.rows);
		let live: Live | undefined;
		let child: PseudoTerminal;
		try {
			child = startTerminal({
				argv: start.argv,
				cwd: request.worktree,
				env: withChanges(sessionEnvironment(environment, handoff), start.environment, start.unset),
				cols,
				rows,
				data: text => {
					if (!live) return;
					take(live, text);
					if (live.pending.length >= PART_LIMIT) flush(live);
					else live.flushTimer ??= setTimeout(() => flush(live!), flushMilliseconds);
				},
			});
		} catch (error) {
			return { outcome: "failed", command: start.command, message: `Could not start ${shell} in ${request.worktree}: ${messageOf(error)}` };
		}

		const session: TerminalSession = {
			id: crypto.randomUUID(),
			kind: start.kind,
			name,
			repository: request.repository,
			worktree: listed.worktree.id,
			path: request.worktree,
			shell,
			command: start.command,
			state: { kind: "running" },
			status: null,
		};
		const ended = child.exited.then(async () => {
			// Output can still be on its way after the shell ended. A program left in the background can hold the terminal open, so do not wait for long.
			await Promise.race([child.drained, wait(DRAIN_MILLISECONDS)]);
			child.close();
			if (!live) return;
			// What the shell left running is hung up on, as when a terminal closes. A program started with nohup goes on; closing the session ends it too.
			// On Windows closing the pseudo console above already hung up on what was attached to it.
			hangUp(live);
			live.leftovers = sessionMembers(child.pid) ?? [];
			// The exit is told in one change with the status: working and blocked end with the process.
			live.records.exited();
			live.statusChanged = false;
			flush(live);
			// A session closed meanwhile is already gone and stays gone.
			if (sessions.get(session.id) !== live) return;
			const end = child.ended() ?? { exitCode: null, signal: null };
			live.pasteMode.reset();
			changed(live, { ...live.session, state: { kind: "exited", ...end }, status: live.records.root() });
		});
		live = { session, process: child, scrollback: createScrollback(), pending: "", flushTimer: null, undrawn: [], undrawnSize: 0, held: false, leftovers: null, ended, scanner: createStatusScanner(), records: createStatusRecords(), pasteMode: createPasteModeScanner(), statusChanged: false, probedAt: Number.NEGATIVE_INFINITY };
		sessions.set(session.id, live);
		changed(live, session);
		return { outcome: "opened", session: { ...session } };
	}

	/** Kill the shell, if it still runs, and what is left in its session. */
	function killLeftovers(live: Live): void {
		// Windows has no session to signal. Its process tree is followed by parent ids, so it is reachable only while the shell runs.
		if (windows) {
			if (running(live.process)) killProcessTree(live.process.pid, environment);
		} else signalSession(live, "SIGKILL");
		if (running(live.process)) live.process.kill();
	}

	/** Whether the shell ended and nothing is left in its session that may be signalled. */
	const settled = (live: Live) => !running(live.process) && (members(live)?.length ?? 0) === 0;

	async function close(id: string): Promise<void> {
		const live = sessions.get(id);
		if (!live) return;
		sessions.delete(id);
		if (live.flushTimer !== null) clearTimeout(live.flushTimer);
		// Hanging up the terminal sends SIGHUP to the shell and what runs in front; the rest of its session gets it too.
		// On Windows it closes the pseudo console, and every process attached to it is told to close.
		live.process.close();
		hangUp(live);
		// Everything gets the same time to clean up, not only the shell.
		const deadline = Date.now() + closeMilliseconds;
		while (!settled(live) && Date.now() < deadline) await wait(Math.min(50, closeMilliseconds));
		killLeftovers(live);
		await live.process.exited;
		await live.ended;
		changed(live, null);
	}

	return {
		list: () => [...sessions.values()].map(live => ({ ...live.session })),
		open,
		rename(id, name) {
			const live = sessions.get(id);
			const clean = cleanSessionName(name);
			if (!live || clean === null) return null;
			if (clean !== live.session.name) changed(live, { ...live.session, name: clean });
			return { ...live.session };
		},
		read(id) {
			const live = sessions.get(id);
			if (!live) return null;
			flush(live);
			return live.scrollback.snapshot();
		},
		drawn(id, seq) {
			const live = sessions.get(id);
			if (!live || !Number.isInteger(seq)) return;
			while (live.undrawn.length > 0 && live.undrawn[0]!.seq <= seq) live.undrawnSize -= live.undrawn.shift()!.size;
			if (!live.held || live.undrawn.length > 0) return;
			// Caught up: what was kept meanwhile, up to now, replaces the screen in one part.
			flush(live);
			live.held = false;
			const snapshot = live.scrollback.snapshot();
			send(live, { id, seq: snapshot.seq, data: snapshot.data, reset: true });
		},
		write(id, data) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running" || typeof data !== "string" || data === "") return;
			live.process.write(data);
		},
		paste(id, text) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running") return { outcome: "gone", message: "The session has ended." };
			if (live.session.kind !== "agent") return { outcome: "not-agent", message: "Only an agent session takes a pasted review." };
			const problem = pasteProblem(text);
			if (problem !== null) return { outcome: "refused", message: problem };
			if (!live.pasteMode.on()) return { outcome: "not-ready", message: PASTE_NOT_READY };
			live.process.write(bracketedPaste(text));
			return { outcome: "pasted" };
		},
		resize(id, cols, rows) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running") return;
			const size = clampTerminalSize(cols, rows);
			live.process.resize(size.cols, size.rows);
		},
		close,
		async closeAll() {
			await Promise.all([...sessions.keys()].map(close));
		},
		killAll() {
			for (const live of sessions.values()) {
				// Killed first: on Windows the process tree is found through the shell, which closing the pseudo console may end first.
				killLeftovers(live);
				live.process.close();
			}
			sessions.clear();
		},
		liveCount: () => [...sessions.values()].filter(live => live.session.state.kind === "running").length,
		leaders: () => [...sessions.values()]
			.filter(live => live.session.state.kind === "running")
			.map(live => ({ id: live.session.id, name: live.session.name, path: live.session.path, pid: live.process.pid })),
	};
}
