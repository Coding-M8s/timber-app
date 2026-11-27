import { useEffect, useState } from "react";
import type { LinkedPullRequest } from "../../shared/issue-search";
import type { OpenWorktreeRequest } from "../../shared/model";
import { RESULT_FILE_PLACEHOLDER, describeTimberCommand } from "../../shared/timber-result";
import { openWorktreeArguments } from "../../shared/worktree-commands";
import { CHECK_OUT_LABEL, type CheckOutChoice, checkOutChoice, checkOutRequest, describeCheckedOut, describePullRequest, describeUnlisted, firstOption } from "../check-out-format";
import { issueKeyLabel } from "../issue-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { DialogRequest } from "../store/state";
import type { AppStore } from "../store/store";
import type { SubmissionOutcome, SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";
import { followUps } from "./worktree-modes/agent-choice";
import { type TagChoice, TagField } from "./TagField";
import { reviewTagId } from "../../shared/worktree-tags";

/**
 * Run `timber open --issue <issue> -- <branch>` once for a pull request, and
 * on success show the worktree on its Pull request tab. The store reads the
 * repository again after every outcome and selects the worktree Timber
 * reported (`openWorktree`). When Timber left setup scripts, they run in a
 * session of their own in the worktree, as Existing branch does, without
 * waiting for them; the Pull request tab shows after that session starts,
 * since starting one shows the Workspace tab. A failure stays in the dialog
 * with Timber's reason, and nothing is tried again.
 */
export async function runCheckOut(
	store: Pick<AppStore, "openWorktree" | "startSessionsIn" | "showTab" | "getState">,
	request: OpenWorktreeRequest,
	pullRequest: LinkedPullRequest,
	tag?: string,
): Promise<SubmissionOutcome> {
	const result = await store.openWorktree(request, tag);
	if (result.outcome === "cancelled") return { ok: false, failure: { command: null, diagnostic: "timber open was cancelled before anything was changed.", output: null } };
	// A worktree Timber kept although it failed is already selected in the list (`openWorktree`); the failure stays here.
	if (result.outcome === "failed") return { ok: false, failure: result.failure };
	const toast = describeCheckedOut(pullRequest, result.worktree, result.created);
	// Not in the list, for example because reading it again failed: there is no tab to show, and setup has no pane to start in.
	const repository = store.getState().repositories.find(candidate => candidate.path === request.repository);
	const listed = repository?.worktrees.some(candidate => candidate.id === result.worktree.id || candidate.path === result.worktree.path) ?? false;
	if (!listed) return { ok: true, toast: `${toast} ${describeUnlisted(result.setupSkipped)}` };
	if (result.setupSkipped) store.startSessionsIn(request.repository, result.worktree, { setup: true, agent: null });
	store.showTab("pull-request");
	return { ok: true, toast };
}

export interface CheckOutDialogViewProps {
	repository: string;
	/** The card's key, as the board shows it. */
	keyLabel: string;
	choice: CheckOutChoice;
	picked: number;
	onPick: (index: number) => void;
	submission: SubmissionState;
	/** The Tag field, starting on Review (issue 409). None when left out. */
	tag?: TagChoice;
	onSubmit: () => void;
	onClose: () => void;
}

/** What the dialog shows for one state. It holds no state of its own (see `CheckOutPullRequestDialog`). */
export function CheckOutDialogView({ repository, keyLabel, choice, picked, onPick, submission, tag, onSubmit, onClose }: CheckOutDialogViewProps) {
	const option = choice.options[picked] ?? choice.options[0]!;
	const command = describeTimberCommand(openWorktreeArguments(checkOutRequest(repository, choice, option.pullRequest), RESULT_FILE_PLACEHOLDER));
	const several = choice.options.length > 1;
	return (
		<OperationDialog
			title={`Check out a pull request of ${keyLabel}`}
			command={command}
			submission={submission}
			submitLabel={CHECK_OUT_LABEL}
			runningLabel="Opening the pull request's branch"
			failureTitle="Could not check out the pull request"
			canSubmit={option.refused === null}
			followUps={option.refused === null ? followUps(null, "never", "if-skipped") : []}
			onSubmit={onSubmit}
			onClose={onClose}
		>
			{several ? (
				<fieldset className="review-agents">
					<legend className="field-label">Pull request</legend>
					{choice.options.map((candidate, index) => {
						const { name, notes } = describePullRequest(candidate.pullRequest);
						return (
							<label key={candidate.pullRequest.url} className="review-agent">
								<input type="radio" name="check-out-pull-request" checked={index === picked} onChange={() => onPick(index)} />
								<span className="review-agent-name">{name}</span>
								<span className="review-agent-state">{candidate.refused === null ? notes.join(", ") : ["cannot be opened here", ...notes].join(", ")}</span>
							</label>
						);
					})}
				</fieldset>
			) : (
				<p className="dialog-note check-out-pull-request">
					<span className="review-agent-name">{describePullRequest(option.pullRequest).name}</span>
					{describePullRequest(option.pullRequest).notes.length > 0 && <span className="review-agent-state"> ({describePullRequest(option.pullRequest).notes.join(", ")})</span>}
				</p>
			)}
			{tag && <TagField tags={tag.tags} chosen={tag.chosen} disabled={submission.running} onPick={tag.onPick} />}
			{option.refused !== null
				? <p className="dialog-note" role="status">{option.refused}</p>
				: <p className="dialog-note">Opens the pull request's branch in its own worktree and links it to {keyLabel}, then shows its Pull request tab. Timber never asks anything here: what it cannot decide, it says.</p>}
		</OperationDialog>
	);
}

/**
 * Check out PR, opened from a card on the issues board. The card's issue and
 * its pull requests are kept as the board had them when it opened. Like
 * every dialog, it is shown only while Timber is ready (`Dialogs`).
 */
export function CheckOutPullRequestDialog({ request }: { request: Extract<DialogRequest, { kind: "check-out-pull-request" }> }) {
	const store = useStore();
	const state = useAppState();
	const trackers = state.issueBoards[request.repository]?.trackers;
	const [choice] = useState(() => checkOutChoice(request.issue, trackers?.ok ? trackers.githubRepository : null));
	const [picked, setPicked] = useState(() => (choice === null ? 0 : firstOption(choice)));
	// A pull request checked out here is one to review, so it starts on Review while that tag exists.
	const [tag, setTag] = useState(() => reviewTagId(state.preferences.tags));
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());

	useEffect(() => {
		if (choice === null) store.closeDialog();
	}, [choice, store]);
	if (choice === null) return null;

	const run = () => {
		const option = choice.options[picked];
		if (!option || option.refused !== null) return;
		void submission.submit(() => runCheckOut(store, checkOutRequest(request.repository, choice, option.pullRequest), option.pullRequest, tag));
	};

	return (
		<CheckOutDialogView
			repository={request.repository}
			keyLabel={issueKeyLabel(request.issue.tracker, request.issue.key)}
			choice={choice}
			picked={picked}
			onPick={index => {
				setPicked(index);
				submission.clearFailure();
			}}
			submission={submissionState}
			tag={{ tags: state.preferences.tags, chosen: tag, onPick: setTag }}
			onSubmit={run}
			onClose={() => store.closeDialog()}
		/>
	);
}
