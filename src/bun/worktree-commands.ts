import type { NewWorktreeRequest, OpenWorktreeRequest, TimberStatus, WorktreeCommandResult } from "../shared/model";
import type { ResultCommand } from "../shared/timber-result";
import { type RebaseRequest, type RebaseResult, readRebaseResult, rebaseResultArguments } from "../shared/timber-rebase";
import { REBASE_RESULT_TIMBER_VERSION, supportsRebaseResult } from "../shared/timber-version";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../shared/worktree-commands";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { type RepositoryTurns, createRepositoryTurns } from "./repository-turns";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";

export interface WorktreeCommandsOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	/** The repository in the app's list read again, for the worktrees Timber lists right now (see `RepositoryList.find`). */
	findRepository: FindRepository;
	environment?: Record<string, string | undefined>;
	/** Where the private folder for the result file is made. The system's temporary folder by default. */
	temporaryRoot?: string;
	/** The turns shared with other commands that change a repository, such as restoring a backup. Its own by default. */
	turns?: RepositoryTurns;
}

/**
 * Creating, opening, and rebasing worktrees. All go through Timber, which owns every
 * rule about what may be created where: nothing here checks a name, a base,
 * or a folder. Each call runs Timber once and never again by itself.
 */
export interface WorktreeCommands {
	/** Run `timber new` in a repository from the list. */
	create(request: NewWorktreeRequest): Promise<WorktreeCommandResult>;
	/** Run `timber open` in a repository from the list. */
	open(request: OpenWorktreeRequest): Promise<WorktreeCommandResult>;
	/**
	 * Run `timber rebase --result-file` for a worktree Timber lists, in the same
	 * turn as the other commands of its repository. A rebase that stops on
	 * conflicts is left as Git left it: no Git command runs here.
	 */
	rebase(request: RebaseRequest): Promise<RebaseResult>;
}

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/** A failure from before any command ran. Nothing was changed. */
function notRun(diagnostic: string): WorktreeCommandResult {
	return { outcome: "failed", failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null }, worktree: null, created: false };
}

/**
 * What a command printed is private, because setup scripts can print
 * anything. It goes back to the interface inside the result and is never
 * logged here, and neither is the result.
 */
export function createWorktreeCommands(options: WorktreeCommandsOptions): WorktreeCommands {
	const { timber, isListed, findRepository, environment, temporaryRoot } = options;

	// Commands in one repository run one after another, so two of them never work on its worktrees at once.
	const turns = options.turns ?? createRepositoryTurns();
	const inTurn = <Result>(repository: string, task: () => Promise<Result>) => turns.inTurn(repository, task);

	function run(repository: string, command: ResultCommand, timberArguments: (resultFile: string) => string[]): Promise<WorktreeCommandResult> {
		// Before the queue, which is kept by repository: a request without one has no place in it.
		if (typeof repository !== "string") return Promise.resolve(notRun(`The request for timber ${command} is not complete.`));
		return inTurn(repository, async () => {
			try {
				if (!await isListed(repository)) return notRun(`${repository} is not a repository in the app's list.`);
				const status = await timber();
				if (status.state !== "ready") return notRun(`${describeTimberStatus(status)}.`);
				return worktreeCommandResult(await runTimberWithResultFile({
					executable: status.path,
					command,
					arguments: timberArguments,
					folder: repository,
					...(environment ? { environment } : {}),
					...(temporaryRoot === undefined ? {} : { temporaryRoot }),
				}));
			} catch (error) {
				return notRun(`Could not start timber ${command}: ${messageOf(error)}.`);
			}
		});
	}

	// A request comes over the bridge, so its shape is checked and not assumed: only text ever becomes an argument.
	const incomplete = (command: ResultCommand) => Promise.resolve(notRun(`The request for timber ${command} is not complete.`));

	/** A failure from before the rebase ran. Nothing was changed. */
	const rebaseNotRun = (diagnostic: string): RebaseResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic, output: null } });

	async function rebase(request: RebaseRequest): Promise<RebaseResult> {
		const { repository, worktree, onto } = (request ?? {}) as Partial<RebaseRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || (onto !== null && (typeof onto !== "string" || onto === ""))) {
			return rebaseNotRun("The request for timber rebase is not complete. Nothing was run.");
		}
		return inTurn(repository, async () => {
			try {
				if (!await isListed(repository)) return rebaseNotRun(`${repository} is not a repository in the app's list. Nothing was run.`);
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return rebaseNotRun(found.message);
				const status = await timber();
				if (status.state !== "ready") return rebaseNotRun(`${describeTimberStatus(status)}. Nothing was run.`);
				if (!supportsRebaseResult(status.version)) {
					return { outcome: "unsupported", message: `Timber ${status.version} cannot report how a rebase ended. Timber ${REBASE_RESULT_TIMBER_VERSION} or newer can. Nothing was run.` };
				}
				const run = await runTimberWithResultFile({
					executable: status.path,
					command: "rebase",
					arguments: resultFile => rebaseResultArguments({ worktree, onto }, resultFile),
					folder: repository,
					...(environment ? { environment } : {}),
					...(temporaryRoot === undefined ? {} : { temporaryRoot }),
				});
				return readRebaseResult(run, worktree);
			} catch (error) {
				return rebaseNotRun(`Could not start timber rebase: ${messageOf(error)}. Nothing was run.`);
			}
		});
	}

	return {
		rebase,
		create(request) {
			const { repository, name, base } = request;
			if (typeof name !== "string" || (base !== null && typeof base !== "string")) return incomplete("new");
			return run(repository, "new", resultFile => newWorktreeArguments({ repository, name, base }, resultFile));
		},
		open(request) {
			const { repository, selector, setup } = request;
			if (typeof selector !== "string" || typeof setup !== "boolean") return incomplete("open");
			return run(repository, "open", resultFile => openWorktreeArguments({ repository, selector, setup }, resultFile));
		},
	};
}
