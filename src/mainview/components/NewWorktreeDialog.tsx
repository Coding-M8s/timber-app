import { Fragment, useEffect, useState, useSyncExternalStore } from "react";
import type { AgentSetting } from "../../shared/agent";
import type { Repository } from "../../shared/model";
import { arenasUnavailable } from "../arena-format";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { NewWorktreeMode } from "../store/state";
import type { SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { useArenaMode } from "./worktree-modes/arena";
import type { AgentLocation } from "../../shared/agent-lookup";
import { type AgentPlan, agentOptionLabel, agentPickHint, followUps, startingAgent } from "./worktree-modes/agent-choice";
import { createWorktreeDialogController, pickOfOption } from "./worktree-modes/dialog-controller";
import { useExistingBranchMode } from "./worktree-modes/existing-branch";
import type { WorktreeDialogMode } from "./worktree-modes/mode";
import { useNewBranchMode } from "./worktree-modes/new-branch";

interface AgentFieldProps {
	/** The agents saved in Settings, Agents, in menu order. */
	agents: readonly AgentSetting[];
	/** Whether each agent's executable was found, as last looked for, or null before the first look. */
	locations: readonly AgentLocation[] | null;
	/** Where the agent that will start comes from: the pick, or the workflow, which locks the field. */
	plan: AgentPlan;
	onPick: (pick: string | null) => void;
}

/**
 * The Agent field, shared by every mode: each saved agent, marked when its
 * executable was not found or cannot start, then None. When
 * the picked workflow decides the agent, the field shows what it decided,
 * locked, and says why.
 */
export function AgentField({ agents, locations, plan, onPick }: AgentFieldProps) {
	if (plan.source === "workflow") {
		const { workflow } = plan;
		const [option, hint] = plan.kind === "command"
			? [plan.command, `Set by the ${workflow} workflow, so it cannot be changed here. It starts in place of the app's agents, once this dialog has created the worktree.`]
			: ["None (set by the workflow)", `The ${workflow} workflow turns the agent off, so none starts. It cannot be changed here.`];
		return (
			<label className="field">
				<span className="field-label">Agent</span>
				<select className="field-input" name="agent" value="" disabled onChange={() => {}}>
					<option value="">{option}</option>
				</select>
				<span className="field-hint">{hint}</span>
			</label>
		);
	}
	const chosen = plan.agent;
	return (
		<label className="field">
			<span className="field-label">Agent</span>
			<select className="field-input" name="agent" value={chosen?.name ?? ""} onChange={event => onPick(pickOfOption(event.target.value))}>
				{agents.map(agent => <option key={agent.name} value={agent.name}>{agentOptionLabel(agent, locations)}</option>)}
				<option value="">None</option>
			</select>
			<span className="field-hint">{agentPickHint(agents, locations, plan)}</span>
		</label>
	);
}

interface WorktreeDialogFrameProps {
	repository: Repository;
	/** The dialog's title. "New worktree in <repository>" unless given. */
	title?: string;
	modes: readonly WorktreeDialogMode[];
	/** The position of the mode on screen in `modes`. */
	selected: number;
	submission: SubmissionState;
	/** The agents saved in Settings, Agents. */
	agents: readonly AgentSetting[];
	/** Whether each agent's executable was found (`AppState.agentLocations`). */
	agentLocations: readonly AgentLocation[] | null;
	/** Where the agent that will start after a worktree is created comes from, for a run with the given workflow. */
	plan: (workflow: string | null) => AgentPlan;
	onSelect: (index: number) => void;
	onPickAgent: (pick: string | null) => void;
	/** Run the mode on screen. */
	onSubmit: (mode: WorktreeDialogMode) => void;
	onClose: () => void;
}

/**
 * The worktree dialog as a drawing of its modes: one `OperationDialog` for
 * whichever mode is selected, with the Agent field under the mode's own
 * fields, unless the mode starts its own agents. The switch shows only when
 * there is a choice. It keeps one height, and its submit button one width,
 * across modes and steps, so the buttons never move.
 */
export function WorktreeDialogFrame(props: WorktreeDialogFrameProps) {
	const { repository, modes, selected, submission, agents, agentLocations, onSelect, onPickAgent, onSubmit, onClose } = props;
	const mode = modes[selected] ?? modes[0];
	if (!mode) return null;
	const plan = props.plan(mode.workflow);
	return (
		<OperationDialog
			title={props.title ?? `New worktree in ${repository.name}`}
			className="steady worktree-dialog"
			headerAside={modes.length > 1 && (
				<ModeSwitch
					labels={modes.map(candidate => candidate.label)}
					selected={modes.indexOf(mode)}
					disabled={submission.running}
					onSelect={onSelect}
					unavailable={modes.map(candidate => typeof candidate.unavailable === "string")}
					notes={modes.map(candidate => candidate.unavailable)}
				/>
			)}
			command={mode.command}
			followUps={mode.ownFollowUps ?? followUps(startingAgent(plan), mode.agentStart, mode.setupStart, mode.worktree, mode.workflow)}
			failureNote={mode.failureNote}
			submission={submission}
			submitLabel={mode.submitLabel}
			reserveLabels={modes.flatMap(candidate => candidate.submitLabels)}
			runningLabel={mode.runningLabel}
			failureTitle={mode.failureTitle}
			canSubmit={mode.canSubmit}
			onSubmit={() => onSubmit(mode)}
			onClose={onClose}
		>
			{/* Keyed by mode, so a switch mounts the new mode's fields and its first field's autoFocus takes the keyboard. */}
			<Fragment key={mode.label}>{mode.fields}</Fragment>
			{!mode.ownFollowUps && <AgentField agents={agents} locations={agentLocations} plan={plan} onPick={onPickAgent} />}
		</OperationDialog>
	);
}

/** The position of each mode on the switch. */
const MODE_INDEX: Record<NewWorktreeMode, number> = { new: 0, existing: 1, arena: 2 };

/**
 * The mode the dialog opens on: the one asked for, or New branch when that is
 * Arena and the Timber found has no arenas for apps.
 */
export function openingMode(asked: NewWorktreeMode, arenas: string | null): number {
	return asked === "arena" && arenas !== null ? MODE_INDEX.new : MODE_INDEX[asked];
}

/**
 * The dialog behind the "+" of a repository. Its controller
 * (./worktree-modes/dialog-controller.ts) owns which mode is selected and the
 * agent to start, which all modes share, and runs the one submission. Each
 * mode brings its fields, its command, and what running it means. Add a mode
 * by adding its hook to `modes`.
 */
export function NewWorktreeDialog({ repository, initialMode = "new" }: { repository: Repository; initialMode?: NewWorktreeMode }) {
	const store = useStore();
	const { submission, state } = useSubmission(() => store.closeDialog());
	const [controller] = useState(() =>
		createWorktreeDialogController(store, repository.path, submission, openingMode(initialMode, arenasUnavailable(store.getState().arenas[repository.path]))));
	const { selected, workflows } = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
	// Read once when the dialog opens: each read runs Timber, and file watching reads the repository again often.
	// The controller reads again after a run fails, when the settings may have changed.
	// The agents are looked for again too, as one may have been installed since the app started. Nothing runs.
	useEffect(() => {
		void controller.readWorkflows();
		void controller.locateAgents();
	}, [controller]);
	const modes = [
		useNewBranchMode(repository, submission, workflows),
		useExistingBranchMode(repository, submission, workflows),
		useArenaMode(repository, submission, selected === MODE_INDEX.arena),
	];
	const { preferences: { agents }, agentLocations } = useAppState();
	return (
		<WorktreeDialogFrame
			repository={repository}
			modes={modes}
			selected={selected}
			submission={state}
			agents={agents}
			agentLocations={agentLocations}
			plan={controller.plan}
			onSelect={controller.select}
			onPickAgent={controller.pickAgent}
			onSubmit={mode => void controller.submit(mode)}
			onClose={() => store.closeDialog()}
		/>
	);
}
