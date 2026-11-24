import { lstat, readlink } from "node:fs/promises";
import { isAbsolute, join } from "node:path";
import { COMMIT_ARGUMENTS, COMMIT_COMMAND_LINE, type CommitRequest, type CommitResult, type GitOperation, NOT_COMMITTED, OPERATION_MARKERS, commitBlocker, emptyMessage, operationOf } from "../shared/commit-staged";
import {
	type BaseComparison, type FileChange, type FileChangesRequest, type FileChangesResult, type FileDiffRequest, type FileDiffResult, type LineCounts,
	MAX_DIFF_BYTES, MAX_LISTED_FILES, MAX_STATUS_BYTES, baseContentArguments, baseNamesArguments, commitArguments, countAddedLines, diffArguments, isCommitHash, parseNameStatus, parseNumstat,
	parseStatus, baseName, readDiffOutput, relativePathProblem, sameFileChange, savedBaseRef, sinceBase, statusArguments, uncommittedContentArguments, withChangedContent, withLineCounts,
} from "../shared/file-changes";
import { type IndexAction, type IndexWriteRequest, type IndexWriteResult, canWriteIndex, indexCommand } from "../shared/index-writes";
import { type GenerateKind, MAX_GENERATE_LOG_BYTES, type WorktreePart, NO_COMMITS_AHEAD, commitGenerateBlocker, cutDiff } from "../shared/generate-text";
import { type DiscardRequest, type DiscardResult, canDiscard, discardCommand } from "../shared/discard-files";
import type { GitWritePlan, GitWriteRan, GitWrites } from "./git-writes";
import type { Worktree } from "../shared/model";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { messageOf } from "../shared/error-message";
import { readGit } from "./read-git";

/** Git is stopped when it takes longer than this, so a stuck read cannot hold the tab forever. */
const GIT_MILLISECONDS = 20_000;

/** Standard error is kept up to this many bytes, for the message when Git fails. */
const STDERR_BYTES = 4096;

const NOT_READ = "No changes were read.";

/** A commit runs the person's hooks, which may run a whole test suite: Git is stopped only after this long. */
export const COMMIT_MILLISECONDS = 10 * 60_000;

const NOT_WRITTEN: Record<IndexAction, string> = { stage: "Nothing was staged.", unstage: "Nothing was unstaged." };

const NOT_DISCARDED = "Nothing was discarded.";

export interface FileChangesDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
	/** The Git executable. Tests may pass another. */
	git?: string;
	/** How long Git may take. Tests shorten it. */
	timeoutMilliseconds?: number;
	/** Runs staging, unstaging, discarding, and committing (see ./git-writes.ts). Without it, all are refused. */
	writes?: GitWrites;
	/** How long a commit may take. Tests shorten it. */
	commitMilliseconds?: number;
}

/**
 * The Changes view's side in the main process: the changed files of a
 * worktree and the diff of one, read-only; staging and unstaging files,
 * which write only the index; discarding files' changes, which writes only
 * the files named; and committing what is staged.
 */
export interface FileChanges {
	read(request: FileChangesRequest): Promise<FileChangesResult>;
	diff(request: FileDiffRequest): Promise<FileDiffResult>;
	stage(request: IndexWriteRequest): Promise<IndexWriteResult>;
	unstage(request: IndexWriteRequest): Promise<IndexWriteResult>;
	discard(request: DiscardRequest): Promise<DiscardResult>;
	commit(request: CommitRequest): Promise<CommitResult>;
	/**
	 * What an agent is given to write text from, read-only, or why there is
	 * nothing to give: the staged diff, or the commit messages and the
	 * committed diff of the branch since it left its base. `base` is the pull
	 * request form's, as a branch on the remote, or null for the saved one.
	 */
	generationInput(kind: GenerateKind, worktree: Worktree, base: string | null): Promise<GenerationInput>;
	/** What an agent must not change, as one text for each part, to compare before and after. A part Git could not read is null. Read-only. */
	worktreeState(worktree: string): Promise<WorktreeState>;
}

export type GenerationInput = { ok: true; data: string; leftOut: number | null } | { ok: false; message: string };

export type WorktreeState = Record<WorktreePart, string | null>;

/** Two reads of a worktree that differ, in the order they are told. A part that could not be read in either counts as changed: nothing shows that it is not. */
export function changedParts(before: WorktreeState, after: WorktreeState): WorktreePart[] {
	return (["files", "index", "HEAD", "refs", "stash"] as const).filter(part => before[part] === null || before[part] !== after[part]);
}

/** A whole diff is read up to this many bytes before it is cut: far more than an agent is given. */
const MAX_GENERATE_READ_BYTES = 8 * 1024 * 1024;

/** A whole diff as `diffArguments` gives one file's, with renames found, and nothing of the person's config run: no external diff, no text conversion. */
const WHOLE_DIFF = ["-c", "diff.autoRefreshIndex=false", "-c", "diff.noprefix=false", "-c", "diff.mnemonicPrefix=false", "diff", "--no-color", "--no-ext-diff", "--no-textconv", "-M"];

type GitRun = { ok: true; text: string; truncated: boolean } | { ok: false; message: string };

type FileList = { ok: true; files: FileChange[]; truncated: boolean } | { ok: false; message: string };

/** A commit hash is far shorter than this. */
const HASH_BYTES = 1024;

/** An untracked file larger than this is not read to count its lines: it shows no counts. */
export const MAX_COUNTED_BYTES = 16 * 1024 * 1024;
/** At most this many bytes of untracked files are read to count their lines for one list; the files after show no counts. */
export const MAX_COUNTED_TOTAL_BYTES = 64 * 1024 * 1024;

/** Files looked at on disk at once, for their counts and versions. */
const DISK_BATCH = 32;

const NO_COUNTS: LineCounts = { added: null, removed: null };

/** Each item through `work`, `DISK_BATCH` at a time, in order. */
async function inBatches<T, R>(items: readonly T[], work: (item: T) => Promise<R>): Promise<R[]> {
	const done: R[] = [];
	for (let index = 0; index < items.length; index += DISK_BATCH) done.push(...await Promise.all(items.slice(index, index + DISK_BATCH).map(work)));
	return done;
}

/**
 * The lines of an untracked file, as `git diff --no-index` counts them. A
 * link counts as the one line of its target, as Git shows it, and is never
 * followed. A folder, a file larger than `MAX_COUNTED_BYTES` or than what
 * is left of `budget`, or one that is gone shows none.
 */
async function untrackedCounts(worktree: string, path: string, budget: { bytes: number }): Promise<LineCounts> {
	const full = join(worktree, path);
	try {
		const stats = await lstat(full);
		if (stats.isSymbolicLink()) return { added: (await readlink(full)) === "" ? 0 : 1, removed: 0 };
		if (!stats.isFile() || stats.size > MAX_COUNTED_BYTES || stats.size > budget.bytes) return NO_COUNTS;
		budget.bytes -= stats.size;
		return countAddedLines(await Bun.file(full).bytes());
	} catch {
		return NO_COUNTS;
	}
}

/** The size and modification time of a file on disk, never following a link, or `-` when it is not there. */
async function stamp(worktree: string, path: string): Promise<string> {
	try {
		const stats = await lstat(join(worktree, path));
		return `${stats.size}:${stats.mtimeMs}`;
	} catch {
		return "-";
	}
}

/**
 * Each change's version, from what Git reported for it, the branch point
 * `commit` for the base, and the file on disk for every diff that reads it:
 * all but a staged change and a deletion.
 */
async function withVersions(worktree: string, files: readonly FileChange[], commit: string | null): Promise<FileChange[]> {
	return inBatches(files, async file => {
		const onDisk = file.area !== "staged" && file.kind !== "deleted";
		const parts = [file.area, file.kind, file.previousPath ?? "", file.version, file.area === "base" ? commit ?? "" : "", onDisk ? await stamp(worktree, file.path) : ""];
		return { ...file, version: Bun.hash(parts.join("\0")).toString(36) };
	});
}

/**
 * The changed files of a worktree and the diff of one, from Git.
 *
 * - Only a worktree that Timber lists, in a repository in the app's list, and
 *   whose folder is there (`findListedWorktree`), the same check as "Open in
 *   editor" and terminals.
 * - Git runs in the worktree as an executable plus arguments, never through
 *   a shell, with `GIT_OPTIONAL_LOCKS=0`, so that `git status` does not
 *   write the index as it otherwise does to refresh it, and every diff of
 *   tracked files with `diff.autoRefreshIndex` off, since `git diff` writes
 *   it even then. Paths are literal (`--literal-pathspecs`). Nothing here
 *   changes the repository except the writes below.
 * - Output is read up to a limit, and Git is stopped beyond it or after
 *   `GIT_MILLISECONDS`.
 * - A diff names its file by area and path. The status of that file is read
 *   again and the diff is built from what Git says now, never from what the
 *   interface sent, so a path cannot reach outside the worktree.
 * - Comparing with the base: the ref comes from the base Timber saved for
 *   the listed worktree, never from the window. The branch point is
 *   `git merge-base <base> HEAD`, worked out again for every list and diff.
 *   A base that cannot be used answers with the uncommitted list and the
 *   reason, never a failure.
 * - Staging and unstaging are writes through `writes`, and only to the
 *   index: the paths come from the status read again, never from the
 *   window (see `planIndexWrite`).
 * - Discarding is a write through `writes` too, and the only one that
 *   changes files on disk: only the files named, as the status read again
 *   lists them in one group (see `planDiscard`).
 * - Committing is the other write: one commit of what is staged on the
 *   current branch, refused unless Git says now that something is staged,
 *   HEAD is on a branch, and no operation is in progress (see `planCommit`).
 */
export function createFileChanges(dependencies: FileChangesDependencies): FileChanges {
	const { findRepository, git = "git", timeoutMilliseconds = GIT_MILLISECONDS, writes, commitMilliseconds = COMMIT_MILLISECONDS } = dependencies;

	async function run(cwd: string, args: readonly string[], limit: number, okExits: readonly number[]): Promise<GitRun> {
		// No index lock, and Git's own words in English, which `readDiffOutput` reads ("Binary files ... differ").
		const answer = await readGit(args, { git, cwd, timeoutMs: timeoutMilliseconds, limitBytes: limit, stderrBytes: STDERR_BYTES });
		if (!answer.started) return { ok: false, message: `Could not start Git: ${messageOf(answer.error)}` };
		if (answer.timedOut) return { ok: false, message: `Git took longer than ${timeoutMilliseconds / 1000} seconds and was stopped.` };
		if (answer.truncated) return { ok: true, text: answer.stdout, truncated: true };
		if (!okExits.includes(answer.exitCode ?? -1)) {
			const said = answer.stderr.trim();
			return { ok: false, message: said === "" ? `Git ended with exit code ${answer.exitCode ?? "unknown"}.` : said };
		}
		return { ok: true, text: answer.stdout, truncated: false };
	}

	/** A numstat's counts by path. Null when Git failed or was cut short: then no file of it shows counts. */
	async function numstat(worktree: string, args: readonly string[]): Promise<Map<string, LineCounts> | null> {
		const answer = await run(worktree, args, MAX_STATUS_BYTES, [0]);
		return answer.ok && !answer.truncated ? parseNumstat(answer.text) : null;
	}

	/** The counts of the untracked files among `files`, read from disk, by path. */
	async function untrackedLines(worktree: string, files: readonly FileChange[]): Promise<Map<string, LineCounts>> {
		const untracked = files.filter(file => file.kind === "untracked");
		const budget = { bytes: MAX_COUNTED_TOTAL_BYTES };
		const counts = await inBatches(untracked, file => untrackedCounts(worktree, file.path, budget));
		return new Map(untracked.map((file, index) => [file.path, counts[index]!]));
	}

	/** The uncommitted changes, with their counts and versions. */
	async function status(worktree: string, paths: readonly string[] = []): Promise<FileList> {
		const read = await statusOnly(worktree, paths);
		if (!read.ok) return read;
		// Only the files that are listed are counted and looked at on disk.
		const files = read.files.slice(0, MAX_LISTED_FILES);
		const more = read.files.length > MAX_LISTED_FILES;
		const has = (area: FileChange["area"]) => files.some(file => file.area === area && file.kind !== "untracked");
		const [staged, unstaged, untracked] = await Promise.all([
			has("staged") ? numstat(worktree, uncommittedContentArguments(true, paths)) : null,
			has("unstaged") ? numstat(worktree, uncommittedContentArguments(false, paths)) : null,
			untrackedLines(worktree, files),
		]);
		const counted = withLineCounts(files, file => {
			if (file.kind === "untracked") return untracked.get(file.path);
			if (file.area === "staged") return staged?.get(file.path);
			if (file.area === "unstaged") return unstaged?.get(file.path);
			return undefined;
		});
		return { ok: true, files: await withVersions(worktree, counted, null), truncated: read.truncated || more };
	}

	/** The status alone, without counts or versions, for the conflicts and untracked files of the comparison with the base. */
	async function statusOnly(worktree: string, paths: readonly string[] = []): Promise<FileList> {
		const answer = await run(worktree, statusArguments(paths), MAX_STATUS_BYTES, [0]);
		if (!answer.ok) return { ok: false, message: `Git could not read the status of ${worktree}: ${answer.message}` };
		return { ok: true, files: parseStatus(answer.text), truncated: answer.truncated };
	}

	/** The full hash of a commit, null when there is no such commit, or why Git could not say. */
	async function commitOf(worktree: string, revision: string): Promise<{ ok: true; commit: string | null } | { ok: false; message: string }> {
		const answer = await run(worktree, commitArguments(revision), HASH_BYTES, [0, 1]);
		if (!answer.ok) return { ok: false, message: answer.message };
		const commit = answer.text.trim();
		return { ok: true, commit: isCommitHash(commit) ? commit : null };
	}

	/** The merge, rebase, cherry-pick, or revert in progress in a worktree, from the files Git keeps for it there, or why Git could not say. */
	async function operationNow(worktree: string): Promise<{ ok: true; operation: GitOperation | null } | { ok: false; message: string }> {
		// Asked of Git, since a linked worktree keeps these in its own folder, not in the shared one.
		const answer = await run(worktree, ["rev-parse", ...OPERATION_MARKERS.flatMap(marker => ["--git-path", marker])], HASH_BYTES * OPERATION_MARKERS.length * 4, [0]);
		if (!answer.ok) return { ok: false, message: answer.message };
		const paths = answer.text.split("\n").filter(line => line !== "");
		if (paths.length !== OPERATION_MARKERS.length) return { ok: false, message: "Git did not name where it keeps the state of a merge or rebase." };
		const present = await Promise.all(paths.map(path => lstat(isAbsolute(path) ? path : join(worktree, path)).then(() => true, () => false)));
		return { ok: true, operation: operationOf(present) };
	}

	/** Whether HEAD is detached, or why Git could not say. */
	async function detachedNow(worktree: string): Promise<{ ok: true; detached: boolean } | { ok: false; message: string }> {
		const answer = await run(worktree, ["symbolic-ref", "-q", "HEAD"], HASH_BYTES, [0, 1]);
		return answer.ok ? { ok: true, detached: answer.text.trim() === "" } : answer;
	}

	/** Whether anything is staged: the index differs from HEAD, or from nothing before the first commit. Never cut short by a long list. */
	async function stagedNow(worktree: string): Promise<{ ok: true; staged: boolean } | { ok: false; message: string }> {
		const answer = await readGit(["diff", "--cached", "--quiet", "--no-ext-diff"], { git, cwd: worktree, timeoutMs: timeoutMilliseconds, stderrBytes: STDERR_BYTES });
		if (!answer.started) return { ok: false, message: `Could not start Git: ${messageOf(answer.error)}` };
		if (answer.timedOut) return { ok: false, message: `Git took longer than ${timeoutMilliseconds / 1000} seconds and was stopped.` };
		if (answer.exitCode === 0 || answer.exitCode === 1) return { ok: true, staged: answer.exitCode === 1 };
		const said = answer.stderr.trim();
		return { ok: false, message: said === "" ? `Git ended with exit code ${answer.exitCode ?? "unknown"}.` : said };
	}

	/**
	 * The commit command, from what Git says now: refused while an operation
	 * is in progress, on a detached HEAD, with nothing staged, or with an
	 * empty message, the same reasons the window gives (`commitBlocker`).
	 * `before` gets the commit HEAD points at, to tell afterwards whether a
	 * commit was made.
	 */
	async function planCommit(message: string, worktree: string, before: { commit: string | null }): Promise<GitWritePlan> {
		const refuse = (text: string): GitWritePlan => ({ ok: false, message: `${text} ${NOT_COMMITTED}` });
		const [operation, detached, staged, head] = await Promise.all([operationNow(worktree), detachedNow(worktree), stagedNow(worktree), commitOf(worktree, "HEAD")]);
		if (!operation.ok) return refuse(`Git could not say whether a merge or rebase is in progress: ${operation.message}`);
		if (!detached.ok) return refuse(`Git could not read this worktree's branch: ${detached.message}`);
		if (!staged.ok) return refuse(`Git could not say what is staged: ${staged.message}`);
		if (!head.ok) return refuse(`Git could not read this worktree's HEAD: ${head.message}`);
		const blocker = commitBlocker({ operation: operation.operation, detached: detached.detached, staged: staged.staged ? 1 : 0, message });
		if (blocker !== null) return refuse(blocker);
		before.commit = head.commit;
		return { ok: true, command: { args: [...COMMIT_ARGUMENTS], input: message }, line: COMMIT_COMMAND_LINE };
	}

	/** How a commit ended: made when HEAD moved, whatever Git's exit code, since a hook after the commit, or a stop, can follow it. */
	async function settleCommit(ran: GitWriteRan, worktree: string, before: string | null): Promise<CommitResult> {
		const after = await commitOf(worktree, "HEAD");
		if (after.ok && after.commit !== null && after.commit !== before) {
			const short = await run(worktree, ["rev-parse", "--short", after.commit], HASH_BYTES, [0]);
			return { outcome: "committed", command: ran.command, commit: after.commit, short: short.ok && short.text.trim() !== "" ? short.text.trim() : after.commit.slice(0, 7) };
		}
		if (ran.outcome === "failed") return ran;
		return { outcome: "failed", command: ran.command, message: after.ok ? "Git ended without making a commit." : `Git ended, and could not read this worktree's HEAD: ${after.message}` };
	}

	async function commit(request: CommitRequest): Promise<CommitResult> {
		const { repository, worktree, message, shown } = (request ?? {}) as Partial<CommitRequest>;
		// Only text reaches Git: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || typeof message !== "string" || !Array.isArray(shown) || shown.some(word => typeof word !== "string")) {
			return { outcome: "refused", message: `The request is not complete. ${NOT_COMMITTED}` };
		}
		if (emptyMessage(message)) return { outcome: "refused", message: `Write a commit message first. ${NOT_COMMITTED}` };
		if (!writes) return { outcome: "refused", message: `This app cannot commit. ${NOT_COMMITTED}` };
		const before: { commit: string | null } = { commit: null };
		return writes.writeAndSettle(
			{ repository, worktree, shown, consequence: NOT_COMMITTED, runAs: "terminal", timeoutMilliseconds: commitMilliseconds, plan: listed => planCommit(message, listed.path, before) },
			(ran, listed) => settleCommit(ran, listed.path, before.commit),
		);
	}

	/** Whether the worktree can be compared with the base Timber saved for it, and its branch point. */
	async function baseOf(worktree: Worktree): Promise<BaseComparison> {
		const saved = savedBaseRef(worktree.base);
		if (!saved.ok) return { usable: false, reason: saved.reason };
		const name = baseName(saved.ref);
		const head = await commitOf(worktree.path, "HEAD");
		if (!head.ok) return { usable: false, reason: `Git could not read this worktree's HEAD: ${head.message}` };
		if (head.commit === null) return { usable: false, reason: "This worktree has no commit yet, so there is no branch point to compare with." };
		const base = await commitOf(worktree.path, saved.ref);
		if (!base.ok) return { usable: false, reason: `Git could not read the base ${name}: ${base.message}` };
		const savedCommit = isCommitHash(saved.ref);
		if (base.commit === null) {
			// Missing, or a tree or blob. Timber never fetches a commit base, and a commit no branch contains does not arrive with a fetch.
			if (savedCommit) return { usable: false, reason: `The saved base ${name} is not a commit in this repository. Check the base Timber saved.` };
			return { usable: false, reason: `The saved base ${name} is not in this repository. Fetch, or check the base Timber saved.` };
		}
		// Git peels a tag's hash to the commit it names; Timber saves only a commit, so anything else is refused.
		if (savedCommit && base.commit !== saved.ref) return { usable: false, reason: `The saved base ${name} is not a commit. Check the base Timber saved.` };
		const answer = await run(worktree.path, ["merge-base", base.commit, head.commit], HASH_BYTES, [0, 1]);
		if (!answer.ok) return { usable: false, reason: `Git could not find where this branch left ${name}: ${answer.message}` };
		const commit = answer.text.trim();
		if (!isCommitHash(commit)) return { usable: false, reason: `This branch and ${name} share no history, so there is no branch point to compare with.` };
		return { usable: true, ref: saved.ref, name, commit };
	}

	/** Every change since the branch point `commit`, with conflicts and untracked files from the status. */
	async function changedSince(worktree: string, commit: string, paths: readonly string[] = []): Promise<FileList> {
		const read = await statusOnly(worktree, paths);
		if (!read.ok) return read;
		const [answer, content] = await Promise.all([
			run(worktree, baseNamesArguments(commit, paths), MAX_STATUS_BYTES, [0]),
			run(worktree, baseContentArguments(commit, paths), MAX_STATUS_BYTES, [0]),
		]);
		if (!answer.ok) return { ok: false, message: `Git could not compare ${worktree} with its base: ${answer.message}` };
		// Counts that failed or were cut short check nothing: every name is kept rather than a real change left out.
		const counts = content.ok && !content.truncated ? parseNumstat(content.text) : null;
		const changed = withChangedContent(parseNameStatus(answer.text), counts === null ? null : new Set(counts.keys()));
		const all = sinceBase(read.files, changed);
		const files = all.slice(0, MAX_LISTED_FILES);
		const untracked = await untrackedLines(worktree, files);
		const counted = withLineCounts(files, file => (file.area === "untracked" ? untracked.get(file.path) : file.area === "base" ? counts?.get(file.path) : undefined));
		return { ok: true, files: await withVersions(worktree, counted, commit), truncated: read.truncated || answer.truncated || all.length > MAX_LISTED_FILES };
	}

	/**
	 * The command that stages or unstages the files the window named, built
	 * from the status Git reports now: every file must be listed there, in a
	 * group that can take the action, or nothing runs.
	 */
	async function planIndexWrite(action: IndexAction, request: IndexWriteRequest, worktree: string): Promise<GitWritePlan> {
		const refuse = (message: string): GitWritePlan => ({ ok: false, message: `${message} ${NOT_WRITTEN[action]}` });
		const files = Array.isArray(request.files) ? request.files : [];
		if (files.length === 0) return refuse("No file was named.");
		for (const file of files) {
			if (typeof file?.path !== "string" || (file.previousPath !== null && typeof file.previousPath !== "string")) return refuse("A file in the request is not complete.");
			for (const path of [file.path, file.previousPath]) {
				const problem = path === null ? null : relativePathProblem(path);
				if (problem !== null) return refuse(problem);
			}
		}
		const read = await statusOnly(worktree);
		if (!read.ok) return refuse(read.message);
		if (read.truncated) return refuse("The status of this worktree is too long to read whole.");
		const found: FileChange[] = [];
		for (const file of files) {
			const current = read.files.find(candidate => sameFileChange(candidate, file));
			if (!current || !canWriteIndex(action, current.area)) return refuse(`${file.path} is no longer ${action === "stage" ? "a change that can be staged" : "staged"} in this worktree.`);
			found.push(current);
		}
		const head = await commitOf(worktree, "HEAD");
		if (!head.ok) return refuse(`Git could not read this worktree's HEAD: ${head.message}`);
		return { ok: true, command: indexCommand(action, found, head.commit !== null) };
	}

	/**
	 * The command that discards the files the window named, built from the
	 * status Git reports now: every file must be listed there, all in one
	 * group that can be discarded, or nothing runs. An untracked folder, as
	 * Git lists a nested repository, is never deleted.
	 */
	async function planDiscard(request: DiscardRequest, worktree: string): Promise<GitWritePlan> {
		const refuse = (message: string): GitWritePlan => ({ ok: false, message: `${message} ${NOT_DISCARDED}` });
		const files = Array.isArray(request.files) ? request.files : [];
		if (files.length === 0) return refuse("No file was named.");
		for (const file of files) {
			if (typeof file?.path !== "string" || (file.previousPath !== null && typeof file.previousPath !== "string")) return refuse("A file in the request is not complete.");
			for (const path of [file.path, file.previousPath]) {
				const problem = path === null ? null : relativePathProblem(path);
				if (problem !== null) return refuse(problem);
			}
		}
		const read = await statusOnly(worktree);
		if (!read.ok) return refuse(read.message);
		if (read.truncated) return refuse("The status of this worktree is too long to read whole.");
		const head = await commitOf(worktree, "HEAD");
		if (!head.ok) return refuse(`Git could not read this worktree's HEAD: ${head.message}`);
		const found: FileChange[] = [];
		for (const file of files) {
			const current = read.files.find(candidate => sameFileChange(candidate, file));
			if (!current || !canDiscard(current.area, head.commit !== null)) return refuse(`${file.path} is no longer a change that can be discarded in this worktree.`);
			if (current.area === "untracked" && current.path.endsWith("/")) return refuse(`${current.path} is a folder, which is never deleted from here.`);
			found.push(current);
		}
		const planned = discardCommand(found, head.commit !== null);
		return planned.ok ? planned : refuse(planned.message);
	}

	async function discard(request: DiscardRequest): Promise<DiscardResult> {
		const { repository, worktree, shown } = (request ?? {}) as Partial<DiscardRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || !Array.isArray(shown) || shown.some(word => typeof word !== "string")) {
			return { outcome: "refused", message: `The request is not complete. ${NOT_DISCARDED}` };
		}
		if (!writes) return { outcome: "refused", message: `This app cannot discard changes. ${NOT_DISCARDED}` };
		return writes.write({ repository, worktree, shown, consequence: NOT_DISCARDED, plan: listed => planDiscard(request, listed.path) });
	}

	async function writeIndex(action: IndexAction, request: IndexWriteRequest): Promise<IndexWriteResult> {
		const { repository, worktree, shown } = (request ?? {}) as Partial<IndexWriteRequest>;
		// Only text becomes an argument: the request comes over the bridge.
		if (typeof repository !== "string" || typeof worktree !== "string" || !Array.isArray(shown) || shown.some(word => typeof word !== "string")) {
			return { outcome: "refused", message: `The request is not complete. ${NOT_WRITTEN[action]}` };
		}
		if (!writes) return { outcome: "refused", message: `This app cannot write the index. ${NOT_WRITTEN[action]}` };
		return writes.write({ repository, worktree, shown, consequence: NOT_WRITTEN[action], plan: listed => planIndexWrite(action, request, listed.path) });
	}

	/** The branch point to describe a pull request from: the form's base, a branch on the remote, or the saved base. */
	async function pullRequestBase(worktree: Worktree, base: string | null): Promise<{ ok: true; commit: string } | { ok: false; message: string }> {
		if (base === null) {
			const saved = await baseOf(worktree);
			return saved.usable ? { ok: true, commit: saved.commit } : { ok: false, message: saved.reason };
		}
		const missing = `The base ${base} is not a branch on the remote in this repository. Fetch, or check the Base field.`;
		// Only ever a remote-tracking ref, by its full name, so what is typed cannot be an option or another revision.
		if (base === "" || /[\0\s~^:?*[\\]|\.\.|@\{/.test(base)) return { ok: false, message: missing };
		const found = await commitOf(worktree.path, `refs/remotes/${base}`);
		if (!found.ok) return { ok: false, message: `Git could not read the base ${base}: ${found.message}` };
		if (found.commit === null) return { ok: false, message: missing };
		const answer = await run(worktree.path, ["merge-base", found.commit, "HEAD"], HASH_BYTES, [0, 1]);
		if (!answer.ok) return { ok: false, message: `Git could not find where this branch left ${base}: ${answer.message}` };
		const commit = answer.text.trim();
		return isCommitHash(commit) ? { ok: true, commit } : { ok: false, message: `This branch and ${base} share no history.` };
	}

	async function generationInput(kind: GenerateKind, worktree: Worktree, base: string | null): Promise<GenerationInput> {
		const refuse = (message: string): GenerationInput => ({ ok: false, message });
		const [operation, detached] = await Promise.all([operationNow(worktree.path), detachedNow(worktree.path)]);
		if (!operation.ok) return refuse(`Git could not say whether a merge or rebase is in progress: ${operation.message}`);
		if (!detached.ok) return refuse(`Git could not read this worktree's branch: ${detached.message}`);
		let args: string[];
		let log = "";
		if (kind === "commit") {
			const staged = await stagedNow(worktree.path);
			if (!staged.ok) return refuse(`Git could not say what is staged: ${staged.message}`);
			const blocker = commitGenerateBlocker({ operation: operation.operation, detached: detached.detached, staged: staged.staged ? 1 : 0 });
			if (blocker !== null) return refuse(blocker);
			args = [...WHOLE_DIFF, "--cached", "--"];
		} else {
			if (detached.detached) return refuse("HEAD is detached, so there is no branch to open a pull request from.");
			const from = await pullRequestBase(worktree, base);
			if (!from.ok) return refuse(from.message);
			const range = `${from.commit}..HEAD`;
			const commits = await run(worktree.path, ["log", "--no-color", "--no-show-signature", "--no-notes", "--no-decorate", "--no-mailmap", "--format=%B", range, "--"], MAX_GENERATE_LOG_BYTES, [0]);
			if (!commits.ok) return refuse(`Git could not read this branch's commits: ${commits.message}`);
			const count = await run(worktree.path, ["rev-list", "--count", range, "--"], HASH_BYTES, [0]);
			if (!count.ok) return refuse(`Git could not count this branch's commits: ${count.message}`);
			if (count.text.trim() === "0") return refuse(NO_COMMITS_AHEAD);
			log = `Commit messages, newest first:\n${commits.text}\n\nDiff:\n`;
			args = [...WHOLE_DIFF, from.commit, "HEAD", "--"];
		}
		const diff = await run(worktree.path, args, MAX_GENERATE_READ_BYTES, [0]);
		if (!diff.ok) return refuse(`Git could not read the diff: ${diff.message}`);
		const cut = cutDiff(diff.text, diff.truncated);
		return { ok: true, data: `${log}${cut.text}`, leftOut: diff.truncated ? null : cut.leftOut };
	}

	async function worktreeState(worktree: string): Promise<WorktreeState> {
		const read = async (args: string[]) => {
			const answer = await run(worktree, args, MAX_STATUS_BYTES, [0]);
			return answer.ok && !answer.truncated ? answer.text : null;
		};
		const [status, index, head, branch, refs, stash] = await Promise.all([
			statusOnly(worktree),
			read(["ls-files", "--stage", "-z"]),
			read(["rev-parse", "--verify", "--quiet", "HEAD"]).then(text => text ?? "none"),
			run(worktree, ["symbolic-ref", "-q", "HEAD"], HASH_BYTES, [0, 1]),
			// A branch checked out in another worktree moves by what is done there, and a fetch moves only remote-tracking refs: neither is told.
			read(["for-each-ref", "--format=%(refname)%00%(objectname)%00%(worktreepath)", "refs/heads", "refs/tags"]),
			run(worktree, ["rev-parse", "--verify", "--quiet", "refs/stash"], HASH_BYTES, [0, 1]),
		]);
		const own = branch.ok ? branch.text.trim() : "";
		const told = refs?.split("\n").filter(line => {
			const [name, , elsewhere] = line.split("\0");
			return line !== "" && (name === own || !elsewhere);
		}).join("\n") ?? null;
		const listedFiles = status.ok && !status.truncated ? await inBatches(status.files, async file => `${file.area}\0${file.kind}\0${file.previousPath ?? ""}\0${file.path}\0${await stamp(worktree, file.path)}`) : null;
		return {
			"files": listedFiles === null ? null : listedFiles.join("\n"),
			index,
			"HEAD": branch.ok ? `${own} ${head}` : null,
			"refs": told,
			"stash": stash.ok ? stash.text.trim() : null,
		};
	}

	return {
		generationInput,
		worktreeState,

		async read(request) {
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_READ);
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };
			const [base, head, operation, detached] = await Promise.all([baseOf(listed.worktree), commitOf(request.worktree, "HEAD"), operationNow(request.worktree), detachedNow(request.worktree)]);
			const compared = request.compare === "base" && base.usable ? "base" : "uncommitted";
			const read = base.usable && compared === "base" ? await changedSince(request.worktree, base.commit) : await status(request.worktree);
			if (!read.ok) return { outcome: "failed", message: read.message };
			const more = read.truncated || read.files.length > MAX_LISTED_FILES;
			// When HEAD cannot be read, unstaging is offered as `git restore`, and Git's message says why it fails.
			const hasCommit = !head.ok || head.commit !== null;
			// When Git cannot say, Commit is offered, and the main process asks again before it runs.
			return { outcome: "read", files: read.files.slice(0, MAX_LISTED_FILES), more, compared, base, hasCommit, operation: operation.ok ? operation.operation : null, detached: detached.ok && detached.detached };
		},

		stage: request => writeIndex("stage", request),
		unstage: request => writeIndex("unstage", request),
		discard,
		commit,

		async diff(request) {
			const { file } = request;
			for (const path of [file.path, file.previousPath]) {
				const problem = path === null ? null : relativePathProblem(path);
				if (problem !== null) return { outcome: "failed", message: `${problem} ${NOT_READ}` };
			}
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_READ);
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };

			// Both paths, so that a rename is still found as one.
			const paths = file.previousPath === null ? [file.path] : [file.previousPath, file.path];
			const base = request.compare === "base" ? await baseOf(listed.worktree) : null;
			const commit = base?.usable ? base.commit : null;
			const read = commit === null ? await status(request.worktree, paths) : await changedSince(request.worktree, commit, paths);
			if (!read.ok) return { outcome: "failed", message: read.message };
			const current = read.files.find(candidate => candidate.area === file.area && candidate.path === file.path);
			if (!current) return { outcome: "read", file: null, diff: { kind: "unchanged" } };

			const { args, differencesExit } = diffArguments(current, commit);
			const answer = await run(request.worktree, args, MAX_DIFF_BYTES, differencesExit ? [0, 1] : [0]);
			if (!answer.ok) return { outcome: "failed", message: `Git could not show the changes of ${current.path}: ${answer.message}` };
			return { outcome: "read", file: current, diff: readDiffOutput(answer.text, answer.truncated) };
		},
	};
}
