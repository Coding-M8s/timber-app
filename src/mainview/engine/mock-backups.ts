import {
	type Backup, type BackupDeleteResult, type BackupList, type BackupRestoreResult, backupDeleteArguments, backupRestoreArguments, isAbsoluteFolder, readBackupDeleteResult, readBackupRestoreResult,
} from "../../shared/backups";
import type { Engine } from "../../shared/engine";
import type { Repository, TimberStatus } from "../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand, readTimberResult } from "../../shared/timber-result";

/** The part of the engine about backups. */
export type BackupCapabilities = Pick<Engine, "readBackups" | "restoreBackup" | "deleteBackup">;

/**
 * How an acted restore or delete ends: as asked ("works"), refused by Timber,
 * stopped part of the way ("partial"), or with no result to read
 * ("no-result"). A backup that is unknown, protected, or changed is refused
 * whatever the ending, as Timber does.
 */
export const BACKUP_ENDINGS = ["works", "refused", "partial", "no-result"] as const;
export type BackupEnding = typeof BACKUP_ENDINGS[number];

export interface BackupControls {
	/**
	 * Decide what the backups of one repository, named by its primary
	 * checkout, answer from now on: a list, or null for the sample. Restores
	 * and deletes act on it.
	 */
	setBackups(repository: string, list: BackupList | null): void;
	/** How many times the backups of a repository were read. */
	backupReads(repository: string): number;
	/** Decide how restores and deletes end from now on. "works" at the start. */
	endBackupCommands(ending: BackupEnding): void;
}

const digest = (seed: string) => Array.from({ length: 64 }, (_, index) => "0123456789abcdef"[(seed.charCodeAt(index % seed.length) + index) % 16]).join("");

const backup = (id: string, branch: string | null, createdAt: string, worktreePath: string, fields: Partial<Backup> = {}): Backup => ({
	id,
	branch,
	commit: "1111111111111111111111111111111111111111",
	createdAt,
	bytes: 48_213_504,
	entries: 1_284,
	worktreePath,
	recordSha256: digest(id),
	protection: { protected: false },
	...fields,
});

/**
 * Sample backups by primary checkout, for the browser build and tests. The
 * timber repository has one of each kind of entry; a repository not named
 * here has none, which shows no section. The billing repository acts out a Timber that has
 * no backup list at all.
 */
export const sampleBackups: Readonly<Record<string, BackupList>> = {
	"/work/timber": {
		state: "listed",
		backups: [
			backup("20261117T091502Z-3fa91c2e", "feat/github-issue-lookup", "2026-11-17T09:15:02.118Z", "/work/timber-worktrees/feat-github-issue-lookup"),
			backup("20261118T164011Z-a07be5d4", "fix/macos-portability", "2026-11-18T16:40:11.540Z", "/work/timber-worktrees/fix-macos-portability", {
				bytes: 3_145_728,
				protection: { protected: true, reason: "its source worktree has a rebase in progress" },
			}),
			backup("20261118T171230Z-c4d8e901", null, "2026-11-18T17:12:30.003Z", "/work/timber-worktrees/old-experiment", { bytes: 9_216, entries: 12 }),
		],
		unfinished: [{ id: "20261110T080000Z-0b1c2d3e", directory: "/work/timber/.git/timber/backups/.deleting-20261110T080000Z-0b1c2d3e" }],
		notUsable: [{ name: "20261101T120000Z-deadbeef", reason: "its private ref is missing" }],
		totalBytes: 48_213_504 + 3_145_728 + 9_216,
	},
	"/work/billing": { state: "unsupported" },
};

const empty = (): BackupList => ({ state: "listed", backups: [], unfinished: [], notUsable: [], totalBytes: 0 });

interface MockBackupOptions {
	/** The repository in the list with this primary checkout, there on disk, or undefined. */
	listed: (path: string) => Repository | undefined;
	timber: () => TimberStatus;
	/** Add a recovery worktree to the pretend disk, as `git worktree add` would. */
	addWorktree: (repository: string, path: string, branch: string) => void;
	/** How long a restore or delete takes. */
	delay: () => number;
}

/**
 * Backups acted out from sample data, for the browser build and tests. As
 * the main process does, a repository must be in the list and Timber must be
 * ready. Each outcome is written as Timber's record and read with the same
 * code as the real one.
 */
export function createMockBackups(options: MockBackupOptions): BackupCapabilities & BackupControls {
	const { listed, timber, addWorktree, delay } = options;
	const lists = new Map<string, BackupList>();
	const reads = new Map<string, number>();
	let ending: BackupEnding = "works";

	const listOf = (path: string): BackupList => {
		if (!lists.has(path)) lists.set(path, structuredClone(sampleBackups[path] ?? empty()));
		return lists.get(path)!;
	};
	const notRun = (diagnostic: string) => ({ outcome: "failed" as const, ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } });
	const ready = (repository: string): string | null => {
		if (!listed(repository)) return `${repository} is not a repository in the app's list.`;
		return timber().state === "ready" ? null : "Timber is not ready.";
	};
	const wait = async () => {
		const milliseconds = delay();
		if (milliseconds > 0) await new Promise(resolve => setTimeout(resolve, milliseconds));
	};
	/** Timber's record, as the result file would hold it. */
	const record = (command: "backup-restore" | "backup-delete", repository: string, diagnostic: string | null, fields: object) => JSON.stringify({
		schemaVersion: 1, command, outcome: diagnostic === null ? "succeeded" : "failed", exitCode: diagnostic === null ? 0 : 1,
		repository: { commonGitDir: `${repository}/.git`, primaryWorktreeRoot: repository, currentWorktreeRoot: repository },
		worktree: null, materialized: false, diagnostic,
		[command === "backup-restore" ? "backupRestore" : "backupDelete"]: fields,
	});

	return {
		async readBackups(repository) {
			reads.set(repository, (reads.get(repository) ?? 0) + 1);
			const problem = ready(repository);
			if (problem) return { state: "failed", message: problem };
			return structuredClone(listOf(repository));
		},

		async restoreBackup(request): Promise<BackupRestoreResult> {
			const { repository, id, destination } = request;
			if (!isAbsoluteFolder(destination)) return notRun(`The folder to restore into must be a whole path, such as /home/me/recovered, not ${destination}.`);
			const problem = ready(repository);
			if (problem) return notRun(problem);
			await wait();
			const command = describeTimberCommand(backupRestoreArguments({ id, destination }, RESULT_FILE_PLACEHOLDER));
			const list = listOf(repository);
			const found = list.state === "listed" ? list.backups.find(candidate => candidate.id === id) : undefined;
			const branch = `recovery/${id}`;
			const taken = listed(repository)!.worktrees.some(worktree => worktree.path === destination || worktree.branch === branch);
			const fields = { result: "refused", id, worktree: null, branch: null, commit: null, remaining: null, cleanup: [] as string[] };
			let diagnostic: string | null = null;
			let printed = "";
			if (!found) diagnostic = `Backup ${id} was not found or is not usable. Review it with timber backup list.`;
			else if (taken || ending === "refused") diagnostic = `Destination already exists: ${destination}. Choose a new directory; restore never overwrites existing files.`;
			else if (ending === "partial") {
				addWorktree(repository, destination, branch);
				diagnostic = "Could not write a restored file: no space left on device. The incomplete recovery workspace was kept.";
				Object.assign(fields, { result: "partial", remaining: { worktree: destination, branch }, cleanup: [`git worktree remove --force '${destination}'`, `git branch -D '${branch}'`] });
			} else {
				addWorktree(repository, destination, branch);
				Object.assign(fields, { result: "restored", worktree: destination, branch, commit: found.commit });
				printed = `Restored backup ${id} into ${destination} on branch ${branch}.\n`;
			}
			const text = ending === "no-result" && found && !taken ? null : record("backup-restore", repository, diagnostic, fields);
			const exitCode = diagnostic === null ? 0 : 1;
			return readBackupRestoreResult({ command, result: readTimberResult("backup-restore", text, exitCode), output: { text: printed, truncated: false } }, id);
		},

		async deleteBackup(request): Promise<BackupDeleteResult> {
			const { repository, id, recordSha256 } = request;
			const problem = ready(repository);
			if (problem) return notRun(problem);
			await wait();
			const command = describeTimberCommand(backupDeleteArguments({ id, recordSha256 }, RESULT_FILE_PLACEHOLDER));
			const list = listOf(repository);
			const found = list.state === "listed" ? list.backups.find(candidate => candidate.id === id) : undefined;
			const fields = { result: "refused", id, remaining: null as object | null, cleanup: [] as string[] };
			let diagnostic: string | null = null;
			if (!found) diagnostic = `Kept backup ${id}: it is not a usable backup in this repository. Nothing was deleted.`;
			else if (found.protection.protected) diagnostic = `Kept backup ${id}: it is protected: ${found.protection.reason}. Nothing was deleted.`;
			else if (found.recordSha256 !== recordSha256) diagnostic = `Kept backup ${id}: its record differs from the one that was confirmed; review it again. Nothing was deleted.`;
			else if (ending === "refused") diagnostic = `Kept backup ${id}: its contents changed while it was checked. Nothing was deleted.`;
			else if (list.state === "listed") {
				list.backups = list.backups.filter(candidate => candidate !== found);
				list.totalBytes -= found.bytes;
				if (ending === "partial") {
					const directory = `${repository}/.git/timber/backups/.deleting-${id}`;
					list.unfinished.push({ id, directory });
					diagnostic = `Could not finish deleting backup ${id}: permission denied. It is no longer restorable.`;
					Object.assign(fields, {
						result: "partial",
						remaining: { directory, directoryState: "present", files: 3, ref: `refs/timber/backups/${id}`, refState: "removed" },
						cleanup: [`rm -r '${directory}'`],
					});
				} else Object.assign(fields, { result: "deleted" });
			}
			const text = ending === "no-result" && found ? null : record("backup-delete", repository, diagnostic, fields);
			return readBackupDeleteResult({ command, result: readTimberResult("backup-delete", text, diagnostic === null ? 0 : 1), output: { text: "", truncated: false } }, id);
		},

		setBackups(repository, list) {
			if (list === null) lists.delete(repository);
			else lists.set(repository, structuredClone(list));
		},
		backupReads: repository => reads.get(repository) ?? 0,
		endBackupCommands(next) {
			ending = next;
		},
	};
}
