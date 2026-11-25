import { realpathSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type AgentSetting, agentCommand, rowAgent } from "../shared/agent";
import type { AgentLookup } from "../shared/agent-lookup";
import { type AgentDefinition, type AgentSignInStatus, agentByExecutable } from "../shared/agent-registry";
import { type AgentSignIn, SIGN_IN_MILLISECONDS, type SignInState, readSignIn } from "../shared/agent-sign-in";
import { describeCommandLine } from "../shared/command-line";
import { agentRunEnvironment, runOnce } from "./run-agent";

/** An answer is far shorter than this; a longer one is not read. */
const ANSWER_BYTES = 64 * 1024;

export interface SignInReaderDependencies {
	/** The agents as saved in Settings, in their order. */
	agents: () => Promise<readonly AgentSetting[]>;
	/** Where a saved agent's executable is, as its session looks for it. */
	locate: (agent: AgentSetting) => AgentLookup;
	/** The app's environment, which the command gets, as the agent's sessions do. */
	environment?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	/** Where the empty folder is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	/** How long a command may take. Tests shorten it. */
	timeoutMilliseconds?: number;
}

export interface SignInReader {
	/** Ask each saved agent the registry knows and that was found. Rejects only when the saved agents cannot be read. */
	read(): Promise<AgentSignIn[]>;
	/** End every command, as the app quits. Nothing runs afterwards. */
	stopAll(): void;
}

/**
 * Asks each saved agent whether it is signed in, with its own status command
 * from the registry.
 *
 * - Only the executable found for the saved row, with the registry's
 *   arguments; the row's other words are never used. Run as an executable
 *   plus arguments, without a shell, a terminal, or anything to read, in a
 *   new empty folder only this user can open, and killed with all it started
 *   once its time is up.
 * - Only an executable named as the agent's own. A wrapper picked as an
 *   agent could start a session of it, so it is not run.
 * - What it prints can hold an email address: it stays here, is read for its
 *   state, and is dropped. It is never logged or kept, and no part of it is
 *   in the answer.
 * - The app reads none of the agent's files. The agent's own command does.
 */
export function createSignInReader(dependencies: SignInReaderDependencies): SignInReader {
	const { agents, locate, environment = process.env, platform = process.platform, temporaryRoot = tmpdir(), timeoutMilliseconds = SIGN_IN_MILLISECONDS } = dependencies;
	/** The commands under way, so rows that ask the same, and a read during another, share one. */
	const runs = new Map<string, Promise<SignInState>>();
	const kills = new Set<() => void>();
	let stopped = false;

	async function run(command: readonly string[], status: AgentSignInStatus, env: Record<string, string | undefined>): Promise<SignInState> {
		let folder: string;
		try {
			// mkdtemp makes the folder with access for this user only (mode 0700).
			folder = await mkdtemp(join(temporaryRoot, "timber-app-sign-in-"));
		} catch {
			return { state: "not-known", reason: "not-started" };
		}
		let ended: (() => void) | undefined;
		try {
			if (stopped) return { state: "not-known", reason: "not-started" };
			const ran = await runOnce({
				command, cwd: folder, env, input: null, outputBytes: ANSWER_BYTES, errorBytes: ANSWER_BYTES, timeoutMilliseconds, platform,
				onStart: kill => {
					kills.add(kill);
					ended = () => kills.delete(kill);
				},
			});
			if (!ran.started) return { state: "not-known", reason: "not-started" };
			return ran.late ? { state: "not-known", reason: "too-long" } : readSignIn(status, ran, env);
		} catch {
			return { state: "not-known", reason: "unreadable" };
		} finally {
			ended?.();
			await rm(folder, { recursive: true, force: true }).catch(() => {});
		}
	}

	function ask(path: string, agent: AgentDefinition, status: AgentSignInStatus, setting: AgentSetting): Promise<SignInState> {
		const command = [path, ...status.arguments];
		const env = agentRunEnvironment(environment, agent, setting.configFolder);
		const variable = agent.resume?.conversations.folderVariable;
		const key = JSON.stringify([command, variable === undefined ? null : env[variable] ?? null]);
		const running = runs.get(key);
		if (running !== undefined) return running;
		const started = run(command, status, env).finally(() => runs.delete(key));
		runs.set(key, started);
		return started;
	}

	async function readOne(setting: AgentSetting): Promise<AgentSignIn | null> {
		const built = agentCommand(setting);
		const lookup = locate(setting);
		if (!built.ok || lookup.state !== "found") return null;
		const real = realPathOf(lookup.path);
		const agent = rowAgent(setting, built.executable, real);
		if (agent === null) return null;
		const { status } = agent.signIn;
		const answer = (shown: string | null, signIn: SignInState): AgentSignIn => ({ setting: { ...setting }, agent: agent.id, shown, signIn });
		if (status === null) return answer(null, { state: "not-known", reason: "no-command" });
		const shown = describeCommandLine([built.executable, ...status.arguments]);
		if (agentByExecutable(lookup.path, real)?.id !== agent.id) return answer(shown, { state: "not-known", reason: "not-asked" });
		return answer(shown, await ask(lookup.path, agent, status, setting));
	}

	return {
		async read() {
			if (stopped) return [];
			const answers = await Promise.all((await agents()).map(readOne));
			return answers.filter(answer => answer !== null);
		},
		stopAll() {
			stopped = true;
			for (const kill of kills) kill();
		},
	};
}

function realPathOf(path: string): string | null {
	try {
		return realpathSync(path);
	} catch {
		return null;
	}
}
