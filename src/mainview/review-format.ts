import { PASTE_TEXT_LIMIT } from "../shared/terminal";

/**
 * Words and choices for review notes in the Changes tab and the Send review
 * dialog. Pure, so they can be tested without a window. The message itself
 * is built in ../shared/review.ts.
 */

export const REVIEW_WAITS_WARNING =
	"This agent is waiting for you, such as for an approval. The review would go into that answer. Answer it first, or pick another agent.";

export const NO_REVIEW_AGENT = "No agent runs in this worktree. Copy the review and paste it where you want it.";

export const REVIEW_PASTE_NOTE = "The review is pasted into the agent's input as one paste. Nothing is sent until you press Enter there.";

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

/** The first line of a note, for the Review list. */
export function noteSummary(text: string): string {
	return text.split("\n", 1)[0]!;
}
