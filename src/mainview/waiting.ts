import { alertStatus, shownStatus } from "../shared/session-status";
import type { TerminalSession } from "../shared/terminal";

/**
 * The sessions that need the person, across every repository, then the ones
 * that finished, and the shortcut that goes to the next one. Everything here
 * is pure.
 *
 * Each order is the order in which sessions moved into Needs you, or into
 * Done, so the one that has waited longest, or finished first, comes first.
 * The interface keeps them from the changes it hears; no clock is needed.
 * After the window reloads, sessions already waiting or done are put in the
 * order they started, which is the best that is known then.
 */

/** Whether a session is shown as Needs you, agent or not, itself or through one of its children. */
export function isWaiting(session: Pick<TerminalSession, "state" | "status"> & Partial<Pick<TerminalSession, "children">>): boolean {
	return alertStatus(session).status.kind === "needs-you";
}

/**
 * The waiting order after the sessions changed: the ids still waiting keep
 * their places, the ones that stopped waiting or are gone leave, and those
 * that started waiting join at the end, in the order the sessions started.
 * Answers the same array when nothing changed.
 */
export function withWaitingOrder(order: readonly string[], terminals: readonly TerminalSession[]): readonly string[] {
	const waiting = new Set(terminals.filter(isWaiting).map(session => session.id));
	const kept = order.filter(id => waiting.has(id));
	const known = new Set(kept);
	const added = terminals.filter(session => waiting.has(session.id) && !known.has(session.id)).map(session => session.id);
	if (added.length === 0 && kept.length === order.length) return order;
	return [...kept, ...added];
}

/** Whether a session is shown as Done: it reported `done` and still runs. */
export function isFinished(session: Pick<TerminalSession, "state" | "status">): boolean {
	return shownStatus(session).kind === "done";
}

/**
 * The finished order after a change, from the sessions and the session on
 * screen before it and after it. A session joins at the end when it moves
 * into Done, in the order the sessions started, unless it is on screen then:
 * that one is seen already. Done stays until the program reports something
 * else, so a finished session also leaves once the person has seen it: it
 * was on screen before the change and is not now. It joins again only when
 * it finishes again. One that stops being done, closes, or exits leaves.
 * "On screen" is the session shown in the window, focused or not, as for
 * the unseen mark on a chip.
 * Answers the same array when nothing changed.
 */
export function withFinishedOrder(
	order: readonly string[],
	change: { before: readonly TerminalSession[]; now: readonly TerminalSession[]; shownBefore: string | null; shownNow: string | null },
): readonly string[] {
	const { before, now, shownBefore, shownNow } = change;
	// Most updates touch neither the sessions nor what is on screen.
	if (before === now && shownBefore === shownNow) return order;
	const finished = new Set(now.filter(isFinished).map(session => session.id));
	const finishedBefore = new Set(before.filter(isFinished).map(session => session.id));
	const seen = shownBefore !== null && shownBefore !== shownNow ? shownBefore : null;
	const kept = order.filter(id => finished.has(id) && id !== seen);
	const known = new Set(kept);
	const added = now
		.filter(session => finished.has(session.id) && !finishedBefore.has(session.id) && !known.has(session.id) && session.id !== shownNow)
		.map(session => session.id);
	if (added.length === 0 && kept.length === order.length) return order;
	return [...kept, ...added];
}

/**
 * The session the shortcut goes to, from the sessions to visit in order: the
 * one after the session on screen when that one is in the list, wrapping
 * around, or else the first. Null when there is none.
 */
export function nextWaitingSession(order: readonly string[], onScreen: string | null): string | null {
	if (order.length === 0) return null;
	const at = onScreen === null ? -1 : order.indexOf(onScreen);
	return at === -1 ? order[0]! : order[(at + 1) % order.length]!;
}

/**
 * The words for the sessions that need the person, such as "1 needs you" or
 * "2 need you", or empty when none waits. A collapsed repository header says
 * "2 needs you" instead, as one of several states in a summary (see
 * `summarizeStatuses`); this is a sentence about the sessions, so the verb
 * agrees with the count.
 */
export function describeWaiting(count: number): string {
	if (count <= 0) return "";
	return count === 1 ? "1 needs you" : `${count} need you`;
}

/** The words for the finished sessions, such as "1 done", or empty when none. */
export function describeFinished(count: number): string {
	return count <= 0 ? "" : `${count} done`;
}

/** Both, such as "2 need you, 1 done", for the palette. Empty when there are none. */
export function describeToVisit(waiting: number, finished: number): string {
	return [describeWaiting(waiting), describeFinished(finished)].filter(words => words !== "").join(", ");
}

export const WAITING_LABEL = "Show next session that needs you or is done";
export const NONE_WAITING = "No session needs you or is done.";

/** The shortcut that shows the next session that needs you or is done. */
export const WAITING_SHORTCUT = "Ctrl+Shift+J";
export const WAITING_SHORTCUT_MAC = "Cmd+Shift+J";

export function waitingShortcut(mac: boolean): string {
	return mac ? WAITING_SHORTCUT_MAC : WAITING_SHORTCUT;
}

/** The title bar item's tooltip, which names the shortcut for this platform. */
export function waitingHint(mac: boolean): string {
	return `${WAITING_LABEL} (${waitingShortcut(mac)})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift+J, or Cmd+Shift+J on macOS. Either modifier counts, as for the palette's shortcut. */
export function isWaitingShortcut(event: Keys): boolean {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey) return false;
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "j";
}
