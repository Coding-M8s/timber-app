import { type ShownStatus, type ShownStatusKind, alertStatus, hasStatusMark, shownStatus } from "../shared/session-status";
import type { TerminalSession } from "../shared/terminal";

/**
 * Which agent statuses the person has seen, so a Done, an Error, or a crash
 * they already looked at turns quiet. Everything here is pure.
 *
 * A status is seen once its session is on screen in a window that shows and
 * has the focus: the chosen chip of the selected worktree, while the
 * Workspace tab shows. Needs you is never seen, because the agent still
 * waits on the person. A new state from the agent starts unseen again: the
 * mark is kept only while the session stays in the state it was seen in. A
 * new report in the same state, such as Done with a new message, stays seen.
 * Seen lives in the window only and does not survive a restart.
 */

/** The session id and the state it was seen in. */
export type SeenStatuses = Readonly<Record<string, ShownStatusKind>>;

/** The states that turn quiet once seen. */
export const SEEABLE_KINDS: readonly ShownStatusKind[] = ["done", "error", "crashed"];

export function canBeSeen(kind: ShownStatusKind): boolean {
	return SEEABLE_KINDS.includes(kind);
}

/**
 * The seen statuses after a change, from the sessions and the session on
 * screen in a focused window, or null when none is. A session that left the
 * state it was seen in, or is gone, is forgotten; the one on screen is seen
 * when its state can be. Answers the same object when nothing changed.
 */
export function withSeenStatuses(seen: SeenStatuses, terminals: readonly TerminalSession[], onScreen: string | null): SeenStatuses {
	const next: Record<string, ShownStatusKind> = {};
	let changed = false;
	for (const [id, kind] of Object.entries(seen)) {
		const session = terminals.find(candidate => candidate.id === id);
		if (session && shownStatus(session).kind === kind) next[id] = kind;
		else changed = true;
	}
	if (onScreen !== null && next[onScreen] === undefined) {
		const session = terminals.find(candidate => candidate.id === onScreen);
		const kind = session ? shownStatus(session).kind : null;
		if (kind !== null && canBeSeen(kind)) {
			next[onScreen] = kind;
			changed = true;
		}
	}
	return changed ? next : seen;
}

/** Whether a session's status as shown now was seen. */
export function isSeen(seen: SeenStatuses, session: Pick<TerminalSession, "id" | "state" | "status"> & Partial<Pick<TerminalSession, "endedAgent">>): boolean {
	const kind = shownStatus(session).kind;
	return canBeSeen(kind) && seen[session.id] === kind;
}

/**
 * The statuses a collapsed repository header sums up: the status that counts
 * for each session with a status mark (`alertStatus`, so a task that needs
 * you counts as the session needing you), less those that are the session's
 * own status and were seen. A task that needs you is never left out.
 */
export function unseenStatuses(sessions: readonly TerminalSession[], seen: SeenStatuses): ShownStatus[] {
	return sessions.filter(hasStatusMark).flatMap(session => {
		const counted = alertStatus(session);
		return counted.child === null && isSeen(seen, session) ? [] : [counted.status];
	});
}
