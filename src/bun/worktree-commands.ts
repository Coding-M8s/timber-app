import type { NewWorktreeRequest, OpenWorktreeRequest, TimberStatus, WorktreeCommandResult } from "../shared/model";
import type { ResultCommand } from "../shared/timber-result";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../shared/worktree-commands";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";

export interface WorktreeCommandsOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	environment?: Record<string, string | undefined>;
	/** Where the private folder for the result file is made. The system's temporary folder by default. */
	temporaryRoot?: string;
}

/**
 * Creating and opening worktrees. Both go through Timber, which owns every
 * rule about what may be created where: nothing here checks a name, a base,
 * or a folder. Each call runs Timber once and never again by itself.
 */
export interface WorktreeCommands {
	/** Run `timber new` in a repository from the list. */
	create(request: NewWorktreeRequest): Promise<WorktreeCommandResult>;
	/** Run `timber open` in a repository from the list. */
	open(request: OpenWorktreeRequest): Promise<WorktreeCommandResult>;
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
	const { timber, isListed, environment, temporaryRoot } = options;

	// Commands in one repository run one after another, so two of them never work on its worktrees at once.
	const queues = new Map<string, Promise<unknown>>();
	function inTurn<Result>(repository: string, task: () => Promise<Result>): Promise<Result> {
		const run = (queues.get(repository) ?? Promise.resolve()).then(task);
		const settled = run.catch(() => {}).then(() => {
			if (queues.get(repository) === settled) queues.delete(repository);
		});
		queues.set(repository, settled);
		return run;
	}

	function run(repository: string, command: ResultCommand, timberArguments: (resultFile: string) => string[]): Promise<WorktreeCommandResult> {
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

	return {
		create: request => run(request.repository, "new", resultFile => newWorktreeArguments(request, resultFile)),
		open: request => run(request.repository, "open", resultFile => openWorktreeArguments(request, resultFile)),
	};
}
