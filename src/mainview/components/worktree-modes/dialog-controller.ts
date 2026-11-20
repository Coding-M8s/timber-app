import type { AppStore } from "../../store/store";
import type { Submission } from "../../store/submission";
import { type AgentPick, type AgentPlan, plannedAgent, runAndStart, startingAgent } from "./agent-choice";
import type { WorktreeDialogMode } from "./mode";
import type { WorkflowOptions } from "./workflow-choice";

/**
 * What the New worktree dialog does between its modes and its one
 * submission, without React: which mode shows, which agent is picked, the
 * workflows every mode offers, which agent a run starts, the picked one or
 * the workflow's, and how it starts it.
 * ../NewWorktreeDialog.tsx only draws this, so tests drive the same wiring
 * the window uses.
 */

export interface WorktreeDialogChoices {
	/** The position of the mode on screen. */
	selected: number;
	/** The Agent field as the person left it. Kept while a workflow sets the field, so it is back once the workflow is not. */
	pick: AgentPick;
	/** The repository's workflows for the modes' Workflow fields: undefined until read. */
	workflows: WorkflowOptions;
}

export interface WorktreeDialogController {
	getState(): WorktreeDialogChoices;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/** Show another mode. Never while a command runs. The failure on screen goes. */
	select(index: number): void;
	/** Pick an agent by name, or null for None. */
	pickAgent(pick: string | null): void;
	/** Read the repository's workflows. Only the latest read counts. Never throws. */
	readWorkflows(): Promise<void>;
	/**
	 * Where the agent that starts after a worktree is created comes from, for
	 * a run with `workflow` (null for none): the pick, from the agents saved
	 * now, or the workflow, as the list read last says.
	 */
	plan(workflow: string | null): AgentPlan;
	/**
	 * Run a mode through the dialog's submission, then start setup and the
	 * agent its plan names in the worktree it reports (see `runAndStart`). Answers as
	 * `Submission.submit` does. After a run that failed, the workflows are
	 * read again, as a workflow may have left the settings.
	 */
	submit(mode: WorktreeDialogMode): Promise<boolean>;
}

/** The value of the Agent field's option as a pick: the empty value is None. */
export function pickOfOption(value: string): string | null {
	return value === "" ? null : value;
}

/** `repository` is the path of the primary checkout. */
export function createWorktreeDialogController(
	store: Pick<AppStore, "getState" | "startSessionsIn" | "listWorkflows">,
	repository: string,
	submission: Pick<Submission, "getState" | "submit" | "clearFailure">,
	/** The mode to start on, by position. The first unless given. */
	selected = 0,
): WorktreeDialogController {
	let state: WorktreeDialogChoices = { selected, pick: undefined, workflows: undefined };
	const listeners = new Set<() => void>();
	let latestRead = 0;

	function update(change: Partial<WorktreeDialogChoices>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	async function readWorkflows(): Promise<void> {
		const read = ++latestRead;
		const workflows = await store.listWorkflows(repository);
		if (read === latestRead) update({ workflows });
	}

	const plan = (workflow: string | null) => plannedAgent(store.getState().preferences.agents, state.pick, state.workflows, workflow);

	return {
		getState: () => state,
		subscribe(listener) {
			listeners.add(listener);
			return () => void listeners.delete(listener);
		},
		select(index) {
			if (submission.getState().running) return;
			update({ selected: index });
			submission.clearFailure();
		},
		pickAgent: pick => update({ pick }),
		readWorkflows,
		plan,
		async submit(mode) {
			// A second submit while one runs does nothing, so it reads nothing either.
			if (submission.getState().running) return false;
			// The agent as planned when the person submitted, not when the command ends. The main process reads a workflow's agent again when it starts.
			const starting = startingAgent(plan(mode.workflow));
			const worked = await submission.submit(() => runAndStart(store, repository, () => mode.run(), starting));
			// Reading runs Timber, so the list is read again only when a failure may have come from the settings.
			if (!worked) await readWorkflows();
			return worked;
		},
	};
}
