import type { AgentSetting } from "../../../shared/agent";
import type { AppStore } from "../../store/store";
import type { Submission } from "../../store/submission";
import { type AgentPick, chosenAgent, runWithAgent } from "./agent-choice";
import type { WorktreeDialogMode } from "./mode";

/**
 * What the New worktree dialog does between its modes and its one
 * submission, without React: which mode shows, which agent is picked, and
 * how a run starts that agent. ../NewWorktreeDialog.tsx only draws this, so
 * tests drive the same wiring the window uses.
 */

export interface WorktreeDialogChoices {
	/** The position of the mode on screen. */
	selected: number;
	/** The Agent field as the person left it. */
	pick: AgentPick;
}

export interface WorktreeDialogController {
	getState(): WorktreeDialogChoices;
	/** Hear about every change of state. Returns a function that stops listening. */
	subscribe(listener: () => void): () => void;
	/** Show another mode. Never while a command runs. The failure on screen goes. */
	select(index: number): void;
	/** Pick an agent by name, or null for None. */
	pickAgent(pick: string | null): void;
	/** The agent that starts after a worktree is created, from the agents saved now. */
	agent(): AgentSetting | null;
	/**
	 * Run a mode through the dialog's submission, then start the picked agent
	 * in the worktree it reports as created (see `runWithAgent`). Answers as
	 * `Submission.submit` does.
	 */
	submit(mode: WorktreeDialogMode): Promise<boolean>;
}

/** The value of the Agent field's option as a pick: the empty value is None. */
export function pickOfOption(value: string): string | null {
	return value === "" ? null : value;
}

/** `repository` is the path of the primary checkout. */
export function createWorktreeDialogController(
	store: Pick<AppStore, "getState" | "startAgentIn">,
	repository: string,
	submission: Pick<Submission, "getState" | "submit" | "clearFailure">,
): WorktreeDialogController {
	let state: WorktreeDialogChoices = { selected: 0, pick: undefined };
	const listeners = new Set<() => void>();

	function update(change: Partial<WorktreeDialogChoices>): void {
		state = { ...state, ...change };
		for (const listener of [...listeners]) listener();
	}

	const agent = () => chosenAgent(store.getState().preferences.agents, state.pick);

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
		agent,
		submit(mode) {
			// The agent as picked when the person submitted, not when the command ends.
			const picked = agent();
			return submission.submit(() => runWithAgent(store, repository, () => mode.run(), picked));
		},
	};
}
