import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Worktree } from "../../shared/model";
import { type DoneOptions, describeDoneApply, describeDonePreview } from "../../shared/timber-done";
import {
	DONE_EXPIRED_NOTE, DONE_REMOTE_NOTE, describeBranchEffect, describeDone, describeExpiry, describeIgnoredEffect,
	describeUnpublishedCommits, filesLost, losesWork,
} from "../done-format";
import { worktreeLabel } from "../format";
import { describeDoneSessionsWarning } from "../terminal-format";
import { useAppState, useStore } from "../store/react";
import { type DoneSessionState, canRemove, createDoneSession } from "../store/done-session";
import { type DialogRequest, removalAt, runningSessionCount } from "../store/state";
import type { SubmissionState } from "../store/submission";
import { focusFirstWorktree, focusLost } from "../sidebar-focus";
import { groupChainOf } from "../../shared/repository-groups";
import { OperationDialog } from "./OperationDialog";
import { TimberFailureDetails } from "./TimberFailureDetails";

/**
 * The warning about sessions that run in the worktree. Removing the
 * worktree ends them: the store closes every session once Timber says the
 * worktree is removed (`applyDone` in ../store/store.ts).
 */
function LiveSessionsWarning({ running }: { running: number }) {
	if (running === 0) return null;
	return <p className="done-warning" role="note">{describeDoneSessionsWarning(running)}</p>;
}

function FileList({ title, tone, files }: { title: string; tone: "modified" | "untracked"; files: readonly string[] }) {
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
	/** How many sessions run in the worktree. */
	runningSessions?: number;
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
	const { repository, worktree, gone, runningSessions = 0, session, submission, baseDraft, onBaseDraft, onBaseCommit, onOptions, onRefresh, onRemove, onClose } = props;
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
					<LiveSessionsWarning running={runningSessions} />

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
 * The removal itself belongs to the store (`removeWorktree`), which closes
 * the dialog as soon as it starts, so the window is free while Timber works
 * and the worktree's row shows it meanwhile. A failure is kept by the store
 * and shown here when the dialog is opened again from the row's Details,
 * with Timber's diagnostic. Closing it puts the failure away.
 *
 * The request names the worktree by identity. When it leaves the list while
 * the dialog is open, the dialog says so and offers nothing but Close. A
 * dialog opened for a removal that failed after the worktree left the list,
 * as a partial failure does, names it as the record has it.
 */
export function DoneDialog({ request }: { request: Extract<DialogRequest, { kind: "done-worktree" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const listed = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	// The removal is named by the registered path, which stays while the worktree's identity can change.
	const removal = listed
		? removalAt(state, request.repository, listed.path)
		: state.removals.find(candidate => candidate.repository === request.repository && candidate.worktree.id === request.worktree) ?? null;
	// The worktree as it was last listed, so the dialog can still name it once it is gone.
	const [seen, setSeen] = useState(listed ?? removal?.worktree ?? null);
	if (listed && listed !== seen) setSeen(listed);
	const worktree = listed ?? seen;
	// What the removal is named by when Remove is pressed: the worktree as it is listed then.
	const latest = useRef(worktree);
	latest.current = worktree;

	const [session] = useState(() => worktree && createDoneSession({
		repository: request.repository,
		path: worktree.path,
		preview: store.previewDone,
		apply: (apply, shown) => {
			const target = latest.current ?? worktree;
			return store.removeWorktree({ repository: apply.repository, worktree: target, preview: apply.preview, toast: describeDone(worktreeLabel(target), shown) });
		},
		attempted: removal?.status.kind === "failed",
		listed: () => store.getState().repositories.some(candidate => candidate.path === request.repository && candidate.worktrees.some(tree => tree.path === worktree.path)),
	}));
	const sessionState = useSyncExternalStore(
		listener => session?.subscribe(listener) ?? (() => {}),
		() => session?.getState() ?? null,
		() => session?.getState() ?? null,
	);
	const [baseDraft, setBaseDraft] = useState("");
	// Whether the worktree was listed when the dialog opened. One that was not has nothing to preview.
	const [listedAtOpen] = useState(listed !== null);

	// Closing gives the keyboard back to the Done button that opened the dialog. While the removal runs that button is
	// disabled, and once it worked the worktree is gone, so the keyboard would be nowhere: it goes to the first worktree
	// of the repository instead. Checked once the dialog has closed and the browser has moved focus.
	useEffect(() => () => {
		setTimeout(() => {
			// In a folded repository group the repository is not drawn, so the group's header takes the keyboard.
			if (focusLost(document.activeElement, document.body)) focusFirstWorktree(request.repository, undefined, groupChainOf(store.getState().repositoryGroups, request.repository));
		}, 0);
	}, [request.repository, store]);

	useEffect(() => {
		// A dialog for a worktree that was never in the list, and has no removal on record, has nothing to show.
		if (!session) return store.closeDialog();
		if (!listedAtOpen) return;
		session.start();
		return () => session.stop();
	}, [session, store, listedAtOpen]);

	if (!session || !sessionState || !worktree) return null;

	const running = removal?.status.kind === "running";
	const submission: SubmissionState = { running, failure: removal?.status.kind === "failed" ? removal.status.failure : null };
	const close = () => {
		// The person has seen the failure, so it goes. A removal that runs goes on.
		store.dismissRemoval(request.repository, worktree.path);
		store.closeDialog();
	};

	return (
		<DoneDialogView
			repository={repository?.name ?? request.repository}
			worktree={worktree}
			gone={listed === null && !running}
			runningSessions={runningSessionCount(state, worktree.id)}
			session={sessionState}
			submission={submission}
			baseDraft={baseDraft}
			onBaseDraft={setBaseDraft}
			onBaseCommit={() => {
				if (baseOf(baseDraft) !== sessionState.options.base) session.setOptions({ ...sessionState.options, base: baseOf(baseDraft) });
			}}
			onOptions={options => session.setOptions(options)}
			onRefresh={() => session.refresh()}
			onRemove={() => void session.remove()}
			onClose={close}
		/>
	);
}
