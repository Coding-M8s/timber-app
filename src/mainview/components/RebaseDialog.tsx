import { useEffect, useRef, useState } from "react";
import type { BranchSuggestion, Worktree } from "../../shared/model";
import { type StartRebaseRequest, initialOnto, ontoFromText, rebaseArguments, rebaseBases } from "../../shared/rebase-command";
import { rebaseResultArguments } from "../../shared/timber-rebase";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../shared/timber-result";
import { supportsRebaseResult } from "../../shared/timber-version";
import { describeRebaseBase } from "../base-format";
import { worktreeLabel } from "../format";
import {
	type RebaseConflicts, type RebaseFailureKind, REBASE_DIRTY_NOTE, REBASE_FAILED_NOTE, REBASE_FAILED_TITLE, REBASE_NOT_RUN_TITLE, REBASE_ONTO_HINT, REBASE_REFUSED_NOTE, REBASE_REFUSED_TITLE, REBASE_REPORTS_RESULT,
	REBASE_REWRITES, REBASE_RUNS_IN_TERMINAL, REBASE_UNSUPPORTED_TITLE, describeConflictsAdvice, describeConflictsTitle, describeRebaseStarted,
	hasLocalChanges, presentRebase,
} from "../rebase-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { BranchField } from "./BranchField";
import { OperationDialog } from "./OperationDialog";
import { TimberFailureDetails } from "./TimberFailureDetails";
import { estimateTerminalSize } from "./TerminalPanel";

/** The command the dialog shows for what is typed, worded from the same arguments the main process runs. */
export function rebaseCommandFor(worktreePath: string, ontoText: string): string {
	return describeTimberCommand(rebaseArguments({ worktree: worktreePath, onto: ontoFromText(ontoText) }));
}

/**
 * The command the dialog shows when Timber reports through a result file,
 * worded from the same arguments the main process runs.
 */
export function rebaseResultCommandFor(worktreePath: string, ontoText: string): string {
	return describeTimberCommand(rebaseResultArguments({ worktree: worktreePath, onto: ontoFromText(ontoText) }, RESULT_FILE_PLACEHOLDER));
}

export interface RebaseDialogViewProps {
	/**
	 * Whether Timber reports through a result file: the Timber found is ready
	 * and new enough. False runs the interim rebase in a terminal session.
	 */
	structured: boolean;
	/** How the latest rebase ended when it left the dialog open, for the words above its failure. */
	failureKind?: RebaseFailureKind | null;
	/** Set once the rebase stopped on conflicts: the dialog then lists the files and offers a terminal. */
	conflicts?: RebaseConflicts | null;
	/**
	 * The worktree's name when the rebase was submitted. A paused rebase
	 * detaches HEAD, so the list read afterwards names it by its commit.
	 */
	conflictsLabel?: string | null;
	/** Starts a terminal session in the worktree and closes the dialog. Used by the conflicts view. */
	onOpenTerminal?: () => void;
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
	const { structured, failureKind = null, conflicts = null, conflictsLabel = null, onOpenTerminal, worktree, path, bases, onto, onOnto, submission, onSubmit, onClose } = props;
	const label = worktree ? worktreeLabel(worktree) : path;
	const savedBase = worktree ? describeRebaseBase(worktree.base) : null;
	if (structured && conflicts) return <RebaseConflictsView label={conflictsLabel ?? label} conflicts={conflicts} onOpenTerminal={onOpenTerminal} onClose={onClose} />;
	const target = worktree?.path ?? path;
	const refused = structured && failureKind === "refused";
	return (
		<OperationDialog
			title={worktree ? `Rebase ${label}` : `${label} is no longer in the list`}
			command={structured ? rebaseResultCommandFor(target, onto) : rebaseCommandFor(target, onto)}
			submission={submission}
			submitLabel={structured ? "Rebase" : "Rebase in terminal"}
			runningLabel={structured ? "Rebasing" : "Starting the terminal"}
			failureTitle={!structured ? "The rebase did not start" : refused ? REBASE_REFUSED_TITLE : failureKind === "unsupported" ? REBASE_UNSUPPORTED_TITLE : failureKind === "not-run" ? REBASE_NOT_RUN_TITLE : REBASE_FAILED_TITLE}
			failureNote={structured && failureKind !== null && failureKind !== "unsupported" && failureKind !== "not-run"
				? <p className="dialog-note">{refused ? REBASE_REFUSED_NOTE : REBASE_FAILED_NOTE}</p>
				: undefined}
			canSubmit={worktree !== null}
			cancelLabel={worktree ? "Cancel" : "Close"}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{worktree ? (
				<>
					<p className="dialog-note">{structured ? REBASE_REPORTS_RESULT : REBASE_RUNS_IN_TERMINAL}</p>
					{savedBase && <p className={savedBase.warning ? "dialog-note saved-base-warning" : "dialog-note"} role={savedBase.warning ? "note" : undefined}>{savedBase.text}</p>}
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

interface RebaseConflictsViewProps {
	label: string;
	conflicts: RebaseConflicts;
	onOpenTerminal: (() => void) | undefined;
	onClose: () => void;
}

/**
 * What the dialog shows once Git paused the rebase on conflicts: every
 * conflicted path, what Timber printed, and a button that opens a terminal in
 * the worktree to resolve them. The rebase is left exactly as Git left it.
 */
function RebaseConflictsView({ label, conflicts, onOpenTerminal, onClose }: RebaseConflictsViewProps) {
	const dialog = useRef<HTMLDialogElement>(null);
	useEffect(() => {
		const element = dialog.current;
		if (element && !element.open) element.showModal();
		return () => element?.close();
	}, []);
	return (
		<dialog
			ref={dialog}
			className="dialog"
			aria-label={describeConflictsTitle(label)}
			onCancel={event => {
				event.preventDefault();
				onClose();
			}}
		>
			<div className="dialog-form">
				<header className="dialog-head">
					<h2 className="dialog-title">{describeConflictsTitle(label)}</h2>
				</header>
				<p className="dialog-note rebase-advice">
					{describeConflictsAdvice(conflicts.base)} To finish, resolve the files below and stage them, then run <code>git rebase --continue</code> in
					this worktree, or run <code>git rebase --abort</code> to go back.
				</p>
				<ul className="rebase-conflicts" aria-label="Conflicted files">
					{conflicts.conflicts.map(file => <li key={file}>{file}</li>)}
				</ul>
				<TimberFailureDetails title="Timber stopped the rebase" failure={conflicts.failure} />
				<footer className="dialog-foot">
					<div className="dialog-buttons">
						<button type="button" className="button quiet" onClick={onClose}>Close</button>
						<button type="button" className="button primary" onClick={onOpenTerminal}>Open a terminal here</button>
					</div>
				</footer>
			</div>
		</dialog>
	);
}

/**
 * The Rebase dialog for one worktree, opened from the workspace header. Its
 * Onto field starts as the base Timber saved for the worktree, offers the
 * repository's local and remote branches in the form Timber takes, and takes
 * any typed ref.
 *
 * With a Timber that writes a result file for rebase, submitting runs the
 * command shown and the dialog says how it ended. A rebase or an up to date
 * branch closes it with a toast. A refusal or a failure stays in it with
 * Timber's reason. Conflicts switch it to the list of files, with an offer to
 * open a terminal in the worktree. The repositories are read again after
 * every outcome (`rebaseWorktree` in ../store/store.ts).
 *
 * With an older Timber, submitting starts the interim command in a new Timber
 * session in the worktree and closes the dialog. The session shows what
 * Timber prints, and the store reads the repositories again when it stops, as
 * for any Timber session.
 */
export function RebaseDialog({ request }: { request: Extract<DialogRequest, { kind: "rebase-worktree" }> }) {
	const store = useStore();
	const state = useAppState();
	const repository = state.repositories.find(candidate => candidate.path === request.repository);
	const worktree = repository?.worktrees.find(candidate => candidate.id === request.worktree) ?? null;
	// The path the dialog opened for, so the footer still names it if the worktree leaves the list.
	const [path] = useState(() => worktree?.path ?? "");
	// Starts from the base Timber saved, as the list had it when the dialog opened. What is typed after that stays.
	const [onto, setOnto] = useState(() => initialOnto(worktree?.base ?? null));
	const structured = state.timber?.known === true && state.timber.status.state === "ready" && supportsRebaseResult(state.timber.status.version);
	const [failureKind, setFailureKind] = useState<RebaseFailureKind | null>(null);
	const [conflicts, setConflicts] = useState<RebaseConflicts | null>(null);
	const [conflictsLabel, setConflictsLabel] = useState<string | null>(null);
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

	const runStructured = () => {
		if (!worktree) return;
		const rebaseRequest = { repository: request.repository, worktree: worktree.path, onto: ontoFromText(onto) };
		const label = worktreeLabel(worktree);
		setFailureKind(null);
		const command = rebaseResultCommandFor(rebaseRequest.worktree, onto);
		void submission.submit(async (): Promise<SubmissionOutcome> => {
			const shown = presentRebase(label, await store.rebaseWorktree(rebaseRequest), command);
			setFailureKind(shown.failureKind);
			setConflicts(shown.conflicts);
			setConflictsLabel(shown.conflicts ? label : null);
			return shown.outcome;
		});
	};

	const runInterim = () => {
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
			structured={structured}
			failureKind={failureKind}
			conflicts={conflicts}
			conflictsLabel={conflictsLabel}
			onOpenTerminal={() => {
				const worktreePath = worktree?.path ?? path;
				store.closeDialog();
				// Closing the dialog hands the focus back to the Rebase control, where a typed space would open it again.
				// Let it go first, so the new terminal takes the keyboard when it shows, as a session started from "+" does.
				setTimeout(() => {
					if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
					store.openTerminalIn(request.repository, worktreePath);
				}, 0);
			}}
			worktree={worktree}
			path={path}
			bases={bases}
			onto={onto}
			onOnto={next => {
				setOnto(next);
				submission.clearFailure();
			}}
			submission={submissionState}
			onSubmit={structured ? runStructured : runInterim}
			onClose={() => store.closeDialog()}
		/>
	);
}
