import { repositoryPick } from "../../store/state";
import type { AppStore } from "../../store/store";
import type { Submission } from "../../store/submission";
import { defaultAgentKnown } from "../../../shared/agent-lookup";
import { type AgentPick, type AgentPlan, defaultAgent, plannedAgent, runAndStart, startingAgent } from "./agent-choice";
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
	 * Look for the agents' executables again, as the dialog opens, then hold
	 * the agent the field picked on its own (`defaultAgent`) as if the person
	 * had picked it, so a later look never changes the pick under them; it
	 * only changes the marks. Until this look answers, the pick follows what
	 * the app knew, and may change once when it does. Nothing is held when
	 * the look got no answer, or the default agent is still not known. Never throws.
	 */
	locateAgents(): Promise<void>;
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
	store: Pick<AppStore, "getState" | "startSessionsIn" | "listWorkflows" | "locateAgents">,
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

	const plan = (workflow: string | null) => {
		const { preferences, agentLocations } = store.getState();
		return plannedAgent(preferences.agents, agentLocations, state.pick, state.workflows, workflow, repositoryPick(store.getState(), repository));
	};

	async function locateAgents(): Promise<void> {
		// Held only from an answer this look got: never from what was known before it, which may be out of date.
		if (!(await store.locateAgents())) return;
		const { preferences: { agents }, agentLocations } = store.getState();
		const own = repositoryPick(store.getState(), repository);
		if (state.pick !== undefined || !defaultAgentKnown(agents, agentLocations, own)) return;
		update({ pick: defaultAgent(agents, agentLocations, own)?.name ?? null });
	}

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
		locateAgents,
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
