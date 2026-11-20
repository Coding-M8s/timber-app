import { useEffect, useState, useSyncExternalStore } from "react";
import { DEFAULT_DONE_OPTIONS, DONE_PREVIEW_MINUTES, describeDonePreview } from "../../shared/timber-done";
import { CLEAN_UP_LIMIT, describeCleanUpCommands, describeCleanUpTitle, describeReadyEffect, mergedCandidates } from "../clean-up-format";
import { BEING_REMOVED_REASON, DONE_REMOTE_NOTE } from "../done-format";
import { worktreeLabel } from "../format";
import { useAppState, useStore } from "../store/react";
import { type CleanUpRow, type CleanUpSessionState, createCleanUpSession, readyRows } from "../store/clean-up-session";
import { type DialogRequest, isBeingRemoved, runningSessionCount } from "../store/state";
import { OperationDialog } from "./OperationDialog";

export interface CleanUpMergedDialogViewProps {
	/** The repository's name in the list. */
	repository: string;
	session: CleanUpSessionState;
	/** Whether the worktree at this path is being removed or waits for it, so its own Done dialog cannot open. */
	beingRemoved: (path: string) => boolean;
	onRefresh: () => void;
	/** Open the single Done dialog for a skipped worktree, in place of this one. */
	onOpenDone: (row: CleanUpRow) => void;
	onRemove: () => void;
	onClose: () => void;
}

function SkippedRow({ row, beingRemoved, onOpenDone }: { row: Extract<CleanUpRow, { kind: "skipped" }>; beingRemoved: boolean; onOpenDone: () => void }) {
	const label = worktreeLabel(row.worktree);
	return (
		<li className="clean-up-row">
			<span className="clean-up-name">{label}</span>
			<span className="path">{row.worktree.path}</span>
			<span className="clean-up-reason">{row.reason}</span>
			{row.failure && <span className="clean-up-reason">Timber says: {row.failure.diagnostic}</span>}
			<button
				type="button"
				className="text-button clean-up-open"
				aria-haspopup="dialog"
				aria-label={`Open Done for ${label}`}
				disabled={beingRemoved}
				title={beingRemoved ? BEING_REMOVED_REASON : `Review ${label} in its own Done dialog`}
				onClick={onOpenDone}
			>
				Open Done
			</button>
		</li>
	);
}

/**
 * What the Clean up merged dialog shows for a given state. It holds no state
 * of its own (see `CleanUpMergedDialog` below for that).
 *
 * Every candidate is a row: Ready, Skipped with the reason, or still being
 * previewed. The commands Remove runs are shown in full, one per Ready row,
 * and Remove is the only thing that removes anything.
 */
export function CleanUpMergedDialogView(props: CleanUpMergedDialogViewProps) {
	const { repository, session, beingRemoved, onRefresh, onOpenDone, onRemove, onClose } = props;
	const ready = readyRows(session);
	const skipped = session.rows.filter((row): row is Extract<CleanUpRow, { kind: "skipped" }> => row.kind === "skipped");
	const loading = session.rows.filter(row => row.kind === "loading");
	const previewed = session.rows.slice(0, CLEAN_UP_LIMIT);

	return (
		<OperationDialog
			title={describeCleanUpTitle(repository)}
			command={describeCleanUpCommands(ready.map(row => row.worktree.path))}
			submission={{ running: false, failure: null }}
			submitLabel={ready.length > 1 ? `Remove ${ready.length} worktrees` : "Remove"}
			runningLabel="Starting the removals"
			failureTitle="Nothing was removed"
			canSubmit={ready.length > 0 && loading.length === 0}
			destructive
			onSubmit={onRemove}
			onClose={onClose}
		>
			<div className="done-preview clean-up" aria-live="polite">
				{loading.length > 0 && (
					<p className="done-line" role="status">
						Asking Timber what removing {loading.length === 1 ? "1 worktree" : `${loading.length} worktrees`} would do. Nothing is removed by asking.
					</p>
				)}

				<p className="done-files-title">Ready ({ready.length})</p>
				{ready.length === 0
					? <p className="done-line">{loading.length > 0 ? "None yet." : "None. Every worktree below needs its own look."}</p>
					: (
						<ul className="clean-up-list" aria-label="Ready">
							{ready.map(row => (
								<li key={row.worktree.path} className="clean-up-row">
									<span className="clean-up-name">{worktreeLabel(row.worktree)}</span>
									<span className="path">{row.worktree.path}</span>
									<span className="clean-up-reason">{describeReadyEffect(row.worktree)}</span>
									{row.warning && <span className="done-warning">{row.warning}</span>}
								</li>
							))}
						</ul>
					)}

				{skipped.length > 0 && (
					<>
						<p className="done-files-title">Skipped ({skipped.length})</p>
						<ul className="clean-up-list" aria-label="Skipped">
							{skipped.map(row => (
								<SkippedRow key={row.worktree.path} row={row} beingRemoved={beingRemoved(row.worktree.path)} onOpenDone={() => onOpenDone(row)} />
							))}
						</ul>
					</>
				)}

				<p className="done-line">Ignored files in each folder are deleted with it, as Done does by default.</p>
				<p className="done-line">{DONE_REMOTE_NOTE}</p>
				<p className="done-line">Remove starts the removals in the background, one at a time, and closes this dialog. Each row in the sidebar shows how its removal ends.</p>
				<p className="done-hint">Timber accepts each preview for {DONE_PREVIEW_MINUTES} minutes from now. A worktree whose turn comes later than that is not removed, and its row says so.</p>
				<div className="done-preview-foot">
					<pre className="dialog-command" aria-label="Preview commands">{previewed.map(row => describeDonePreview(row.worktree.path, DEFAULT_DONE_OPTIONS)).join("\n")}</pre>
					{loading.length === 0 && <button type="button" className="button quiet done-refresh" onClick={onRefresh}>Preview again</button>}
				</div>
			</div>
		</OperationDialog>
	);
}

/**
 * The Clean up merged dialog for one repository. Opening it previews every
 * linked worktree whose pull request merged, which removes nothing. Remove
 * hands the Ready ones to the store (`cleanUpMerged`), which removes them
 * one at a time in the background, and the dialog closes at once.
 */
export function CleanUpMergedDialog({ request }: { request: Extract<DialogRequest, { kind: "clean-up-merged" }> }) {
	const store = useStore();
	const state = useAppState();
	// Timber runs in the repository's folder, so the repository has to be listed and there.
	const repository = state.repositories.find(candidate => candidate.path === request.repository && candidate.available);

	const [session] = useState(() => repository && createCleanUpSession({
		repository: repository.path,
		candidates: mergedCandidates(repository, state.pullRequests[repository.path]),
		preview: store.previewDone,
		current: path => store.getState().repositories.find(candidate => candidate.path === request.repository)?.worktrees.find(worktree => worktree.path === path) ?? null,
		runningSessions: worktree => runningSessionCount(store.getState(), worktree.id),
		beingRemoved: path => isBeingRemoved(store.getState(), request.repository, path),
		apply: items => void store.cleanUpMerged({ repository: request.repository, items }),
	}));
	const sessionState = useSyncExternalStore(
		listener => session?.subscribe(listener) ?? (() => {}),
		() => session?.getState() ?? null,
		() => session?.getState() ?? null,
	);

	useEffect(() => {
		if (!session) return store.closeDialog();
		session.start();
		return () => session.stop();
	}, [session, store]);

	// The repository left the list, or its folder went, while the dialog was open: there is nothing left to clean up here.
	const gone = repository === undefined;
	useEffect(() => {
		if (gone) store.closeDialog();
	}, [gone, store]);

	if (!session || !sessionState || !repository) return null;

	return (
		<CleanUpMergedDialogView
			repository={repository.name}
			session={sessionState}
			beingRemoved={path => isBeingRemoved(state, request.repository, path)}
			onRefresh={() => session.refresh()}
			onOpenDone={row => store.openDialog({ kind: "done-worktree", repository: request.repository, worktree: row.worktree.id })}
			onRemove={() => {
				if (session.remove()) store.closeDialog();
			}}
			onClose={() => store.closeDialog()}
		/>
	);
}
