import type { TerminalSession } from "../shared/terminal";

/**
 * Which running agent gets text from the app: a review (see
 * ./review-format.ts) or a prompt chop (see ./chop-format.ts), and when a
 * new one starts for it (`promptTarget`). Pure, so the choice can be tested
 * without a window.
 */

/** The agent sessions of a worktree that text can go to: running, in the order they started. */
export function runningAgents(sessions: readonly TerminalSession[], worktree: string): TerminalSession[] {
	return sessions.filter(session => session.worktree === worktree && session.kind === "agent" && session.state.kind === "running");
}

/** The session picked at first: the only one, or none when there are several to choose from. */
export function onlyAgent(sessions: readonly TerminalSession[]): string | null {
	return sessions.length === 1 ? sessions[0]!.id : null;
}

/** Whether the agent waits on a question or an approval, which text sent to it could answer. */
export function waitsOnPerson(session: Pick<TerminalSession, "status">): boolean {
	return session.status?.state === "blocked";
}

/** Whether an agent was started for a prompt chop or a review that it has not been sent yet: it may still be on a first-run screen. */
export function awaitsItsPrompt(session: Pick<TerminalSession, "prompt">): boolean {
	return session.prompt?.state === "pending";
}

/** The agent of the worktree started with a review that it still waits to paste, if any: a second review would go twice. */
export function reviewWaiting(sessions: readonly TerminalSession[], worktree: string): TerminalSession | null {
	return runningAgents(sessions, worktree).find(session => session.prompt?.state === "pending" && session.prompt.what === "review") ?? null;
}

/**
 * Where a prompt chop or a review goes in a worktree, from its running agents: a new
 * agent when none runs, the only one when one runs, does not wait on the
 * person, and is not still waiting to be ready for a prompt of its own, or a
 * question otherwise. Such an agent is never picked without asking, since
 * the prompt and its Enter could answer a question meant for the person.
 */
export type PromptTarget =
	| { kind: "new" }
	| { kind: "session"; session: string }
	| { kind: "ask"; sessions: TerminalSession[] };

export function promptTarget(sessions: readonly TerminalSession[], worktree: string): PromptTarget {
	const running = runningAgents(sessions, worktree);
	if (running.length === 0) return { kind: "new" };
	if (running.length === 1 && !waitsOnPerson(running[0]!) && !awaitsItsPrompt(running[0]!)) return { kind: "session", session: running[0]!.id };
	return { kind: "ask", sessions: running };
}
