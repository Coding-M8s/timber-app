import { constants } from "node:fs";
import { type FileHandle, lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { relativePathProblem } from "../shared/file-changes";
import { messageOf } from "../shared/error-message";
import { type FileContent, MAX_FILE_BYTES, type OutsideFileRequest, type WorktreeFileRequest, type WorktreeFileResult, type WorktreeFileWriteRequest, type WorktreeFileWriteResult, fileContentOf, isCompletePath, textToSaveProblem } from "../shared/worktree-files";
import { type FindRepository, findListedWorktree } from "./listed-worktree";

const NOT_READ = "The file was not read.";
const NOT_SAVED = "Nothing was saved.";

export interface WorktreeFilesDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
}

/** The file viewer's side in the main process. */
export interface WorktreeFiles {
	read(request: WorktreeFileRequest): Promise<WorktreeFileResult>;
	/** A file anywhere on disk, by its complete path, read-only (see `readFileOutside` in src/shared/engine.ts). */
	readOutside(request: OutsideFileRequest): Promise<WorktreeFileResult>;
	write(request: WorktreeFileWriteRequest): Promise<WorktreeFileWriteResult>;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Whether `inner` is `outer` or inside it, both already real paths. */
function inside(outer: string, inner: string): boolean {
	const between = relative(outer, inner);
	return between === "" || (!between.startsWith(`..${sep}`) && between !== ".." && !isAbsolute(between));
}

type Refusal = Exclude<WorktreeFileResult, { outcome: "read" }>;

/** The byte order mark some editors put at the start of a UTF-8 file. Reading drops it, and saving keeps it. */
const BOM = [0xef, 0xbb, 0xbf];
const startsWithBom = (bytes: Uint8Array) => bytes.length >= 3 && BOM.every((byte, index) => bytes[index] === byte);

/**
 * Where a file of a worktree really is, or why it may not be touched.
 *
 * - Only a worktree that Timber lists, in a repository in the app's list,
 *   whose folder is there (`findListedWorktree`), as the Changes view.
 * - The path must be relative and stay inside the worktree as written
 *   (`relativePathProblem`), and the real path of the file, every link
 *   followed, must still be inside the real path of the worktree, so a link
 *   cannot lead out of it.
 * - Only a plain file that is there already.
 */
async function locate(findRepository: FindRepository, request: WorktreeFileRequest, untouched: string): Promise<{ ok: true; real: string } | { ok: false; refusal: Refusal }> {
	const { path } = request;
	const refuse = (refusal: Refusal) => ({ ok: false as const, refusal });
	const problem = relativePathProblem(path);
	if (problem !== null) return refuse({ outcome: "outside", path, message: `${problem} ${untouched}` });
	const listed = await findListedWorktree(findRepository, request.repository, request.worktree, untouched);
	if (!listed.ok) return refuse({ outcome: "not-listed", message: listed.message });

	const full = `${request.worktree}${request.worktree.endsWith(sep) ? "" : sep}${path.split("/").join(sep)}`;
	let real: string;
	try {
		real = await realpath(full);
	} catch (error) {
		const code = codeOf(error);
		if (code === "ENOENT" || code === "ENOTDIR") {
			// A link whose target is gone is there, but leads nowhere.
			const link = await lstat(full).then(found => found.isSymbolicLink(), () => false);
			return refuse(link
				? { outcome: "missing", path, message: `${path} is a link to a file that is not there.` }
				: { outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted.` });
		}
		return refuse({ outcome: "failed", message: `Could not find ${path}: ${messageOf(error)}` });
	}
	let root: string;
	try {
		root = await realpath(request.worktree);
	} catch (error) {
		return refuse({ outcome: "failed", message: `Could not find the worktree folder ${request.worktree}: ${messageOf(error)}` });
	}
	if (!inside(root, real)) return refuse({ outcome: "outside", path, message: `${path} leads outside this worktree, to ${real}. ${untouched}`, target: real });
	if (real === root) return refuse({ outcome: "outside", path, message: `${path} leads to the worktree folder itself. ${untouched}` });
	try {
		const found = await stat(real);
		if (found.isDirectory()) return refuse({ outcome: "not-a-file", path, message: `${path} is a folder, not a file.` });
		if (!found.isFile()) return refuse({ outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not ${untouched === NOT_READ ? "read" : "saved"}.` });
	} catch (error) {
		if (codeOf(error) === "ENOENT") return refuse({ outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted.` });
		return refuse({ outcome: "failed", message: `Could not find ${path}: ${messageOf(error)}` });
	}
	return { ok: true, real };
}

/**
 * Where a file outside every worktree really is, or why it is not read: the
 * path must be complete, and only a plain file that is there is read.
 */
async function locateOutside(path: unknown): Promise<{ ok: true; real: string } | { ok: false; refusal: Refusal }> {
	const refuse = (refusal: Refusal) => ({ ok: false as const, refusal });
	if (typeof path !== "string" || path.includes("\0") || !isCompletePath(path) || !isAbsolute(path)) {
		return refuse({ outcome: "failed", message: `${typeof path === "string" && path !== "" ? path.replaceAll("\0", "") : "That"} is not a complete path, so it is not read outside the worktree. ${NOT_READ}` });
	}
	let real: string;
	try {
		real = await realpath(path);
	} catch (error) {
		const code = codeOf(error);
		if (code === "ENOENT" || code === "ENOTDIR") {
			const link = await lstat(path).then(found => found.isSymbolicLink(), () => false);
			return refuse({ outcome: "missing", path, message: link ? `${path} is a link to a file that is not there.` : `${path} is not there. It may have been moved or deleted.` });
		}
		if (code === "EACCES" || code === "EPERM") return refuse({ outcome: "failed", message: `This app may not read ${path}.` });
		return refuse({ outcome: "failed", message: `Could not find ${path}: ${messageOf(error)}` });
	}
	try {
		const found = await stat(real);
		if (found.isDirectory()) return refuse({ outcome: "not-a-file", path, message: `${path} is a folder, not a file.` });
		if (!found.isFile()) return refuse({ outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not read.` });
	} catch (error) {
		if (codeOf(error) === "ENOENT") return refuse({ outcome: "missing", path, message: `${path} is not there. It may have been moved or deleted.` });
		return refuse({ outcome: "failed", message: `Could not find ${path}: ${messageOf(error)}` });
	}
	return { ok: true, real };
}

/** The bytes of an open file, at most `MAX_FILE_BYTES` and one more, whatever size it claimed. */
async function readStart(handle: FileHandle): Promise<Uint8Array> {
	const buffer = new Uint8Array(MAX_FILE_BYTES + 1);
	let length = 0;
	while (length < buffer.length) {
		const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
		if (bytesRead === 0) break;
		length += bytesRead;
	}
	return buffer.subarray(0, length);
}

/**
 * A plain file at its real path, read, answered for `path` as it was asked
 * for. Opened without blocking, in case the file turned into a pipe since it
 * was looked at, and at most `MAX_FILE_BYTES` and one more byte are read.
 */
async function readPlainFile(real: string, path: string, gone: string): Promise<WorktreeFileResult> {
	try {
		const handle = await open(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
		try {
			const opened = await handle.stat();
			if (!opened.isFile()) return { outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not read.` };
			const bytes = await readStart(handle);
			return { outcome: "read", path, content: fileContentOf(bytes, Math.max(opened.size, bytes.length)) };
		} finally {
			await handle.close();
		}
	} catch (error) {
		const code = codeOf(error);
		if (code === "ENOENT") return { outcome: "missing", path, message: gone };
		if (code === "EACCES" || code === "EPERM") return { outcome: "failed", message: `This app may not read ${path}.` };
		return { outcome: "failed", message: `Could not read ${path}: ${messageOf(error)}` };
	}
}

/**
 * One file of a worktree, read from disk, or saved there.
 *
 * - Both go through `locate`, so only a plain file inside a listed worktree,
 *   links included, is touched. A link that leads out is answered with its
 *   real target, unread.
 * - `readOutside` reads any plain file by its complete path, and nothing can
 *   save it: `write` takes only files inside a listed worktree.
 * - Only a plain file is opened, without blocking, so a pipe or a device
 *   cannot hold the read.
 * - At most `MAX_FILE_BYTES` and one more byte are read, whatever size the
 *   file claimed, so a file that grows while it is read is still refused.
 * - A read writes nothing. A save writes only that file, in place: no new
 *   file, no temporary file beside it, and its mode and links stay as they
 *   are. It never creates a file, and it writes nothing when the file holds
 *   something other than the text the window edited.
 * - Git is not run.
 */
export function createWorktreeFiles(dependencies: WorktreeFilesDependencies): WorktreeFiles {
	const { findRepository } = dependencies;
	return {
		async read(request) {
			const located = await locate(findRepository, request, NOT_READ);
			if (!located.ok) return located.refusal;
			return readPlainFile(located.real, request.path, `${request.path} is not in this worktree. It may have been moved or deleted.`);
		},

		async readOutside(request) {
			const located = await locateOutside((request as Partial<OutsideFileRequest> | null)?.path);
			if (!located.ok) return located.refusal;
			return readPlainFile(located.real, request.path, `${request.path} is not there. It may have been moved or deleted.`);
		},

		async write(request) {
			const { path, text, expected } = request;
			const tooLarge = textToSaveProblem(text);
			if (tooLarge !== null) return { outcome: "too-large", path, message: `${tooLarge} ${NOT_SAVED}` };
			const located = await locate(findRepository, request, NOT_SAVED);
			if (!located.ok) return located.refusal;
			try {
				// Never O_CREAT: only a file that is there is written.
				const handle = await open(located.real, constants.O_RDWR | (constants.O_NONBLOCK ?? 0));
				try {
					const opened = await handle.stat();
					if (!opened.isFile()) return { outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not saved.` };
					const before = await readStart(handle);
					const now: FileContent = fileContentOf(before, Math.max(opened.size, before.length));
					if (expected !== null && (now.kind !== "text" || now.text !== expected)) {
						return { outcome: "changed", path, content: now, message: `${path} changed on disk since it was opened. ${NOT_SAVED}` };
					}
					const encoded = new TextEncoder().encode(text);
					const bytes = startsWithBom(before) ? new Uint8Array([...BOM, ...encoded]) : encoded;
					await handle.truncate(0);
					let written = 0;
					while (written < bytes.length) {
						const { bytesWritten } = await handle.write(bytes, written, bytes.length - written, written);
						written += bytesWritten;
					}
					return { outcome: "saved", path, content: fileContentOf(bytes, bytes.length) };
				} finally {
					await handle.close();
				}
			} catch (error) {
				const code = codeOf(error);
				if (code === "ENOENT") return { outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted. ${NOT_SAVED}` };
				if (code === "EACCES" || code === "EPERM" || code === "EROFS") return { outcome: "failed", message: `This app may not write ${path}. ${NOT_SAVED}` };
				return { outcome: "failed", message: `Could not save ${path}: ${messageOf(error)}` };
			}
		},
	};
}
