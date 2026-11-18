/**
 * The words and marks for what a session's program reported about itself
 * through the Program Status Protocol (see ./program-status.ts), and
 * for how the session ended. Everything here is pure.
 */
import type { StatusKind } from "./program-status";
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
export function hasStatusMark(session: Pick<TerminalSession, "kind" | "state" | "status">): boolean {
	return session.kind === "agent" || (session.state.kind === "running" && session.status !== null);
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

/** One session's status in words, with its name, such as "Codex: Needs you: approval, approve Write: src/a.ts". */
export function describeSessionStatus(session: Pick<TerminalSession, "name" | "state" | "status">): string {
	const words = describeShownStatus(shownStatus(session));
	const full = session.state.kind === "running" ? session.status?.message ?? null : null;
	const message = full === null ? null : shortMessage(full);
	return message === null ? `${session.name}: ${words}` : `${session.name}: ${words}. ${message}`;
}
