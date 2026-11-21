import { constants } from "node:fs";
import { lstat, open, realpath, stat } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";
import { relativePathProblem } from "../shared/file-changes";
import { messageOf } from "../shared/error-message";
import { MAX_FILE_BYTES, type WorktreeFileRequest, type WorktreeFileResult, fileContentOf } from "../shared/worktree-files";
import { type FindRepository, findListedWorktree } from "./listed-worktree";

const NOT_READ = "The file was not read.";

export interface WorktreeFilesDependencies {
	/** The repository in the app's list, read again (see ./listed-worktree.ts). */
	findRepository: FindRepository;
}

/** The file viewer's side in the main process. Read-only. */
export interface WorktreeFiles {
	read(request: WorktreeFileRequest): Promise<WorktreeFileResult>;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Whether `inner` is `outer` or inside it, both already real paths. */
function inside(outer: string, inner: string): boolean {
	const between = relative(outer, inner);
	return between === "" || (!between.startsWith(`..${sep}`) && between !== ".." && !isAbsolute(between));
}

/**
 * One file of a worktree, read from disk.
 *
 * - Only a worktree that Timber lists, in a repository in the app's list,
 *   whose folder is there (`findListedWorktree`), as the Changes tab.
 * - The path must be relative and stay inside the worktree as written
 *   (`relativePathProblem`), and the real path of the file, every link
 *   followed, must still be inside the real path of the worktree, so a link
 *   cannot lead out of it.
 * - Only a plain file is opened, so a pipe or a device cannot hold the read.
 * - At most `MAX_FILE_BYTES` and one more byte are read, whatever size the
 *   file claimed, so a file that grows while it is read is still refused.
 * - Nothing is written, and Git is not run.
 */
export function createWorktreeFiles(dependencies: WorktreeFilesDependencies): WorktreeFiles {
	const { findRepository } = dependencies;
	return {
		async read(request) {
			const { path } = request;
			const problem = relativePathProblem(path);
			if (problem !== null) return { outcome: "outside", path, message: `${problem} ${NOT_READ}` };
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, NOT_READ);
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };

			const full = `${request.worktree}${request.worktree.endsWith(sep) ? "" : sep}${path.split("/").join(sep)}`;
			let real: string;
			try {
				real = await realpath(full);
			} catch (error) {
				const code = codeOf(error);
				if (code === "ENOENT" || code === "ENOTDIR") {
					// A link whose target is gone is there, but leads nowhere.
					const link = await lstat(full).then(found => found.isSymbolicLink(), () => false);
					return link
						? { outcome: "missing", path, message: `${path} is a link to a file that is not there.` }
						: { outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted.` };
				}
				return { outcome: "failed", message: `Could not find ${path}: ${messageOf(error)}` };
			}
			let root: string;
			try {
				root = await realpath(request.worktree);
			} catch (error) {
				return { outcome: "failed", message: `Could not find the worktree folder ${request.worktree}: ${messageOf(error)}` };
			}
			if (!inside(root, real) || real === root) return { outcome: "outside", path, message: `${path} leads outside this worktree, to ${real}. ${NOT_READ}` };

			try {
				const found = await stat(real);
				if (found.isDirectory()) return { outcome: "not-a-file", path, message: `${path} is a folder, not a file.` };
				if (!found.isFile()) return { outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not read.` };
				// Not blocking on open, in case the file turned into a pipe since it was looked at.
				const handle = await open(real, constants.O_RDONLY | (constants.O_NONBLOCK ?? 0));
				try {
					const opened = await handle.stat();
					if (!opened.isFile()) return { outcome: "not-a-file", path, message: `${path} is not a plain file, so it is not read.` };
					const buffer = new Uint8Array(MAX_FILE_BYTES + 1);
					let length = 0;
					while (length < buffer.length) {
						const { bytesRead } = await handle.read(buffer, length, buffer.length - length, length);
						if (bytesRead === 0) break;
						length += bytesRead;
					}
					return { outcome: "read", path, content: fileContentOf(buffer.subarray(0, length), Math.max(opened.size, length)) };
				} finally {
					await handle.close();
				}
			} catch (error) {
				const code = codeOf(error);
				if (code === "ENOENT") return { outcome: "missing", path, message: `${path} is not in this worktree. It may have been moved or deleted.` };
				if (code === "EACCES" || code === "EPERM") return { outcome: "failed", message: `This app may not read ${path}.` };
				return { outcome: "failed", message: `Could not read ${path}: ${messageOf(error)}` };
			}
		},
	};
}
