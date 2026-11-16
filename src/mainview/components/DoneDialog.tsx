import { useEffect, useState, useSyncExternalStore } from "react";
import type { Worktree } from "../../shared/model";
import { type DoneOptions, describeDoneApply, describeDonePreview } from "../../shared/timber-done";
import {
	DONE_EXPIRED_NOTE, DONE_REMOTE_NOTE, describeBranchEffect, describeDone, describeExpiry, describeIgnoredEffect,
	describeUnpublishedCommits, filesLost, losesWork,
} from "../done-format";
import { worktreeLabel } from "../format";
import { useAppState, useStore, useSubmission } from "../store/react";
import { type DoneSessionState, canRemove, createDoneSession } from "../store/done-session";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";
import { TimberFailureDetails } from "./TimberFailureDetails";

/**
 * Where the warning about live terminal and agent sessions of the worktree
 * will go. The app has no sessions yet (see Milestones in
 * docs/architecture.md), so there is nothing to warn about and this shows
 * nothing. When sessions exist, list them here, and make closing them part of
 * the flow before Remove.
 */
function LiveSessionsWarning(_props: { worktree: Worktree }) {
	return null;
}

function FileList({ title, tone, files }: { title: string; tone: "modified" | "untracked" | "ignored"; files: readonly string[] }) {
	if (files.length === 0) return null;
	return (
		<div className="done-files">
			<p className={`done-files-title ${tone}`}>{title} ({files.length})</p>
			<ul className="done-files-list" tabIndex={0} aria-label={`${title} files`}>
				{files.map(file => <li key={file}>{file}</li>)}
			</ul>
		</div>
	);
}

/** The base as the options hold it: no surrounding space, and null when empty. */
const baseOf = (draft: string): string | null => draft.trim() || null;

export interface DoneDialogViewProps {
	/** The repository's name in the list. */
	repository: string;
	/** The worktree as the list has it, or as it last had it when `gone`. */
	worktree: Worktree;
	/** The worktree left the list while the dialog was open. */
	gone: boolean;
	session: DoneSessionState;
	submission: SubmissionState;
	/** What the base field holds. It becomes an option, and a new preview, on Enter or on leaving the field. */
	baseDraft: string;
	onBaseDraft: (draft: string) => void;
	onBaseCommit: () => void;
	onOptions: (options: DoneOptions) => void;
	onRefresh: () => void;
	onRemove: () => void;
	onClose: () => void;
}

/**
 * What the Done dialog shows for a given state. It holds no state of its own
 * (see `DoneDialog` below for that).
 *
 * Remove is possible only while a preview that has not expired is on screen
 * for exactly the options on screen. Focus starts on the button that keeps
 * the worktree, and Enter in a field never removes.
 */
export function DoneDialogView(props: DoneDialogViewProps) {
	const { repository, worktree, gone, session, submission, baseDraft, onBaseDraft, onBaseCommit, onOptions, onRefresh, onRemove, onClose } = props;
	const { options, preview } = session;
	const label = worktreeLabel(worktree);
	const basePending = baseOf(baseDraft) !== options.base;
	const ready = preview.kind === "ready" && !preview.expired ? preview.preview : null;
	const lossy = ready !== null && losesWork(ready, worktree.sync);
	const commits = ready && describeUnpublishedCommits(ready, worktree.sync);

	const title = gone ? `${label} is no longer in the list` : lossy ? "Delete anyway?" : `Remove ${label}?`;
	const failureNote = (
		<p className="done-note">
			{gone
				? "The list was read again and no longer has this worktree. What is left of it, such as its branch, is what the list and Git show now."
				: "The list was read again and shows the real state. Nothing is tried again by itself: the preview above is a new one, so review it before removing."}
		</p>
	);

	return (
		<OperationDialog
			title={title}
			command={describeDoneApply(worktree.path)}
			submission={submission}
			submitLabel="Remove"
			runningLabel={`Removing ${label}`}
			failureTitle={`Timber did not finish removing ${label}`}
			failureNote={failureNote}
			canSubmit={!gone && !basePending && canRemove(session)}
			destructive
			cancelLabel={gone ? "Close" : lossy ? "Keep" : "Cancel"}
			onSubmit={onRemove}
			onClose={onClose}
		>
			<div className="done-target">
				<span className="done-label">{gone ? "Was at" : "Removes the folder"}</span>
				<span className="path">{worktree.path}</span>
				<span className="done-sub">{worktree.branch === null ? label : `Branch ${worktree.branch}`} in {repository}</span>
			</div>

			{gone ? (
				// After a removal that failed, the failure below says what happened.
				!session.attempted && (
					<p className="done-line">
						This worktree left the list while the dialog was open, so there is nothing to remove here any more. Nothing else is removed from this dialog.
					</p>
				)
			) : (
				<>
					<LiveSessionsWarning worktree={worktree} />

					<div className="done-options" role="group" aria-label="Options">
						<label className="done-check">
							<input type="checkbox" checked={options.keepBranch} onChange={event => onOptions({ ...options, keepBranch: event.target.checked })} />
							<span>Keep the local branch</span>
						</label>
						<label className="done-check">
							<input type="checkbox" checked={options.keepIgnored} onChange={event => onOptions({ ...options, keepIgnored: event.target.checked })} />
							<span>Keep ignored files (Timber then refuses while any exist, and copies nothing)</span>
						</label>
						<label className="field">
							<span className="field-label">Base branch to check against (empty for Timber's own choice)</span>
							<input
								className="field-input"
								value={baseDraft}
								spellCheck={false}
								onChange={event => onBaseDraft(event.target.value)}
								onBlur={onBaseCommit}
								onKeyDown={event => {
									if (event.key !== "Enter") return;
									// Enter asks for the preview with this base. It never removes.
									event.preventDefault();
									onBaseCommit();
								}}
							/>
						</label>
						{basePending && <p className="done-hint">Press Enter to preview with this base. Remove waits for that preview.</p>}
					</div>

					<div className="done-preview" aria-live="polite">
						{preview.kind === "loading" && <p className="done-line" role="status">Asking Timber what would be removed. Nothing is removed by asking.</p>}
						{preview.kind === "failed" && <TimberFailureDetails title="Timber gave no preview, so nothing can be removed" failure={preview.failure} />}
						{preview.kind === "ready" && preview.expired && <p className="done-warning" role="alert">{DONE_EXPIRED_NOTE}</p>}
						{ready && (
							<>
								{filesLost(ready) > 0
									? <p className="done-warning">These files exist only in this folder and are deleted with it:</p>
									: <p className="done-line">No modified or untracked files.</p>}
								{ready.worktree.changes.kind === "known" && (
									<>
										<FileList title="Modified" tone="modified" files={ready.worktree.changes.modified} />
										<FileList title="Untracked" tone="untracked" files={ready.worktree.changes.untracked} />
									</>
								)}
								<p className="done-line">{describeIgnoredEffect(ready)}</p>
								{ready.options.discardIgnored && <FileList title="Ignored" tone="ignored" files={ready.ignored} />}
								<p className="done-line">{describeBranchEffect(ready)}</p>
								{commits && <p className="done-warning">{commits}</p>}
								<p className="done-line">{DONE_REMOTE_NOTE}</p>
								<p className="done-hint">{describeExpiry(ready.expiresAt)}</p>
							</>
						)}
						<div className="done-preview-foot">
							<pre className="dialog-command" aria-label="Preview command">{describeDonePreview(worktree.path, options)}</pre>
							{preview.kind !== "loading" && <button type="button" className="button quiet done-refresh" onClick={onRefresh}>Preview again</button>}
						</div>
					</div>
				</>
			)}
		</OperationDialog>
	);
}

/**
 * The Done dialog for one worktree. Opening it asks Timber for a preview,
 * which removes nothing. Remove approves exactly the preview on screen, once.
 *
 * The request names the worktree by identity. When it leaves the list while
 * the dialog is open, the dialog says so and offers nothing but Close.
 */
export function DoneDialog({ request }: { request: Extract<DialogRequest, { kind: "done-worktree" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const listed = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	// The worktree as it was last listed, so the dialog can still name it once it is gone.
	const [seen, setSeen] = useState(listed);
	if (listed && listed !== seen) setSeen(listed);
	const worktree = listed ?? seen;

	const [session] = useState(() => worktree && createDoneSession({
		repository: request.repository,
		path: worktree.path,
		preview: store.previewDone,
		apply: store.applyDone,
		listed: () => store.getState().repositories.some(candidate => candidate.path === request.repository && candidate.worktrees.some(tree => tree.id === request.worktree)),
	}));
	const sessionState = useSyncExternalStore(
		listener => session?.subscribe(listener) ?? (() => {}),
		() => session?.getState() ?? null,
		() => session?.getState() ?? null,
	);
	const [baseDraft, setBaseDraft] = useState("");
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());

	useEffect(() => {
		// A dialog for a worktree that was never in the list has nothing to show.
		if (!session) return store.closeDialog();
		session.start();
		return () => session.stop();
	}, [session, store]);

	if (!session || !sessionState || !worktree) return null;

	const remove = () => void submission.submit(async (): Promise<SubmissionOutcome> => {
		const shown = session.getState().preview;
		const result = await session.remove();
		if (result === null || shown.kind !== "ready") {
			return { ok: false, failure: { command: null, diagnostic: "The preview on screen can no longer be approved. Nothing was run.", output: null } };
		}
		return result.outcome === "removed" ? { ok: true, toast: describeDone(worktreeLabel(worktree), shown.preview) } : { ok: false, failure: result.failure };
	});

	return (
		<DoneDialogView
			repository={repository?.name ?? request.repository}
			worktree={worktree}
			gone={listed === null && !submissionState.running}
			session={sessionState}
			submission={submissionState}
			baseDraft={baseDraft}
			onBaseDraft={setBaseDraft}
			onBaseCommit={() => {
				if (baseOf(baseDraft) !== sessionState.options.base) session.setOptions({ ...sessionState.options, base: baseOf(baseDraft) });
			}}
			onOptions={options => session.setOptions(options)}
			onRefresh={() => session.refresh()}
			onRemove={remove}
			onClose={() => store.closeDialog()}
		/>
	);
}
