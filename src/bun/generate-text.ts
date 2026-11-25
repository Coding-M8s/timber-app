import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type { AgentSetting } from "../shared/agent";
import type { AgentLookup } from "../shared/agent-lookup";
import { messageOf } from "../shared/error-message";
import {
	GENERATE_MILLISECONDS, type GenerateTextRequest, type GenerateTextResult, NOT_GENERATED, describeGenerateCommand, generateCommand, generateMarker, generateOf, generatePrompt, pickGenerator,
	readGenerated,
} from "../shared/generate-text";
import { sameArguments } from "../shared/index-writes";
import { type FileChanges, changedParts } from "./file-changes";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { agentRunEnvironment, runOnce } from "./run-agent";

export interface TextGeneratorDependencies {
	/** The repository in the app's list, read again, so its worktrees are the ones Timber lists right now. */
	findRepository: FindRepository;
	/** The read-only Git queries: what the agent is given, and what it must not change. */
	changes: Pick<FileChanges, "generationInput" | "worktreeState">;
	/** The agents as saved in Settings, and the one picked there to write text ("" for the first that can). */
	settings: () => Promise<{ agents: readonly AgentSetting[]; choice: string }>;
	/** Where a saved agent's executable is, as its session looks for it. */
	locate: (agent: AgentSetting) => AgentLookup;
	/** The app's environment, which the agent gets, as its sessions do. */
	environment?: Record<string, string | undefined>;
	platform?: NodeJS.Platform;
	/** Where the empty folder is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	/** How long the agent may take. Tests shorten it. */
	timeoutMilliseconds?: number;
}

export interface TextGenerator {
	generate(request: GenerateTextRequest): Promise<GenerateTextResult>;
	/** Stop a run by its id. False when there is none. */
	stop(id: string): boolean;
	/** Stop every run, as the app quits. */
	stopAll(): void;
}

/** An answer is far shorter than this; the end of a longer one is kept, and is refused. */
const ANSWER_BYTES = 256 * 1024;
const ERROR_BYTES = 8 * 1024;

/**
 * Runs an agent once to write a commit message, or a pull request's title
 * and description.
 *
 * - Only for a worktree Timber lists, and only an agent saved in Settings
 *   that the registry says how to run so. Its executable is the one found
 *   for the saved row; the row's other arguments are never used.
 * - The command must be the one the window showed, or nothing runs.
 * - It runs as an executable plus arguments, never through a shell, in a new
 *   empty folder only this user can open, never in the worktree, so it reads
 *   no instruction file from there. The folder is removed afterwards.
 * - The prompt, with the diff, goes to its standard input. The app's
 *   environment is passed on, as to a session, with the row's config folder
 *   and without what ties a process to one of the app's sessions.
 * - It holds no turn of the repository: it writes nothing there. What it
 *   must not change is read before and after, and the difference is told.
 * - Nothing given to it, or answered by it, is logged.
 */
export function createTextGenerator(dependencies: TextGeneratorDependencies): TextGenerator {
	const { findRepository, changes, settings, locate, environment = process.env, platform = process.platform, temporaryRoot = tmpdir(), timeoutMilliseconds = GENERATE_MILLISECONDS } = dependencies;
	/** The runs under way, by id. `kill` is there while the agent runs. */
	const runs = new Map<string, { stopped: boolean; kill: (() => void) | null }>();
	const refuse = (message: string): GenerateTextResult => ({ outcome: "refused", message: `${message} ${NOT_GENERATED}` });

	function stopRun(run: { stopped: boolean; kill: (() => void) | null }): void {
		run.stopped = true;
		run.kill?.();
	}

	async function run(request: GenerateTextRequest, state: { stopped: boolean; kill: (() => void) | null }): Promise<GenerateTextResult> {
		const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_GENERATED);
		if (!listed.ok) return { outcome: "refused", message: listed.message };
		const { agents, choice } = await settings();
		// Only an agent that can write text is looked for.
		const locations = agents.filter(agent => generateOf(agent) !== null).map(agent => ({ name: agent.name, command: agent.command, lookup: locate(agent) }));
		const picked = pickGenerator(agents, locations, choice);
		if (!picked.ok) return refuse(picked.reason);
		const { generator } = picked;
		const command = generateCommand(generator);
		if (!sameArguments(command, request.shown)) return refuse("The command to run is not the one that was shown.");
		// Before the diff is read, so a change between the two is told.
		const before = await changes.worktreeState(listed.worktree.path);
		const input = await changes.generationInput(request.kind, listed.worktree, request.base);
		if (!input.ok) return refuse(input.message);
		if (state.stopped) return { outcome: "stopped" };

		let folder: string;
		try {
			// mkdtemp makes the folder with access for this user only (mode 0700).
			folder = await mkdtemp(join(temporaryRoot, "timber-app-generate-"));
		} catch (error) {
			return refuse(`Could not make a temporary folder: ${messageOf(error)}.`);
		}
		const line = describeGenerateCommand(generator);
		const failed = (message: string): GenerateTextResult => ({ outcome: "failed", command: line, message });
		try {
			for (const file of generator.generate.files) {
				const path = join(folder, ...file.path);
				await mkdir(dirname(path), { recursive: true });
				await writeFile(path, file.text, { flag: "wx", mode: 0o600 });
			}
			const answered = await runAgent(command, folder, generator.setting, generatePrompt(request.kind, generateMarker(crypto.randomUUID().replaceAll("-", "")), input.data), state);
			if (state.stopped) return { outcome: "stopped" };
			if (!answered.ok) return failed(answered.message);
			const read = readGenerated(request.kind, answered.text);
			if (!read.ok) return failed(read.message);
			const after = await changes.worktreeState(listed.worktree.path);
			return { outcome: "generated", text: read.text, changed: changedParts(before, after), leftOut: input.leftOut };
		} finally {
			await rm(folder, { recursive: true, force: true }).catch(() => {});
		}
	}

	async function runAgent(
		command: string[], cwd: string, setting: AgentSetting, prompt: string, state: { stopped: boolean; kill: (() => void) | null },
	): Promise<{ ok: true; text: string } | { ok: false; message: string }> {
		if (state.stopped) return { ok: false, message: "" };
		try {
			const ran = await runOnce({
				command, cwd, env: agentRunEnvironment(environment, generateOf(setting)?.agent ?? null, setting.configFolder), input: prompt,
				outputBytes: ANSWER_BYTES, errorBytes: ERROR_BYTES, timeoutMilliseconds, platform,
				onStart: kill => {
					state.kill = kill;
					if (state.stopped) kill();
				},
			});
			if (!ran.started) return { ok: false, message: `Could not start it: ${ran.message}` };
			const { out, err, exitCode } = ran;
			if (ran.late) return { ok: false, message: `${setting.name} took longer than ${Math.round(timeoutMilliseconds / 1000)} seconds and was stopped.` };
			if (exitCode !== 0) {
				const said = (err.text.trim() || out.text.trim()).slice(-4000);
				return { ok: false, message: said === "" ? `${setting.name} ended with exit code ${exitCode ?? "unknown"}.` : said };
			}
			return out.truncated ? { ok: false, message: "The agent's answer is too long." } : { ok: true, text: out.text };
		} finally {
			state.kill = null;
		}
	}

	return {
		async generate(request) {
			const { id, kind, repository, worktree, base, shown } = (request ?? {}) as Partial<GenerateTextRequest>;
			// Only text becomes an argument: the request comes over the bridge.
			if (
				typeof id !== "string" || id === "" || (kind !== "commit" && kind !== "pull-request") || typeof repository !== "string" || typeof worktree !== "string"
				|| (base !== null && typeof base !== "string") || !Array.isArray(shown) || shown.some(word => typeof word !== "string")
			) return refuse("The request is not complete.");
			if (runs.has(id)) return refuse("This run is already under way.");
			const state: { stopped: boolean; kill: (() => void) | null } = { stopped: false, kill: null };
			runs.set(id, state);
			try {
				const result = await run({ id, kind, repository, worktree, base, shown }, state);
				return state.stopped ? { outcome: "stopped" } : result;
			} catch (error) {
				return refuse(`Could not run the agent: ${messageOf(error)}.`);
			} finally {
				runs.delete(id);
			}
		},
		stop(id) {
			const state = runs.get(id);
			if (state === undefined) return false;
			stopRun(state);
			return true;
		},
		stopAll() {
			for (const state of runs.values()) stopRun(state);
		},
	};
}
