import {
	ARENA_LIST_ARGUMENTS, ARENA_LIST_COMMAND, type ArenaInspection, type ArenaLaunch, type ArenaList, type ArenaPresetList, type NewArenaRequest, type NewArenaResult,
	type PickArenaRequest, type PickArenaResult, TASK_FILE_PLACEHOLDER, arenaInspectArguments, arenaInspectCommand, arenaLaunchArguments, arenaNewArguments, arenaOf,
	arenaPickArguments, isArenaName, isAttemptLabel, newArenaProblem, readArenaInspection, readArenaLaunch, readArenaList, readArenaPresets, readNewArenaResult,
	readPickArenaResult,
} from "../shared/arenas";
import type { TimberStatus } from "../shared/model";
import { APP_CONFIG_READ_ARGUMENTS, APP_CONFIG_READ_COMMAND } from "../shared/workflows";
import { type RepositoryTurns, createRepositoryTurns } from "./repository-turns";
import { runTimberWithResultFile } from "./timber-run";
import { runTimberRecord, withReadyTimber } from "./timber-record";

/** Listing reads every arena's records and asks Git about each attempt. Anything this slow is stuck. */
export const READ_ARENAS_TIMEOUT_MS = 30_000;

/** An arena list or comparison is small. Anything past this is not a record Timber would print. */
const RECORD_LIMIT_BYTES = 4 * 1024 * 1024;

export interface ArenaCommandsOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	/**
	 * The app's running sessions in any of these folders, by name, for the
	 * refusal to pick while one runs. Timber does not know about sessions the
	 * app started, so this is the only check that keeps pick from removing a
	 * worktree under a running agent.
	 */
	runningIn: (paths: readonly string[]) => string[];
	/** The turns shared with the other commands that change a repository (see ./repository-turns.ts). */
	turns?: RepositoryTurns;
	environment?: Record<string, string | undefined>;
	timeoutMs?: number;
	/** Where the private folder for a result file and the task is made. The system's temporary folder by default. */
	temporaryRoot?: string;
}

/**
 * Arenas of a repository in the app's list. Timber owns every rule about
 * them and checks again right before it acts: nothing here does. Each call
 * runs Timber once and never again by itself. The task text and what Timber
 * printed are never logged here.
 */
export interface ArenaCommands {
	/** `timber __app-arena list`. Read-only. */
	list(repository: string): Promise<ArenaList>;
	/** The arena presets from `timber __app-config read --scope repository`. Read-only. */
	presets(repository: string): Promise<ArenaPresetList>;
	/** `timber arena pick <arena> --inspect --json`. Read-only. */
	inspect(request: { repository: string; arena: string }): Promise<ArenaInspection>;
	/** `timber arena new ... --no-editor --no-agent --result-file`, in the repository's turn. */
	create(request: NewArenaRequest): Promise<NewArenaResult>;
	/** `timber arena pick <arena> --winner <label> --result-file`, in the repository's turn, never while an app session runs in an attempt. */
	pick(request: PickArenaRequest): Promise<PickArenaResult>;
	/** `timber __app-arena launch`, run in the attempt's worktree. Read-only: it runs nothing. */
	launch(request: { repository: string; worktree: string; arena: string; attempt: string }): Promise<ArenaLaunch>;
}

const isFilled = (value: unknown): value is string => typeof value === "string" && value !== "";

/** A failure from before anything ran. Nothing was changed. */
function notRun(diagnostic: string) {
	return { outcome: "failed" as const, ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } };
}

export function createArenaCommands(options: ArenaCommandsOptions): ArenaCommands {
	const { timber, isListed, runningIn, environment = process.env, timeoutMs = READ_ARENAS_TIMEOUT_MS, temporaryRoot } = options;
	const turns = options.turns ?? createRepositoryTurns();

	const record = (executable: string, args: readonly string[], folder: string, command: string, tooLong: string) => runTimberRecord({
		executable, arguments: args, folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES, command, where: `in ${folder}`, tooLong,
	});

	async function listWith(executable: string, repository: string): Promise<ArenaList> {
		const output = await record(executable, ARENA_LIST_ARGUMENTS, repository, ARENA_LIST_COMMAND, "an arena list holds. The arenas were not read.");
		if (!output.ok) return { state: "failed", message: output.message };
		return readArenaList(output.record, output.diagnostic, output.exitCode);
	}

	const where = (executable: string, repository: string) => ({
		executable,
		folder: repository,
		environment,
		...(temporaryRoot === undefined ? {} : { temporaryRoot }),
	});

	return {
		async list(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (!isFilled(repository)) return { state: "failed", message: "The request for arenas names no repository." };
			return withReadyTimber<ArenaList>({
				timber, isListed, repository, couldNot: `read the arenas of ${repository}`,
				fail: message => ({ state: "failed", message }),
				run: executable => listWith(executable, repository),
			});
		},

		async presets(repository) {
			if (!isFilled(repository)) return { ok: false, message: "The request for arena presets names no repository." };
			return withReadyTimber<ArenaPresetList>({
				timber, isListed, repository, couldNot: `read the arena presets of ${repository}`,
				fail: message => ({ ok: false, message }),
				run: async executable => {
					// The record says whether logins are saved and holds preset commands: only names and tools leave here.
					const output = await record(executable, APP_CONFIG_READ_ARGUMENTS, repository, APP_CONFIG_READ_COMMAND, "a settings record holds. The presets were not read.");
					if (!output.ok) return { ok: false, message: output.message };
					return readArenaPresets(output.record, output.diagnostic, output.exitCode);
				},
			});
		},

		async inspect(request) {
			const { repository, arena } = (request ?? {}) as Partial<{ repository: string; arena: string }>;
			if (!isFilled(repository) || !isArenaName(arena)) return { state: "failed", message: "The request to compare an arena's attempts is not complete." };
			return withReadyTimber<ArenaInspection>({
				timber, isListed, repository, couldNot: `compare the attempts of ${arena}`,
				fail: message => ({ state: "failed", message }),
				run: async executable => {
					const output = await record(executable, arenaInspectArguments(arena), repository, arenaInspectCommand(arena), "a comparison holds. The attempts were not compared.");
					if (!output.ok) return { state: "failed", message: output.message };
					return readArenaInspection(output.record, output.diagnostic, output.exitCode, arena);
				},
			});
		},

		async create(request) {
			const { repository, name, task, groups, base } = (request ?? {}) as Partial<NewArenaRequest>;
			const refused = (diagnostic: string): NewArenaResult => ({ ...notRun(diagnostic), arena: null });
			if (!isFilled(repository) || typeof name !== "string" || typeof task !== "string" || !Array.isArray(groups) || (base !== null && typeof base !== "string")) {
				return refused("The request for timber arena new is not complete.");
			}
			const problem = newArenaProblem({ name, task, groups, base });
			if (problem !== null) return refused(problem);
			return turns.inTurn(repository, () => withReadyTimber<NewArenaResult>({
				timber, isListed, repository, couldNot: "start timber arena new", fail: refused,
				run: async executable => readNewArenaResult(await runTimberWithResultFile({
					...where(executable, repository),
					command: "arena-new",
					// The task goes in a new private file beside the result, and is never an argument.
					input: { bytes: new TextEncoder().encode(task), shownAs: TASK_FILE_PLACEHOLDER },
					arguments: (resultFile, taskFile) => arenaNewArguments({ name, groups, base }, taskFile, resultFile),
				})),
			}));
		},

		async pick(request) {
			const { repository, arena, winner } = (request ?? {}) as Partial<PickArenaRequest>;
			const refused = (diagnostic: string): PickArenaResult => ({ ...notRun(diagnostic), pick: null });
			if (!isFilled(repository) || !isArenaName(arena) || !isAttemptLabel(winner)) return refused("The request for timber arena pick is not complete.");
			return turns.inTurn(repository, () => withReadyTimber<PickArenaResult>({
				timber, isListed, repository, couldNot: "start timber arena pick", fail: refused,
				run: async executable => {
					// Read afresh right before the pick: which folders are attempts is Timber's to say, not the window's.
					const list = await listWith(executable, repository);
					if (list.state !== "listed") return refused(list.state === "unsupported" ? "The Timber found has no arenas for apps." : `The arenas could not be read: ${list.message}`);
					const listed = arenaOf(list, arena);
					if (listed === null) return refused(`Timber lists no arena called ${arena}.`);
					if (listed.outcome !== "read") return refused(`Timber could not read the arena ${arena}: ${listed.diagnostic}`);
					// Timber refuses only attempts it recorded as running. It never knows about the app's sessions.
					const running = runningIn(listed.attempts.map(attempt => attempt.path));
					if (running.length > 0) {
						return refused(`A session still runs in this arena: ${running.join(", ")}. Pick removes the other attempts' worktrees, so end their sessions first. The app never stops them for you.`);
					}
					return readPickArenaResult(await runTimberWithResultFile({
						...where(executable, repository),
						command: "arena-pick",
						arguments: resultFile => arenaPickArguments({ arena, winner }, resultFile),
					}), { arena, winner });
				},
			}));
		},

		async launch(request) {
			const { repository, worktree, arena, attempt } = (request ?? {}) as Partial<{ repository: string; worktree: string; arena: string; attempt: string }>;
			if (!isFilled(repository) || !isFilled(worktree) || !isArenaName(arena) || !isAttemptLabel(attempt)) return { outcome: "failed", message: "The request to start an attempt's agent is not complete. Nothing was started." };
			return withReadyTimber<ArenaLaunch>({
				timber, isListed, repository, couldNot: `ask Timber how to start ${attempt}`,
				fail: message => ({ outcome: "failed", message: `${message} Nothing was started.` }),
				run: async executable => {
					const output = await record(executable, arenaLaunchArguments(arena, attempt), worktree, `timber __app-arena launch ${arena} --attempt ${attempt}`, "a launch record holds. Nothing was started.");
					if (!output.ok) return { outcome: "failed", message: `${output.message} Nothing was started.` };
					return readArenaLaunch(output.record, output.diagnostic, output.exitCode, arena, attempt);
				},
			});
		},
	};
}
