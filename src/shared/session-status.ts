/**
 * The words and marks for what a session's program reported about itself
 * through the Program Status Protocol (see ./program-status.ts), and
 * for how the session ended. Everything here is pure.
 */
import type { ChildStatus, StatusKind, StatusRecords } from "./program-status";
import type { TerminalSession } from "./terminal";

/**
 * A session's status as shown. The process exit is the source of truth:
 * once it exited, it is stopped or crashed, whatever the last report said.
 * A running session that never reported is `unknown`, shown as running.
 */
export type ShownStatus =
	| { kind: "working"; progress: number | null }
	| { kind: "needs-you"; reason: StatusKind | null }
	| { kind: "done" }
	| { kind: "idle" }
	| { kind: "error" }
	| { kind: "stopped" }
	/** The process ended with a code other than 0, or a signal stopped it. */
	| { kind: "crashed"; exitCode: number | null; signal: string | null }
	| { kind: "unknown" };

export type ShownStatusKind = ShownStatus["kind"];

export function shownStatus(session: Pick<TerminalSession, "state" | "status">): ShownStatus {
	const { state, status } = session;
	if (state.kind === "exited") {
		return state.exitCode === 0 ? { kind: "stopped" } : { kind: "crashed", exitCode: state.exitCode, signal: state.signal };
	}
	if (status === null) return { kind: "unknown" };
	switch (status.state) {
		case "working":
			return { kind: "working", progress: status.progress };
		case "blocked":
			return { kind: "needs-you", reason: status.kind };
		default:
			return { kind: status.state };
	}
}

/**
 * Whether a session gets a status mark of its own on the sidebar row and its
 * chip: every agent session, and any other running session whose program
 * reported a status. A plain shell with no status stays a count.
 */
export function hasStatusMark(session: Pick<TerminalSession, "kind" | "state" | "status"> & Partial<Pick<TerminalSession, "children">>): boolean {
	return session.kind === "agent" || (session.state.kind === "running" && (session.status !== null || notableChildren(session).length > 0));
}

/** A child record's status as shown. A child has no process of its own, so it is what it reported. */
export function shownChildStatus(child: ChildStatus): ShownStatus {
	switch (child.state) {
		case "working":
			return { kind: "working", progress: child.progress };
		case "blocked":
			return { kind: "needs-you", reason: child.kind };
		default:
			return { kind: child.state };
	}
}

/**
 * The children still at work: Working or Needs you, while the session runs.
 * Done, Idle, and Error children are listed but not counted, and an exited
 * session has none: its process, the source of truth, ended.
 */
export function runningChildren(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "children">>): ChildStatus[] {
	if (session.state.kind !== "running") return [];
	return (session.children ?? []).filter(child => child.state === "working" || child.state === "blocked");
}

/** The words for a number of child records, such as "1 task" or "3 tasks". A child can be a subagent or any background task, and the protocol does not say which. */
export function describeTaskCount(count: number): string {
	return count === 1 ? "1 task" : `${count} tasks`;
}

/**
 * The children that call for a look: the running ones, and those that
 * reported an error, while the session runs. They are what the count beside
 * the mark counts and what the descriptions say. Done and Idle ones are only
 * listed.
 */
export function notableChildren(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "children">>): ChildStatus[] {
	if (session.state.kind !== "running") return [];
	return (session.children ?? []).filter(child => child.state === "working" || child.state === "blocked" || child.state === "error");
}

/** The notable children's statuses summed up, such as "1 needs you, 1 error, 2 working", the most urgent first. Empty when there are none. */
export function summarizeChildren(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "children">>): string {
	return summarizeStatuses(notableChildren(session).map(shownChildStatus));
}

/**
 * The notable children in words, such as "4 tasks: 1 needs you, 1 error, 2
 * working", the most urgent first. Empty when there are none.
 */
export function describeNotableChildren(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "children">>): string {
	const notable = notableChildren(session);
	return notable.length === 0 ? "" : `${describeTaskCount(notable.length)}: ${summarizeChildren(session)}`;
}

/** Whether the root says Done or Idle while children still run, so "done" does not hide work going on. */
export function stillWorking(session: Pick<TerminalSession, "state" | "status"> & Partial<Pick<TerminalSession, "children">>): boolean {
	const kind = shownStatus(session).kind;
	return (kind === "done" || kind === "idle") && runningChildren(session).length > 0;
}

/** The small count beside a session's mark: how many children run or reported an error, and the most urgent of their statuses. Null when there are none. */
export function childBadge(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "children">>): { count: number; status: ShownStatus } | null {
	const statuses = notableChildren(session).map(shownChildStatus);
	const urgent = mostUrgent(statuses);
	if (urgent === null) return null;
	return { count: statuses.length, status: statuses.find(status => status.kind === urgent)! };
}

/**
 * The status that counts for alerts, the waiting list, and a collapsed
 * header, and the child it comes from, if any. A child that needs the person
 * counts as the session needing them. In order: an exited session is its
 * exit; a root that needs you; the first child, by path, that needs you; a
 * root that is done or reported an error; the first child that reported an
 * error; otherwise the root. Children never make a session Working, so a
 * background server cannot hold back a Done. Notifications keep following
 * the task they told about while it holds the same status (see
 * ./status-notices.ts), so they can name another task than this one; the
 * status is the same.
 */
export function alertStatus(session: Pick<TerminalSession, "state" | "status"> & Partial<Pick<TerminalSession, "children">>): { status: ShownStatus; child: ChildStatus | null } {
	const root = shownStatus(session);
	if (session.state.kind !== "running" || root.kind === "needs-you") return { status: root, child: null };
	const children = session.children ?? [];
	const blocked = children.find(child => child.state === "blocked");
	if (blocked !== undefined) return { status: shownChildStatus(blocked), child: blocked };
	if (root.kind === "done" || root.kind === "error") return { status: root, child: null };
	const failed = children.find(child => child.state === "error");
	if (failed !== undefined) return { status: shownChildStatus(failed), child: failed };
	return { status: root, child: null };
}

/** The name a child goes by: its title, or its path when it gave none. */
export function childName(child: Pick<ChildStatus, "id" | "title">): string {
	return child.title ?? child.id;
}

/** One child in words, such as "review: Needs you: approval. approve Write: src/a.ts". */
export function describeChild(child: ChildStatus): string {
	const words = `${childName(child)}: ${describeShownStatus(shownChildStatus(child))}`;
	return child.message === null ? words : `${words}. ${shortMessage(child.message)}`;
}

/** One row of the list of children: the child, how far it is indented, and what it is called there. */
export interface ChildRow {
	child: ChildStatus;
	depth: number;
	/** Its title, or its path from the record it sits under, such as `tests` under `review`. */
	label: string;
}

/**
 * The children as rows of a tree by path. A child sits under the nearest
 * record above it on its path; with none, it is at the top and its label is
 * its whole path. Children arrive ordered by path, so each comes after the
 * record it sits under.
 */
export function childRows(children: readonly ChildStatus[]): ChildRow[] {
	const depths = new Map<string, number>();
	return children.map(child => {
		const segments = child.id.split("/");
		let parent: string | null = null;
		for (let length = segments.length - 1; length > 0 && parent === null; length -= 1) {
			const path = segments.slice(0, length).join("/");
			if (depths.has(path)) parent = path;
		}
		const depth = parent === null ? 0 : depths.get(parent)! + 1;
		depths.set(child.id, depth);
		const path = parent === null ? child.id : child.id.slice(parent.length + 1);
		return { child, depth, label: child.title ?? path };
	});
}

const REASONS: Record<StatusKind, string> = { permission: "approval", question: "question", auth: "sign-in" };

/** The words for a status, such as "Working, 40%", "Needs you: approval", or "Crashed, exit 1". */
export function describeShownStatus(status: ShownStatus): string {
	switch (status.kind) {
		case "working":
			return status.progress === null ? "Working" : `Working, ${status.progress}%`;
		case "needs-you":
			return status.reason === null ? "Needs you" : `Needs you: ${REASONS[status.reason]}`;
		case "done":
			return "Done";
		case "idle":
			return "Idle";
		case "error":
			return "Error";
		case "stopped":
			return "Stopped";
		case "crashed":
			return status.exitCode !== null ? `Crashed, exit ${status.exitCode}` : status.signal ? `Crashed, ${status.signal}` : "Crashed";
		case "unknown":
			return "Running";
	}
}

/** The short words in a summary of several, such as "needs you" in "2 needs you". */
const SUMMARY_WORDS: Partial<Record<ShownStatusKind, string>> = {
	"needs-you": "needs you",
	"crashed": "crashed",
	"error": "error",
	"working": "working",
	"done": "done",
	"idle": "idle",
};

/** Which comes first, most urgent first. Stopped and unknown are not summed up. */
const URGENCY: readonly ShownStatusKind[] = ["needs-you", "crashed", "error", "working", "done", "idle"];

/**
 * A summary of several sessions' statuses for a collapsed repository header,
 * such as "1 needs you, 2 working", the most urgent first. Empty when none
 * of them has a state worth summing up.
 */
export function summarizeStatuses(statuses: readonly ShownStatus[]): string {
	const counts = new Map<ShownStatusKind, number>();
	for (const status of statuses) counts.set(status.kind, (counts.get(status.kind) ?? 0) + 1);
	return URGENCY.filter(kind => counts.has(kind)).map(kind => `${counts.get(kind)} ${SUMMARY_WORDS[kind]}`).join(", ");
}

/** The most urgent of several statuses, for the color of a summary. Null when there is none to sum up. */
export function mostUrgent(statuses: readonly ShownStatus[]): ShownStatusKind | null {
	return URGENCY.find(kind => statuses.some(status => status.kind === kind)) ?? null;
}

/** Agents the interface draws with their own icon instead of letters. */
export const AGENT_BRANDS = ["claude", "codex"] as const;
export type AgentBrand = typeof AGENT_BRANDS[number];

/**
 * The agent a session runs, when the app has an icon for it: Claude Code or
 * Codex, known by the executable of an agent session (`claude`, `codex`) or
 * by the `app` a program reports, such as `claude-code`. Null for anything
 * else, which keeps its letters.
 */
export function agentBrand(session: Pick<TerminalSession, "kind" | "shell" | "status">): AgentBrand | null {
	const executable = session.shell.split(/[\\/]/).filter(Boolean).at(-1) ?? "";
	const app = session.status?.app?.toLowerCase() ?? "";
	for (const brand of AGENT_BRANDS) {
		if ((session.kind === "agent" && executable === brand) || app.startsWith(brand)) return brand;
	}
	return null;
}

/** The most of a program's message that is shown, in characters. The protocol allows 2048 bytes. */
export const MESSAGE_SHOWN_LIMIT = 200;

/** A program's message cut to fit a tooltip, a description, or a notification. */
export function shortMessage(message: string): string {
	const characters = Array.from(message);
	return characters.length <= MESSAGE_SHOWN_LIMIT ? message : `${characters.slice(0, MESSAGE_SHOWN_LIMIT - 3).join("").trimEnd()}...`;
}

/**
 * What the window is told of a session's records: the root as it is, and
 * the children with each message cut to `MESSAGE_SHOWN_LIMIT`, so a change
 * carrying 255 children stays near 300 KB even with the longest titles.
 */
export function recordsForWindow(records: Pick<StatusRecords, "root" | "children">): Pick<TerminalSession, "status" | "children"> {
	return {
		status: records.root(),
		children: records.children().map(child => child.message === null ? child : { ...child, message: shortMessage(child.message) }),
	};
}

/**
 * Short labels for the marks on one row, in order: each session's first
 * letter, or as many of its first letters as tell it apart from the others,
 * up to three, so "Claude Code" and "Codex" are "Cl" and "Co".
 */
export function sessionInitials(names: readonly string[]): string[] {
	const letters = names.map(name => Array.from(name.replace(/\s+/g, "")));
	const label = (index: number, length: number) => {
		const shown = letters[index]!.slice(0, length).join("");
		return shown === "" ? "?" : shown[0]!.toUpperCase() + shown.slice(1).toLowerCase();
	};
	return letters.map((_, index) => {
		for (let length = 1; length < 3; length += 1) {
			const mine = label(index, length);
			if (letters.every((_, other) => other === index || label(other, length) !== mine)) return mine;
		}
		return label(index, 3);
	});
}

/**
 * A session's own status in words, with "tasks still running" when it says
 * Done or Idle while children run, such as "Done, tasks still running". No
 * count, so it can be a live region that does not speak on every change.
 */
export function describeSessionState(session: Pick<TerminalSession, "state" | "status"> & Partial<Pick<TerminalSession, "children">>): string {
	const words = describeShownStatus(shownStatus(session));
	return stillWorking(session) ? `${words}, tasks still running` : words;
}

/** One session's status in words, with its name, such as "Codex: Needs you: approval, approve Write: src/a.ts. 2 tasks: 2 working". */
export function describeSessionStatus(session: Pick<TerminalSession, "name" | "state" | "status"> & Partial<Pick<TerminalSession, "children">>): string {
	const words = describeSessionState(session);
	const full = session.state.kind === "running" ? session.status?.message ?? null : null;
	const message = full === null ? null : shortMessage(full);
	const children = describeNotableChildren(session);
	return [`${session.name}: ${words}`, message, children].filter(Boolean).join(". ");
}
