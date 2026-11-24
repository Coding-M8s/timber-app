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
	/** How long Git may take, unless a write says otherwise. Tests shorten it. */
	timeoutMilliseconds?: number;
	/** Variables added to Git's environment for every write. Tests use it to leave out the person's own Git config. */
	environment?: Record<string, string>;
}

/** The command to run in a listed worktree, or why nothing may run. */
/** `line` is how the window shows the command, when `describeGitCommand` would not say it well, as for a message on standard input. */
export type GitWritePlan = { ok: true; command: GitCommand; line?: string } | { ok: false; message: string };

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
	/**
	 * "index" (the default): paths taken literally, `LC_ALL=C`, and Git stopped
	 * after the helper's time. "terminal": as Git would run from a terminal,
	 * for a command that runs hooks (a commit), which must see the person's
	 * own environment, may print a lot, and may take long (`timeoutMilliseconds`).
	 */
	runAs?: "index" | "terminal";
	/** How long Git may take for this write, in place of the helper's. */
	timeoutMilliseconds?: number;
}

/** A write that was not refused, as Git ran it. */
export type GitWriteRan = Exclude<GitWriteResult, { outcome: "refused" }>;

/**
 * The app's own Git writes (see docs/architecture.md): staging, unstaging,
 * discarding, and committing.
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
	/**
	 * As `write`, then `settle` in the same turn once Git ran, whether it
	 * worked, failed, or was stopped, to read what Git did, such as where a
	 * commit's HEAD now points. Nothing else writes in between.
	 */
	writeAndSettle<Settled>(request: GitWrite, settle: (ran: GitWriteRan, worktree: Worktree) => Promise<Settled>): Promise<Settled | { outcome: "refused"; message: string }>;
}

/** Bytes kept of each stream of a write that runs as from a terminal: the end of a hook's output is where it says what failed. */
const TERMINAL_TAIL_BYTES = 64 * 1024;

export function createGitWrites(dependencies: GitWritesDependencies): GitWrites {
	const { findRepository, turns, onWritten, git = "git", timeoutMilliseconds: helperMilliseconds = GIT_MILLISECONDS, environment = {} } = dependencies;

	async function writeAndSettle<Settled>(
		{ repository, worktree, shown, consequence, plan, runAs = "index", timeoutMilliseconds = helperMilliseconds }: GitWrite,
		settle: (ran: GitWriteRan, worktree: Worktree) => Promise<Settled>,
	): Promise<Settled | { outcome: "refused"; message: string }> {
		return turns.inTurn(repository, async () => {
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
			const line = planned.line ?? describeGitCommand(command);
			if (!sameArguments(command.args, shown)) {
				return { outcome: "refused", message: `The command is now ${line}, not the one that was shown. ${consequence} Look at the list again.` };
			}
			const terminal = runAs === "terminal";
			const answer = await readGit(command.args, {
				git,
				cwd: listed.worktree.path,
				timeoutMs: timeoutMilliseconds,
				// Never cut short: stopping Git part way through a write is worse than reading what it printed, at most a line a path (`git rm`).
				stderrBytes: STDERR_BYTES,
				// A hook's own pathspecs must keep their globs, so only an index write takes paths literally.
				environment: terminal ? environment : { ...environment, GIT_LITERAL_PATHSPECS: "1" },
				...(terminal ? { asTerminal: { tailBytes: TERMINAL_TAIL_BYTES } } : {}),
				...(command.input === null ? {} : { input: command.input }),
			});
			const ran = await (async (): Promise<GitWriteRan> => {
				if (!answer.started) return { outcome: "failed", command: line, message: `Could not start Git: ${messageOf(answer.error)}` };
				// Stopped part way, Git may or may not have written: the window reads again either way.
				onWritten?.(repository);
				const said = terminal ? [answer.stdout.trim(), answer.stderr.trim()].filter(text => text !== "").join("\n") : answer.stderr.trim();
				if (answer.timedOut) return { outcome: "failed", command: line, message: `Git took longer than ${timeoutMilliseconds / 1000} seconds and was stopped.${said === "" ? "" : `\n${said}`}` };
				if (answer.exitCode !== 0) return { outcome: "failed", command: line, message: said === "" ? `Git ended with exit code ${answer.exitCode ?? "unknown"}.` : said };
				return { outcome: "written", command: line };
			})();
			return settle(ran, listed.worktree);
		});
	}

	return {
		write: request => writeAndSettle(request, async ran => ran),
		writeAndSettle,
	};
}
