import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { messageOf } from "../shared/error-message";
import { CHOPS_FILE, CHOPS_FILE_BYTES, type ChopList, type ChopsFileState, type ChopsRequest, type Chop, type PersonalChop, mergeChops, parseChopsFile } from "../shared/chops";
import { type FindRepository, findListedWorktree } from "./listed-worktree";

export interface ChopsDependencies {
	findRepository: FindRepository;
	/** The personal chops as saved now. Read for every request, so a save shows at once. */
	personal: () => Promise<readonly PersonalChop[]>;
}

export interface Chops {
	/** A worktree's chops, with the repository file read anew. Read-only: nothing is written or created. */
	list(request: ChopsRequest): Promise<ChopList>;
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Whether a failure means there is no file there: the folder or the file is missing, or a part of the path is a file. */
const isAbsent = (error: unknown) => codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR";

export type ChopsFileRead = { file: ChopsFileState; chops: Chop[] };

/**
 * Read the repository file of one worktree, safely, since its content comes
 * from the repository:
 *
 * - `.timber` must be a folder and `chops.json` a regular file, neither a
 *   symbolic link, so the file cannot point elsewhere on the machine. A link,
 *   a folder, or a device is reported as damaged and never opened.
 * - It is opened without following a link and without blocking, so a link
 *   put there after the check, or a named pipe, cannot hang or redirect the
 *   read, and its size is checked on what was opened.
 * - It must be UTF-8 and at most `CHOPS_FILE_BYTES`.
 * - A reason never quotes the file.
 *
 * Nothing is written, and a missing folder is not created.
 */
export async function readChopsFile(worktree: string): Promise<ChopsFileRead> {
	const damaged = (message: string): ChopsFileRead => ({ file: { state: "damaged", message }, chops: [] });
	const folder = join(worktree, ".timber");
	const path = join(worktree, ...CHOPS_FILE.split("/"));
	try {
		const info = await lstat(folder);
		if (info.isSymbolicLink()) return damaged("The .timber folder is a symbolic link, so the app does not follow it.");
		if (!info.isDirectory()) return { file: { state: "missing" }, chops: [] };
		const fileInfo = await lstat(path);
		if (fileInfo.isSymbolicLink()) return damaged("It is a symbolic link, so the app does not follow it.");
		if (!fileInfo.isFile()) return damaged("It is not a regular file.");
	} catch (error) {
		if (isAbsent(error)) return { file: { state: "missing" }, chops: [] };
		return damaged(`Could not read it: ${messageOf(error)}`);
	}

	let text: string;
	try {
		// O_NOFOLLOW and O_NONBLOCK are not there on Windows, where 0 leaves them out.
		const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
		try {
			const info = await handle.stat();
			if (!info.isFile()) return damaged("It is not a regular file.");
			if (info.size > CHOPS_FILE_BYTES) return damaged(`It is larger than ${CHOPS_FILE_BYTES / 1024} KB.`);
			const buffer = Buffer.alloc(CHOPS_FILE_BYTES + 1);
			let size = 0;
			// Read up to one byte past the limit, in case the file grew after the size was checked.
			while (size < buffer.length) {
				const { bytesRead } = await handle.read(buffer, size, buffer.length - size, size);
				if (bytesRead === 0) break;
				size += bytesRead;
			}
			if (size > CHOPS_FILE_BYTES) return damaged(`It is larger than ${CHOPS_FILE_BYTES / 1024} KB.`);
			try {
				text = new TextDecoder("utf-8", { fatal: true }).decode(buffer.subarray(0, size));
			} catch {
				return damaged("It is not UTF-8 text.");
			}
		} finally {
			await handle.close();
		}
	} catch (error) {
		if (isAbsent(error)) return { file: { state: "missing" }, chops: [] };
		if (codeOf(error) === "ELOOP") return damaged("It is a symbolic link, so the app does not follow it.");
		return damaged(`Could not read it: ${messageOf(error)}`);
	}

	const reading = parseChopsFile(text);
	return reading.ok ? { file: { state: "read" }, chops: reading.chops } : damaged(reading.message);
}

/**
 * The chops of a worktree: the person's saved chops merged with the
 * repository's file (`mergeChops` in ../shared/chops.ts). Only a worktree that
 * Timber lists, in a repository in the app's list, whose folder is there
 * (`findListedWorktree`). The file is read on every call and never cached,
 * so a change to it, or a switch of branch, shows on the next read without
 * any watch on the working tree.
 */
export function createChops({ findRepository, personal }: ChopsDependencies): Chops {
	return {
		async list(request) {
			const listed = await findListedWorktree(findRepository, request.repository, request.worktree, "No chops were read.");
			if (!listed.ok) return { outcome: "not-listed", message: listed.message };
			let saved: readonly PersonalChop[];
			try {
				saved = await personal();
			} catch (error) {
				return { outcome: "failed", message: `Could not read the saved chops: ${messageOf(error)}` };
			}
			const { file, chops } = await readChopsFile(request.worktree);
			return { outcome: "listed", file, path: join(request.worktree, ...CHOPS_FILE.split("/")), ...mergeChops(saved, request.repository, chops) };
		},
	};
}
