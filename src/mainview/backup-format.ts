import {
	type Backup, type BackupList, type RemainingDeletion, type RemainingState, BACKUP_LIST_COMMAND, backupDeleteArguments, backupRestoreArguments,
} from "../shared/backups";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../shared/timber-result";
import { describeAgo } from "./fetch-format";

/**
 * Words for Timber's recovery backups: the section under a repository's
 * worktrees, and the Restore and Delete dialogs. Pure, so they can be tested
 * without a window.
 */

export const BACKUPS_TITLE = "Backups";

/** Timber asks every app that shows backups to say this. */
export const BACKUPS_IGNORED_NOTE = "Backups can hold copies of ignored files, such as .env, even after their worktree is gone.";

/** Where an unfinished deletion or an entry that is not usable is dealt with: in a terminal, as Timber asks there. */
export const BACKUPS_MANAGE_NOTE = "Finish or review these with timber backup list and timber backup done in a terminal.";

export const RESTORE_NOTE = "Timber restores the backup into a new folder on a new branch. The worktree it came from and the backup stay as they are. No setup script, editor, or agent runs.";
export const RESTORE_CHANGES_NOTE = "Changes come back unstaged or untracked, and ignored files such as .env come back too.";
export const RESTORE_FOLDER_HINT = "A new folder, as a whole path. Its parent folder must exist.";
export const RESTORE_FOLDER_NOT_ABSOLUTE = "Give the whole path, such as /home/me/recovered.";

export const DELETE_NOTE = "Timber deletes this backup only, and only if it is still exactly as listed here. It cannot be restored afterwards.";

/** The toast after a restore worked. */
export const describeRestored = (branch: string) => `Backup restored on ${branch}`;
export const BACKUP_DELETED = "Backup deleted";

/** Text from Timber or the disk, safe to show whole: control characters become a replacement mark, and nothing is cut. Paths and commands must stay whole. */
export function cleanText(value: string): string {
	return value.replace(/[\u0000-\u001f\u007f-\u009f\u2028\u2029]/g, "\uFFFD");
}

/** The branch a backup was made from, as a person reads it. */
export function describeBackupBranch(backup: Pick<Backup, "branch">): string {
	return backup.branch === null ? "detached HEAD" : cleanText(backup.branch);
}

/** A size in a few characters, in powers of 1024, as Timber prints them: `12 B`, `3.0 MiB`. */
export function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	const units = ["KiB", "MiB", "GiB", "TiB"];
	let value = bytes / 1024;
	let unit = 0;
	while (value >= 1024 && unit < units.length - 1) {
		value /= 1024;
		unit += 1;
	}
	return `${value.toFixed(1)} ${units[unit]}`;
}

/**
 * When a backup was made: how long ago, and the moment in full for its
 * tooltip. A time Timber recorded that cannot be read is shown as it is.
 */
export function describeCreated(createdAt: string, now: number): { text: string; tooltip: string } {
	const at = Date.parse(createdAt);
	if (Number.isNaN(at)) return { text: cleanText(createdAt), tooltip: `Made ${cleanText(createdAt)}` };
	return { text: describeAgo(at, now), tooltip: `Made ${new Date(at).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" })}` };
}

/** The one-line summary of a usable backup in the section: its branch, then when it was made and its size. */
export function describeBackupRow(backup: Backup, now: number): { branch: string; detail: string; tooltip: string } {
	const created = describeCreated(backup.createdAt, now);
	const tooltip = [
		`${created.tooltip} from ${cleanText(backup.worktreePath)}.`,
		`${formatBytes(backup.bytes)}, ${backup.entries.toLocaleString("en-US")} ${backup.entries === 1 ? "entry" : "entries"}. ID ${cleanText(backup.id)}.`,
		backup.protection.protected ? `Timber protects it: ${cleanText(backup.protection.reason)}. It cannot be deleted now.` : "",
	].filter(Boolean).join(" ");
	return { branch: describeBackupBranch(backup), detail: `${created.text}, ${formatBytes(backup.bytes)}`, tooltip };
}

/**
 * The quiet word beside a repository's name when its backups could not be
 * read, with the reason. Null when they were read, or when the Timber found
 * has no backup list, which is not a problem.
 */
export function describeBackupsProblem(list: BackupList | undefined): { text: string; tooltip: string } | null {
	if (list?.state !== "failed") return null;
	return { text: "backups unknown", tooltip: `${BACKUP_LIST_COMMAND} did not say which backups there are. ${cleanText(list.message)}` };
}

/** The restore command for a dialog, worded from the same arguments the main process runs. */
export function restoreCommandFor(id: string, destination: string): string {
	return describeTimberCommand(backupRestoreArguments({ id, destination }, RESULT_FILE_PLACEHOLDER));
}

/** The delete command for a dialog, worded from the same arguments the main process runs. */
export function deleteCommandFor(backup: Pick<Backup, "id" | "recordSha256">): string {
	return describeTimberCommand(backupDeleteArguments(backup, RESULT_FILE_PLACEHOLDER));
}

const STATE_WORDS: Record<RemainingState, string> = { present: "is still there", removed: "is gone", unknown: "could not be checked" };

/** What a deletion that did not finish left, in sentences. */
export function describeRemainingDeletion(remaining: RemainingDeletion): string[] {
	const files = remaining.files === null ? "" : ` with ${remaining.files} ${remaining.files === 1 ? "file" : "files"} in it`;
	return [
		`The backup can no longer be restored.`,
		`Its folder ${cleanText(remaining.directory)} ${STATE_WORDS[remaining.directoryState]}${remaining.directoryState === "present" ? files : ""}.`,
		`Its private ref ${cleanText(remaining.ref)} ${STATE_WORDS[remaining.refState]}.`,
	];
}

/** What a restore that did not finish left, in sentences. */
export function describeRemainingRestore(remaining: { worktree: string | null; branch: string | null }): string[] {
	const lines: string[] = [];
	if (remaining.worktree !== null) lines.push(`An incomplete recovery worktree is left at ${cleanText(remaining.worktree)}. Do not use it.`);
	if (remaining.branch !== null) lines.push(`The branch ${cleanText(remaining.branch)} is left.`);
	if (lines.length === 0) lines.push("Timber found nothing left behind.");
	return lines;
}
