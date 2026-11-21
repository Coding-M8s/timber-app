import type { NewWorktreeRequest, OpenWorktreeRequest, TimberStatus, WorktreeCommandResult } from "../shared/model";
import type { ResultCommand } from "../shared/timber-result";
import { type RebaseRequest, type RebaseResult, readRebaseResult, rebaseResultArguments } from "../shared/timber-rebase";
import { type SetBaseRequest, type SetBaseResult, readSetBaseResult, setBaseResultArguments } from "../shared/timber-base";
import { type CreatePullRequestRequest, type CreatePullRequestResult, type HeadSubjectRequest, prResultArguments, readPrResult } from "../shared/timber-pr";
import { readHeadSubject } from "./git-engine";
import { isWorkflowName } from "../shared/workflows";
import { isIssueLinkSelector } from "../shared/issue-trackers";
import { newWorktreeArguments, openWorktreeArguments, worktreeCommandResult } from "../shared/worktree-commands";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { type RepositoryTurns, createRepositoryTurns } from "./repository-turns";
import { describeTimberStatus } from "./timber";
import { runTimberWithResultFile } from "./timber-run";
import { messageOf } from "../shared/error-message";

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
 * Creating, opening, and rebasing worktrees, saving a worktree's base, and
 * opening a pull request for one. All go through Timber, which owns every
 * rule about what may be created where and what may be pushed: nothing here
 * checks a name, a base, a title, or a folder. Each call runs Timber once and
 * never again by itself.
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
	/**
	 * Run `timber base --set --result-file` for a worktree Timber lists, in the
	 * same turn as the other commands of its repository. Timber checks the base
	 * and saves it: nothing here checks a ref.
	 */
	setBase(request: SetBaseRequest): Promise<SetBaseResult>;
	/**
	 * Run `timber pr --result-file` for a worktree Timber lists, in the same
	 * turn as the other commands of its repository. Timber publishes the
	 * branch and opens the pull request: nothing here pushes or calls GitHub.
	 */
	pullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult>;
	/** The subject of the last commit of a worktree Timber lists, read from Git. Null when there is none or it cannot be read. */
	headSubject(request: HeadSubjectRequest): Promise<string | null>;
}

/** A failure from before any command ran. Nothing was changed. */
function notRun(diagnostic: string): WorktreeCommandResult {
	return { outcome: "failed", failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null }, worktree: null, created: false, setupSkipped: false };
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
	// A workflow follows `--workflow`, so only a workflow name may pass: whether one by that name exists is Timber's to say.
	const isPickedWorkflow = (workflow: unknown) => workflow === undefined || isWorkflowName(workflow);
	const picked = (workflow: string | undefined) => (workflow === undefined ? {} : { workflow });
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
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return rebaseNotRun(found.message);
				const status = await timber();
				if (status.state !== "ready") return rebaseNotRun(`${describeTimberStatus(status)}. Nothing was run.`);
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

	/** A failure from before `timber base` ran. Nothing was changed. */
	const setBaseNotRun = (diagnostic: string): SetBaseResult => ({ outcome: "failed", ran: false, failure: { command: null, diagnostic, output: null } });

	async function setBase(request: SetBaseRequest): Promise<SetBaseResult> {
		const { repository, worktree, base } = (request ?? {}) as Partial<SetBaseRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || typeof base !== "string" || base === "") {
			return setBaseNotRun("The request for timber base is not complete. Nothing was run.");
		}
		return inTurn(repository, async () => {
			try {
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return setBaseNotRun(found.message);
				const status = await timber();
				if (status.state !== "ready") return setBaseNotRun(`${describeTimberStatus(status)}. Nothing was run.`);
				const run = await runTimberWithResultFile({
					executable: status.path,
					command: "base",
					arguments: resultFile => setBaseResultArguments({ worktree, base }, resultFile),
					folder: repository,
					...(environment ? { environment } : {}),
					...(temporaryRoot === undefined ? {} : { temporaryRoot }),
				});
				return readSetBaseResult(run, worktree);
			} catch (error) {
				return setBaseNotRun(`Could not start timber base: ${messageOf(error)}. Nothing was run.`);
			}
		});
	}

	/** A failure from before `timber pr` ran. Nothing was pushed. */
	const prNotRun = (diagnostic: string): CreatePullRequestResult => ({ outcome: "failed", ran: false, published: false, failure: { command: null, diagnostic, output: null } });

	async function pullRequest(request: CreatePullRequestRequest): Promise<CreatePullRequestResult> {
		const { repository, worktree, title, body, base, draft, reviewers } = (request ?? {}) as Partial<CreatePullRequestRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || typeof title !== "string" || typeof body !== "string"
			|| (base !== null && (typeof base !== "string" || base === "")) || typeof draft !== "boolean"
			|| !Array.isArray(reviewers) || !reviewers.every(reviewer => typeof reviewer === "string" && reviewer !== "")) {
			return prNotRun("The request for timber pr is not complete. Nothing was run.");
		}
		return inTurn(repository, async () => {
			try {
				const found = await findListedWorktree(findRepository, repository, worktree, "Nothing was run.");
				if (!found.ok) return prNotRun(found.message);
				const status = await timber();
				if (status.state !== "ready") return prNotRun(`${describeTimberStatus(status)}. Nothing was run.`);
				const run = await runTimberWithResultFile({
					executable: status.path,
					command: "pr",
					arguments: resultFile => prResultArguments({ worktree, title, body, base, draft, reviewers: [...reviewers] }, resultFile),
					folder: repository,
					...(environment ? { environment } : {}),
					...(temporaryRoot === undefined ? {} : { temporaryRoot }),
				});
				return readPrResult(run, worktree);
			} catch (error) {
				return prNotRun(`Could not start timber pr: ${messageOf(error)}. Nothing was run.`);
			}
		});
	}

	async function headSubject(request: HeadSubjectRequest): Promise<string | null> {
		const { repository, worktree } = (request ?? {}) as Partial<HeadSubjectRequest>;
		if (typeof repository !== "string" || typeof worktree !== "string") return null;
		try {
			const found = await findListedWorktree(findRepository, repository, worktree, "");
			return found.ok ? await readHeadSubject(found.worktree.path) : null;
		} catch {
			return null;
		}
	}

	return {
		rebase,
		setBase,
		pullRequest,
		headSubject,
		create(request) {
			const { repository, name, base, workflow, branch, assign, allowClosed } = request;
			if (typeof name !== "string" || (base !== null && typeof base !== "string") || !isPickedWorkflow(workflow)) return incomplete("new");
			// Starting work on an issue: each part has its one form, and only beside a whole issue selector. Timber judges the branch name.
			// The branch is the value of --branch, before the --: a leading dash could read as an option, and Timber refuses such a name anyway.
			if ((branch !== undefined && (typeof branch !== "string" || branch === "" || branch.startsWith("-"))) || (assign !== undefined && assign !== "assign" && assign !== "reassign")
				|| (allowClosed !== undefined && allowClosed !== true)) return incomplete("new");
			const forIssue = { ...(branch === undefined ? {} : { branch }), ...(assign === undefined ? {} : { assign }), ...(allowClosed === undefined ? {} : { allowClosed }) };
			if (Object.keys(forIssue).length > 0 && !isIssueLinkSelector(name)) return incomplete("new");
			return run(repository, "new", resultFile => newWorktreeArguments({ repository, name, base, ...picked(workflow), ...forIssue }, resultFile));
		},
		open(request) {
			const { repository, selector, workflow, issue } = request;
			if (typeof selector !== "string" || !isPickedWorkflow(workflow) || (issue !== undefined && !isIssueLinkSelector(issue))) return incomplete("open");
			return run(repository, "open", resultFile => openWorktreeArguments({ repository, selector, ...picked(workflow), ...(issue === undefined ? {} : { issue }) }, resultFile));
		},
	};
}
