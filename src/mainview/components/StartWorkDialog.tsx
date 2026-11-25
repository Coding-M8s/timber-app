import { useEffect, useState, useSyncExternalStore } from "react";
import type { SuggestedIssue } from "../../shared/issue-search";
import type { Repository } from "../../shared/model";
import { issueKeyLabel } from "../issue-format";
import { CHECK_OUT_THEIRS_LABEL, branchPrefix, describeQuestion, offersCheckOut, startWorkChoice } from "../start-work-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import { type DialogRequest, repositoryPick } from "../store/state";
import type { Submission } from "../store/submission";
import { WorktreeDialogFrame } from "./NewWorktreeDialog";
import { createWorktreeDialogController } from "./worktree-modes/dialog-controller";
import type { WorktreeDialogMode } from "./worktree-modes/mode";
import { reportedLabel } from "./worktree-modes/new-branch-model";
import { type StartWorkModel, type StartWorkState, createStartWorkModel, describeStartWorkStep, startWorkCommand } from "./worktree-modes/start-work-model";
import { WorkflowField, type WorkflowOptions, chosenWorkflow } from "./worktree-modes/workflow-choice";

/**
 * The Start work dialog's one mode drawn from its model
 * (./worktree-modes/start-work-model.ts). A plain function, so every state
 * can be rendered in a test. `onCheckOut` is set when the issue has an open
 * pull request that can be opened here: the question about its assignee
 * then also offers checking it out.
 */
export function startWorkMode(
	model: StartWorkModel,
	state: StartWorkState,
	repository: Repository,
	issue: SuggestedIssue,
	selector: string,
	submission: Pick<Submission, "clearFailure" | "getState">,
	workflows: WorkflowOptions = undefined,
	onCheckOut: (() => void) | null = null,
): WorktreeDialogMode {
	const { fields, step, question } = state;
	const running = submission.getState().running;
	const edit = (change: Partial<StartWorkState["fields"]>) => {
		model.edit(change);
		submission.clearFailure();
	};
	// The command and the run take the same workflow, so the footer shows what runs.
	const workflow = chosenWorkflow(workflows, fields.workflow);
	const label = issueKeyLabel(issue.tracker, issue.key);
	const asked = describeQuestion(question, issue.tracker, issue.key);
	const prefix = branchPrefix(issue.tracker, issue.key);
	return {
		label: "Start work",
		command: startWorkCommand(repository.path, selector, state, workflow),
		canSubmit: true,
		...describeStartWorkStep(state),
		// `timber new` creates the worktree when it works, and "Run setup" finishes one this mode created.
		agentStart: "always",
		setupStart: step.kind === "form" ? "if-skipped" : "never",
		worktree: step.kind === "form" ? null : step.worktree.path,
		workflow: step.kind === "form" ? workflow : step.workflow,
		run: () => model.run(workflow),
		fields: step.kind === "form"
			? (
				<>
					<div className="start-work-issue">
						<span className="issue-card-key">{label}</span>
						<span className="start-work-title">{issue.title}</span>
						<span className="field-hint">{issue.assignee === null ? "Unassigned" : `Assigned to ${issue.assignee}`} · {issue.status.name}</span>
					</div>
					{asked.length > 0 && (
						<div className="start-work-question" role="status">
							{asked.map(line => <p key={line} className="dialog-note">{line}</p>)}
							{question.replace !== null && onCheckOut !== null && (
								<button type="button" className="button quiet" disabled={running} onClick={onCheckOut}>{CHECK_OUT_THEIRS_LABEL}</button>
							)}
						</div>
					)}
					<label className="field">
						<span className="field-label">Branch</span>
						<input
							className="field-input"
							name="branch"
							value={fields.branch}
							placeholder={`Timber's name for ${label}`}
							autoComplete="off"
							spellCheck={false}
							autoFocus
							disabled={running}
							onChange={event => edit({ branch: event.target.value })}
						/>
						<span className="field-hint">Optional. Timber names the branch from the issue's title. A name typed here must start with {prefix}, and the worktree stays linked to {label}.</span>
					</label>
					<label className="field">
						<span className="field-label">Start from</span>
						<input
							className="field-input"
							name="base"
							value={fields.base}
							placeholder="Timber's configured base"
							autoComplete="off"
							spellCheck={false}
							disabled={running}
							onChange={event => edit({ base: event.target.value })}
						/>
						<span className="field-hint">Optional. A branch to start from instead.</span>
					</label>
					<WorkflowField options={workflows} chosen={workflow} disabled={running} onPick={pick => edit({ workflow: pick })} />
				</>
			)
			: (
				<div className="dialog-outcome">
					<p className="dialog-outcome-text">
						{reportedLabel(step.worktree)} was created, linked to {label}, and is in the list, but Timber stopped before its setup
						{step.assigned ? "." : `, so ${label} was not assigned to you.`}
					</p>
					<p className="dialog-outcome-text path">{step.worktree.path}</p>
					<p className="dialog-outcome-text">
						Run setup runs every setup script in that worktree
						{step.workflow === null ? "" : `, with the ${step.workflow} workflow`}, in a terminal of its own, and closes this dialog. Nothing is created again.
					</p>
				</div>
			),
	};
}

/**
 * Start work, opened from a card on the issues board: `timber new` for the
 * card's issue, kept as the board had it when the dialog opened. The frame,
 * the Agent field, setup, and the agent that starts afterwards are the New
 * worktree dialog's. Like every dialog, it is shown only while Timber is
 * ready (`Dialogs`).
 */
export function StartWorkDialog({ request, repository }: { request: Extract<DialogRequest, { kind: "start-work" }>; repository: Repository }) {
	const store = useStore();
	const state = useAppState();
	const trackers = state.issueBoards[request.repository]?.trackers;
	const githubRepository = trackers?.ok ? trackers.githubRepository : null;
	const [choice] = useState(() => startWorkChoice(request.issue, githubRepository));
	const selector = choice?.ok ? choice.selector : null;
	const { submission, state: submissionState } = useSubmission(() => store.closeDialog());
	const [controller] = useState(() => createWorktreeDialogController(store, repository.path, submission));
	const [model] = useState(() => createStartWorkModel(store, repository.path, request.issue, selector ?? ""));
	const { workflows } = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
	const modelState = useSyncExternalStore(model.subscribe, model.getState, model.getState);
	useEffect(() => {
		if (selector === null) store.closeDialog();
		else {
			void controller.readWorkflows();
			void controller.locateAgents();
		}
	}, [controller, selector, store]);
	if (selector === null) return null;

	const onCheckOut = offersCheckOut(request.issue, githubRepository)
		? () => store.openDialog({ kind: "check-out-pull-request", repository: request.repository, issue: request.issue })
		: null;
	const mode = startWorkMode(model, modelState, repository, request.issue, selector, submission, workflows, onCheckOut);
	return (
		<WorktreeDialogFrame
			title={`Start work on ${issueKeyLabel(request.issue.tracker, request.issue.key)} in ${repository.name}`}
			repository={repository}
			modes={[mode]}
			selected={0}
			submission={submissionState}
			agents={state.preferences.agents}
			agentLocations={state.agentLocations}
			plan={controller.plan}
			repositoryAgent={repositoryPick(state, repository.path)}
			onSelect={controller.select}
			onPickAgent={controller.pickAgent}
			onSubmit={chosen => void controller.submit(chosen)}
			onClose={() => store.closeDialog()}
		/>
	);
}
