import { createHash } from "node:crypto";
import { constants, statSync } from "node:fs";
import { lstat, open } from "node:fs/promises";
import { join } from "node:path";
import { messageOf } from "../shared/error-message";
import {
	CHOPS_FILE, CHOPS_FILE_BYTES, type ChopApprovals, type ChopList, type ChopsFileState, type ChopsRequest, type Chop, type PersonalChop, type RunChopRequest, type RunChopResult,
	chopDigestInput, commandChops, findListedChop, isChopApproved, mergeChops, parseChopsFile,
} from "../shared/chops";
import type { OpenTerminalRequest, OpenTerminalResult } from "../shared/terminal";
import type { FindRepository } from "./listed-worktree";
import type { ChopInput } from "./terminals";

export interface ChopsDependencies {
	findRepository: FindRepository;
	/** The personal chops as saved now. Read for every request, so a save shows at once. */
	personal: () => Promise<readonly PersonalChop[]>;
	/** The approvals of repository chops as saved now. None when left out. */
	approvals?: () => Promise<ChopApprovals>;
	/** Keep an approval. Throws when it could not be saved. */
	approve?: (repository: string, digest: string) => Promise<void>;
	/** Start the person's shell in a worktree with a chop typed into it (`TerminalSessions.open`). Without it, nothing runs. */
	openTerminal?: (request: OpenTerminalRequest, chop: ChopInput) => Promise<OpenTerminalResult>;
	warn?: (message: string) => void;
}

export interface Chops {
	/** A repository's chops, with the main checkout's file read anew. Read-only: nothing is written or created. */
	list(request: ChopsRequest): Promise<ChopList>;
	/** Run a command chop in a worktree, as `Engine.runChop` says. */
	run(request: RunChopRequest): Promise<RunChopResult>;
}

/** The digest an approval keeps: SHA-256 of the kind and the text (`chopDigestInput`), in hex. */
export function chopDigest(chop: Pick<Chop, "kind" | "text">): string {
	return createHash("sha256").update(chopDigestInput(chop), "utf8").digest("hex");
}

function isFolder(path: string): boolean {
	try {
		return statSync(path).isDirectory();
	} catch {
		return false;
	}
}

const codeOf = (error: unknown) => (error as NodeJS.ErrnoException | null)?.code;

/** Whether a failure means there is no file there: the folder or the file is missing, or a part of the path is a file. */
const isAbsent = (error: unknown) => codeOf(error) === "ENOENT" || codeOf(error) === "ENOTDIR";

export type ChopsFileRead = { file: ChopsFileState; chops: Chop[] };

/**
 * Read the repository file of a main checkout, safely, since its content comes
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
export async function readChopsFile(checkout: string): Promise<ChopsFileRead> {
	const damaged = (message: string): ChopsFileRead => ({ file: { state: "damaged", message }, chops: [] });
	const folder = join(checkout, ".timber");
	const path = join(checkout, ...CHOPS_FILE.split("/"));
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
 * The chops of a repository: the person's saved chops merged with the file
 * in the repository's main checkout (`mergeChops` in ../shared/chops.ts), the
 * same for every worktree. Only a repository in the app's list whose primary
 * checkout's folder is there. The file is read on every call and never
 * cached, so a change to it shows on the next read.
 */
export function createChops({ findRepository, personal, approvals = async () => ({}), approve = async () => {}, openTerminal, warn = console.warn }: ChopsDependencies): Chops {
	/** The list, and the primary checkout it was read for, which keys both the merge and the approvals. */
	async function read(request: ChopsRequest): Promise<{ list: ChopList; checkout: string }> {
		const notRead = "No chops were read.";
		const answer = (list: ChopList, checkout = request.repository) => ({ list, checkout });
		let repository;
		try {
			repository = await findRepository(request.repository);
		} catch (error) {
			return answer({ outcome: "failed", message: `Could not read the repository at ${request.repository}: ${messageOf(error)}. ${notRead}` });
		}
		if (repository === null) return answer({ outcome: "not-listed", message: `${request.repository} is not a repository in this app's list. ${notRead}` });
		if (!isFolder(repository.path)) return answer({ outcome: "not-listed", message: `The folder of the main checkout, ${repository.path}, is missing. ${notRead}` });
		let saved: readonly PersonalChop[];
		try {
			saved = await personal();
		} catch (error) {
			return answer({ outcome: "failed", message: `Could not read the saved chops: ${messageOf(error)}` });
		}
		const { file, chops } = await readChopsFile(repository.path);
		return answer({ outcome: "listed", file, path: join(repository.path, ...CHOPS_FILE.split("/")), ...mergeChops(saved, repository.path, chops) }, repository.path);
	}

	return {
		list: async request => (await read(request)).list,
		async run(request) {
			if (openTerminal === undefined) return { outcome: "unsupported", message: "Chops cannot run here. Nothing was started." };
			if (typeof request.chop !== "string") return { outcome: "no-chop", message: "The request names no chop. Nothing was started." };
			// Read once: the text approved is the text that runs.
			const { list: listed, checkout } = await read({ repository: request.repository });
			if (listed.outcome !== "listed") return { outcome: listed.outcome === "not-listed" ? "not-listed" : "failed", message: listed.message };
			const chop = findListedChop(commandChops(listed), request.chop);
			if (chop === null) return { outcome: "no-chop", message: `No command chop called "${request.chop}" is in ${request.repository} now. Nothing was started.` };
			const digest = chopDigest(chop);
			let saved: ChopApprovals;
			try {
				saved = await approvals();
			} catch (error) {
				warn(`Could not read the chop approvals: ${messageOf(error)}`);
				saved = {};
			}
			if (!isChopApproved(saved, checkout, chop, digest)) {
				if (request.approve !== chop.text) return { outcome: "needs-approval", chop, path: listed.path };
				try {
					await approve(checkout, digest);
				} catch (error) {
					// The person agreed to this run: it goes ahead, and the next one asks again.
					warn(`Could not save the approval of a chop: ${messageOf(error)}`);
				}
			}
			return openTerminal({ repository: request.repository, worktree: request.worktree, cols: request.cols, rows: request.rows }, { name: chop.name, text: chop.text });
		},
	};
}
