import {
	type FileChange, type FileChangesRequest, type FileChangesResult, type FileDiffRequest, type FileDiffResult,
	MAX_DIFF_BYTES, MAX_LISTED_FILES, MAX_STATUS_BYTES, diffArguments, parseStatus, readDiffOutput, relativePathProblem, statusArguments,
} from "../shared/file-changes";
import { type FindRepository, findListedWorktree } from "./listed-worktree";

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

/** The Changes tab's side in the main process: the changed files of a worktree, and the diff of one. Read-only. */
export interface FileChanges {
	read(request: FileChangesRequest): Promise<FileChangesResult>;
	diff(request: FileDiffRequest): Promise<FileDiffResult>;
}

type GitRun = { ok: true; text: string; truncated: boolean } | { ok: false; message: string };

function messageOf(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

/**
 * Read a stream up to `limit` bytes. Returns what was read and whether there
 * was more. `stops` gets a function that ends the reading early, for when
 * Git is stopped: a process Git started could otherwise hold the stream open.
 */
async function readUpTo(stream: ReadableStream<Uint8Array>, limit: number, onOver: () => void, stops: (() => void)[]): Promise<{ bytes: Uint8Array; over: boolean }> {
	const chunks: Uint8Array[] = [];
	let size = 0;
	let over = false;
	const reader = stream.getReader();
	stops.push(() => void reader.cancel().catch(() => {}));
	try {
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			const room = limit - size;
			if (value.byteLength > room) {
				chunks.push(value.subarray(0, room));
				size = limit;
				over = true;
				onOver();
				break;
			}
			chunks.push(value);
			size += value.byteLength;
		}
	} finally {
		await reader.cancel().catch(() => {});
	}
	const bytes = new Uint8Array(size);
	let offset = 0;
	for (const chunk of chunks) {
		bytes.set(chunk, offset);
		offset += chunk.byteLength;
	}
	return { bytes, over };
}

/**
 * The changed files of a worktree and the diff of one, from Git.
 *
 * - Only a worktree that Timber lists, in a repository in the app's list, and
 *   whose folder is there (`findListedWorktree`), the same check as "Open in
 *   editor" and terminals.
 * - Git runs in the worktree as an executable plus arguments, never through
 *   a shell, with `GIT_OPTIONAL_LOCKS=0`, so that neither `git status` nor
 *   `git diff` writes the index as they otherwise do to refresh it. Paths are
 *   literal (`--literal-pathspecs`). Nothing here changes the repository.
 * - Output is read up to a limit, and Git is stopped beyond it or after
 *   `GIT_MILLISECONDS`.
 * - A diff names its file by area and path. The status of that file is read
 *   again and the diff is built from what Git says now, never from what the
 *   interface sent, so a path cannot reach outside the worktree.
 */
export function createFileChanges(dependencies: FileChangesDependencies): FileChanges {
	const { findRepository, git = "git", timeoutMilliseconds = GIT_MILLISECONDS } = dependencies;

	async function run(cwd: string, args: readonly string[], limit: number, okExits: readonly number[]): Promise<GitRun> {
		let child: Bun.Subprocess<"ignore", "pipe", "pipe">;
		try {
			child = Bun.spawn([git, ...args], {
				cwd,
				stdin: "ignore",
				stdout: "pipe",
				stderr: "pipe",
				// No index refresh, and Git's own words in English, which `readDiffOutput` reads ("Binary files ... differ").
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0", LC_ALL: "C" },
			});
		} catch (error) {
			return { ok: false, message: `Could not start Git: ${messageOf(error)}` };
		}
		let timedOut = false;
		const stops: (() => void)[] = [];
		const timer = setTimeout(() => {
			timedOut = true;
			child.kill();
			for (const stop of stops) stop();
		}, timeoutMilliseconds);
		try {
			const [out, err] = await Promise.all([
				readUpTo(child.stdout, limit, () => child.kill(), stops),
				readUpTo(child.stderr, STDERR_BYTES, () => {}, stops),
				child.exited,
			]);
			if (timedOut) return { ok: false, message: `Git took longer than ${timeoutMilliseconds / 1000} seconds and was stopped.` };
			const text = new TextDecoder().decode(out.bytes);
			if (out.over) return { ok: true, text, truncated: true };
			if (!okExits.includes(child.exitCode ?? -1)) {
				const said = new TextDecoder().decode(err.bytes).trim();
				return { ok: false, message: said === "" ? `Git ended with exit code ${child.exitCode ?? "unknown"}.` : said };
			}
			return { ok: true, text, truncated: false };
		} finally {
			clearTimeout(timer);
		}
	}

	async function status(worktree: string, paths: readonly string[] = []): Promise<{ ok: true; files: FileChange[]; truncated: boolean } | { ok: false; message: string }> {
		const answer = await run(worktree, statusArguments(paths), MAX_STATUS_BYTES, [0]);
		if (!answer.ok) return { ok: false, message: `Git could not read the status of ${worktree}: ${answer.message}` };
		return { ok: true, files: parseStatus(answer.text), truncated: answer.truncated };
	}

	return {
		async read(request) {
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_READ);
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };
			const read = await status(request.worktree);
			if (!read.ok) return { outcome: "failed", message: read.message };
			const more = read.truncated || read.files.length > MAX_LISTED_FILES;
			return { outcome: "read", files: read.files.slice(0, MAX_LISTED_FILES), more };
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
			const read = await status(request.worktree, paths);
			if (!read.ok) return { outcome: "failed", message: read.message };
			const current = read.files.find(candidate => candidate.area === file.area && candidate.path === file.path);
			if (!current) return { outcome: "read", file: null, diff: { kind: "unchanged" } };

			const { args, differencesExit } = diffArguments(current);
			const answer = await run(request.worktree, args, MAX_DIFF_BYTES, differencesExit ? [0, 1] : [0]);
			if (!answer.ok) return { outcome: "failed", message: `Git could not show the changes of ${current.path}: ${answer.message}` };
			return { outcome: "read", file: current, diff: readDiffOutput(answer.text, answer.truncated) };
		},
	};
}
