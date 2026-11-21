import { PASTE_TEXT_LIMIT } from "../shared/terminal";

/**
 * Words and choices for review notes in the Changes tab and the Send review
 * dialog. Pure, so they can be tested without a window. The message itself
 * is built in ../shared/review.ts.
 */

export const REVIEW_WAITS_WARNING =
	"This agent is waiting for you, such as for an approval. The review would go into that answer. Answer it first, or pick another agent.";

/** What the new agent choice says it does, before the command that starts it. */
export const NEW_REVIEW_AGENT_NOTE = "Starts it here, then pastes the review once it is ready. Command:";

export const NO_REVIEW_AGENT = "No agent runs in this worktree, and none is saved in Settings, Agents. Copy the review and paste it where you want it.";

export const REVIEW_PASTE_NOTE = "The review is pasted into the agent's input as one paste. Nothing is sent until you press Enter there.";

/** The choice of a new agent for a review: the first saved agent, by name. */
export function describeNewReviewAgent(name: string): string {
	return `New ${name}`;
}

/** The toast after a new agent started for a review. */
export function describeReviewAgentStarted(name: string): string {
	return `${name} is starting. The review is pasted once it is ready, and nothing is sent until you press Enter there.`;
}

/** Why a review does not start a second agent while another waits to paste one. */
export function reviewAlreadyWaiting(name: string): string {
	return `${name} is still waiting to paste a review here. Wait until it has, or close it.`;
}

/** Why a new agent's review was not pasted, in a toast. */
export function describeReviewNotPasted(message: string): string {
	return `The review was not pasted: ${message}`;
}

/** The count beside the Changes tab and the Review heading, in words for a screen reader. */
export function describeNoteCount(count: number): string {
	return count === 1 ? "1 review note" : `${count} review notes`;
}

/** The toast after the review went to an agent. */
export function describeReviewSent(name: string): string {
	return `Review pasted into ${name}. Press Enter there to send it.`;
}

/** Why a review cannot be pasted: it is longer than one paste may be. */
export function reviewTooLong(length: number): string {
	return `The review is ${length} characters, more than one paste can take (${PASTE_TEXT_LIMIT}). Send it in parts, or copy it.`;
}

export const REVIEW_COPIED = "Review copied. The notes stay until sent or discarded.";

/** What a screen reader hears for a note's reference, which shows its lines in the diff. */
export function describeReference(location: string, outdated: boolean): string {
	return outdated ? `Show ${location}, outdated` : `Show ${location}`;
}

export const OUTDATED_REFERENCE = "These lines changed or left the diff since the note. It is sent with the lines as they were.";

export const REVIEW_TOGGLE_TITLE = "Show the review notes over the diff";

export const CLOSE_REVIEW = "Close the review";

/** Shown for a reference whose first line is blank, so the line still shows. */
export const EMPTY_LINE = "empty line";
