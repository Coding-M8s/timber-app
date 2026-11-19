import type { TimberFailure } from "./model";
import { type Fields, isFields, isTextOrNull } from "./timber-ls";
import { type TimberRun, failureOf } from "./timber-result";
import { readDiagnostic } from "./workflows";

/**
 * Timber's recovery backups, version 1 of its backup records
 * (docs/ide-contract.md and docs/cli-contract.md in the Timber repository).
 * Pure: the main process runs Timber and hands the output here (see
 * src/bun/backups.ts).
 *
 * Timber decides which backups are usable and which are protected, and checks
 * everything again before it restores or deletes one. Nothing here repeats
 * those rules: the records say what Timber found, and this reads them.
 *
 * Values are kept exactly as Timber wrote them. IDs and digests become
 * arguments, and paths and cleanup commands must be shown whole, so the
 * interface cleans them only for display (see src/mainview/backup-format.ts).
 */
export const BACKUP_LIST_ARGUMENTS = ["backup", "list", "--json"] as const;
export const BACKUP_LIST_COMMAND = `timber ${BACKUP_LIST_ARGUMENTS.join(" ")}`;
export const SUPPORTED_BACKUP_LIST_SCHEMA_VERSION = 1;

/** Whether Timber keeps a backup from deletion, and why. */
export type BackupProtection = { protected: false } | { protected: true; reason: string };

/** A backup Timber lists as usable: it can be restored, and deleted unless it is protected. */
export interface Backup {
	/** Timber's ID, such as `20261119T014346Z-acb71661`. Given back to Timber as it is. */
	id: string;
	/** The branch the backup was made from, as recorded. Null for a detached HEAD. */
	branch: string | null;
	/** The commit the backup keeps. */
	commit: string;
	/** When it was made, as recorded. Timber writes ISO 8601 in UTC, but the text is kept as it is. */
	createdAt: string;
	/** Snapshot size in bytes. */
	bytes: number;
	/** How many files, folders, and links the snapshot holds. */
	entries: number;
	/** The folder of the worktree it was made from, as recorded. It may be gone. */
	worktreePath: string;
	/** The digest of the backup's record, which the delete command needs to be sure it deletes what the person saw. */
	recordSha256: string;
	protection: BackupProtection;
}

/** A deletion that started and did not finish. Not restorable. */
export interface UnfinishedDeletion {
	id: string;
	/** Its `.deleting-<id>` folder. */
	directory: string;
}

/** Something in backup storage that Timber does not count as a usable backup, with Timber's reason. */
export interface UnusableBackup {
	name: string;
	reason: string;
}

/**
 * A repository's backups as Timber listed them, or why there is no list.
 * `unsupported` means the Timber found has no `backup list --json`: there is
 * nothing to show, and nothing is wrong. A list is used only as a whole.
 */
export type BackupList =
	| { state: "listed"; backups: Backup[]; unfinished: UnfinishedDeletion[]; notUsable: UnusableBackup[]; totalBytes: number }
	| { state: "unsupported" }
	| { state: "failed"; message: string };

/** Whether a list has anything to show. Only then does the sidebar show the section. */
export function hasBackups(list: BackupList | undefined): boolean {
	return list?.state === "listed" && (list.backups.length > 0 || list.unfinished.length > 0 || list.notUsable.length > 0);
}

/** The usable backup with this ID in a list, or null. */
export function backupOf(list: BackupList | undefined, id: string): Backup | null {
	return list?.state === "listed" ? list.backups.find(backup => backup.id === id) ?? null : null;
}

const DIGEST = /^[0-9a-f]{64}$/;

const failed = (message: string): BackupList => ({ state: "failed", message });
const unreadable = (detail: string) => failed(`${BACKUP_LIST_COMMAND} did not answer with a record this app can read: ${detail}.`);

const isCount = (value: unknown): value is number => typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
const isFilled = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * What Commander, which Timber's command line is built on, says about a
 * command or option it does not know. Timber releases before `backup list
 * --json` print this and nothing else. It is the one place the app reads
 * Timber's human output, because those releases carry the same version number
 * as the first one with the list (see docs/architecture.md).
 */
const UNKNOWN_TO_TIMBER = /^error: unknown (command 'list'|option '--json')/m;

function readProtection(value: unknown): BackupProtection | null {
	if (!isFields(value)) return null;
	if (value.protected === false) return value.reason === null ? { protected: false } : null;
	if (value.protected === true) return isFilled(value.reason) ? { protected: true, reason: value.reason } : null;
	return null;
}

/** Null when the value is not one usable backup. `expiry` and fields this app does not use are ignored. */
function readBackup(value: unknown): Backup | null {
	if (!isFields(value)) return null;
	const { id, branch, commit, createdAt, bytes, entries, worktreePath, recordSha256 } = value;
	if (!isFilled(id) || (branch !== null && !isFilled(branch)) || !isFilled(commit) || typeof createdAt !== "string") return null;
	if (!isCount(bytes) || !isCount(entries) || typeof worktreePath !== "string") return null;
	if (typeof recordSha256 !== "string" || !DIGEST.test(recordSha256)) return null;
	const protection = readProtection(value.protection);
	if (protection === null) return null;
	return { id, branch, commit, createdAt, bytes, entries, worktreePath, recordSha256, protection };
}

function readUnfinished(value: unknown): UnfinishedDeletion | null {
	if (!isFields(value) || !isFilled(value.id) || typeof value.directory !== "string" || !isTextOrNull(value.recordSha256)) return null;
	return { id: value.id, directory: value.directory };
}

function readUnusable(value: unknown): UnusableBackup | null {
	if (!isFields(value) || typeof value.name !== "string" || typeof value.reason !== "string") return null;
	return { name: value.name, reason: value.reason };
}

function readAll<Item>(value: unknown, read: (item: unknown) => Item | null): Item[] | null {
	if (!Array.isArray(value)) return null;
	const items: Item[] = [];
	for (const entry of value) {
		const item = read(entry);
		if (item === null) return null;
		items.push(item);
	}
	return items;
}

/**
 * Read what one run of `timber backup list --json` printed. `exitCode` is the
 * exit code of that process, or null when it did not exit by itself.
 *
 * Timber prints its record whether it exits with 0 or with 1, and leaves
 * standard error empty. A list is accepted only as a whole: one version 1
 * record whose exit code is the process's, with every entry readable. Exit
 * 1 with Timber's diagnostic is a failure, never an empty list.
 *
 * A Timber without the command exits with 1, prints nothing, and names the
 * unknown command or option on standard error. Only that exact shape is
 * `unsupported`, so a Timber that crashed is never mistaken for one that has
 * no backups.
 */
export function readBackupList(stdout: string, stderr: string, exitCode: number | null): BackupList {
	const ending = exitCode === null ? "did not exit by itself" : `exited with code ${exitCode}`;
	if (exitCode === 1 && stdout.trim() === "" && UNKNOWN_TO_TIMBER.test(stderr)) return { state: "unsupported" };

	const explained = () => {
		const diagnostic = readDiagnostic(stderr);
		return failed(diagnostic === null ? `${BACKUP_LIST_COMMAND} ${ending} without saying why.` : `${BACKUP_LIST_COMMAND} ${ending}: ${diagnostic}`);
	};
	if (exitCode !== 0 && exitCode !== 1) return explained();

	let record: unknown;
	try {
		record = JSON.parse(stdout);
	} catch {
		if (exitCode !== 0) return explained();
		return unreadable(stdout.trim() === "" ? "it printed nothing" : "the output is not valid JSON");
	}
	if (!isFields(record)) return unreadable("the output is not a JSON object");

	if (record.schemaVersion !== SUPPORTED_BACKUP_LIST_SCHEMA_VERSION) {
		const found = typeof record.schemaVersion === "number" || typeof record.schemaVersion === "string" ? String(record.schemaVersion) : "none";
		return failed(`${BACKUP_LIST_COMMAND} answered with schema version ${found}, and this app reads version ${SUPPORTED_BACKUP_LIST_SCHEMA_VERSION} only. Update Timber app, or install a Timber that matches it.`);
	}
	const { outcome, diagnostic } = record;
	if (record.exitCode !== exitCode) return unreadable(`it says exit code ${String(record.exitCode)}, but the process ${ending}`);
	if (outcome !== "succeeded" && outcome !== "failed") return unreadable("its outcome is not one this app knows");
	if ((outcome === "failed") !== (exitCode === 1)) return unreadable(`its outcome "${outcome}" does not go with exit code ${exitCode}`);
	if (!isTextOrNull(diagnostic)) return unreadable("its diagnostic is not text");
	if (outcome === "failed") {
		const text = diagnostic?.trim() ?? "";
		return failed(text === "" ? `${BACKUP_LIST_COMMAND} failed without saying why.` : `${BACKUP_LIST_COMMAND} failed: ${text}`);
	}

	const backups = readAll(record.backups, readBackup);
	if (backups === null) return unreadable("a backup in it cannot be read");
	const unfinished = readAll(record.unfinished, readUnfinished);
	if (unfinished === null) return unreadable("an unfinished deletion in it cannot be read");
	const notUsable = readAll(record.notUsable, readUnusable);
	if (notUsable === null) return unreadable("an entry that is not usable cannot be read");
	if (!isCount(record.totalBytes)) return unreadable("it has no total size");
	return { state: "listed", backups, unfinished, notUsable, totalBytes: record.totalBytes };
}

/** Restore one backup into a new folder. */
export interface BackupRestoreRequest {
	/** The path of the repository's primary checkout. Timber runs there. */
	repository: string;
	id: string;
	/** The new folder for the recovery worktree, as an absolute path. It must not exist yet; its parent must. */
	destination: string;
}

/** Delete one backup the person confirmed. */
export interface BackupDeleteRequest {
	repository: string;
	id: string;
	/** `recordSha256` of the backup as the person saw it. Timber refuses when the backup changed since. */
	recordSha256: string;
}

/**
 * Everything after `timber` for a restore: options first, then `--`, then
 * the ID and the folder, so neither is ever read as an option. `resultFile`
 * is put in as it is.
 */
export function backupRestoreArguments(request: Pick<BackupRestoreRequest, "id" | "destination">, resultFile: string): string[] {
	return ["backup", "restore", "--result-file", resultFile, "--", request.id, request.destination];
}

/** Everything after `timber` for deleting one backup. Every value follows its own option. */
export function backupDeleteArguments(request: Pick<BackupDeleteRequest, "id" | "recordSha256">, resultFile: string): string[] {
	return ["__app-backup", "delete", "--id", request.id, "--record-sha256", request.recordSha256, "--result-file", resultFile];
}

/**
 * The folder offered for a restore: beside the primary checkout, named after
 * it and the backup, such as `/code/app-recovery-<id>` for `/code/app`. Only
 * a suggestion the person can change; Timber refuses one that exists.
 */
export function defaultRestoreFolder(primaryCheckout: string, id: string): string {
	const separator = primaryCheckout.includes("\\") && !primaryCheckout.includes("/") ? "\\" : "/";
	const trimmed = primaryCheckout.length > 1 ? primaryCheckout.replace(/[\\/]+$/, "") : primaryCheckout;
	const cut = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
	const parent = cut <= 0 ? trimmed.slice(0, cut + 1) || separator : trimmed.slice(0, cut);
	const name = trimmed.slice(cut + 1);
	return `${parent}${parent.endsWith(separator) ? "" : separator}${name}-recovery-${id}`;
}

/** Whether a path is absolute, on Linux, macOS, or Windows. Pure, so the dialog and the main process agree. */
export function isAbsoluteFolder(path: string): boolean {
	return path.startsWith("/") || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith("\\\\");
}

/** How a restore ended, as Timber's record says. */
export type BackupRestoreResult =
	/** The recovery worktree is complete, at `worktree` on `branch`. */
	| { outcome: "restored"; worktree: string; branch: string; commit: string }
	/** Nothing was created. */
	| { outcome: "refused"; failure: TimberFailure }
	/**
	 * Git created something and the restore stopped. `remaining` is what is
	 * left; a recovery worktree left behind is incomplete and must not be used.
	 * `cleanup` holds Timber's commands for removing it by hand.
	 */
	| { outcome: "partial"; remaining: { worktree: string | null; branch: string | null }; cleanup: string[]; failure: TimberFailure }
	/** `ran` is false only when the app refused before it ran anything. Otherwise what the restore did is unknown. */
	| { outcome: "failed"; ran: boolean; failure: TimberFailure };

export type RemainingState = "present" | "removed" | "unknown";

/** What a deletion that did not finish left, as Timber observed it after the failure. */
export interface RemainingDeletion {
	directory: string;
	directoryState: RemainingState;
	/** Entries left in the folder. Null unless it is there and could be read. */
	files: number | null;
	ref: string;
	refState: RemainingState;
}

/** How deleting one backup ended, as Timber's record says. */
export type BackupDeleteResult =
	| { outcome: "deleted" }
	/** Timber kept the backup and changed nothing. */
	| { outcome: "refused"; failure: TimberFailure }
	/** Deletion started and did not finish. The backup can no longer be restored. Running the same delete again finishes it. */
	| { outcome: "partial"; remaining: RemainingDeletion; cleanup: string[]; failure: TimberFailure }
	| { outcome: "failed"; ran: boolean; failure: TimberFailure };

const STATES: readonly string[] = ["present", "removed", "unknown"];
const isState = (value: unknown): value is RemainingState => typeof value === "string" && STATES.includes(value);
const isTextList = (value: unknown): value is string[] => Array.isArray(value) && value.every(item => typeof item === "string");

/** A record this app cannot use: what the command did is unknown, so the list must be read again. */
function unknown(run: TimberRun, name: string, detail: string): { outcome: "failed"; ran: true; failure: TimberFailure } {
	const exitCode = run.result.record?.fields.exitCode;
	const exited = typeof exitCode === "number" ? `exited with code ${exitCode}` : "ended";
	return {
		outcome: "failed",
		ran: true,
		failure: { command: run.command, diagnostic: `${name} ${exited} and left a result this app cannot read (${detail}), so what it did is unknown. The details below show what it printed.`, output: run.output },
	};
}

/**
 * The checks both records share: a record, never cancelled, for the ID that
 * was asked for, with its object, whose result goes with Timber's outcome.
 */
function readOutcome(run: TimberRun, name: string, key: "backupRestore" | "backupDelete", id: string, succeeds: string): { fields: Fields; failure: TimberFailure | null } | { outcome: "failed"; ran: true; failure: TimberFailure } {
	const { result } = run;
	if (result.outcome === "failed" && result.record === null) return { outcome: "failed", ran: true, failure: failureOf(run)! };
	const { record } = result;
	if (record === null) return unknown(run, name, "there is no record");
	if (result.outcome === "cancelled") return unknown(run, name, "it says it was cancelled, which this command never is");
	const fields = record.fields[key];
	if (!isFields(fields)) return unknown(run, name, `it has no ${key} object`);
	if (fields.id !== null && fields.id !== id) return unknown(run, name, `it is about backup ${String(fields.id)}, not ${id}`);
	if (!isTextList(fields.cleanup)) return unknown(run, name, "its cleanup is not a list of commands");
	if ((fields.result === succeeds) !== (result.outcome === "succeeded")) return unknown(run, name, `its result "${String(fields.result)}" does not go with its outcome "${result.outcome}"`);
	if ((fields.result === "partial") !== (fields.remaining !== null)) return unknown(run, name, "what remains does not go with its result");
	if (fields.result !== "partial" && fields.cleanup.length > 0) return unknown(run, name, "it has cleanup commands for a result that leaves nothing");
	return { fields, failure: failureOf(run) };
}

/**
 * What one run of `timber backup restore --result-file` came to. `id` is the
 * backup that was asked for: a record about another one is not used. What
 * Timber printed is passed on for the details area and never read here.
 */
export function readBackupRestoreResult(run: TimberRun, id: string): BackupRestoreResult {
	const name = "timber backup restore";
	const read = readOutcome(run, name, "backupRestore", id, "restored");
	if ("outcome" in read) return read;
	const { fields, failure } = read;
	const { worktree, branch, commit, remaining } = fields;
	if (!isTextOrNull(worktree) || !isTextOrNull(branch) || !isTextOrNull(commit)) return unknown(run, name, "its worktree, branch, or commit is not text");
	switch (fields.result) {
		case "restored":
			if (!isFilled(worktree) || !isFilled(branch) || !isFilled(commit)) return unknown(run, name, "it says restored but names no worktree, branch, or commit");
			return { outcome: "restored", worktree, branch, commit };
		case "refused":
		case "partial": {
			if (worktree !== null || branch !== null || commit !== null) return unknown(run, name, `it names a recovery worktree for a result of "${fields.result}"`);
			if (fields.result === "refused") return { outcome: "refused", failure: failure! };
			if (!isFields(remaining) || !isTextOrNull(remaining.worktree) || !isTextOrNull(remaining.branch)) return unknown(run, name, "what remains cannot be read");
			return { outcome: "partial", remaining: { worktree: remaining.worktree, branch: remaining.branch }, cleanup: fields.cleanup as string[], failure: failure! };
		}
		default:
			return unknown(run, name, "its result is not one this app knows");
	}
}

/** What one run of `timber __app-backup delete` came to, read as for a restore. */
export function readBackupDeleteResult(run: TimberRun, id: string): BackupDeleteResult {
	const name = "timber __app-backup delete";
	const read = readOutcome(run, name, "backupDelete", id, "deleted");
	if ("outcome" in read) return read;
	const { fields, failure } = read;
	switch (fields.result) {
		case "deleted":
			return { outcome: "deleted" };
		case "refused":
			return { outcome: "refused", failure: failure! };
		case "partial": {
			const remaining = fields.remaining;
			if (!isFields(remaining) || typeof remaining.directory !== "string" || typeof remaining.ref !== "string" || !isState(remaining.directoryState) || !isState(remaining.refState)) {
				return unknown(run, name, "what remains cannot be read");
			}
			if (remaining.files !== null && !isCount(remaining.files)) return unknown(run, name, "the count of files left is not a number");
			return {
				outcome: "partial",
				remaining: { directory: remaining.directory, directoryState: remaining.directoryState, files: remaining.files, ref: remaining.ref, refState: remaining.refState },
				cleanup: fields.cleanup as string[],
				failure: failure!,
			};
		}
		default:
			return unknown(run, name, "its result is not one this app knows");
	}
}
