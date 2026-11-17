import { useEffect, useState } from "react";
import type { BranchSuggestion, Worktree } from "../../shared/model";
import { type StartRebaseRequest, ontoFromText, rebaseArguments, rebaseBases } from "../../shared/rebase-command";
import { describeTimberCommand } from "../../shared/timber-result";
import { worktreeLabel } from "../format";
import { REBASE_DIRTY_NOTE, REBASE_ONTO_HINT, REBASE_REWRITES, REBASE_RUNS_IN_TERMINAL, describeRebaseStarted, hasLocalChanges } from "../rebase-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { BranchField } from "./BranchField";
import { OperationDialog } from "./OperationDialog";
import { estimateTerminalSize } from "./TerminalPanel";

/** The command the dialog shows for what is typed, worded from the same arguments the main process runs. */
export function rebaseCommandFor(worktreePath: string, ontoText: string): string {
	return describeTimberCommand(rebaseArguments({ worktree: worktreePath, onto: ontoFromText(ontoText) }));
}

export interface RebaseDialogViewProps {
	/** The worktree as the list has it, or null when it left the list. */
	worktree: Worktree | null;
	/** The registered path the dialog was opened for, kept for when the worktree left the list. */
	path: string;
	/** The bases to offer. Undefined while they are read, null when they could not be read. */
	bases: readonly BranchSuggestion[] | null | undefined;
	onto: string;
	onOnto: (onto: string) => void;
	submission: SubmissionState;
	onSubmit: () => void;
	onClose: () => void;
}

/**
 * What the Rebase dialog shows for a given state. It holds no state of its
 * own (see `RebaseDialog` below). It says what will run and where, and never
 * anything about how a rebase went.
 */
export function RebaseDialogView(props: RebaseDialogViewProps) {
	const { worktree, path, bases, onto, onOnto, submission, onSubmit, onClose } = props;
	const label = worktree ? worktreeLabel(worktree) : path;
	return (
		<OperationDialog
			title={worktree ? `Rebase ${label}` : `${label} is no longer in the list`}
			command={rebaseCommandFor(worktree?.path ?? path, onto)}
			submission={submission}
			submitLabel="Rebase in terminal"
			runningLabel="Starting the terminal"
			failureTitle="The rebase did not start"
			canSubmit={worktree !== null}
			cancelLabel={worktree ? "Cancel" : "Close"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{worktree ? (
				<>
					<p className="dialog-note">{REBASE_RUNS_IN_TERMINAL}</p>
					<BranchField label="Onto" value={onto} branches={bases} disabled={submission.running} onChange={onOnto} />
					<p className="dialog-note">{REBASE_ONTO_HINT}</p>
					<p className="dialog-note">{REBASE_REWRITES}</p>
					{hasLocalChanges(worktree) && <p className="dialog-note" role="note">{REBASE_DIRTY_NOTE}</p>}
				</>
			) : (
				<p className="dialog-note">This worktree left the list while the dialog was open, so there is nothing to rebase here. Nothing was run.</p>
			)}
		</OperationDialog>
	);
}

/**
 * The Rebase dialog for one worktree, opened from the workspace header. Its
 * Onto field offers the repository's local and remote branches in the form
 * Timber takes, and takes any typed ref. Submitting starts the command shown
 * in a new Timber session in the worktree and closes the dialog. The
 * session shows what Timber prints, and the store reads the repositories
 * again when it stops, as for any Timber session (../store/store.ts).
 */
export function RebaseDialog({ request }: { request: Extract<DialogRequest, { kind: "rebase-worktree" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const worktree = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	// The path the dialog opened for, so the footer still names it if the worktree leaves the list.
	const [path] = useState(() => worktree?.path ?? "");
	const [onto, setOnto] = useState("");
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
		if (!worktree) return;
		const startRequest: StartRebaseRequest = {
			repository: request.repository,
			worktree: worktree.path,
			onto: ontoFromText(onto),
			...estimateTerminalSize(document.getElementById("workspace-panel")),
		};
		const command = describeTimberCommand(rebaseArguments(startRequest));
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const result = await store.startRebase(startRequest);
			if (result.outcome === "started") return { ok: true, toast: describeRebaseStarted(worktreeLabel(worktree)) };
			return { ok: false, failure: { command, diagnostic: result.message, output: null } };
		});
	};

	return (
		<RebaseDialogView
			worktree={worktree}
			path={path}
			bases={bases}
			onto={onto}
			onOnto={next => {
				setOnto(next);
				submission.clearFailure();
			}}
			submission={submissionState}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
