import type { ReactNode } from "react";
import type { TerminalSession } from "../../shared/terminal";
import { describeTerminalState } from "../terminal-format";

export interface AgentChoicesProps {
	/** The running agents of the worktree, as `runningAgents` lists them. */
	sessions: readonly TerminalSession[];
	/** The picked session's id, or null. */
	picked: string | null;
	onPick: (id: string) => void;
	/** The radio group's name, unique in the dialog. */
	name: string;
	legend: string;
	disabled: boolean;
	/** More choices after the agents, such as starting a new one. */
	children?: ReactNode;
}

/**
 * The running agents text can go to, each with its state, as one radio
 * group: shared by Send review and Send prompt, so both pick an agent the
 * same way.
 */
export function AgentChoices({ sessions, picked, onPick, name, legend, disabled, children }: AgentChoicesProps) {
	return (
		<fieldset className="review-agents" disabled={disabled}>
			<legend className="field-label">{legend}</legend>
			{sessions.map(session => (
				<label key={session.id} className="review-agent">
					<input type="radio" name={name} checked={picked === session.id} onChange={() => onPick(session.id)} />
					<span className="review-agent-name">{session.name}</span>
					<span className="review-agent-state">{describeTerminalState(session)}</span>
				</label>
			))}
			{children}
		</fieldset>
	);
}
