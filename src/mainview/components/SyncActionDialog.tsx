import { useEffect, useState } from "react";
import type { Worktree } from "../../shared/model";
import type { SyncActionKind, SyncActionResult } from "../../shared/sync-actions";
import { worktreeLabel } from "../format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import {
	SYNC_ACTION_WORDS, describeSyncCommands, describeSyncIntro, describeSyncRefusalNote, describeSyncTitle, presentSyncResult, syncTargetOfWorktree,
} from "../sync-action-format";
import { OperationDialog } from "./OperationDialog";
import { focusWorktreeRow } from "../sidebar-focus";

export interface SyncActionDialogViewProps {
	action: SyncActionKind;
	/** The worktree as the list has it, or null when it left the list. */
	worktree: Worktree | null;
	/** The registered path the dialog was opened for, kept for when the worktree left the list. */
	path: string;
	/** What the latest run that left the dialog open came to, for the note under Git's words. */
	result: SyncActionResult | null;
	submission: SubmissionState;
	onSubmit: () => void;
	onClose: () => void;
}

/**
 * What a sync action's dialog shows for a given state. It holds no state of
 * its own. It shows every Git command before it runs, worded from the same
 * table the main process runs them from.
 */
export function SyncActionDialogView({ action, worktree, path, result, submission, onSubmit, onClose }: SyncActionDialogViewProps) {
	const words = SYNC_ACTION_WORDS[action];
	const target = syncTargetOfWorktree(worktree);
	const commands = target ? describeSyncCommands(action, target) : null;
	const note = result ? describeSyncRefusalNote(result) : null;
	return (
		<OperationDialog
			title={worktree ? describeSyncTitle(action, worktree) : `${path} is no longer in the list`}
			command={commands?.command ?? "Nothing to run"}
			followUps={commands?.followUps ?? []}
			submission={submission}
			submitLabel={words.label}
			runningLabel={words.running}
			failureTitle={words.failureTitle}
			failureNote={note ? <p className="dialog-note" role="note">{note}</p> : undefined}
			canSubmit={worktree !== null && target !== null}
			cancelLabel={worktree && target ? "Cancel" : "Close"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{worktree === null
				? <p className="dialog-note">This worktree left the list while the dialog was open. Nothing was run.</p>
				: target === null
					? <p className="dialog-note">The branch of {worktreeLabel(worktree)} has no upstream on a remote now, so there is nothing to {words.label.toLowerCase()}. Nothing was run.</p>
					: describeSyncIntro(action, worktree).map(line => <p key={line} className="dialog-note">{line}</p>)}
		</OperationDialog>
	);
}

/**
 * The dialog of a sync action such as Pull, for one worktree. Submitting
 * runs the commands shown, with the remote and upstream they name; the main
 * process runs nothing when those changed since. A pull that worked closes
 * the dialog with a toast, which also says when the fetch failed. A refusal
 * or a failure stays in the dialog with Git's words. The repository is read
 * again after every outcome (`runSyncAction` in ../store/store.ts).
 */
export function SyncActionDialog({ request }: { request: Extract<DialogRequest, { kind: "sync-action" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const worktree = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	const [path] = useState(() => worktree?.path ?? "");
	const [result, setResult] = useState<SyncActionResult | null>(null);
	const { submission, state: submissionState } = useSubmission(() => {
		store.closeDialog();
		// The control that opened the dialog is gone once the branch caught up, so the keyboard goes to the row instead of nowhere.
		setTimeout(() => {
			if (path !== "" && (document.activeElement === null || document.activeElement === document.body)) focusWorktreeRow(path);
		}, 0);
	});

	useEffect(() => {
		// A dialog for a worktree that was never in the list has nothing to show.
		if (!worktree && path === "") store.closeDialog();
	}, [worktree, path, store]);

	if (!worktree && path === "") return null;

	const run = () => {
		const target = syncTargetOfWorktree(worktree);
		if (!worktree || !target || worktree.sync?.kind !== "tracking") return;
		const label = worktreeLabel(worktree);
		const upstream = worktree.sync.upstream;
		setResult(null);
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const ended = await store.runSyncAction({ action: request.action, repository: request.repository, worktree: worktree.path, target });
			setResult(ended);
			return presentSyncResult(request.action, label, upstream, ended);
		});
	};

	return (
		<SyncActionDialogView
			action={request.action}
			worktree={worktree}
			path={path}
			result={result}
			submission={submissionState}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
