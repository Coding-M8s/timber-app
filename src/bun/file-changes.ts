import {
	type BaseComparison, type FileChange, type FileChangesRequest, type FileChangesResult, type FileDiffRequest, type FileDiffResult,
	MAX_DIFF_BYTES, MAX_LISTED_FILES, MAX_STATUS_BYTES, baseContentArguments, baseNamesArguments, commitArguments, diffArguments, isCommitHash, parseNameStatus, parseNumstatPaths, parseStatus,
	baseName, readDiffOutput, relativePathProblem, savedBaseRef, sinceBase, statusArguments, withChangedContent,
} from "../shared/file-changes";
import type { Worktree } from "../shared/model";
import { type FindRepository, findListedWorktree } from "./listed-worktree";
import { messageOf } from "../shared/error-message";
import { readGit } from "./read-git";

/** Git is stopped when it takes longer than this, so a stuck read cannot hold the tab forever. */
const GIT_MILLISECONDS = 20_000;

/** Standard error is kept up to this many bytes, for the message when Git fails. */
const STDERR_BYTES = 4096;

const NOT_READ = "No changes were read.";

export interface FileChangesDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
	/** The Git executable. Tests may pass another. */
	git?: string;
	/** How long Git may take. Tests shorten it. */
	timeoutMilliseconds?: number;
}

/** The Changes view's side in the main process: the changed files of a worktree, and the diff of one. Read-only. */
export interface FileChanges {
	read(request: FileChangesRequest): Promise<FileChangesResult>;
	diff(request: FileDiffRequest): Promise<FileDiffResult>;
}

type GitRun = { ok: true; text: string; truncated: boolean } | { ok: false; message: string };

type FileList = { ok: true; files: FileChange[]; truncated: boolean } | { ok: false; message: string };

/** A commit hash is far shorter than this. */
const HASH_BYTES = 1024;

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
 *   changes the repository.
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
 */
export function createFileChanges(dependencies: FileChangesDependencies): FileChanges {
	const { findRepository, git = "git", timeoutMilliseconds = GIT_MILLISECONDS } = dependencies;

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

	async function status(worktree: string, paths: readonly string[] = []): Promise<FileList> {
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
		const read = await status(worktree, paths);
		if (!read.ok) return read;
		const [answer, content] = await Promise.all([
			run(worktree, baseNamesArguments(commit, paths), MAX_STATUS_BYTES, [0]),
			run(worktree, baseContentArguments(commit, paths), MAX_STATUS_BYTES, [0]),
		]);
		if (!answer.ok) return { ok: false, message: `Git could not compare ${worktree} with its base: ${answer.message}` };
		// Counts that failed or were cut short check nothing: every name is kept rather than a real change left out.
		const changed = withChangedContent(parseNameStatus(answer.text), content.ok && !content.truncated ? parseNumstatPaths(content.text) : null);
		return { ok: true, files: sinceBase(read.files, changed), truncated: read.truncated || answer.truncated };
	}

	return {
		async read(request) {
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_READ);
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };
			const base = await baseOf(listed.worktree);
			const compared = request.compare === "base" && base.usable ? "base" : "uncommitted";
			const read = base.usable && compared === "base" ? await changedSince(request.worktree, base.commit) : await status(request.worktree);
			if (!read.ok) return { outcome: "failed", message: read.message };
			const more = read.truncated || read.files.length > MAX_LISTED_FILES;
			return { outcome: "read", files: read.files.slice(0, MAX_LISTED_FILES), more, compared, base };
		},

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
