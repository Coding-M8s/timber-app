import { alsoUnstaged, discardCommand, discardPaths } from "../../shared/discard-files";
import { type FileChangeTarget, sameFileChange } from "../../shared/file-changes";
import { describeGitCommand } from "../../shared/index-writes";
import {
	DISCARD_LIST_CHANGED, describeAlsoUnstaged, describeDiscardEffect, describeDiscardTitle, describeDiscarded, describeUnsavedDiscard, discardFailureTitle, discardRunningLabel,
	discardSubmitLabel,
} from "../discard-format";
import { hasUnsavedEdits } from "../file-view-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { SubmissionOutcome } from "../store/submission";
import { OperationDialog } from "./OperationDialog";

export interface DiscardFilesRequest {
	/** The path of the repository's primary checkout. */
	repository: string;
	/** The worktree's identity (`Worktree.id`). */
	worktree: string;
	/** The files as the list showed them when Discard was pressed, all of one group. */
	files: readonly FileChangeTarget[];
}

/**
 * Asks before discarding files' changes from the Changes view: lists the
 * files and the exact command, says it cannot be undone, and names a file
 * open in the editor with unsaved edits. Focus starts on Cancel, and Escape
 * cancels without changes. Runs only for the files as they were listed when
 * it opened; when the list no longer has them so, nothing runs.
 */
export function DiscardFilesDialog({ request }: { request: DiscardFilesRequest }) {
	const store = useStore();
	const state = useAppState();
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());
	const { files } = request;
	const area = files[0]?.area ?? "unstaged";
	const view = state.changes?.worktree === request.worktree && state.changes.compared === "uncommitted" ? state.changes : null;
	const listed = view?.files ?? null;
	const still = listed !== null && files.every(file => listed.some(candidate => sameFileChange(candidate, file)));
	const planned = discardCommand(files, view?.hasCommit ?? true);
	const blocked = !submissionState.running && (!still || !planned.ok);
	const command = planned.ok ? describeGitCommand(planned.command) : "";
	const open = state.files[request.worktree];
	const unsaved = open && hasUnsavedEdits(open) && discardPaths(files).includes(open.path) ? open.path : null;
	const also = listed === null ? null : describeAlsoUnstaged(alsoUnstaged(files, listed));

	const run = () => {
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const result = await store.discardFiles(files);
			if (result === null) return { ok: false, failure: { command: null, diagnostic: DISCARD_LIST_CHANGED, output: null } };
			if (result.outcome === "written") return { ok: true, toast: describeDiscarded(files) };
			return { ok: false, failure: { command: result.outcome === "failed" ? result.command : null, diagnostic: result.message, output: null } };
		});
	};

	return (
		<OperationDialog
			title={describeDiscardTitle(files)}
			command={command}
			submission={submissionState}
			submitLabel={discardSubmitLabel(area)}
			runningLabel={discardRunningLabel(area)}
			failureTitle={discardFailureTitle(area)}
			canSubmit={!blocked}
			destructive
			cancelLabel={blocked ? "Close" : "Cancel"}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		>
			{blocked ? (
				<p className="dialog-note">{planned.ok ? DISCARD_LIST_CHANGED : planned.message}</p>
			) : (
				<>
					<ul className="discard-files" aria-label="Files">
						{files.map(file => (
							<li key={`${file.previousPath ?? ""}\0${file.path}`}>
								{file.previousPath === null ? file.path : `${file.previousPath} → ${file.path}`}
							</li>
						))}
					</ul>
					<p className="dialog-note">{describeDiscardEffect(area, files.length)}</p>
					{also !== null && <p className="dialog-note">{also}</p>}
					{unsaved !== null && <p className="dialog-note">{describeUnsavedDiscard(unsaved)}</p>}
				</>
			)}
		</OperationDialog>
	);
}
