import { type MissingPick, type NoDefaultAgent, describeMissingPick } from "../shared/agent-lookup";
import { PASTE_TEXT_LIMIT } from "../shared/terminal";

/**
 * Words and choices for review notes in diffs and the Send review
 * dialog. Pure, so they can be tested without a window. The message itself
 * is built in ../shared/review.ts.
 */

export const REVIEW_WAITS_WARNING =
	"This agent is waiting for you, such as for an approval. The review would go into that answer. Answer it first, or pick another agent.";

/** What the new agent choice says it does, before the command that starts it. */
export const NEW_REVIEW_AGENT_NOTE = "Starts it here, then pastes the review once it is ready. Command:";

/** What the Send review dialog says with no agent running in the worktree and no default agent to start, by why there is none. */
export function noReviewAgent(why: NoDefaultAgent): string {
	if (typeof why === "object") return `No agent runs in this worktree, and ${describeMissingPick(why)}. Copy the review and paste it where you want it.`;
	switch (why) {
		case "none-saved": return "No agent runs in this worktree, and none is saved in Settings, Agents. Copy the review and paste it where you want it.";
		case "none-found": return "No agent runs in this worktree, and none of the agents in Settings, Agents was found. Copy the review and paste it where you want it.";
		case "not-known": return "No agent runs in this worktree, and the app has not found out yet which agents are installed. Copy the review and paste it where you want it.";
	}
}

/** Why a review starts no new agent, as `startReviewAgent` answers, by why there is no default agent. */
export function noNewReviewAgent(why: NoDefaultAgent): string {
	if (typeof why === "object") return `${describeMissingPick(why)}. Copy the review instead.`;
	switch (why) {
		case "none-saved": return "No agent is saved in Settings, Agents. Copy the review instead.";
		case "none-found": return "None of the agents in Settings, Agents was found. Copy the review instead.";
		case "not-known": return "The app could not find out which agents are installed. Copy the review instead, or send it again.";
	}
}

export const REVIEW_PASTE_NOTE = "The review is pasted into the agent's input as one paste. Nothing is sent until you press Enter there.";

/** What the Send review dialog says beside the agents running when the repository's default agent cannot start, so no new one is offered. */
export function noNewReviewChoice(missing: MissingPick): string {
	return `${describeMissingPick(missing)}, so no new agent can be started for the review.`;
}

/** The choice of a new agent for a review: the default agent (the repository's, or the first saved agent found), by name. */
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

/** The count beside the Changes view's switch and the Review heading, in words for a screen reader. */
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

export const REVIEW_NOT_COPIED = "The review could not be put on the clipboard.";

/** Shown for a reference whose first line is blank, so the line still shows. */
export const EMPTY_LINE = "empty line";
