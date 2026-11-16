import { accessSync, constants } from "node:fs";
import { type AgentSetting, agentCommand, findAgent } from "../shared/agent";
import { describeCommandLine } from "../shared/command-line";
import {
	type OpenTerminalRequest, type OpenTerminalResult, type Scrollback, type TerminalChange, type TerminalOutput, type TerminalSession,
	type TerminalSnapshot, TERMINAL_UNSUPPORTED_REASON, clampTerminalSize, cleanSessionName, createScrollback, defaultSessionName, pickShell,
} from "../shared/terminal";
import { findExecutable } from "./find-executable";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { sessionMembers, signalEach, signalGroup } from "./process-session";

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
	/** Hears every part of output, in order per session. */
	onOutput: (output: TerminalOutput) => void;
	/** Hears every session that started, ended, or is gone. */
	onChange: (change: TerminalChange) => void;
	/** The environment the app was started with. The shell gets all of it, with `TERM` set. */
	environment?: Record<string, string | undefined>;
	/** The operating system, as `process.platform` names it. Tests pass another. */
	platform?: NodeJS.Platform;
	/** Tests change the waits and the limit. */
	closeMilliseconds?: number;
	flushMilliseconds?: number;
	undrawnLimit?: number;
}

/** The main process side of terminal sessions. A worktree can have several. */
export interface TerminalSessions {
	/** Every session, running or exited, in the order they started. */
	list(): TerminalSession[];
	/** Start another shell, or an agent from Settings, in a listed worktree, beside the sessions it has. */
	open(request: OpenTerminalRequest): Promise<OpenTerminalResult>;
	/** Give a session another name. Null for a session that is gone, or a name with nothing in it. */
	rename(id: string, name: string): TerminalSession | null;
	/** The end of what a session printed. Null for a session that is gone. */
	read(id: string): TerminalSnapshot | null;
	/** The window drew a session's parts up to and including `seq`. */
	drawn(id: string, seq: number): void;
	/** Pass typed text on to a running session. Anything else is ignored. */
	write(id: string, data: string): void;
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
}

interface Live {
	session: TerminalSession;
	process: Bun.Subprocess;
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
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
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

const running = (child: Bun.Subprocess) => child.exitCode === null && child.signalCode === null;

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

/**
 * Terminal sessions owned by the main process.
 *
 * - A session is the person's shell (`SHELL`, or `/bin/sh`) in a pseudo
 *   terminal (`Bun.Terminal`), started in the worktree's folder with the
 *   app's environment and `TERM=xterm-256color`. The shell leads a session
 *   of processes of its own.
 * - An agent session starts an agent's command from the saved Settings in
 *   place of the shell, split without a shell, its executable found on the
 *   app's PATH. A request names the agent, never the command. An agent whose
 *   executable is not there starts nothing, and no session is kept. What an
 *   agent prints is handled as any terminal's output and never read.
 * - Only a worktree Timber lists, in a repository in the app's list, with its
 *   folder there, gets one. Each request starts another, beside the ones the
 *   worktree has, named after the shell or the agent ("Terminal",
 *   "Terminal 2", "Codex", ...).
 * - Output is kept, up to `SCROLLBACK_LIMIT`, so the interface can draw a
 *   session again, and is sent in numbered parts, never far ahead of what
 *   the window drew (`UNDRAWN_LIMIT`).
 * - When the shell ends by itself, what it left running is hung up on, as a
 *   terminal does when it closes. The session stays, with how it ended,
 *   until it is closed.
 * - Pseudo terminals exist on Linux and macOS only, so on Windows nothing
 *   starts.
 */
export function createTerminalSessions(dependencies: TerminalDependencies): TerminalSessions {
	const {
		findRepository, onOutput, onChange, agents = async () => [], environment = process.env, platform = process.platform,
		closeMilliseconds = CLOSE_MILLISECONDS, flushMilliseconds = FLUSH_MILLISECONDS, undrawnLimit = UNDRAWN_LIMIT,
	} = dependencies;
	const sessions = new Map<string, Live>();

	const inWorktree = (worktreeId: string) => [...sessions.values()].filter(live => live.session.worktree === worktreeId);

	function send(live: Live, output: TerminalOutput): void {
		live.undrawn.push({ seq: output.seq, size: output.data.length });
		live.undrawnSize += output.data.length;
		if (live.undrawnSize > undrawnLimit) live.held = true;
		onOutput(output);
	}

	function flush(live: Live): void {
		if (live.flushTimer !== null) clearTimeout(live.flushTimer);
		live.flushTimer = null;
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
		| { ok: true; kind: TerminalSession["kind"]; base: string; argv: string[]; command: string }
		| { ok: false; result: OpenTerminalResult };

	function startOf(agent: AgentSetting | null): Start {
		if (agent === null) {
			const shell = pickShell(environment, isExecutable);
			return { ok: true, kind: "terminal", base: "Terminal", argv: [shell], command: describeCommandLine([shell]) };
		}
		const built = agentCommand(agent);
		if (!built.ok) return { ok: false, result: { outcome: "failed", message: `${built.message} Change it in Settings, Agents. Nothing was started.` } };
		const command = describeCommandLine([built.executable, ...built.arguments]);
		const lookup = findExecutable(built.executable, environment.PATH ?? "", { what: agent.name, command: `The command of ${agent.name}`, section: "Settings, Agents" });
		if (!lookup.ok) {
			return {
				ok: false,
				result: lookup.reason === "relative"
					? { outcome: "failed", command, message: lookup.message }
					: { outcome: "not-found", command, executable: built.executable, message: lookup.message },
			};
		}
		const argv = [lookup.path, ...built.arguments];
		return { ok: true, kind: "agent", base: agent.name, argv, command: describeCommandLine(argv) };
	}

	async function open(request: OpenTerminalRequest): Promise<OpenTerminalResult> {
		if (platform === "win32") return { outcome: "unsupported", message: TERMINAL_UNSUPPORTED_REASON };
		// An agent is looked up first: a request for one never falls back to a shell.
		let agent: AgentSetting | null = null;
		if (request.agent !== undefined) {
			if (typeof request.agent !== "string") return { outcome: "not-configured", message: "The request names no agent. Nothing was started." };
			let saved: readonly AgentSetting[];
			try {
				saved = await agents();
			} catch (error) {
				return { outcome: "failed", message: `Could not read the agents in Settings: ${messageOf(error)}. Nothing was started.` };
			}
			agent = findAgent(saved, request.agent);
			if (agent === null) return { outcome: "not-configured", message: `No agent called "${request.agent}" is set in Settings, Agents. Nothing was started.` };
		}
		const listed = await findListedWorktree(findRepository, request.repository, request.worktree, agent ? `${agent.name} was not started.` : "No terminal was started.");
		if (!listed.ok) return { outcome: "not-listed", message: listed.message };
		// From here to the new session being kept nothing waits, so two sessions that start at once get different names.
		const start = startOf(agent);
		if (!start.ok) return start.result;
		const name = defaultSessionName(start.base, inWorktree(listed.worktree.id).map(live => live.session.name));

		const shell = start.argv[0]!;
		const { cols, rows } = clampTerminalSize(request.cols, request.rows);
		const decoder = new TextDecoder();
		let live: Live | undefined;
		let drained: () => void = () => {};
		const terminalClosed = new Promise<void>(resolve => {
			drained = resolve;
		});
		let child: Bun.Subprocess;
		try {
			child = Bun.spawn(start.argv, {
				cwd: request.worktree,
				env: { ...environment, TERM: "xterm-256color", COLORTERM: "truecolor", TERM_PROGRAM: "timber-app" },
				terminal: {
					cols,
					rows,
					name: "xterm-256color",
					data: (_terminal, bytes) => {
						if (!live) return;
						live.pending += decoder.decode(bytes, { stream: true });
						if (live.pending.length >= PART_LIMIT) flush(live);
						else live.flushTimer ??= setTimeout(() => flush(live!), flushMilliseconds);
					},
					exit: () => drained(),
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
		};
		const ended = child.exited.then(async () => {
			// Output can still be on its way after the shell ended. A program left in the background can hold the terminal open, so do not wait for long.
			await Promise.race([terminalClosed, wait(DRAIN_MILLISECONDS)]);
			child.terminal?.close();
			if (!live) return;
			// What the shell left running is hung up on, as when a terminal closes. A program started with nohup goes on; closing the session ends it too.
			signalSession(live, "SIGHUP");
			live.leftovers = sessionMembers(child.pid) ?? [];
			live.pending += decoder.decode();
			flush(live);
			// A session closed meanwhile is already gone and stays gone.
			if (sessions.get(session.id) !== live) return;
			changed(live, { ...live.session, state: { kind: "exited", exitCode: child.exitCode, signal: child.signalCode } });
		});
		live = { session, process: child, scrollback: createScrollback(), pending: "", flushTimer: null, undrawn: [], undrawnSize: 0, held: false, leftovers: null, ended };
		sessions.set(session.id, live);
		changed(live, session);
		return { outcome: "opened", session: { ...session } };
	}

	/** Kill the shell, if it still runs, and what is left in its session. */
	function killLeftovers(live: Live): void {
		signalSession(live, "SIGKILL");
		if (running(live.process)) live.process.kill("SIGKILL");
	}

	/** Whether the shell ended and nothing is left in its session that may be signalled. */
	const settled = (live: Live) => !running(live.process) && (members(live)?.length ?? 0) === 0;

	async function close(id: string): Promise<void> {
		const live = sessions.get(id);
		if (!live) return;
		sessions.delete(id);
		if (live.flushTimer !== null) clearTimeout(live.flushTimer);
		// Hanging up the terminal sends SIGHUP to the shell and what runs in front; the rest of its session gets it too.
		live.process.terminal?.close();
		signalSession(live, "SIGHUP");
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
			live.process.terminal?.write(data);
		},
		resize(id, cols, rows) {
			const live = sessions.get(id);
			if (!live || live.session.state.kind !== "running") return;
			const size = clampTerminalSize(cols, rows);
			live.process.terminal?.resize(size.cols, size.rows);
		},
		close,
		async closeAll() {
			await Promise.all([...sessions.keys()].map(close));
		},
		killAll() {
			for (const live of sessions.values()) {
				live.process.terminal?.close();
				killLeftovers(live);
			}
			sessions.clear();
		},
		liveCount: () => [...sessions.values()].filter(live => live.session.state.kind === "running").length,
	};
}
