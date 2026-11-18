/**
 * When a session's status calls for a desktop notification, and what it
 * says. The main process decides, since it hears every session even while
 * the window is hidden, and knows from `attend` what is on screen. Pure: the
 * clock is passed in.
 */
import type { Attention } from "./attention";
import { type ShownStatus, describeShownStatus, hasStatusMark, shortMessage, shownStatus } from "./session-status";
import type { TerminalChange, TerminalSession } from "./terminal";

/**
 * The least time between two notifications of one session for the same
 * status, as the spec asks to rate limit them. A different one, such as
 * Needs you right after Done, is never held back.
 */
export const NOTICE_INTERVAL_MILLISECONDS = 10_000;

/** A desktop notification to show for a session. */
export interface StatusNotice {
	/** The session it is for, to select its worktree and show it on a click. */
	session: string;
	/** Such as "Codex needs you". */
	title: string;
	/** Such as "In feature-login: approve Write: src/a.ts". */
	body: string;
}

/** The statuses that call for the person: Needs you, Done, Error, and crashed. */
const NOTABLE: ReadonlySet<ShownStatus["kind"]> = new Set(["needs-you", "done", "error", "crashed"]);

const HEADLINES: Partial<Record<ShownStatus["kind"], string>> = {
	"needs-you": "needs you",
	"done": "is done",
	"error": "reported an error",
	"crashed": "crashed",
};

/** The worktree's folder name, such as `feature-login` for `/work/timber-worktrees/feature-login`. */
function folderName(path: string): string {
	return path.split(/[\\/]/).filter(Boolean).at(-1) ?? path;
}

/** Whether the session's worktree is on screen in a window that shows and has the focus. */
export function onScreen(session: Pick<TerminalSession, "repository" | "path">, attention: Attention): boolean {
	return attention.visible && attention.focused
		&& attention.selected?.repository === session.repository && attention.selected.worktree === session.path;
}

/** The words of a notification for a session that reached a notable status. */
export function describeNotice(session: TerminalSession, status: ShownStatus): Omit<StatusNotice, "session"> {
	const message = session.state.kind === "running" ? session.status?.message ?? null : null;
	const detail = message === null ? describeShownStatus(status) : shortMessage(message);
	return { title: `${session.name} ${HEADLINES[status.kind] ?? describeShownStatus(status).toLowerCase()}`, body: `In ${folderName(session.path)}: ${detail}` };
}

export interface StatusNotices {
	/**
	 * A session changed. Answers the notification to show, or null. Only a
	 * session that moves into Needs you, Done, Error, or crashed gets one,
	 * and only when its worktree is not on screen in a focused window, the
	 * setting is on, and its last one for that status was long enough ago.
	 */
	changed(change: TerminalChange, attention: Attention, enabled: boolean, now: number): StatusNotice | null;
}

export function createStatusNotices(interval: number = NOTICE_INTERVAL_MILLISECONDS): StatusNotices {
	const known = new Map<string, { session: TerminalSession; status: ShownStatus["kind"] }>();
	/** When each session was last told about, by session and status. */
	const lastShown = new Map<string, Map<ShownStatus["kind"], number>>();
	return {
		changed(change, attention, enabled, now) {
			const before = known.get(change.id);
			const session = change.session;
			if (session === null) {
				known.delete(change.id);
				lastShown.delete(change.id);
				return null;
			}
			const status = shownStatus(session);
			known.set(change.id, { session, status: status.kind });
			// A session with no status mark, such as a plain shell, is never told about, not even when it ends badly.
			const marked = hasStatusMark(session) || (before !== undefined && hasStatusMark(before.session));
			if (!marked || before === undefined || before.status === status.kind || !NOTABLE.has(status.kind)) return null;
			if (!enabled || onScreen(session, attention)) return null;
			const shown = lastShown.get(change.id) ?? new Map<ShownStatus["kind"], number>();
			const last = shown.get(status.kind);
			if (last !== undefined && now - last < interval) return null;
			shown.set(status.kind, now);
			lastShown.set(change.id, shown);
			return { session: change.id, ...describeNotice(session, status) };
		},
	};
}
