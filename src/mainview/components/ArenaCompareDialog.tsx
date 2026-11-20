import { useCallback, useEffect, useRef, useState } from "react";
import { type ArenaInspection, type InspectedAttempt, type PickedAttempt, arenaInspectCommand } from "../../shared/arenas";
import type { TimberFailure, Worktree } from "../../shared/model";
import type { TerminalSession } from "../../shared/terminal";
import {
	ARENA_BETA_NOTE, BETA, PICK_NOTE, describeAttemptSession, describeAttemptState, describeAttemptTool, describeComparison, describePickOutcome, describePicked, pickCommandFor,
} from "../arena-format";
import { useAppState, useStore } from "../store/react";
import { sessionsOf } from "../store/state";
import { OperationDialog } from "./OperationDialog";

/** One attempt's row: what Timber compared, and what the app knows of it. */
export interface CompareRow {
	attempt: InspectedAttempt;
	/** The listed worktree at the attempt's path, or null when it is gone. */
	worktree: Worktree | null;
	sessions: readonly TerminalSession[];
	/** What the last pick did to it, or null. */
	outcome: PickedAttempt | null;
}

export interface ArenaCompareViewProps {
	arena: string;
	inspection: ArenaInspection | null;
	rows: readonly CompareRow[];
	/** The attempt the person chose to keep, so the dialog asks to confirm the pick. */
	choosing: string | null;
	/** The app's sessions in the other attempts than the one chosen, by name, which the pick ends first. */
	ending: readonly string[];
	/** The app's sessions in the chosen attempt, by name, which keep running. */
	keeping: readonly string[];
	submission: { running: boolean; failure: TimberFailure | null };
	onChoose: (label: string | null) => void;
	onCompare: () => void;
	onPick: () => void;
	onOpenChanges: (worktree: Worktree) => void;
	onStartAgent: (row: CompareRow) => void;
	onClose: () => void;
}

/** What the Compare dialog shows for a given state. It holds no state of its own. */
export function ArenaCompareView(props: ArenaCompareViewProps) {
	const { arena, inspection, rows, choosing, ending, keeping, submission, onChoose, onCompare, onPick, onOpenChanges, onStartAgent, onClose } = props;
	const confirming = choosing !== null;
	const others = rows.filter(row => row.attempt.label !== choosing && !row.attempt.removed).map(row => row.attempt.label);
	return (
		<OperationDialog
			title={confirming ? `Keep ${choosing} of arena ${arena}? (${BETA})` : `Compare attempts of arena ${arena} (${BETA})`}
			command={confirming ? pickCommandFor(arena, choosing) : arenaInspectCommand(arena)}
			submission={submission}
			submitLabel={confirming ? `Keep ${choosing}` : "Compare again"}
			runningLabel={confirming ? `Ending the other attempts' sessions, then keeping ${choosing}` : "Comparing the attempts"}
			failureTitle={confirming ? "Timber did not finish the pick" : "Could not compare the attempts"}
			destructive={confirming}
			cancelLabel="Close"
			onSubmit={confirming ? onPick : onCompare}
			onClose={onClose}
		>
			<p className="dialog-note">{ARENA_BETA_NOTE}</p>
			{inspection?.state === "inspected" && inspection.base && (
				<p className="dialog-note">{`Counted against the arena's base, ${inspection.base.ref} @ ${inspection.base.commit.slice(0, 7)}. Untracked files are counted on their own.`}</p>
			)}
			{inspection?.state === "unsupported" && <p className="dialog-note">The Timber found cannot compare arena attempts. Install a newer Timber.</p>}
			{inspection?.state === "failed" && <p className="field-hint error" role="alert">{inspection.message}</p>}
			{rows.length > 0 && (
				<table className="arena-compare">
					<thead>
						<tr>
							<th scope="col">Attempt</th>
							<th scope="col">Agent</th>
							<th scope="col">Commits</th>
							<th scope="col">Committed</th>
							<th scope="col">Uncommitted</th>
							<th scope="col">Untracked</th>
							<th scope="col"><span className="visually-hidden">Actions</span></th>
						</tr>
					</thead>
					<tbody>
						{rows.map(row => {
							const { attempt, worktree, outcome } = row;
							const session = describeAttemptSession(row.sessions);
							const counts = attempt.comparison ? describeComparison(attempt.comparison) : null;
							const usable = worktree !== null && !attempt.removed;
							return (
								<tr key={attempt.label} className={attempt.label === choosing ? "chosen" : undefined}>
									<th scope="row">
										<span className="arena-attempt-label">{attempt.label}</span>
										<span className="arena-attempt-tool">{describeAttemptTool(attempt)}</span>
										{outcome && <span className={outcome.outcome === "kept" || outcome.outcome === "partly-removed" ? "arena-outcome failing" : "arena-outcome"}>{describePickOutcome(outcome)}</span>}
									</th>
									<td>
										<span>{session.text}</span>
										<span className="arena-attempt-tool">{describeAttemptState(attempt.state)}</span>
									</td>
									{counts ? (
										<>
											<td>{counts.commits}</td>
											<td>{counts.committed}</td>
											<td>{counts.uncommitted}</td>
											<td>{counts.untracked}</td>
										</>
									) : (
										<td colSpan={4}>{attempt.removed ? "Removed" : attempt.reason ?? "Not compared"}</td>
									)}
									<td className="arena-actions">
										{usable && <button type="button" className="text-button" onClick={() => onOpenChanges(worktree)}>Open in Changes</button>}
										{usable && attempt.tool !== "manual" && !session.running && (
											<button type="button" className="text-button" onClick={() => onStartAgent(row)}>Start agent</button>
										)}
										{usable && !confirming && inspection?.state === "inspected" && inspection.winner === null && (
											<button type="button" className="text-button" onClick={() => onChoose(attempt.label)}>Keep this one</button>
										)}
									</td>
								</tr>
							);
						})}
					</tbody>
				</table>
			)}
			{confirming && (
				<div className="arena-confirm">
					<p className="dialog-note">{PICK_NOTE}</p>
					<p className="dialog-note">{others.length > 0 ? `Removed: ${others.join(", ")}.` : "No other attempt is left to remove."}</p>
					<p className="dialog-note">{ending.length > 0 ? `Ends these sessions first: ${ending.join(", ")}.` : "No session of the app is open in the other attempts."}</p>
					{keeping.length > 0 && <p className="dialog-note">{`Keeps open: ${keeping.join(", ")}.`}</p>}
					<button type="button" className="text-button" disabled={submission.running} onClick={() => onChoose(null)}>Back to the comparison</button>
				</div>
			)}
		</OperationDialog>
	);
}

/** The Compare dialog of one arena, from its header in the sidebar. */
export function ArenaCompareDialog({ request }: { request: { repository: string; arena: string } }) {
	const store = useStore();
	const state = useAppState();
	const { repository, arena } = request;
	const [inspection, setInspection] = useState<ArenaInspection | null>(null);
	const [choosing, setChoosing] = useState<string | null>(null);
	const [outcomes, setOutcomes] = useState<readonly PickedAttempt[]>([]);
	const [submission, setSubmission] = useState<{ running: boolean; failure: TimberFailure | null }>({ running: false, failure: null });
	const asking = useRef(0);

	const compare = useCallback(async () => {
		const ticket = ++asking.current;
		setSubmission(current => ({ ...current, running: true }));
		const answer = await store.inspectArena({ repository, arena });
		if (ticket !== asking.current) return;
		setInspection(answer);
		setSubmission(current => ({ ...current, running: false }));
	}, [store, repository, arena]);

	useEffect(() => {
		void compare();
	}, [compare]);

	const listed = state.repositories.find(candidate => candidate.path === repository)?.worktrees ?? [];
	const attempts = inspection?.state === "inspected" ? inspection.attempts : [];
	const rows: CompareRow[] = attempts.map(attempt => {
		const worktree = listed.find(candidate => candidate.path === attempt.path) ?? null;
		return { attempt, worktree, sessions: worktree ? sessionsOf(state, worktree.id) : [], outcome: outcomes.find(outcome => outcome.label === attempt.label) ?? null };
	});
	// As the main process does: every session in the other attempts ends, and the chosen one's stay.
	const chosenPath = attempts.find(attempt => attempt.label === choosing)?.path;
	const otherPaths = attempts.filter(attempt => attempt.label !== choosing).map(attempt => attempt.path);
	const inRepository = state.terminals.filter(session => session.repository === repository);
	const ending = choosing === null ? [] : inRepository.filter(session => otherPaths.includes(session.path)).map(session => session.name);
	const keeping = inRepository.filter(session => session.path === chosenPath).map(session => session.name);

	const choose = (label: string | null) => {
		setSubmission({ running: false, failure: null });
		setChoosing(label);
		// The comparison is read again before the person confirms, so they keep what is there now.
		if (label !== null) void compare();
	};
	const pick = async () => {
		if (choosing === null || submission.running) return;
		const winner = choosing;
		setSubmission({ running: true, failure: null });
		const result = await store.pickArena({ repository, arena, winner });
		setChoosing(null);
		if (result.outcome === "picked") {
			setOutcomes(result.pick.attempts);
			setSubmission({ running: false, failure: null });
			store.showToast(describePicked(winner));
		} else {
			setOutcomes(result.pick?.attempts ?? []);
			setSubmission({ running: false, failure: result.failure });
		}
		void compare();
	};

	return (
		<ArenaCompareView
			arena={arena}
			inspection={inspection}
			rows={rows}
			choosing={choosing}
			ending={ending}
			keeping={keeping}
			submission={submission}
			onChoose={choose}
			onCompare={() => void compare()}
			onPick={() => void pick()}
			onOpenChanges={worktree => {
				store.closeDialog();
				store.select(worktree.id);
				store.showTab("changes");
			}}
			onStartAgent={row => {
				if (row.worktree === null) return;
				store.closeDialog();
				store.startAttemptAgent({ repository, worktree: row.worktree.path, arena, attempt: row.attempt.label });
			}}
			onClose={() => store.closeDialog()}
		/>
	);
}
