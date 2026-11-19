import { useState } from "react";
import { type Backup, type BackupList, type RemainingDeletion, backupOf, defaultRestoreFolder, isAbsoluteFolder } from "../../shared/backups";
import {
	BACKUP_DELETED, DELETE_NOTE, RESTORE_CHANGES_NOTE, RESTORE_FOLDER_HINT, RESTORE_FOLDER_NOT_ABSOLUTE, RESTORE_NOTE, cleanText, deleteCommandFor, describeBackupRow,
	describeRemainingDeletion, describeRemainingRestore, describeRestored, restoreCommandFor,
} from "../backup-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";

/** The facts the person decides on: which backup, from where, and when. */
function BackupFacts({ backup, now }: { backup: Backup; now: number }) {
	const row = describeBackupRow(backup, now);
	return (
		<dl className="backup-facts">
			<dt>Branch</dt>
			<dd>{row.branch}</dd>
			<dt>Made</dt>
			<dd>{row.detail}</dd>
			<dt>From</dt>
			<dd className="mono">{cleanText(backup.worktreePath)}</dd>
			<dt>ID</dt>
			<dd className="mono">{cleanText(backup.id)}</dd>
		</dl>
	);
}

/** Timber's commands for removing by hand what a run left, shown whole and never run by the app. */
function CleanupCommands({ lines, cleanup }: { lines: string[]; cleanup: string[] }) {
	return (
		<div className="backup-remaining" role="note">
			{lines.map(line => <p key={line} className="dialog-note">{line}</p>)}
			{cleanup.length > 0 && (
				<>
					<p className="dialog-note">Timber's commands to remove it by hand, without its checks:</p>
					{cleanup.map(command => <pre key={command} className="dialog-command">{cleanText(command)}</pre>)}
				</>
			)}
		</div>
	);
}

/** Whether the backup the dialog was opened for is still listed as it was. Unknown, as when the list could not be read, counts as still there: Timber checks again anyway. */
function stillListed(list: BackupList | undefined, backup: Backup): "same" | "gone" | "changed" {
	if (list?.state !== "listed") return "same";
	const current = backupOf(list, backup.id);
	if (current === null) return "gone";
	return current.recordSha256 === backup.recordSha256 && current.protection.protected === backup.protection.protected ? "same" : "changed";
}

export interface RestoreBackupViewProps {
	backup: Backup;
	listed: "same" | "gone" | "changed";
	destination: string;
	onDestination: (destination: string) => void;
	/** What a restore that stopped part of the way left, or null. */
	partial: { worktree: string | null; branch: string | null; cleanup: string[] } | null;
	/** Whether this dialog ran the command already. Then the list no longer decides: its failure is what to show. */
	ran: boolean;
	submission: SubmissionState;
	now: number;
	onSubmit: () => void;
	onClose: () => void;
}

/** What the Restore dialog shows for a given state. It holds no state of its own. */
export function RestoreBackupView(props: RestoreBackupViewProps) {
	const { backup, listed, destination, onDestination, partial, ran, submission, now, onSubmit, onClose } = props;
	const absolute = isAbsoluteFolder(destination.trim());
	const gone = !ran && listed === "gone";
	return (
		<OperationDialog
			title={gone ? "This backup is no longer listed" : `Restore backup of ${describeBackupRow(backup, now).branch}`}
			command={restoreCommandFor(backup.id, destination.trim())}
			submission={submission}
			submitLabel="Restore"
			runningLabel="Restoring the backup"
			failureTitle={partial ? "The restore stopped part of the way" : "Could not restore the backup"}
			failureNote={partial ? <CleanupCommands lines={describeRemainingRestore(partial)} cleanup={partial.cleanup} /> : undefined}
			canSubmit={!gone && absolute}
			cancelLabel={gone ? "Close" : "Cancel"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{gone ? (
				<p className="dialog-note">Timber no longer lists this backup, so there is nothing to restore here. Nothing was run.</p>
			) : (
				<>
					<BackupFacts backup={backup} now={now} />
					<p className="dialog-note">{RESTORE_NOTE}</p>
					<label className="field">
						<span className="field-label">Restore into</span>
						<input
							className="field-input mono"
							name="destination"
							value={destination}
							autoComplete="off"
							spellCheck={false}
							autoFocus
							aria-invalid={!absolute}
							onChange={event => onDestination(event.target.value)}
						/>
						<span className={absolute ? "field-hint" : "field-hint error"}>{absolute ? RESTORE_FOLDER_HINT : RESTORE_FOLDER_NOT_ABSOLUTE}</span>
					</label>
					<p className="dialog-note">{`The new branch is recovery/${cleanText(backup.id)}. ${RESTORE_CHANGES_NOTE}`}</p>
				</>
			)}
		</OperationDialog>
	);
}

/** The Restore dialog of one backup, as the person chose it in the sidebar. */
export function RestoreBackupDialog({ request }: { request: { repository: string; backup: Backup } }) {
	const store = useStore();
	const state = useAppState();
	const { backup } = request;
	const [destination, setDestination] = useState(() => defaultRestoreFolder(request.repository, backup.id));
	const [partial, setPartial] = useState<RestoreBackupViewProps["partial"]>(null);
	const [ran, setRan] = useState(false);
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());
	const run = () => {
		const restoreRequest = { repository: request.repository, id: backup.id, destination: destination.trim() };
		setPartial(null);
		setRan(true);
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const result = await store.restoreBackup(restoreRequest);
			switch (result.outcome) {
				case "restored":
					return { ok: true, toast: describeRestored(result.branch) };
				case "partial":
					setPartial({ ...result.remaining, cleanup: result.cleanup });
					return { ok: false, failure: result.failure };
				case "refused":
				case "failed":
					return { ok: false, failure: result.failure };
			}
		});
	};
	return (
		<RestoreBackupView
			backup={backup}
			listed={stillListed(state.backups[request.repository], backup)}
			destination={destination}
			onDestination={next => {
				setDestination(next);
				submission.clearFailure();
			}}
			partial={partial}
			ran={ran}
			submission={submissionState}
			now={Date.now()}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}

export interface DeleteBackupViewProps {
	backup: Backup;
	listed: "same" | "gone" | "changed";
	/** What a deletion that stopped part of the way left, or null. Once set, the dialog follows it, not the list. */
	partial: { remaining: RemainingDeletion; cleanup: string[] } | null;
	/** Whether this dialog ran the command already. Then the list no longer decides: its failure is what to show. */
	ran: boolean;
	submission: SubmissionState;
	now: number;
	onSubmit: () => void;
	onClose: () => void;
}

/** What the Delete dialog shows for a given state. It holds no state of its own. */
export function DeleteBackupView(props: DeleteBackupViewProps) {
	const { backup, listed, partial, ran, submission, now, onSubmit, onClose } = props;
	const branch = describeBackupRow(backup, now).branch;
	// After a partial deletion the backup is listed as unfinished. The same command finishes it, so the list no longer decides.
	// After any run its failure is shown instead, and Timber checks again on the next.
	const blocked = !ran && listed !== "same";
	return (
		<OperationDialog
			title={blocked ? "This backup changed" : partial ? `Finish deleting the backup of ${branch}` : `Delete backup of ${branch}?`}
			command={deleteCommandFor(backup)}
			submission={submission}
			submitLabel={partial ? "Delete again" : "Delete"}
			runningLabel="Deleting the backup"
			failureTitle={partial ? "The deletion stopped part of the way" : "Timber kept the backup"}
			failureNote={partial ? <CleanupCommands lines={[...describeRemainingDeletion(partial.remaining), "Delete again finishes it, with Timber's checks."]} cleanup={partial.cleanup} /> : undefined}
			canSubmit={!blocked}
			destructive
			cancelLabel={blocked || partial ? "Close" : "Keep"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{blocked ? (
				<p className="dialog-note">
					{listed === "gone"
						? "Timber no longer lists this backup as usable, so there is nothing to delete here. Nothing was run."
						: "Timber lists this backup differently than when the dialog opened, or protects it now. Nothing was run. Close, then choose it again."}
				</p>
			) : (
				<>
					<BackupFacts backup={backup} now={now} />
					<p className="dialog-note">{DELETE_NOTE}</p>
				</>
			)}
		</OperationDialog>
	);
}

/** The Delete dialog of one backup, approving it exactly as the person saw it when the dialog opened. */
export function DeleteBackupDialog({ request }: { request: { repository: string; backup: Backup } }) {
	const store = useStore();
	const state = useAppState();
	const { backup } = request;
	const [partial, setPartial] = useState<DeleteBackupViewProps["partial"]>(null);
	const [ran, setRan] = useState(false);
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());
	const run = () => {
		const deleteRequest = { repository: request.repository, id: backup.id, recordSha256: backup.recordSha256 };
		setRan(true);
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const result = await store.deleteBackup(deleteRequest);
			switch (result.outcome) {
				case "deleted":
					return { ok: true, toast: BACKUP_DELETED };
				case "partial":
					setPartial({ remaining: result.remaining, cleanup: result.cleanup });
					return { ok: false, failure: result.failure };
				case "refused":
				case "failed":
					return { ok: false, failure: result.failure };
			}
		});
	};
	return (
		<DeleteBackupView
			backup={backup}
			listed={stillListed(state.backups[request.repository], backup)}
			partial={partial}
			ran={ran}
			submission={submissionState}
			now={Date.now()}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
