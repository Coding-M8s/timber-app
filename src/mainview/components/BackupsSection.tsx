import { useId } from "react";
import { type BackupList, hasBackups } from "../../shared/backups";
import { BACKUPS_IGNORED_NOTE, BACKUPS_MANAGE_NOTE, BACKUPS_TITLE, cleanText, describeBackupRow } from "../backup-format";
import { useStore } from "../store/react";

interface BackupsSectionProps {
	/** The path of the repository's primary checkout. */
	repository: string;
	list: BackupList | undefined;
	/** The moment "how long ago" is counted from. */
	now: number;
}

/**
 * A repository's recovery backups, below its worktrees, as Timber listed
 * them. Nothing shows while there are none, while they were not read, or
 * when the Timber found has no backup list. Usable backups offer Restore,
 * and Delete unless Timber protects them. Unfinished deletions and entries
 * that are not usable are shown with Timber's reason and offer nothing here.
 */
export function BackupsSection({ repository, list, now }: BackupsSectionProps) {
	const store = useStore();
	const headingId = useId();
	if (!hasBackups(list) || list?.state !== "listed") return null;
	return (
		<section className="backups" aria-labelledby={headingId}>
			<h3 id={headingId} className="backups-title" title={BACKUPS_IGNORED_NOTE}>{BACKUPS_TITLE}</h3>
			<ul className="backups-list">
				{list.backups.map(backup => {
					const row = describeBackupRow(backup, now);
					const { protection } = backup;
					return (
						<li key={backup.id} className="backup" title={row.tooltip}>
							<span className="backup-text">
								<span className="backup-branch">{row.branch}</span>
								<span className="backup-detail">{row.detail}</span>
								{protection.protected && <span className="backup-flag">protected</span>}
								{protection.protected && <span className="backup-reason">{cleanText(protection.reason)}</span>}
							</span>
							<span className="backup-actions">
								<button
									type="button"
									className="text-button"
									aria-label={`Restore backup of ${row.branch}, ${row.detail}`}
									onClick={() => store.openDialog({ kind: "restore-backup", repository, backup })}
								>
									Restore
								</button>
								{!protection.protected && (
									<button
										type="button"
										className="text-button danger"
										aria-label={`Delete backup of ${row.branch}, ${row.detail}`}
										onClick={() => store.openDialog({ kind: "delete-backup", repository, backup })}
									>
										Delete
									</button>
								)}
							</span>
						</li>
					);
				})}
				{list.unfinished.map(entry => (
					<li key={`deleting-${entry.id}`} className="backup quiet" title={cleanText(entry.directory)}>
						<span className="backup-text">
							<span className="backup-branch">{cleanText(entry.id)}</span>
							<span className="backup-flag">deletion unfinished</span>
							<span className="backup-reason">{BACKUPS_MANAGE_NOTE}</span>
						</span>
					</li>
				))}
				{list.notUsable.map(entry => (
					<li key={`unusable-${entry.name}`} className="backup quiet" title={BACKUPS_MANAGE_NOTE}>
						<span className="backup-text">
							<span className="backup-branch">{cleanText(entry.name)}</span>
							<span className="backup-flag">not usable</span>
							<span className="backup-reason">{cleanText(entry.reason)}</span>
						</span>
					</li>
				))}
			</ul>
			<p className="backups-note">{BACKUPS_IGNORED_NOTE}</p>
		</section>
	);
}
