import { accessSync, constants, realpathSync } from "node:fs";
import { type ArenaLaunch, isArenaName, isAttemptLabel } from "../shared/arenas";
import { homedir } from "node:os";
import { type AgentSetting, agentCommand, conversationsOf, expandConfigFolder, findAgent } from "../shared/agent";
import type { AgentLocation, AgentLookup } from "../shared/agent-lookup";
import { type AgentId, type ConversationStore, agentById } from "../shared/agent-registry";
import { type ResumableAgent, agentProgram, agentStartArguments, conversationMissingNote, resumableAgent } from "../shared/agent-resume";
import { describeCommandLine } from "../shared/command-line";
import type { TimberStatus } from "../shared/model";
import {
	type EndedAgent, type OpenTerminalRequest, type OpenTerminalResult, type PasteModeScanner, type PasteResult, type PromptDelivery, type Scrollback, type SessionNaming, type TerminalChange, type TerminalOutput, type TerminalSession,
	type TerminalSnapshot, TERMINAL_UNSUPPORTED_REASON, WORKTREE_SETUP_SESSION_NAME, clampTerminalSize, cleanSessionName, createScrollback, defaultSessionName, pickShell,
	pickWindowsShell, sessionNameBase, agentEndedNote, PASTE_NOT_READY, CHOP_NOT_TYPED, chopRunBytes, createPasteModeScanner, pasteProblem, promptBytes,
} from "../shared/terminal";
import { recordsForWindow } from "../shared/session-status";
import { PROMPT_BUSY_MILLISECONDS, PROMPT_ENTER_MILLISECONDS, PROMPT_QUIET_MILLISECONDS, PROMPT_STILL_STARTING, PROMPT_WAIT_MILLISECONDS, isReadyForPrompt, promptEndedMessage, promptNotReadyMessage } from "../shared/agent-prompt";
import { PROBE_ANSWER, type StatusRecords, type StatusScanner, createStatusRecords, createStatusScanner } from "../shared/program-status";
import { HANDOFF_VARIABLE } from "../shared/handoff";
import { STATUS_VARIABLE, type StatusLine, statusFromLine } from "../shared/status-hooks";
import { asWin32KeyEvents } from "../shared/win32-input";
import { type RestoreTag, isConversationId, isRestoreTag } from "../shared/saved-sessions";
import { type Workflow, type WorkflowList, isWorkflowName } from "../shared/workflows";
import { worktreeSetupArguments } from "../shared/worktree-commands";
import { conversationExists, conversationFolder } from "./agent-conversations";
import { endedKey } from "./session-layout";
import { type ExecutableWords, findExecutable, isWindowsBatch, locateAgent } from "./find-executable";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { killProcessTree, sessionMembers, signalEach, signalGroup } from "./process-session";
import { type PseudoTerminal, type StartPseudoTerminal, startPseudoTerminal } from "./pseudo-terminal";
import { messageOf } from "../shared/error-message";

/** How long a closed session's processes get to end after a hang-up, before they are killed. */
const CLOSE_MILLISECONDS = 2000;
/** Output is gathered this long before it is sent, so a busy program sends a few large parts, not many small ones. */
const FLUSH_MILLISECONDS = 4;
/** A part is sent at once when it reaches this many code units. */
export const PART_LIMIT = 64 * 1024;
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
/**
 * The longest a chop's shell gets to turn on bracketed paste before the chop
 * is typed line by line instead, while it prints nothing. Long enough for
 * slow startup files, such as a version manager's.
 */
const CHOP_WAIT_MILLISECONDS = 5000;
/**
 * Once the shell printed something, such as its prompt, how long it must
 * stay quiet without turning on bracketed paste before the chop is typed
 * line by line. A shell that never turns it on, such as dash, or
 * PowerShell on Windows, waits about this long on each run, not the
 * longest wait.
 */
const CHOP_QUIET_MILLISECONDS = 300;

export interface TerminalDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). Asked when the kept listing is not enough. */
	findRepository: FindRepository;
	/**
	 * The repository in the app's list, perhaps from its last listing (see
	 * `RepositoryList.findKnown`). Opening a session asks this first, except
	 * for a Timber command such as Setup, which reads again. Left out, every
	 * session reads again.
	 */
	findKnownRepository?: FindRepository;
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
	/** The environment the app was started with. The shell gets it as `sessionEnvironment` changes it. */
	environment?: Record<string, string | undefined>;
	/**
	 * The folder where `timber new` typed in a session hands the app the
	 * worktree it created (see ./handoffs.ts), or null when there is none.
	 * Waited for before a session starts, so one opened while the app starts
	 * gets it too. Every session gets it as `TIMBER_APP_HANDOFF`; one
	 * inherited from the app's own environment is never passed on.
	 */
	handoffFolder?: () => Promise<string | null>;
	/**
	 * The folder where status hooks leave what their agent did (see
	 * ./status-files.ts), or null when there is none. Each session gets a file
	 * of its own there, as `TIMBER_APP_STATUS`, made before it starts and
	 * deleted when it ends; one inherited from the app's own environment is
	 * never passed on. Lines come back through `TerminalSessions.hookLine`.
	 */
	statusFolder?: () => Promise<{ add(session: string): string | null; remove(session: string): void } | null>;
	/** The operating system, as `process.platform` names it. Tests pass another. */
	platform?: NodeJS.Platform;
	/**
	 * How a session's program starts in a pseudo terminal, or null where
	 * there is none: see `startPseudoTerminal` in ./pseudo-terminal.ts. Tests
	 * pass null to see the refusal, or another way to start.
	 */
	startTerminal?: StartPseudoTerminal | null;
	/**
	 * Whether an agent's own conversation is still there, in the folder the
	 * session's agent keeps them in, and a new id for one that starts fresh
	 * (see ./agent-conversations.ts). The folder is the row's config folder
	 * from Settings, else the one `environment` names, else the agent's
	 * folder in the home folder.
	 */
	conversations?: {
		exists: (store: ConversationStore, id: string, folder: string) => boolean;
		newId: () => string;
	};
	/** The clock, for when a session started. */
	now?: () => number;
	/** Tests change the waits and the limit. */
	closeMilliseconds?: number;
	flushMilliseconds?: number;
	undrawnLimit?: number;
	chopWaitMilliseconds?: number;
	chopQuietMilliseconds?: number;
	promptWaitMilliseconds?: number;
	promptQuietMilliseconds?: number;
	promptEnterMilliseconds?: number;
	promptBusyMilliseconds?: number;
}

/**
 * A chop to start a new session with (see `TerminalSessions.open`): a
 * command chop typed into a new shell named after it, or a prompt chop sent
 * to a new agent once it is ready (see ../shared/agent-prompt.ts).
 */
export type ChopInput =
	/** `name` names the session. `text` is as `pasteProblem` accepts it. */
	| { kind: "command"; name: string; text: string }
	/**
	 * `text` is as `pasteProblem` accepts it. The session is named as any
	 * agent's. With `review`, the text is a review from the window
	 * (`OpenTerminalRequest.review`), pasted with no Enter.
	 */
	| { kind: "prompt"; text: string; review?: boolean };

/** The main process side of terminal sessions. A worktree can have several. */
export interface TerminalSessions {
	/** Every session, running or exited, in the order they started. */
	list(): TerminalSession[];
	/**
	 * Start another shell, an agent from Settings, or a workflow's agent, in a
	 * listed worktree, beside the sessions it has. With `chop`, the shell
	 * starts named after the chop, and the chop's text is typed into it and
	 * run (`chopRunBytes` in ../shared/terminal.ts): as one bracketed paste
	 * and Enter as soon as the shell turns bracketed paste on, or line by line
	 * once its output is quiet without it. With a prompt chop, the request
	 * names an agent, which starts as usual with nothing added to its command
	 * line, and the prompt is sent to it once it is ready
	 * (`isReadyForPrompt`), as one paste and then Enter. The session's
	 * `prompt` says how that stands. Only the main process passes `chop`; the
	 * interface's `openTerminal` never does. A request's `review` is taken as
	 * a prompt pasted with no Enter, once the agent is ready in the same way.
	 * With `editor`, the saved terminal editor starts in place of the shell,
	 * as a session of kind "editor" that goes on as the shell when the editor quits. Only
	 * "Open in editor" passes it, and the request then names nothing else.
	 */
	open(request: OpenTerminalRequest, chop?: ChopInput, editor?: AgentLaunch): Promise<OpenTerminalResult>;
	/** Whether each saved agent's executable is there to start, looked for as `open` looks for it. Nothing starts. */
	locateAgents(): Promise<AgentLocation[]>;
	/** Whether one agent's executable is there to start, looked for as `open` looks for it, on the PATH the app was started with. Nothing starts. */
	locateAgent(agent: AgentSetting): AgentLookup;
	/**
	 * The agent of the registry each saved agent runs, in the order saved, as
	 * `open` would tell it: the one picked for its row, else the one its
	 * executable is by name. Nothing starts.
	 */
	savedPrograms(): Promise<{ name: string; agent: AgentId | null }[]>;
	/**
	 * A line a status hook left in a session's file (see ./status-files.ts).
	 * Taken as a report of the session's root record, with the state the
	 * registry gives the event, unless the session is gone or ended, runs
	 * another agent of the registry, or reports through its own stream.
	 */
	hookLine(id: string, line: StatusLine): void;
	/** Give a session another name. Null for a session that is gone, or a name with nothing in it. */
	rename(id: string, name: string): TerminalSession | null;
	/** The end of what a session printed. Null for a session that is gone. */
	read(id: string): TerminalSnapshot | null;
	/** The window drew a session's parts up to and including `seq`. */
	drawn(id: string, seq: number): void;
	/** Pass typed text on to a running session. Anything else is ignored. */
	write(id: string, data: string): void;
	/**
	 * Paste text into a running session, with no Enter (`pasteBytes` in
	 * ../shared/terminal.ts): one bracketed paste when its program asked for
	 * bracketed paste, a text of one line as it is when it did not. Nothing
	 * is written for a text with a line break the program cannot take as
	 * part of it, or one a paste must not hold (`pasteProblem`).
	 */
	paste(id: string, text: string): PasteResult;
	/**
	 * Send a prompt to a running agent session of the worktree at
	 * `worktreePath` in `repository` (its primary checkout), as typed input:
	 * the paste as `paste` writes it, then Enter a moment later. It goes at
	 * once, also while the agent is busy. Refused, with nothing written, as
	 * `paste` refuses, for a session that is not an agent's or is in another
	 * worktree or repository, and for an agent still waiting to be ready for
	 * a prompt of its own, which may be on a first-run screen.
	 */
	sendPrompt(id: string, repository: string, worktreePath: string, text: string): PasteResult;
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
	/** Every running terminal and agent session in chip order, as the quit save needs them. */
	running(): RunningSession[];
	/**
	 * When the last session of each agent of the registry ended or closed in
	 * each worktree in this run, for the quit save, keyed by `endedKey`.
	 */
	endedAgents(): ReadonlyMap<string, number>;
}

/** A running session and the process that leads its process session. */
export interface SessionLeader {
	id: string;
	name: string;
	/** The worktree's registered path. */
	path: string;
	pid: number;
}

/** A running terminal or agent session, as the quit save needs it (see ./session-layout.ts). */
export interface RunningSession {
	id: string;
	/** The worktree's id (`Worktree.id`). */
	worktree: string;
	/** The worktree's registered path, where the session started. */
	path: string;
	kind: "terminal" | "agent";
	/** The agent's name in Settings, for an agent. */
	agent: string | null;
	/** Whether, and how, the agent can go back to its conversation. */
	resumable: ResumableAgent | null;
	/**
	 * The agent of the registry it runs, however it was started: the one
	 * picked for its row in Settings, else the one its executable is by name.
	 * A Codex or Cursor CLI started as typed still counts when their conversations are told apart at quit.
	 */
	program: ResumableAgent | null;
	/** The agent's own conversation id, when it is known. */
	conversation: string | null;
	/** Where its agent keeps its conversations, as a full path, as it was when it started; null for an agent that keeps none the app reads. */
	conversationFolder: string | null;
	startedAt: number;
	/** The session's name, only when the person gave it one. */
	name: string | null;
	/** The saved session it opened again, when it did. */
	restored: RestoreTag | null;
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
	/**
	 * For a session that went on as a shell after its agent ended: the agent's
	 * process and what it left running, which closing the session still
	 * signals. Null otherwise.
	 */
	former: { pid: number; leftovers: number[] } | null;
	ended: Promise<void>;
	/** What a new program in this session starts with: the environment before an arena attempt's own changes. */
	environment: Record<string, string | undefined>;
	/** The size the pane last asked for, for a shell that starts in place of an agent that ended. */
	cols: number;
	rows: number;
	/** What the session was launched as: the agent's name in Settings, the workflow's, or the attempt's label. */
	launchName: string;
	/** Reads OSC 7501 reports, OSC 133 prompts, and full resets out of the output. */
	scanner: StatusScanner;
	records: StatusRecords;
	/** Whether the program asked for bracketed paste (mode 2004), read from all of its output. */
	pasteMode: PasteModeScanner;
	/** When the last probe was answered. A flood of probes, such as from a file shown with `cat`, gets one answer at a time. */
	probedAt: number;
	/** A record, the root or a child, changed since the window was last told. Told with the next flush, so a stream of progress is one change per part. */
	statusChanged: boolean;
	/**
	 * The program in the session reported through its own stream since it
	 * started, or since the last new prompt or full reset. A status hook's
	 * line is dropped meanwhile: the agent reports natively.
	 */
	native: boolean;
	/** A chop's text still to type, and the timer that types it line by line if bracketed paste never comes. Null once typed, or for any other session. */
	chop: { text: string; timer: ReturnType<typeof setTimeout> | null; deadline: number } | null;
	/** The agent's name in Settings, or null for a shell or a Timber command. */
	agent: string | null;
	resumable: ResumableAgent | null;
	program: ResumableAgent | null;
	/** The agent's own conversation id, when it is known. */
	conversation: string | null;
	conversationFolder: string | null;
	startedAt: number;
	/** Whether the name is one the person gave, not a default. */
	renamed: boolean;
	restored: RestoreTag | null;
	/**
	 * A prompt chop's text, or a review, still to send to a new agent, with
	 * what tells when it is ready: whether it probed, and when it last
	 * printed. A review is pasted with no Enter. Null once sent or dropped,
	 * or for any other session.
	 */
	prompt: { text: string; review: boolean; timer: ReturnType<typeof setTimeout> | null; deadline: number; probed: boolean; lastOutput: number; pasteOnSince: number | null } | null;
}

/**
 * An agent's executable and arguments, ready to be looked up on the PATH:
 * from Settings, from a workflow, or from an arena attempt. It also
 * carries a terminal editor started by Open in editor.
 */
export interface AgentLaunch {
	/** The session's base name, and the name in messages: the agent's name, the workflow's, the attempt's label, or the editor's executable. */
	name: string;
	executable: string;
	arguments: string[];
	/** For the messages when the executable is not found. */
	words: ExecutableWords;
	/** Where to change the command, for the batch-file message, such as "Settings, Agents". */
	section: string;
	/** Other names to look for when the executable is not on the PATH, such as `zeditor` for `zed`. */
	otherNames?: readonly string[];
	/** "editor" for the person's terminal editor: a session of that kind, not an agent. Only "Open in editor" starts one. */
	kind?: "editor";
	/** The session is named `name` as it is, not by the naming setting: an arena attempt, named by its label everywhere. */
	fixedName?: boolean;
	/** Set on top of the session's environment, and taken out of it, as Timber asks for an arena attempt. */
	environment?: Record<string, string>;
	unset?: string[];
	/** For an agent from Settings: the agent picked for its row, and its config folder as typed. */
	chosen?: AgentSetting["agent"];
	configFolder?: string;
}

/** An agent from Settings, its command split without a shell (`agentCommand` in ../shared/agent.ts). */
function launchOfSetting(agent: AgentSetting): { ok: true; launch: AgentLaunch } | { ok: false; result: OpenTerminalResult } {
	const built = agentCommand(agent);
	if (!built.ok) return { ok: false, result: { outcome: "failed", message: `${built.message} Change it in Settings, Agents. Nothing was started.` } };
	const section = "Settings, Agents";
	return {
		ok: true,
		launch: {
			name: agent.name, executable: built.executable, arguments: built.arguments, words: { what: agent.name, command: `The command of ${agent.name}`, section }, section,
			...(agent.agent !== undefined ? { chosen: agent.agent } : {}),
			...(agent.configFolder ? { configFolder: agent.configFolder } : {}),
		},
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
	return membersOf({ pid: live.process.pid, leftovers: live.leftovers });
}

/** The members of one process's session that may be signalled now, given what was left when it ended (null while it runs). */
function membersOf(leader: { pid: number; leftovers: number[] | null }): number[] | null {
	const now = sessionMembers(leader.pid);
	if (now === null || leader.leftovers === null) return now;
	return now.filter(pid => leader.leftovers!.includes(pid));
}

/**
 * Signal everything in a session. Where members cannot be listed, the shell's
 * process group stands in, but only while the shell runs, because only then
 * is that group surely its own.
 */
function signalSession(live: Live, signal: NodeJS.Signals): void {
	// What an agent that ended left running goes on being signalled, though the session is a shell now.
	if (live.former !== null) signalEach(membersOf(live.former) ?? [], signal);
	const now = members(live);
	if (now !== null) signalEach(now, signal);
	else if (running(live.process)) signalGroup(live.process.pid, signal);
}

/**
 * Variables by which another terminal or multiplexer tells a program it runs
 * inside it, as they are when the app was started from there, such as `bun
 * run dev` in a tmux pane. The app's sessions are not in it, and with any one
 * of these Grok Build 1.0.92 takes a session for that terminal and never asks
 * whether it reads OSC 7501, so it reports no status (issue 355). Those that
 * did not stop it, such as kitty's, are passed on. So is VS Code's
 * `VSCODE_GIT_ASKPASS_MAIN`, which did, since Git asks for a password through
 * it (see docs/architecture.md, "Agent status").
 */
export const SILENCING_VARIABLES = [
	"ALACRITTY_SOCKET", "CURSOR_TRACE_ID", "HERDR_ENV", "STY", "TERMINAL_EMULATOR", "TERMINATOR_UUID", "TERM_SESSION_ID", "TMUX", "VTE_VERSION", "WT_SESSION", "ZELLIJ", "ZELLIJ_SESSION_NAME",
] as const;
/** What says nothing without one of those, or names the version of a `TERM_PROGRAM` that is replaced. None stopped Grok Build by itself. */
const COMPANION_VARIABLES = ["ALACRITTY_WINDOW_ID", "TERM_PROGRAM_VERSION", "TMUX_PANE", "ZELLIJ_PANE_ID"] as const;
/** What no session gets from the app's own environment. */
export const OTHER_TERMINAL_VARIABLES = [...SILENCING_VARIABLES, ...COMPANION_VARIABLES] as const;

/** What a session's program gets: the app's environment without `OTHER_TERMINAL_VARIABLES`, with the terminal's own variables, the handoff folder, and the session's status file. */
export function sessionEnvironment(environment: Record<string, string | undefined>, handoff: string | null, status: string | null = null): Record<string, string | undefined> {
	const env: Record<string, string | undefined> = { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "timber-app" };
	for (const name of OTHER_TERMINAL_VARIABLES) delete env[name];
	// A folder or file from the app's own environment, as when it was started from one of its terminals, belongs to another run or session.
	delete env[HANDOFF_VARIABLE];
	delete env[STATUS_VARIABLE];
	if (handoff !== null) env[HANDOFF_VARIABLE] = handoff;
	if (status !== null) env[STATUS_VARIABLE] = status;
	return env;
}

/**
 * Terminal sessions owned by the main process.
 *
 * - A session is the person's shell (`SHELL`, or `/bin/sh`) in a pseudo
 *   terminal (`Bun.Terminal`), started in the worktree's folder with the
 *   app's environment, without `OTHER_TERMINAL_VARIABLES`,
 *   `TERM=xterm-256color`, and the handoff folder in `TIMBER_APP_HANDOFF`
 *   (see `sessionEnvironment`). The shell leads a session of processes of
 *   its own.
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
 * - An editor session starts the person's terminal editor from Settings in
 *   place of the shell, in the worktree, found on the PATH as the editor
 *   launcher finds it (see ./editor.ts). Only "Open in editor" starts one,
 *   with the command it built, so the window's request cannot. When the
 *   editor quits, the session goes on as the person's shell, as an agent's
 *   does, with no `endedAgent` mark. It is not saved or started again after
 *   a restart as an editor; the shell it became is saved as any shell.
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
 * - A session opened again after a restart may bring the name the person
 *   gave it, and an agent the id of its own conversation. An agent of the
 *   registry with a `resume` goes back to it with its own words (Claude
 *   Code's `--resume <id>`, Codex's `resume <id>`), only when the
 *   conversation is still in the agent's own folder; otherwise the agent
 *   starts fresh and its terminal says so. A fresh agent that takes the id
 *   of a new conversation (Claude Code, Grok Build) gets one, so its
 *   conversation is known from the start. The id is read only as a UUID,
 *   and only ever follows a flag the app adds itself (see
 *   ../shared/agent-resume.ts). A command that already picks a
 *   conversation, or any other agent, starts as typed.
 * - Output is kept, up to `SCROLLBACK_LIMIT`, so the interface can draw a
 *   session again, and is sent in numbered parts, never far ahead of what
 *   the window drew (`UNDRAWN_LIMIT`).
 * - When the shell ends by itself, what it left running is hung up on, as a
 *   terminal does when it closes. The session stays, with how it ended,
 *   until it is closed.
 * - When an agent's process ends by itself (not a Timber setup command, and
 *   not closed from the app), the same session goes on as the person's shell
 *   in the worktree's folder, so the chip stays usable. It keeps its id and
 *   name, and what the agent printed stays above, followed by a note. It
 *   becomes a terminal session: it counts as one, and a restart opens it as a
 *   terminal. What the agent ended with stays on the session as `endedAgent`.
 *   What the agent left running is still hung up on and still ended when the
 *   session is closed. The shell starts in the same step as the swap, so no
 *   typed text, and no Enter of a prompt that was waiting, reaches the wrong
 *   program. A shell that exits later stays exited, with no second shell. If
 *   the shell cannot start, the session ends as an agent's did before.
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
		findRepository, findKnownRepository, onOutput, onChange, agents = async () => [], sessionNaming = async (): Promise<SessionNaming> => "plain", timber = async (): Promise<TimberStatus> => ({ state: "not-found", source: "path", path: null }), environment = process.env, handoffFolder = async () => null, statusFolder = async () => null, platform = process.platform,
		arenaLaunch = async () => ({ outcome: "failed", message: "Arena attempts cannot start here. Nothing was started." }),
		workflows = async (): Promise<WorkflowList> => ({ ok: false, message: "Workflows cannot be read here." }),
		startTerminal = startPseudoTerminal(platform),
		closeMilliseconds = CLOSE_MILLISECONDS, flushMilliseconds = FLUSH_MILLISECONDS, undrawnLimit = UNDRAWN_LIMIT, chopWaitMilliseconds = CHOP_WAIT_MILLISECONDS, chopQuietMilliseconds = CHOP_QUIET_MILLISECONDS,
		now = Date.now,
		promptWaitMilliseconds = PROMPT_WAIT_MILLISECONDS, promptQuietMilliseconds = PROMPT_QUIET_MILLISECONDS, promptEnterMilliseconds = PROMPT_ENTER_MILLISECONDS, promptBusyMilliseconds = PROMPT_BUSY_MILLISECONDS,
	} = dependencies;
	const conversations = dependencies.conversations ?? {
		exists: (store: ConversationStore, id: string, folder: string) => conversationExists[store](id, folder),
		newId: () => crypto.randomUUID(),
	};
	const windows = platform === "win32";
	/** ConPTY drops an OSC written as it is, so on Windows the answer goes in as typed keys. */
	const probeAnswer = windows ? asWin32KeyEvents(PROBE_ANSWER) : PROBE_ANSWER;
	const sessions = new Map<string, Live>();

	/** Whether an agent can start, as `open` would find it: on the PATH the app was started with. */
	function lookAt(agent: AgentSetting): AgentLookup {
		return locateAgent(agent, environment.PATH ?? environment.Path ?? "", windows);
	}

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
		if (live.prompt !== null) live.prompt.lastOutput = Date.now();
		// The shell reads its command line now: the chop goes in whole.
		if (live.chop !== null && live.pasteMode.on() && live.session.state.kind === "running") typeChop(live);
		// The shell printed but has not asked: once it stays quiet, it is waiting at a prompt that takes no paste.
		else if (live.chop !== null) waitForChop(live, Math.min(chopQuietMilliseconds, live.chop.deadline - Date.now()));
		for (const event of live.scanner.scan(text)) {
			if (event.type === "probe") {
				if (live.prompt !== null) live.prompt.probed = true;
				const now = Date.now();
				if (live.session.state.kind === "running" && now - live.probedAt >= PROBE_INTERVAL_MILLISECONDS) {
					live.probedAt = now;
					live.process.write(probeAnswer);
				}
			} else {
				// A report from the stream says the program reports natively; a new prompt or a reset ends that, as it ends the records.
				if (event.type === "report" && event.report !== null) live.native = true;
				else if (event.type === "prompt" || event.type === "reset") live.native = false;
				if (live.records.apply(event)) live.statusChanged = true;
			}
		}
		live.pending += text;
		if (live.prompt !== null) considerPrompt(live);
	}

	/**
	 * Write text into a running session as a paste, and with `enter`, Enter a
	 * moment later, once the program read the paste whole. The one way text
	 * goes to an agent: a review (with no Enter) and a prompt chop both come
	 * here. `onEntered` hears whether the Enter went, which it does not when
	 * the session ended or closed meanwhile.
	 */
	function deliver(live: Live, text: string, enter: boolean, onEntered?: (entered: boolean) => void): PasteResult {
		const problem = pasteProblem(text);
		if (problem !== null) return { outcome: "refused", message: problem };
		const bytes = promptBytes(text, live.pasteMode.on());
		if (bytes === null) return { outcome: "not-ready", message: PASTE_NOT_READY };
		live.process.write(bytes.paste);
		if (enter) {
			// The Enter belongs to the program that got the paste, not to a shell that took the session over.
			const target = live.process;
			setTimeout(() => {
				const still = sessions.get(live.session.id) === live && live.session.state.kind === "running" && live.process === target;
				if (still) live.process.write(bytes.enter);
				onEntered?.(still);
			}, promptEnterMilliseconds);
		}
		return { outcome: "pasted" };
	}

	/** Say how a session's prompt stands, unless the session is gone. */
	function promptChanged(live: Live, prompt: PromptDelivery): void {
		if (sessions.get(live.session.id) === live) changed(live, { ...live.session, prompt });
	}

	/**
	 * Send a new agent its prompt if it is ready (`isReadyForPrompt`),
	 * otherwise look again once it may be: after the quiet it needs, or at
	 * the deadline, when the prompt is dropped and the session says why.
	 */
	function considerPrompt(live: Live): void {
		const prompt = live.prompt;
		if (prompt === null) return;
		if (prompt.timer !== null) clearTimeout(prompt.timer);
		prompt.timer = null;
		if (sessions.get(live.session.id) !== live || live.session.state.kind !== "running") return;
		const now = Date.now();
		const quiet = now - prompt.lastOutput;
		const pasteOn = live.pasteMode.on();
		if (!pasteOn) prompt.pasteOnSince = null;
		else prompt.pasteOnSince ??= now;
		const pasteOnFor = prompt.pasteOnSince === null ? 0 : now - prompt.pasteOnSince;
		const what = prompt.review ? "review" : "prompt";
		const tag = prompt.review ? { what: "review" as const } : {};
		if (isReadyForPrompt({ probed: prompt.probed, status: live.records.root(), pasteOn, quietMilliseconds: quiet, pasteOnMilliseconds: pasteOnFor }, promptQuietMilliseconds, promptBusyMilliseconds)) {
			// A review is pasted with no Enter: it is sent once the paste is written.
			const sent = deliver(live, prompt.text, !prompt.review, entered => promptChanged(live, entered ? { state: "sent" } : { state: "not-sent", message: promptEndedMessage(live.session.name) }));
			// A prompt with a line break waits for bracketed paste, until the deadline.
			if (sent.outcome === "pasted") {
				live.prompt = null;
				if (prompt.review) promptChanged(live, { state: "sent", ...tag });
				return;
			}
		}
		const left = prompt.deadline - now;
		if (left <= 0) {
			live.prompt = null;
			promptChanged(live, { state: "not-sent", message: promptNotReadyMessage(live.session.name, promptWaitMilliseconds, what), ...tag });
			return;
		}
		// An agent that never probed is looked at again once it may have gone quiet, or been on long enough.
		const waits = prompt.probed || !pasteOn ? [] : [promptQuietMilliseconds - quiet, promptBusyMilliseconds - pasteOnFor].filter(wait => wait > 0);
		const next = Math.min(left, ...waits);
		prompt.timer = setTimeout(() => considerPrompt(live), next);
	}

	/**
	 * Type the chop still waiting in a session, once: as a bracketed paste
	 * while the shell asked for one, otherwise line by line. A text the shell
	 * would mangle without one is not typed, and the session says why.
	 */
	function typeChop(live: Live): void {
		const chop = live.chop;
		if (chop === null) return;
		if (chop.timer !== null) clearTimeout(chop.timer);
		live.chop = null;
		const bytes = chopRunBytes(chop.text, live.pasteMode.on());
		if (bytes !== null) {
			live.process.write(bytes);
			return;
		}
		live.pending += `\r\n\x1b[2m${CHOP_NOT_TYPED}\x1b[0m\r\n`;
		live.flushTimer ??= setTimeout(() => flush(live), flushMilliseconds);
	}

	/** Type the waiting chop after `milliseconds`, line by line unless the shell asked for bracketed paste meanwhile. */
	function waitForChop(live: Live, milliseconds: number): void {
		const chop = live.chop;
		if (chop === null) return;
		if (chop.timer !== null) clearTimeout(chop.timer);
		chop.timer = setTimeout(() => {
			if (sessions.get(live.session.id) === live && live.session.state.kind === "running") typeChop(live);
		}, Math.max(0, milliseconds));
	}

	/** Forget a chop not typed yet, or a prompt not sent yet, for a session that ended or closed. */
	function dropChop(live: Live): void {
		if (live.chop?.timer) clearTimeout(live.chop.timer);
		live.chop = null;
		if (live.prompt?.timer) clearTimeout(live.prompt.timer);
		live.prompt = null;
	}

	function flush(live: Live): void {
		if (live.flushTimer !== null) clearTimeout(live.flushTimer);
		live.flushTimer = null;
		if (live.statusChanged) {
			live.statusChanged = false;
			// A session closed meanwhile is already gone and stays gone.
			if (sessions.get(live.session.id) === live) changed(live, { ...live.session, ...recordsForWindow(live.records) });
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
		| {
			ok: true; kind: TerminalSession["kind"]; base: string; argv: string[]; command: string; environment?: Record<string, string>; unset?: string[];
			resumable: ResumableAgent | null; conversation: string | null;
			/** The agent of the registry it runs, however it was started: the one picked in Settings, else the one its executable is by name. */
			program: ResumableAgent | null;
			/** Where that agent keeps its conversations, as a full path, or null. */
			conversationFolder: string | null;
			/** A conversation was asked for and could not be gone back to. */
			missing: boolean;
		}
		| { ok: false; result: OpenTerminalResult };

	const plain = { resumable: null, conversation: null, missing: false, program: null, conversationFolder: null } as const;

	/**
	 * What a session starts with. `resume` is a saved conversation, and
	 * `settings` says the launch is an agent from Settings: only such an agent
	 * gets the words that pick its conversation, never a workflow's own agent
	 * or an arena attempt, whose commands come from Timber.
	 */
	function startOf(launch: AgentLaunch | null, run: TimberRun | null, resume: string | null, settings: boolean): Start {
		if (run !== null) {
			const argv = [run.timber, ...run.arguments];
			return { ok: true, kind: "timber", base: run.name, argv, command: describeCommandLine(argv), ...plain };
		}
		if (launch === null) {
			const shell = shellOf();
			return { ok: true, kind: "terminal", base: "Terminal", argv: [shell], command: describeCommandLine([shell]), ...plain };
		}
		const command = describeCommandLine([launch.executable, ...launch.arguments]);
		const lookup = findExecutable(launch.executable, environment.PATH ?? environment.Path ?? "", launch.words, launch.otherNames);
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
		if (launch.kind === "editor") return { ok: true, kind: "editor", base: launch.name, argv, command: describeCommandLine(argv), ...plain };
		// What the found file leads to tells a name other programs install too, such as `agent`. The agent still starts as found, since some read the name they were started as.
		const real = realPathOf(lookup.path);
		// An agent picked for the row in Settings takes the place of the name.
		const program = agentProgram(launch.executable, real, settings ? launch.chosen : null);
		const kept = conversationsOf(program === null ? null : agentById(program));
		const home = environment.HOME || homedir();
		// The row's config folder, for an agent that keeps its conversations in one: the agent starts with its variable set to it, and is looked for there.
		const own = settings && kept !== null ? expandConfigFolder(launch.configFolder, home) : null;
		const folder = kept === null ? null : own ?? conversationFolder(kept, environment, home);
		const environmentSet = own !== null && kept !== null ? { ...launch.environment, [kept.folderVariable]: own } : launch.environment;
		const extra = { ...(environmentSet ? { environment: environmentSet } : {}), ...(launch.unset ? { unset: launch.unset } : {}) };
		if (!settings) return { ok: true, kind: "agent", base: launch.name, argv, command: describeCommandLine(argv), ...extra, ...plain, program, conversationFolder: folder };
		// The conversation is only ever checked in the agent's own folder, and only a UUID gets that far.
		const resumable = resumableAgent(launch.executable, launch.arguments, real, launch.chosen);
		const recipe = resumable === null ? null : agentById(resumable).resume;
		let conversation: string | null = null;
		let args = launch.arguments;
		if (recipe !== null && resume !== null && folder !== null && conversations.exists(recipe.conversations.store, resume, folder)) {
			args = agentStartArguments(resumable, args, { resume });
			conversation = resume;
		} else if (recipe?.fresh) {
			const fresh = conversations.newId();
			args = agentStartArguments(resumable, args, { fresh });
			conversation = fresh;
		}
		const started = [lookup.path, ...args];
		return { ok: true, kind: "agent", base: launch.name, argv: started, command: describeCommandLine(started), ...extra, resumable, conversation, missing: resume !== null && conversation !== resume, program, conversationFolder: folder };
	}

	/** The file a path leads to with every link followed, or null when that cannot be read. */
	function realPathOf(path: string): string | null {
		try {
			return realpathSync(path);
		} catch {
			return null;
		}
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

	/** A program started in a pseudo terminal, and the promise of its end having been taken care of. */
	interface StartedChild {
		child: PseudoTerminal;
		ended: Promise<void>;
	}

	/**
	 * Start a program for a session and watch it end. `owner` gives the
	 * session's record, which is not there yet while the first program of a
	 * session starts. Output of a program that is no longer the session's
	 * current one is ignored, so an agent that ended never mixes with the
	 * shell that took its place. Throws when it cannot start.
	 */
	function startChild(options: { argv: string[]; cwd: string; env: Record<string, string | undefined>; cols: number; rows: number }, owner: () => Live | undefined): StartedChild {
		if (startTerminal === null) throw new Error(TERMINAL_UNSUPPORTED_REASON);
		const child: PseudoTerminal = startTerminal({
			...options,
			data: text => {
				const live = owner();
				if (!live || live.process !== child) return;
				take(live, text);
				if (live.pending.length >= PART_LIMIT) flush(live);
				else live.flushTimer ??= setTimeout(() => flush(live), flushMilliseconds);
			},
		});
		const ended = child.exited.then(async () => {
			// Output can still be on its way after the shell ended. A program left in the background can hold the terminal open, so do not wait for long.
			await Promise.race([child.drained, wait(DRAIN_MILLISECONDS)]);
			child.close();
			const live = owner();
			if (!live || live.process !== child) return;
			// What the shell left running is hung up on, as when a terminal closes. A program started with nohup goes on; closing the session ends it too.
			// On Windows closing the pseudo console above already hung up on what was attached to it.
			hangUp(live);
			live.leftovers = sessionMembers(child.pid) ?? [];
			// The exit is told in one change with the status: working and blocked end with the process.
			live.records.exited();
			live.native = false;
			live.statusChanged = false;
			flush(live);
			// A session closed meanwhile is already gone and stays gone.
			if (sessions.get(live.session.id) !== live) return;
			const end = child.ended() ?? { exitCode: null, signal: null };
			const unsent = live.prompt;
			const notSent = unsent ? { prompt: { state: "not-sent" as const, message: promptEndedMessage(live.session.name, unsent.review ? "review" : "prompt"), ...(unsent.review ? { what: "review" as const } : {}) } } : {};
			dropChop(live);
			noteEnded(live);
			// An agent or a terminal editor goes on as the person's shell. Everything else, a shell and a Timber command, stays ended.
			if ((live.session.kind === "agent" || live.session.kind === "editor") && continueAsShell(live, child, end, notSent)) return;
			live.pasteMode.reset();
			releaseStatusFile(live);
			changed(live, { ...live.session, state: { kind: "exited", ...end }, ...recordsForWindow(live.records), ...notSent });
		});
		return { child, ended };
	}

	/**
	 * Put the person's shell in place of an agent or a terminal editor that
	 * ended by itself, in the same session. Nothing waits between the start
	 * and the swap. Returns false, and changes nothing, when the shell cannot
	 * start. Only an agent leaves `endedAgent` behind: an editor that quit is
	 * not a crash or a stop to mark, so its shell is a plain one.
	 */
	function continueAsShell(live: Live, old: PseudoTerminal, end: { exitCode: number | null; signal: string | null }, notSent: { prompt?: PromptDelivery }): boolean {
		const shell = shellOf();
		let started: StartedChild;
		try {
			started = startChild({ argv: [shell], cwd: live.session.path, env: live.environment, cols: live.cols, rows: live.rows }, () => live);
		} catch {
			return false;
		}
		const endedAgent: EndedAgent = {
			name: live.launchName, agent: live.agent, program: live.program, resumable: live.resumable, conversation: live.conversation,
			command: live.session.command, exitCode: end.exitCode, signal: end.signal,
		};
		// What the agent left running is still signalled when the session closes. On Windows there is nothing to follow.
		live.former = live.leftovers !== null && live.leftovers.length > 0 ? { pid: old.pid, leftovers: live.leftovers } : null;
		live.process = started.child;
		live.ended = started.ended;
		live.leftovers = null;
		live.scanner = createStatusScanner();
		live.records = createStatusRecords();
		live.native = false;
		live.pasteMode.reset();
		live.probedAt = Number.NEGATIVE_INFINITY;
		live.statusChanged = false;
		live.agent = null;
		live.resumable = null;
		live.program = null;
		live.conversation = null;
		live.conversationFolder = null;
		// The note goes after what the agent printed and is kept with it, so drawing the session again shows it too.
		live.pending += agentEndedNote(live.launchName, endedAgent, live.session.path);
		flush(live);
		// The agent's own name goes with it: the shell keeps its mark through `endedAgent`.
		const { program: _agentProgram, ...shellSession } = live.session;
		const mark = live.session.kind === "agent" ? { endedAgent } : {};
		changed(live, { ...shellSession, kind: "terminal", shell, command: describeCommandLine([shell]), state: { kind: "running" }, status: null, children: [], ...mark, ...notSent });
		return true;
	}

	async function open(request: OpenTerminalRequest, chop?: ChopInput, editor?: AgentLaunch): Promise<OpenTerminalResult> {
		if (startTerminal === null) return { outcome: "unsupported", message: TERMINAL_UNSUPPORTED_REASON };
		// An editor starts as itself: no agent, setup, workflow, attempt, chop, review, name, or earlier session goes with it.
		if (editor !== undefined && (chop !== undefined || request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined
			|| request.workflowAgent !== undefined || request.review !== undefined || request.resume !== undefined || request.restore !== undefined || request.name !== undefined)) {
			return { outcome: "failed", message: "The editor starts on its own, not with an agent, setup, a workflow, an arena attempt, or a chop. The editor was not started." };
		}
		// A command chop runs in the person's shell only.
		if (chop?.kind === "command" && (request.agent !== undefined || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined || request.workflowAgent !== undefined)) {
			return { outcome: "failed", message: "A chop runs in a shell, not with an agent, setup, a workflow, or an arena attempt. Nothing was started." };
		}
		if (chop?.kind === "command" && (cleanSessionName(chop.name) !== chop.name || pasteProblem(chop.text) !== null)) {
			return { outcome: "failed", message: "The chop cannot be typed into a shell. Nothing was started." };
		}
		// A prompt goes to an agent from Settings only, never to a shell, where Enter would run it.
		if (chop?.kind === "prompt" && (typeof request.agent !== "string" || request.timberWorktreeSetup !== undefined || request.arenaAttempt !== undefined || request.workflowAgent !== undefined)) {
			return { outcome: "failed", message: "A prompt goes to an agent from Settings only. Nothing was started." };
		}
		if (chop?.kind === "prompt" && pasteProblem(chop.text) !== null) return { outcome: "failed", message: "The prompt cannot be sent to an agent. Nothing was started." };
		// A review from the window goes to a fresh agent from Settings only, with no Enter, and never with a chop of the main process.
		if (request.review !== undefined) {
			const fresh = chop === undefined && typeof request.agent === "string" && request.timberWorktreeSetup === undefined && request.arenaAttempt === undefined
				&& request.workflowAgent === undefined && request.resume === undefined && request.restore === undefined;
			if (!fresh) return { outcome: "failed", message: "A review goes to a new agent from Settings only. Nothing was started." };
			const problem = pasteProblem(request.review);
			if (problem !== null) return { outcome: "failed", message: `The review cannot be pasted: ${problem} Nothing was started.` };
			chop = { kind: "prompt", text: request.review, review: true };
		}
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
		const naming = run === null && chop?.kind !== "command" ? await sessionNaming().catch((): SessionNaming => "plain") : "plain";
		const handoff = await handoffFolder().catch(() => null);
		const folder = await statusFolder().catch(() => null);
		const consequence = attempt.launch ? `${attempt.launch.name} was not started.`
			: agent ? `${agent.name} was not started.`
			: workflowAgent !== undefined ? `The agent of the ${workflowAgent.workflow} workflow was not started.`
			: editor ? "The editor was not started."
			: run ? `${run.what} was not started.` : chop?.kind === "command" ? `${chop.name} was not started.` : "No terminal was started.";
		// Only a session that runs a Timber command, which may change the repository, waits for Timber to list it again.
		const finders = run === null && findKnownRepository !== undefined ? { known: findKnownRepository, fresh: findRepository } : findRepository;
		const listed = await findListedWorktree(finders, request.repository, request.worktree, consequence);
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };
		// From here to the new session being kept nothing waits, so two sessions that start at once get different names.
		let launch = attempt.launch ?? workflowLaunch ?? editor ?? null;
		if (agent !== null) {
			const setting = launchOfSetting(agent);
			if (!setting.ok) return setting.result;
			launch = setting.launch;
		}
		// A conversation, a name, and a restore tag from before a restart are read only as a UUID, a clean name, and a tag, only for an agent from Settings or a shell, and never for a Timber command, an arena attempt, or a workflow's own agent.
		const ownLaunch = run === null && attempt.launch === null && editor === undefined && (agent !== null || workflowLaunch === null);
		const resume = ownLaunch && agent !== null && isConversationId(request.resume) ? request.resume : null;
		const savedName = ownLaunch && chop === undefined ? cleanSessionName(request.name) : null;
		const restored = ownLaunch && isRestoreTag(request.restore) ? { worktree: request.restore.worktree, index: request.restore.index } : null;
		const start = startOf(launch, run, resume, agent !== null);
		if (!start.ok) return start.result;
		if (chop?.kind === "prompt" && start.kind !== "agent") return { outcome: "failed", message: "A prompt goes to an agent only. Nothing was started." };
		// An attempt's session is named after its label, which is how the arena names it everywhere.
		// A chop's session is named after the chop, whatever the naming in Settings, as Setup is.
		const base = chop?.kind === "command" ? chop.name : savedName ?? (run === null && !launch?.fixedName ? sessionNameBase(naming, start.base, listed.worktree.branch, launch !== null) : start.base);
		const name = defaultSessionName(base, inWorktree(listed.worktree.id).map(live => live.session.name));

		const shell = start.argv[0]!;
		const { cols, rows } = clampTerminalSize(request.cols, request.rows);
		// The id comes first, so the session's status file is there before its program starts.
		const id = crypto.randomUUID();
		const statusFile = folder === null ? null : folder.add(id);
		// The shell that may take over from an agent gets the same environment, and so the same file.
		const baseEnvironment = sessionEnvironment(environment, handoff, statusFile);
		let live: Live | undefined;
		let started: StartedChild;
		try {
			started = startChild({ argv: start.argv, cwd: request.worktree, env: withChanges(baseEnvironment, start.environment, start.unset), cols, rows }, () => live);
		} catch (error) {
			if (statusFile !== null) folder?.remove(id);
			return { outcome: "failed", command: start.command, message: `Could not start ${shell} in ${request.worktree}: ${messageOf(error)}` };
		}

		const session: TerminalSession = {
			id,
			kind: start.kind,
			name,
			repository: request.repository,
			worktree: listed.worktree.id,
			path: request.worktree,
			shell,
			command: start.command,
			state: { kind: "running" },
			status: null,
			children: [],
			...(start.program !== null ? { program: start.program } : {}),
			...(chop?.kind === "prompt" ? { prompt: { state: "pending" as const, ...(chop.review ? { what: "review" as const } : {}) } } : {}),
		};
		live = {
			session, process: started.child, scrollback: createScrollback(), pending: "", flushTimer: null, undrawn: [], undrawnSize: 0, held: false, leftovers: null, former: null, ended: started.ended,
			environment: baseEnvironment, cols, rows, launchName: start.base,
			scanner: createStatusScanner(), records: createStatusRecords(), pasteMode: createPasteModeScanner(), statusChanged: false, native: false, probedAt: Number.NEGATIVE_INFINITY, chop: null, prompt: null,
			agent: agent?.name ?? null, resumable: start.resumable, program: start.program, conversation: start.conversation, conversationFolder: start.conversationFolder, startedAt: now(), renamed: savedName !== null, restored,
		};
		if (chop?.kind === "command") {
			live.chop = { text: chop.text, timer: null, deadline: Date.now() + chopWaitMilliseconds };
			waitForChop(live, chopWaitMilliseconds);
		}
		if (chop?.kind === "prompt") {
			const now = Date.now();
			live.prompt = { text: chop.text, review: chop.review === true, timer: null, deadline: now + promptWaitMilliseconds, probed: false, lastOutput: now, pasteOnSince: null };
		}
		sessions.set(session.id, live);
		changed(live, session);
		// The note goes before anything the agent printed, and is kept with it, so drawing the session again shows it too.
		if (start.missing && agent !== null) {
			live.pending = conversationMissingNote(agent.name) + live.pending;
			flush(live);
		}
		considerPrompt(live);
		return { outcome: "opened", session: { ...session } };
	}

	/** Delete a session's status file, once it ended for good or closed. Safe to call again. */
	function releaseStatusFile(live: Live): void {
		void statusFolder().then(folder => folder?.remove(live.session.id), () => undefined);
	}

	/**
	 * Take a status hook's line as a report of a session's root record (see
	 * `TerminalSessions.hookLine`). A line is read when the folder's watch
	 * fires, or by the poll up to two seconds later where the watch misses
	 * it, so a late `stop` can still set Done after a new prompt ended the
	 * records; the next prompt or event sets it right.
	 */
	function hookLine(id: string, line: StatusLine): void {
		const live = sessions.get(id);
		if (!live || live.session.state.kind !== "running" || live.native) return;
		// Another agent's hook can run where that agent's settings are shared, as Grok Build runs Cursor's.
		if (live.program !== null && live.program !== line.agent) return;
		const report = statusFromLine(line);
		if (report === null) return;
		if (live.records.apply({ type: "report", report: { id: null, ...report } })) {
			live.statusChanged = true;
			live.flushTimer ??= setTimeout(() => flush(live), flushMilliseconds);
		}
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
	const settled = (live: Live) => !running(live.process) && (members(live)?.length ?? 0) === 0 && (live.former === null || (membersOf(live.former)?.length ?? 0) === 0);

	/** When the last session of each agent of the registry stopped running in each worktree (see `endedAgents`). */
	const agentsEnded = new Map<string, number>();

	function noteEnded(live: Live): void {
		if (live.program !== null && live.session.state.kind === "running") agentsEnded.set(endedKey(live.program, live.session.worktree), now());
	}

	async function close(id: string): Promise<void> {
		const live = sessions.get(id);
		if (!live) return;
		noteEnded(live);
		sessions.delete(id);
		releaseStatusFile(live);
		dropChop(live);
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
		async locateAgents() {
			return (await agents()).map(agent => ({ name: agent.name, command: agent.command, lookup: lookAt(agent) }));
		},
		locateAgent: agent => lookAt(agent),
		hookLine,
		async savedPrograms() {
			return (await agents()).map(agent => {
				const built = agentCommand(agent);
				if (!built.ok) return { name: agent.name, agent: agent.agent ?? null };
				const lookup = lookAt(agent);
				const real = lookup.state === "found" ? realPathOf(lookup.path) : null;
				return { name: agent.name, agent: agentProgram(built.executable, real, agent.agent ?? null) };
			});
		},
		rename(id, name) {
			const live = sessions.get(id);
			const clean = cleanSessionName(name);
			if (!live || clean === null) return null;
			live.renamed = true;
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
			// An agent still waiting for the text it was started with may be on a first-run screen.
			if (live.prompt !== null) return { outcome: "not-ready", message: PROMPT_STILL_STARTING };
			return deliver(live, text, false);
		},
		sendPrompt(id, repository, worktreePath, text) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running") return { outcome: "gone", message: "The session has ended." };
			if (live.session.kind !== "agent" || live.session.path !== worktreePath || live.session.repository !== repository) return { outcome: "not-agent", message: "That session is not an agent of this worktree." };
			if (live.prompt !== null) return { outcome: "not-ready", message: PROMPT_STILL_STARTING };
			return deliver(live, text, true);
		},
		resize(id, cols, rows) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running") return;
			const size = clampTerminalSize(cols, rows);
			live.cols = size.cols;
			live.rows = size.rows;
			live.process.resize(size.cols, size.rows);
		},
		close,
		async closeAll() {
			await Promise.all([...sessions.keys()].map(close));
		},
		killAll() {
			for (const live of sessions.values()) {
				dropChop(live);
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
		running: () => [...sessions.values()].flatMap((live): RunningSession[] => {
			const { session } = live;
			if (session.state.kind !== "running" || (session.kind !== "terminal" && session.kind !== "agent")) return [];
			return [{
				id: session.id, worktree: session.worktree, path: session.path, kind: session.kind, agent: live.agent, resumable: live.resumable, program: live.program,
				conversation: live.conversation, conversationFolder: live.conversationFolder, startedAt: live.startedAt, name: live.renamed ? session.name : null, restored: live.restored,
			}];
		}),
		endedAgents: () => new Map(agentsEnded),
	};
}
