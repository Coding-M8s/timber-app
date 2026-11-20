import { isAbsolute } from "node:path";
import {
	BACKUP_LIST_ARGUMENTS, BACKUP_LIST_COMMAND, type BackupDeleteRequest, type BackupDeleteResult, type BackupList, type BackupRestoreRequest, type BackupRestoreResult,
	backupDeleteArguments, backupRestoreArguments, isAbsoluteFolder, readBackupDeleteResult, readBackupList, readBackupRestoreResult,
} from "../shared/backups";
import type { TimberStatus } from "../shared/model";
import { type RepositoryTurns, createRepositoryTurns } from "./repository-turns";
import { runTimberWithResultFile } from "./timber-run";
import { runTimberRecord, withReadyTimber } from "./timber-record";

/**
 * Timber reads its backup storage and each backup's manifest, which is
 * larger for a worktree with many ignored files. Anything this slow is stuck.
 */
export const READ_BACKUPS_TIMEOUT_MS = 30_000;

/** One record for every backup of a repository. Anything past this is not a record Timber would print. */
const RECORD_LIMIT_BYTES = 16 * 1024 * 1024;

export interface BackupCommandsOptions {
	/** Where Timber is, as of the last look (see ./timber.ts). */
	timber: () => Promise<TimberStatus>;
	/** Whether a path is the primary checkout of a repository in the app's list. */
	isListed: (repository: string) => Promise<boolean>;
	/** The turns shared with the other commands that change a repository (see ./repository-turns.ts). */
	turns?: RepositoryTurns;
	environment?: Record<string, string | undefined>;
	/** How long the list may take. Thirty seconds by default. */
	timeoutMs?: number;
	/** Where the private folder for a result file is made. The system's temporary folder by default. */
	temporaryRoot?: string;
}

/**
 * Timber's recovery backups of a repository in the app's list: listing them,
 * restoring one into a new worktree, and deleting one. Timber owns every rule
 * about which backup may be restored or deleted, and checks again right
 * before it acts: nothing here does. Each call runs Timber once and never
 * again by itself.
 */
export interface BackupCommands {
	/** `timber backup list --json`. Read-only. */
	list(repository: string): Promise<BackupList>;
	/** `timber backup restore --result-file`, in the repository's turn. */
	restore(request: BackupRestoreRequest): Promise<BackupRestoreResult>;
	/** `timber __app-backup delete`, in the repository's turn. */
	remove(request: BackupDeleteRequest): Promise<BackupDeleteResult>;
}

/**
 * Run `timber backup list --json` in a folder and read its record. Timber is
 * run as an executable plus an argument array, never through a shell, with
 * standard input closed. It changes no file or ref. Nothing it printed is
 * logged: names and paths are the person's own.
 */
export async function readBackups(
	executable: string,
	folder: string,
	environment: Record<string, string | undefined> = process.env,
	timeoutMs: number = READ_BACKUPS_TIMEOUT_MS,
): Promise<BackupList> {
	const output = await runTimberRecord({
		executable, arguments: BACKUP_LIST_ARGUMENTS, folder, environment, timeoutMs, limitBytes: RECORD_LIMIT_BYTES,
		command: BACKUP_LIST_COMMAND, where: `in ${folder}`, tooLong: "a backup list holds. The backups were not read.",
	});
	if (!output.ok) return { state: "failed", message: output.message };
	return readBackupList(output.record, output.diagnostic, output.exitCode);
}

/** A failure from before anything ran. Nothing was changed. */
function notRun(diagnostic: string): { outcome: "failed"; ran: false; failure: { command: null; diagnostic: string; output: null } } {
	return { outcome: "failed", ran: false, failure: { command: null, diagnostic: `${diagnostic} Nothing was run.`, output: null } };
}

const isFilled = (value: unknown): value is string => typeof value === "string" && value !== "";

/**
 * What a restore or delete printed is passed back inside the result and never
 * logged here, and neither is the result.
 */
export function createBackupCommands(options: BackupCommandsOptions): BackupCommands {
	const { timber, isListed, environment, timeoutMs, temporaryRoot } = options;
	const turns = options.turns ?? createRepositoryTurns();

	/** Checks shared by restore and delete, then the run, in the repository's turn. */
	function inTurn<Result>(repository: string, name: string, run: (executable: string) => Promise<Result>): Promise<Result | ReturnType<typeof notRun>> {
		return turns.inTurn(repository, () => withReadyTimber<Result | ReturnType<typeof notRun>>({
			timber, isListed, repository, couldNot: `start ${name}`, fail: notRun, run,
		}));
	}

	const where = (executable: string, repository: string) => ({
		executable,
		folder: repository,
		...(environment ? { environment } : {}),
		...(temporaryRoot === undefined ? {} : { temporaryRoot }),
	});

	return {
		async list(repository) {
			// The request comes over the bridge, so its shape is checked and not assumed.
			if (!isFilled(repository)) return { state: "failed", message: "The request for backups names no repository." };
			return withReadyTimber<BackupList>({
				timber, isListed, repository, couldNot: `read the backups of ${repository}`,
				fail: message => ({ state: "failed", message }),
				run: executable => readBackups(executable, repository, environment ?? process.env, timeoutMs),
			});
		},

		async restore(request) {
			const { repository, id, destination } = (request ?? {}) as Partial<BackupRestoreRequest>;
			// Only text becomes an argument. Which ID and folder may be used is Timber's to say.
			if (!isFilled(repository) || !isFilled(id) || !isFilled(destination)) return notRun("The request for timber backup restore is not complete.");
			// Timber reads a relative folder from where it runs, the primary checkout, and would restore inside it.
			// Also by this system's rules: on Linux, C:\x is a relative name.
			if (!isAbsoluteFolder(destination) || !isAbsolute(destination)) return notRun(`The folder to restore into must be a whole path, such as /home/me/recovered, not ${destination}.`);
			return inTurn(repository, "timber backup restore", async executable => readBackupRestoreResult(await runTimberWithResultFile({
				...where(executable, repository),
				command: "backup-restore",
				arguments: resultFile => backupRestoreArguments({ id, destination }, resultFile),
			}), id));
		},

		async remove(request) {
			const { repository, id, recordSha256 } = (request ?? {}) as Partial<BackupDeleteRequest>;
			if (!isFilled(repository) || !isFilled(id) || !isFilled(recordSha256)) return notRun("The request for timber __app-backup delete is not complete.");
			return inTurn(repository, "timber __app-backup delete", async executable => readBackupDeleteResult(await runTimberWithResultFile({
				...where(executable, repository),
				command: "backup-delete",
				arguments: resultFile => backupDeleteArguments({ id, recordSha256 }, resultFile),
			}), id));
		},
	};
}
