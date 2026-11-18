import { useEffect, useState, useSyncExternalStore } from "react";
import type { AgentSetting } from "../../shared/agent";
import type { Repository } from "../../shared/model";
import { useAppState, useStore, useSubmission } from "../store/react";
import type { SubmissionState } from "../store/submission";
import { OperationDialog } from "./OperationDialog";
import { ModeSwitch } from "./worktree-modes/ModeSwitch";
import { followUps } from "./worktree-modes/agent-choice";
import { createWorktreeDialogController, pickOfOption } from "./worktree-modes/dialog-controller";
import { useExistingBranchMode } from "./worktree-modes/existing-branch";
import type { WorktreeDialogMode } from "./worktree-modes/mode";
import { useNewBranchMode } from "./worktree-modes/new-branch";

interface AgentFieldProps {
	/** The agents saved in Settings, Agents, in menu order. */
	agents: readonly AgentSetting[];
	/** The agent that will start, or null for None. */
	chosen: AgentSetting | null;
	onPick: (pick: string | null) => void;
}

/** The Agent field, shared by every mode: each saved agent, then None. */
export function AgentField({ agents, chosen, onPick }: AgentFieldProps) {
	return (
		<label className="field">
			<span className="field-label">Agent</span>
			<select className="field-input" name="agent" value={chosen?.name ?? ""} onChange={event => onPick(pickOfOption(event.target.value))}>
				{agents.map(agent => <option key={agent.name} value={agent.name}>{agent.name}</option>)}
				<option value="">None</option>
			</select>
			<span className="field-hint">
				{agents.length === 0
					? "No agents are set up. Add one in Settings, Agents."
					: chosen === null
						? "No agent starts. Start one later from the worktree."
						: "Starts in the worktree once this dialog has created it, never in one that was already there."}
			</span>
		</label>
	);
}

interface WorktreeDialogFrameProps {
	repository: Repository;
	modes: readonly WorktreeDialogMode[];
	/** The position of the mode on screen in `modes`. */
	selected: number;
	submission: SubmissionState;
	/** The agents saved in Settings, Agents. */
	agents: readonly AgentSetting[];
	/** The agent that will start after a worktree is created, or null for None. */
	agent: AgentSetting | null;
	onSelect: (index: number) => void;
	onPickAgent: (pick: string | null) => void;
	/** Run the mode on screen. */
	onSubmit: (mode: WorktreeDialogMode) => void;
	onClose: () => void;
}

/**
 * The worktree dialog as a drawing of its modes: one `OperationDialog` for
 * whichever mode is selected, with the Agent field under the mode's own
 * fields. The switch shows only when there is a choice.
 */
export function WorktreeDialogFrame(props: WorktreeDialogFrameProps) {
	const { repository, modes, selected, submission, agents, agent, onSelect, onPickAgent, onSubmit, onClose } = props;
	const mode = modes[selected] ?? modes[0];
	if (!mode) return null;
	return (
		<OperationDialog
			title={`New worktree in ${repository.name}`}
			headerAside={modes.length > 1 && (
				<ModeSwitch labels={modes.map(candidate => candidate.label)} selected={modes.indexOf(mode)} disabled={submission.running} onSelect={onSelect} />
			)}
			command={mode.command}
			followUps={followUps(agent, mode.agentStart, mode.setupStart, mode.worktree, mode.workflow)}
			submission={submission}
			submitLabel={mode.submitLabel}
			runningLabel={mode.runningLabel}
			failureTitle={mode.failureTitle}
			canSubmit={mode.canSubmit}
			onSubmit={() => onSubmit(mode)}
			onClose={onClose}
		>
			{mode.fields}
			<AgentField agents={agents} chosen={agent} onPick={onPickAgent} />
		</OperationDialog>
	);
}

/**
 * The dialog behind the "+" of a repository. Its controller
 * (./worktree-modes/dialog-controller.ts) owns which mode is selected and the
 * agent to start, which all modes share, and runs the one submission. Each
 * mode brings its fields, its command, and what running it means. Add a mode
 * by adding its hook to `modes`.
 */
export function NewWorktreeDialog({ repository }: { repository: Repository }) {
	const store = useStore();
	const { submission, state } = useSubmission(() => store.closeDialog());
	const [controller] = useState(() => createWorktreeDialogController(store, repository.path, submission));
	const { selected, workflows } = useSyncExternalStore(controller.subscribe, controller.getState, controller.getState);
	// Read once when the dialog opens: each read runs Timber, and file watching reads the repository again often.
	// The controller reads again after a run fails, when the settings may have changed.
	useEffect(() => {
		void controller.readWorkflows();
	}, [controller]);
	const modes = [useNewBranchMode(repository, submission, workflows), useExistingBranchMode(repository, submission, workflows)];
	const { agents } = useAppState().preferences;
	return (
		<WorktreeDialogFrame
			repository={repository}
			modes={modes}
			selected={selected}
			submission={state}
			agents={agents}
			agent={controller.agent()}
			onSelect={controller.select}
			onPickAgent={controller.pickAgent}
			onSubmit={mode => void controller.submit(mode)}
			onClose={() => store.closeDialog()}
		/>
	);
}
