import { isFields } from "./timber-record";

/**
 * A worktree that `timber new` or `timber open`, typed in one of the app's
 * terminals, handed to the app (Timber's docs/ide-contract.md, "Handing off
 * from app terminals"). Timber writes one record to the folder named by
 * `HANDOFF_VARIABLE`, in place of starting its agent in that terminal, and
 * the app opens the worktree's session. Pure: the main process reads the
 * file and hands its text here.
 */

/** Set in the app's terminals only, never for the Timber commands the app runs itself. */
export const HANDOFF_VARIABLE = "TIMBER_APP_HANDOFF";

/** The most a record may hold. One is well under a kilobyte. */
export const HANDOFF_SIZE_LIMIT = 16 * 1024;

export interface WorktreeHandoff {
	/** The repository's primary checkout, as Timber reports it. */
	repository: string;
	/** The worktree's folder, as Timber reports it. */
	worktree: string;
	/** Whether Timber would have started its agent. The app picks which agent: its first saved one. */
	agent: boolean;
}

/** Whether a file in the folder is a finished record: Timber writes a dot-file and renames it. */
export function isHandoffName(name: string): boolean {
	return !name.startsWith(".") && name.endsWith(".json");
}

function isAbsolutePath(value: unknown): value is string {
	if (typeof value !== "string" || value === "" || value.includes("\0")) return false;
	return value.startsWith("/") || /^[A-Za-z]:[\\/]/.test(value) || value.startsWith("\\\\");
}

/** The handoff a record's text describes, or null for anything else: another version, a missing field, a relative path. */
export function parseHandoff(text: string): WorktreeHandoff | null {
	let value: unknown;
	try {
		value = JSON.parse(text);
	} catch {
		return null;
	}
	if (!isFields(value) || value.schemaVersion !== 1) return null;
	if (value.command !== "new" && value.command !== "open") return null;
	const { repository, worktree, agent } = value;
	if (!isFields(repository) || !isFields(worktree) || typeof agent !== "boolean") return null;
	if (!isAbsolutePath(repository.primaryWorktreeRoot) || !isAbsolutePath(worktree.path)) return null;
	return { repository: repository.primaryWorktreeRoot, worktree: worktree.path, agent };
}
