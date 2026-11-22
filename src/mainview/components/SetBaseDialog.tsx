import { useEffect, useState } from "react";
import type { BranchSuggestion, Worktree } from "../../shared/model";
import { initialOnto, rebaseBases } from "../../shared/rebase-command";
import { baseFromText, setBaseResultArguments } from "../../shared/timber-base";
import { BASE_PLACEHOLDER, RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../shared/timber-result";
import {
	type BaseFailureKind, BASE_CHANGES_ONLY_METADATA, BASE_FAILED_NOTE, BASE_FAILED_TITLE, BASE_FIELD_HINT, BASE_NOT_RUN_TITLE, BASE_REFUSED_NOTE, BASE_REFUSED_TITLE,
	describeBaseDialogTitle, presentSetBase,
} from "../base-change-format";
import { describeInvalidBase } from "../base-format";
import { worktreeLabel } from "../format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { BranchField } from "./BranchField";
import { OperationDialog } from "./OperationDialog";

/**
 * The command the dialog shows, worded from the same arguments the main
 * process runs. While nothing is typed, the base is a placeholder.
 */
export function setBaseCommandFor(worktreePath: string, baseText: string): string {
	return describeTimberCommand(setBaseResultArguments({ worktree: worktreePath, base: baseFromText(baseText) ?? BASE_PLACEHOLDER }, RESULT_FILE_PLACEHOLDER));
}

export interface SetBaseDialogViewProps {
	/** How the latest run ended when it left the dialog open, for the words above its failure. */
	failureKind?: BaseFailureKind | null;
	/** The worktree as the list has it, or null when it left the list. */
	worktree: Worktree | null;
	/** The registered path the dialog was opened for, kept for when the worktree left the list. */
	path: string;
	/** The bases to offer. Undefined while they are read, null when they could not be read. */
	bases: readonly BranchSuggestion[] | null | undefined;
	base: string;
	onBase: (base: string) => void;
	submission: SubmissionState;
	onSubmit: () => void;
	onClose: () => void;
}

/** What the Set base dialog shows for a given state. It holds no state of its own (see `SetBaseDialog` below). */
export function SetBaseDialogView(props: SetBaseDialogViewProps) {
	const { failureKind = null, worktree, path, bases, base, onBase, submission, onSubmit, onClose } = props;
	const label = worktree ? worktreeLabel(worktree) : path;
	const saved = worktree?.base ?? null;
	const refused = failureKind === "refused";
	return (
		<OperationDialog
			title={worktree ? describeBaseDialogTitle(label, saved) : `${label} is no longer in the list`}
			command={setBaseCommandFor(worktree?.path ?? path, base)}
			submission={submission}
			submitLabel="Save base"
			runningLabel="Saving the base"
			failureTitle={refused ? BASE_REFUSED_TITLE : failureKind === "not-run" ? BASE_NOT_RUN_TITLE : BASE_FAILED_TITLE}
			failureNote={failureKind !== null && failureKind !== "not-run"
				? <p className="dialog-note">{refused ? BASE_REFUSED_NOTE : BASE_FAILED_NOTE}</p>
				: undefined}
			canSubmit={worktree !== null && baseFromText(base) !== null}
			cancelLabel={worktree ? "Cancel" : "Close"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{worktree ? (
				<>
					<p className="dialog-note">{BASE_CHANGES_ONLY_METADATA}</p>
					{saved?.kind === "invalid" && (
						<p className="dialog-note saved-base-warning" role="note">{describeInvalidBase(saved.reason)} Timber decides whether a base given here can replace it.</p>
					)}
					<BranchField label="Base" value={base} branches={bases} disabled={submission.running} onChange={onBase} />
					<p className="dialog-note">{BASE_FIELD_HINT}</p>
				</>
			) : (
				<p className="dialog-note">This worktree left the list while the dialog was open, so there is no base to save here. Nothing was run.</p>
			)}
		</OperationDialog>
	);
}

/**
 * The Set base dialog for one worktree, opened from the Changes view. Its Base
 * field starts as the base Timber saved, in the form Timber takes, offers the
 * repository's local and remote branches in that form, and takes any typed
 * ref. Submitting runs the command shown. A saved base closes the dialog with
 * a toast; a refusal or a failure stays in it with Timber's reason and what
 * was typed. The repository is read again after every outcome, and a saved
 * base moves the tab to Base (`setWorktreeBase` in ../store/store.ts).
 */
export function SetBaseDialog({ request }: { request: Extract<DialogRequest, { kind: "set-base" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const worktree = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	// The path the dialog opened for, so the footer still names it if the worktree leaves the list.
	const [path] = useState(() => worktree?.path ?? "");
	// Starts from the base Timber saved, as the list had it when the dialog opened. What is typed after that stays.
	const [base, setBase] = useState(() => initialOnto(worktree?.base ?? null));
	const [failureKind, setFailureKind] = useState<BaseFailureKind | null>(null);
	const [bases, setBases] = useState<BranchSuggestion[] | null | undefined>(undefined);
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());

	useEffect(() => {
		// A dialog for a worktree that was never in the list has nothing to show.
		if (!worktree && path === "") store.closeDialog();
	}, [worktree, path, store]);

	// Read when the dialog opens, and again whenever the repository was read again.
	useEffect(() => {
		let gone = false;
		void store.listBranches(request.repository).then(branches => {
			if (!gone) setBases(branches && rebaseBases(branches));
		});
		return () => {
			gone = true;
		};
	}, [store, request.repository, repository]);

	if (!worktree && path === "") return null;

	const run = () => {
		const typed = baseFromText(base);
		if (!worktree || typed === null) return;
		const setRequest = { repository: request.repository, worktree: worktree.path, base: typed };
		const label = worktreeLabel(worktree);
		setFailureKind(null);
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const shown = presentSetBase(label, await store.setWorktreeBase(setRequest));
			setFailureKind(shown.failureKind);
			return shown.outcome;
		});
	};

	return (
		<SetBaseDialogView
			failureKind={failureKind}
			worktree={worktree}
			path={path}
			bases={bases}
			base={base}
			onBase={next => {
				setBase(next);
				submission.clearFailure();
			}}
			submission={submissionState}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
