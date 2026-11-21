import type { ProgramStatus } from "./program-status";

/**
 * When an agent started for a prompt chop, or with a review to paste, is
 * ready for that text. Pure, so
 * the rule can be tested without a pseudo terminal; the main process acts on
 * it in ../bun/terminals.ts.
 *
 * - An agent that asked whether the terminal reads the Program Status
 *   Protocol (it probed, see ./program-status.ts) says when it is ready: it
 *   gets the prompt once its root record is `idle`. While it is `blocked`,
 *   such as on Claude Code's "trust this folder" question, or `working`, it
 *   waits, so an Enter never answers a question meant for the person.
 * - An agent that never probed gets it once it turned bracketed paste on,
 *   which is when it draws its input, and its output then stayed quiet for
 *   `PROMPT_QUIET_MILLISECONDS`, or, for one that keeps redrawing, such as
 *   a spinner or a clock, once bracketed paste was on for
 *   `PROMPT_BUSY_MILLISECONDS`. The app never reads what an agent prints,
 *   so it cannot tell that first prompt from a first-run screen that also
 *   takes Enter, such as a sign-in.
 */

/** How long an agent that never probed must stay quiet, with bracketed paste on, before it gets the prompt. */
export const PROMPT_QUIET_MILLISECONDS = 500;
/** How long bracketed paste must be on, for an agent that never probed and never goes quiet, before it gets the prompt anyway. */
export const PROMPT_BUSY_MILLISECONDS = 5000;
/**
 * The longest a new agent gets to be ready before its prompt is dropped. Long
 * enough for the person to answer a first-run question, such as whether to
 * trust the folder.
 */
export const PROMPT_WAIT_MILLISECONDS = 120_000;
/** The pause between the paste and the Enter that submits it, so the agent reads the paste whole first. */
export const PROMPT_ENTER_MILLISECONDS = 100;

export interface PromptReadiness {
	/** Whether the agent probed for the Program Status Protocol. */
	probed: boolean;
	/** Its root record now, or null. */
	status: ProgramStatus | null;
	/** Whether it asked for bracketed paste. */
	pasteOn: boolean;
	/** How long its output has been quiet. */
	quietMilliseconds: number;
	/** How long bracketed paste has been on, 0 while it is off. */
	pasteOnMilliseconds: number;
}

/** Whether a new agent is ready for its prompt (see above). */
export function isReadyForPrompt(agent: PromptReadiness, quietNeeded = PROMPT_QUIET_MILLISECONDS, busyNeeded = PROMPT_BUSY_MILLISECONDS): boolean {
	if (agent.probed) return agent.status?.state === "idle";
	return agent.pasteOn && (agent.quietMilliseconds >= quietNeeded || agent.pasteOnMilliseconds >= busyNeeded);
}

/** Why text does not go to an agent still waiting to be ready for the prompt or review it was started with. */
export const PROMPT_STILL_STARTING = "The agent is still starting, and has not had the text it was started with yet. Wait until it is ready, then send this again.";

/** Which text a new agent waits for: a prompt chop's, or a review, which is pasted with no Enter. */
export type DeliveredText = "prompt" | "review";

/** Why a new agent's prompt or review was not sent: it was not ready in time. */
export function promptNotReadyMessage(agent: string, milliseconds: number, what: DeliveredText = "prompt"): string {
	const seconds = Math.round(milliseconds / 1000);
	return what === "review"
		? `${agent} was not ready for the review within ${seconds} seconds, so it was not pasted. The notes are kept: send the review again.`
		: `${agent} was not ready for the prompt within ${seconds} seconds, so it was not sent. Run the chop again, or copy the prompt from Settings, Chops.`;
}

/** Why a new agent's prompt or review was not sent: it ended first. */
export function promptEndedMessage(agent: string, what: DeliveredText = "prompt"): string {
	return what === "review"
		? `${agent} ended before it was ready for the review, so it was not pasted. The notes are kept.`
		: `${agent} ended before it was ready for the prompt, so it was not sent.`;
}
