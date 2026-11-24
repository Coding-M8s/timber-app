import { useEffect, useId, useState } from "react";
import { confirmsPull, withPullSkipped } from "../../shared/pull-confirm-setting";
import { pullsInsteadOfRebase } from "../../shared/fallback-base";
import type { Worktree } from "../../shared/model";
import { type SyncActionKind, type SyncActionResult, isNoUpstream } from "../../shared/sync-actions";
import { worktreeLabel } from "../format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import {
	SYNC_ACTION_WORDS, actionTargetOfWorktree, describeSyncCommands, describeSyncIntro, describeSyncRefusalNote, describeSyncTitle, presentPublishResult, presentSyncResult,
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
	/** False for a primary checkout whose base is its own upstream, where Pull is offered in place of Rebase: a refusal then does not point to Rebase. */
	rebaseOffered?: boolean;
	submission: SubmissionState;
	/**
	 * The "Don't ask before pulling" box, for a Pull dialog opened to ask
	 * first. Ticked when Pull is submitted, it turns on the repository's
	 * "Skip pull confirmation". Absent otherwise.
	 */
	skipChoice?: { repository: string; checked: boolean; onChange: (checked: boolean) => void };
	onSubmit: () => void;
	onClose: () => void;
}

/**
 * What a sync action's dialog shows for a given state. It holds no state of
 * its own. It shows every command before it runs, worded from the same
 * table the main process runs them from: Git's for Pull, Timber's for Push.
 */
export function SyncActionDialogView({ action, worktree, path, result, rebaseOffered = true, submission, skipChoice, onSubmit, onClose }: SyncActionDialogViewProps) {
	const words = SYNC_ACTION_WORDS[action];
	const skipHintId = useId();
	// After a run, something did run: the notes for a worktree or upstream that went say only what is so now.
	const ran = result !== null && !(result.outcome === "failed" && !result.ran);
	const target = actionTargetOfWorktree(action, worktree);
	const commands = target && worktree ? describeSyncCommands(action, target, worktree.path) : null;
	const note = result ? describeSyncRefusalNote(result, rebaseOffered) : null;
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
				? <p className="dialog-note">{ran ? "This worktree left the list." : "This worktree left the list while the dialog was open. Nothing was run."}</p>
				: target === null
					? <p className="dialog-note">The branch of {worktreeLabel(worktree)} has no upstream on a remote now, so there is nothing to {words.label.toLowerCase()}.{ran ? "" : " Nothing was run."}</p>
					: describeSyncIntro(action, worktree).map(line => <p key={line} className="dialog-note">{line}</p>)}
			{skipChoice && worktree !== null && target !== null && (
				<label className="check">
					<input type="checkbox" checked={skipChoice.checked} aria-describedby={skipHintId} onChange={event => skipChoice.onChange(event.target.checked)} />
					<span className="check-text">
						Don't ask before pulling in {skipChoice.repository}
						<span id={skipHintId} className="check-hint">Turned on when you pull. Pull then runs at once there, and this dialog opens only when Git refuses or it fails. Change it in Settings, Pull.</span>
					</span>
				</label>
			)}
		</OperationDialog>
	);
}

/**
 * The dialog of a sync action, Pull or Push, for one worktree. Submitting
 * runs the commands shown, with the remote and upstream they name, or with
 * no upstream yet for a Push that publishes the branch; the main process
 * runs nothing when those changed since. One that worked closes the
 * dialog with a toast, which for a pull also says when the fetch failed. A
 * refusal or a failure stays in the dialog with Git's or Timber's words. The repository is read
 * again after every outcome (`runSyncAction` in ../store/store.ts).
 *
 * A pull that ran without the dialog, because the Pull setting skips it, and
 * did not work opens it on that outcome (`ended`). A Pull dialog opened to ask
 * first offers "Don't ask before pulling in <repository>": ticked when Pull is
 * submitted, it saves the repository's "Skip pull confirmation". Cancel saves
 * nothing.
 */
export function SyncActionDialog({ request }: { request: Extract<DialogRequest, { kind: "sync-action" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const worktree = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	const repositoryName = repository?.name ?? request.repository;
	const [path] = useState(() => worktree?.path ?? "");
	const [result, setResult] = useState<SyncActionResult | null>(request.ended ?? null);
	// A pull that ran without the dialog and did not work: its failure shows until Pull is submitted again.
	const [ended, setEnded] = useState(request.ended ?? null);
	// Offered once, as the dialog opens to ask first, so the box does not go when a submitted tick is saved.
	const [offerSkip] = useState(() => request.action === "pull" && request.ended === undefined && confirmsPull(state.preferences.pull, request.repository));
	const [skipTicked, setSkipTicked] = useState(false);
	// What the box last saved, so a Pull submitted again after unticking it turns the setting back off.
	const [skipSaved, setSkipSaved] = useState(false);
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
		const target = actionTargetOfWorktree(request.action, worktree);
		if (!worktree || !target) return;
		const label = worktreeLabel(worktree);
		const upstream = worktree.sync?.kind === "tracking" ? worktree.sync.upstream : null;
		setResult(null);
		setEnded(null);
		if (offerSkip && skipTicked !== skipSaved) {
			// Saved whatever the pull comes to: it was asked for when Pull was submitted.
			setSkipSaved(skipTicked);
			void store.savePreferences({ pull: withPullSkipped(store.getState().preferences.pull, request.repository, skipTicked) }).then(saved => {
				if (saved.outcome === "failed") store.showToast(`Could not save "Don't ask before pulling" for ${repositoryName}. ${saved.message}`, true);
			});
		}
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const ended = await store.runSyncAction({ action: request.action, repository: request.repository, worktree: worktree.path, target });
			setResult(ended);
			if (isNoUpstream(target) || upstream === null) {
				// The list was read again after the push, so it names the upstream Timber set.
				const after = store.getState().repositories.find(candidate => candidate.path === request.repository)?.worktrees.find(candidate => candidate.id === request.worktree)?.sync;
				return presentPublishResult(label, after?.kind === "tracking" ? after.upstream : null, ended);
			}
			return presentSyncResult(request.action, label, upstream, ended);
		});
	};

	return (
		<SyncActionDialogView
			action={request.action}
			worktree={worktree}
			path={path}
			result={result}
			rebaseOffered={repository === undefined || worktree === null || !pullsInsteadOfRebase(repository, worktree)}
			submission={ended !== null && !submissionState.running && submissionState.failure === null ? { running: false, failure: ended.failure } : submissionState}
			{...(offerSkip ? { skipChoice: { repository: repositoryName, checked: skipTicked, onChange: setSkipTicked } } : {})}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
