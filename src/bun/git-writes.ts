import { messageOf } from "../shared/error-message";
import { type GitCommand, type GitWriteResult, describeGitCommand, sameArguments } from "../shared/index-writes";
import type { Worktree } from "../shared/model";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { readGit } from "./read-git";
import type { RepositoryTurns } from "./repository-turns";

/** Git is stopped when a write takes longer than this. */
const GIT_MILLISECONDS = 20_000;

/** Standard error is kept up to this many bytes, for Git's message when it fails. */
const STDERR_BYTES = 8192;

export interface GitWritesDependencies {
	/** The repository in the app's list, read again, so its worktrees are the ones Timber lists right now. */
	findRepository: FindRepository;
	/** The turns shared with every command that changes a repository, so a write never runs beside a rebase or a pull. */
	turns: RepositoryTurns;
	/** Told after Git wrote, so the window reads the repository again. */
	onWritten?: (repository: string) => void;
	/** The Git executable. Tests may pass another. */
	git?: string;
	/** How long Git may take. Tests shorten it. */
	timeoutMilliseconds?: number;
}

/** The command to run in a listed worktree, or why nothing may run. */
export type GitWritePlan = { ok: true; command: GitCommand } | { ok: false; message: string };

export interface GitWrite {
	/** The path of the repository's primary checkout, as in the app's list. */
	repository: string;
	/** The worktree's registered path, exactly as Timber lists it. */
	worktree: string;
	/** The arguments the window showed. When `plan` gives others, nothing runs. */
	shown: readonly string[];
	/** Ends every refusal, such as "Nothing was staged." */
	consequence: string;
	/** The command, from what Git says now about the worktree (never from the window's paths), or why nothing may run. */
	plan: (worktree: Worktree) => Promise<GitWritePlan>;
}

/**
 * The app's own Git writes (see docs/architecture.md): today staging and
 * unstaging, and the helper the commit and discard actions build on.
 *
 * - Only in a worktree Timber lists, in a repository in the app's list, whose
 *   folder is there (`findListedWorktree`), read again for every write.
 * - In the repository's turn, so a write never runs beside a rebase, a pull,
 *   or another write.
 * - The command comes from `plan`, which reads the worktree again. It must be
 *   the one the window showed, word for word, or nothing runs.
 * - Git runs once, in the worktree, as an executable plus arguments, never
 *   through a shell, with paths taken literally (`GIT_LITERAL_PATHSPECS=1`)
 *   and `LC_ALL=C`. One run means a failure, such as `index.lock` held by
 *   another Git, changes nothing, and Git's own message comes back.
 * - After Git wrote, `onWritten` is told, so the status is read again.
 */
export interface GitWrites {
	write(request: GitWrite): Promise<GitWriteResult>;
}

export function createGitWrites(dependencies: GitWritesDependencies): GitWrites {
	const { findRepository, turns, onWritten, git = "git", timeoutMilliseconds = GIT_MILLISECONDS } = dependencies;

	async function write({ repository, worktree, shown, consequence, plan }: GitWrite): Promise<GitWriteResult> {
		return turns.inTurn(repository, async (): Promise<GitWriteResult> => {
			const listed = await findListedWorktree(findRepository, repository, worktree, consequence);
			if (!listed.ok) return { outcome: "refused", message: listed.message };
			let planned: GitWritePlan;
			try {
				planned = await plan(listed.worktree);
			} catch (error) {
				return { outcome: "refused", message: `${messageOf(error)}. ${consequence}` };
			}
			if (!planned.ok) return { outcome: "refused", message: planned.message };
			const { command } = planned;
			const line = describeGitCommand(command);
			if (!sameArguments(command.args, shown)) {
				return { outcome: "refused", message: `The command is now ${line}, not the one that was shown. ${consequence} Look at the list again.` };
			}
			const answer = await readGit(command.args, {
				git,
				cwd: listed.worktree.path,
				timeoutMs: timeoutMilliseconds,
				limitBytes: 64 * 1024,
				stderrBytes: STDERR_BYTES,
				environment: { GIT_LITERAL_PATHSPECS: "1" },
				...(command.input === null ? {} : { input: command.input }),
			});
			if (!answer.started) return { outcome: "failed", command: line, message: `Could not start Git: ${messageOf(answer.error)}` };
			// Stopped part way, Git may or may not have written: the window reads again either way.
			onWritten?.(repository);
			if (answer.timedOut) return { outcome: "failed", command: line, message: `Git took longer than ${timeoutMilliseconds / 1000} seconds and was stopped.` };
			if (answer.exitCode !== 0) {
				const said = answer.stderr.trim();
				return { outcome: "failed", command: line, message: said === "" ? `Git ended with exit code ${answer.exitCode ?? "unknown"}.` : said };
			}
			return { outcome: "written", command: line };
		});
	}

	return { write };
}
