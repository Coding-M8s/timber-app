import { type AgentBrand, type ShownStatus, agentBrand, childBadge, describeNotableChildren, describeSessionState, describeSessionStatus, hasStatusMark, sessionInitials, shortMessage, shownStatus, urgencyRank } from "../shared/session-status";
import { type EndedAgent, type TerminalSession, describeAgentExit, describeTerminalExit, sessionKindName } from "../shared/terminal";
import { type SeenStatuses, isSeen } from "./seen-status";

export { describeQuitRequest } from "../shared/terminal";

/** A line for the terminals that end with the app, as when it quits to uninstall or restart, or null when none runs. */
export function describeEndingTerminals(live: number): string | null {
	if (live <= 0) return null;
	return live === 1 ? "1 terminal is running and will be ended." : `${live} terminals are running and will be ended.`;
}

/** How many terminal and agent sessions still run, which end when the app quits. */
export function liveTerminalCount(sessions: readonly TerminalSession[]): number {
	return sessions.filter(session => session.state.kind === "running").length;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/**
 * Copy and paste keys. In a terminal, Ctrl+C and Ctrl+V belong to the
 * program, so on Linux and Windows copying is Ctrl+Shift+C and pasting is
 * Ctrl+Shift+V, as in most terminals. On macOS they are Cmd+C and Cmd+V.
 */
export function clipboardKey(event: Keys, mac: boolean): "copy" | "paste" | null {
	if (event.type !== "keydown" || event.altKey) return null;
	const modified = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && event.shiftKey && !event.metaKey;
	if (!modified) return null;
	const key = event.key.toLowerCase();
	return key === "c" ? "copy" : key === "v" ? "paste" : null;
}

/** What Alt+Enter sends: ESC then CR, which agent CLIs and shells read as a new line rather than a submit. */
export const NEW_LINE_INPUT = "\x1b\r";

/**
 * Shift+Enter with no other modifier adds a new line, the same as Alt+Enter,
 * as in chat boxes. Only the key press counts, so one press adds one line.
 */
export function newLineKey(event: Keys): boolean {
	return event.type === "keydown" && event.key === "Enter" && event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey;
}

/** A link in a terminal opens on a click with Ctrl held, or Cmd on macOS, so a click to select text never opens one. */
export function opensLink(event: Pick<MouseEvent, "ctrlKey" | "metaKey">, mac: boolean): boolean {
	return mac ? event.metaKey : event.ctrlKey;
}

/**
 * Keys a terminal leaves to the app, to move between sessions without
 * leaving the keyboard: the previous or next session of the worktree, and
 * the chips, since Tab belongs to the program. Ctrl+PageUp and Ctrl+PageDown
 * as in most terminals and browsers, and Ctrl+Shift+S for the chips; on
 * macOS Cmd+Shift+[ and Cmd+Shift+], and Cmd+Shift+S.
 */
export function sessionKey(event: Keys, mac: boolean): "previous" | "next" | "chips" | null {
	if (event.type !== "keydown" || event.altKey) return null;
	const key = event.key;
	if (mac) {
		if (!event.metaKey || event.ctrlKey || !event.shiftKey) return null;
		if (key === "[" || key === "{") return "previous";
		if (key === "]" || key === "}") return "next";
		return key.toLowerCase() === "s" ? "chips" : null;
	}
	if (!event.ctrlKey || event.metaKey) return null;
	if (!event.shiftKey && key === "PageUp") return "previous";
	if (!event.shiftKey && key === "PageDown") return "next";
	return event.shiftKey && key.toLowerCase() === "s" ? "chips" : null;
}

/**
 * The session a key on a focused chip moves to, from `current` among `ids`:
 * the arrows step and wrap around, Home and End jump to the first and the
 * last. Null for any other key.
 */
export function chipAfterKey(ids: readonly string[], current: string, key: string): string | null {
	const count = ids.length;
	const index = ids.indexOf(current);
	if (count === 0 || index === -1) return null;
	switch (key) {
		case "ArrowRight":
			return ids[(index + 1) % count]!;
		case "ArrowLeft":
			return ids[(index + count - 1) % count]!;
		case "Home":
			return ids[0]!;
		case "End":
			return ids[count - 1]!;
		default:
			return null;
	}
}

/** What another key on a focused chip does, as for closable tabs: Delete closes, F2 renames. */
export function chipCommand(key: string): "close" | "rename" | null {
	return key === "Delete" ? "close" : key === "F2" ? "rename" : null;
}

/** What a mouse button other than the main one does on a chip: a middle click closes it, as for tabs in a browser. */
export function chipButtonCommand(button: number): "close" | null {
	return button === 1 ? "close" : null;
}

/**
 * What closing a chip shows and where the keyboard goes. Closing the shown
 * chip shows the next open one after it, else the one before; closing another
 * keeps the shown one, which takes the focus. `show` is null when the shown
 * session stays, `focus` is null when no chip is left (then "+" takes it).
 * Null for a chip already being closed: that close does nothing.
 */
export function chipAfterClose(
	ids: readonly string[],
	id: string,
	{ shownId, closing, closingIds }: { shownId: string; closing: boolean; closingIds: readonly string[] },
): { show: string | null; focus: string | null } | null {
	if (closing) return null;
	if (id !== shownId) return { show: null, focus: shownId };
	const at = ids.indexOf(id);
	const open = (candidate: string) => !closingIds.includes(candidate);
	const next = ids.slice(at + 1).find(open) ?? ids.slice(0, at).reverse().find(open) ?? null;
	return { show: next, focus: next };
}

/** The element id of a session's chip, so focus can be put on it from anywhere. */
export function sessionChipId(id: string): string {
	return `session-chip-${id}`;
}

/**
 * The short mark on the chip of a session that ended, such as "exit 0". A
 * running session that went on as a shell after its agent ended
 * (`endedAgent`) shows how the agent ended, until the shell itself ends.
 */
export function shortExit(state: TerminalSession["state"], endedAgent?: Pick<EndedAgent, "exitCode" | "signal">): string | null {
	if (state.kind === "running") return endedAgent === undefined ? null : shortExit({ kind: "exited", exitCode: endedAgent.exitCode, signal: endedAgent.signal });
	if (state.exitCode !== null) return `exit ${state.exitCode}`;
	return state.signal ?? "ended";
}

/**
 * The words for a session's state beside its chips. A running agent still
 * waiting to be ready for its prompt chop or review says so, unless it waits
 * on the person. A session with a status mark says its status, such as
 * "Needs you: approval"; another says whether it runs or how it ended.
 */
export function describeTerminalState(session: Pick<TerminalSession, "state"> & Partial<Pick<TerminalSession, "kind" | "status" | "children" | "prompt" | "endedAgent">>): string {
	// Waiting is said until the text went, unless the agent asks the person something meanwhile, such as whether to trust the folder.
	if (session.state.kind === "running" && session.prompt?.state === "pending" && session.status?.state !== "blocked") {
		return session.prompt.what === "review" ? "Waiting to paste the review" : "Waiting to send the prompt";
	}
	if (session.kind !== undefined && session.status !== undefined) {
		const full = { kind: session.kind, state: session.state, status: session.status, children: session.children ?? [], ...(session.endedAgent ? { endedAgent: session.endedAgent } : {}) };
		if (hasStatusMark(full)) {
			const status = shownStatus(full);
			// How it ended is said in the same words as for any session, so a crash names its code.
			if (status.kind === "crashed" && session.state.kind === "exited") return `Crashed. ${describeTerminalExit(session.state)}`;
			if (status.kind === "crashed" && session.endedAgent !== undefined) return `Crashed. ${describeAgentExit(session.endedAgent)}`;
			// No count here: this is a live region, and a count would be spoken at every change of the children.
			return describeSessionState(full);
		}
	}
	return session.state.kind === "running" ? "Running" : describeTerminalExit(session.state);
}

/** The shell's name, such as `zsh` for `/usr/bin/zsh`. */
export function shellName(shell: string): string {
	return shell.split(/[\\/]/).filter(Boolean).at(-1) ?? shell;
}

/** What the close control of a session says it does. */
export function closeTerminalLabel(session: Pick<TerminalSession, "state" | "name">): string {
	return session.state.kind === "running" ? `Close ${session.name} and end its processes` : `Dismiss ${session.name}`;
}

/**
 * What a chip says to assistive technology, beyond its name: its kind, how
 * it ended, whether the person has seen its status, and whether it printed
 * since it was last on screen. The same words are the chip's tooltip.
 */
export function describeSessionChip(session: Pick<TerminalSession, "kind" | "name" | "state" | "shell"> & Partial<Pick<TerminalSession, "status" | "children" | "endedAgent">>, unseen: boolean, seen = false): string {
	const parts = [`${sessionKindName(session.kind)}, ${shellName(session.shell)}`];
	const status = session.status === undefined ? null : { kind: session.kind, state: session.state, status: session.status, children: session.children ?? [], ...(session.endedAgent ? { endedAgent: session.endedAgent } : {}) };
	const ended = session.state.kind === "running" ? session.endedAgent : undefined;
	// A shell that took over from an agent says so, in the words the agent's end has everywhere else.
	if (ended !== undefined) parts.push(`${ended.name} ended`, describeAgentExit(ended), "Now a shell");
	if (status !== null && hasStatusMark(status) && session.state.kind === "running") {
		// A running agent that never reported says nothing more, as before the protocol. The end of an agent was said just above.
		const shown = shownStatus(status);
		if (shown.kind !== "unknown" && !(ended !== undefined && session.status === null)) parts.push(describeSessionState(status, seen));
		// What the program said, such as "approve Write: src/a.ts". It was cleaned up when it was read.
		if (session.status?.message) parts.push(shortMessage(session.status.message));
		// Its children that run or reported an error, such as "3 tasks: 1 needs you, 2 working".
		const children = describeNotableChildren(status);
		if (children !== "") parts.push(children);
	} else if (status !== null && hasStatusMark(status) && shownStatus(status).kind === "crashed" && session.state.kind === "exited") {
		parts.push(seen ? `Crashed, seen. ${describeTerminalExit(session.state)}` : `Crashed. ${describeTerminalExit(session.state)}`);
	} else if (session.state.kind === "exited") parts.push(describeTerminalExit(session.state));
	if (unseen) parts.push("New output since you last looked");
	return parts.join(". ");
}

/** One session with a status mark on a sidebar row: its initial, its status, and its name and status in words. */
export interface RowSessionMark {
	id: string;
	/** Such as "C" for "Codex", or "Co" beside "Claude Code" (see `sessionInitials`). */
	initial: string;
	/** The agent's icon to show instead of `initial`, or null for letters. */
	brand: AgentBrand | null;
	status: ShownStatus;
	/** How many of its children run or reported an error, and the most urgent of their statuses, or null when there are none. */
	badge: { count: number; status: ShownStatus } | null;
	/** Whether the person has seen this Done, Error, or crash (see ../seen-status.ts). */
	seen: boolean;
	/** Such as "Codex: Needs you: approval. approve Write: src/a.ts. 2 tasks: 2 working", or "Codex: Done, seen". */
	words: string;
}

/**
 * How many places a sidebar row has for marks. With more marks than that, one
 * place goes to a count of the rest, such as "+4", so the row stays inside a
 * narrow sidebar (issue 240).
 */
export const ROW_AGENT_MARKS = 3;

/**
 * What a sidebar row shows of its worktree's sessions: a mark for each agent
 * and each session whose program reported a status, in the order they
 * started, a count of the other running sessions, and all of it as one
 * sentence for the row's description. `marks` holds every one. Past
 * `ROW_AGENT_MARKS`, the row shows only `shown`, the most urgent marks, the
 * earliest first among equals, and `hidden` counts and names the rest. The
 * sentence always names every one.
 */
export function describeRowSessions(sessions: readonly TerminalSession[], seen: SeenStatuses = {}): { marks: RowSessionMark[]; shown: RowSessionMark[]; hidden: { count: number; words: string }; others: number; othersWords: string; sentence: string } {
	const marked = sessions.filter(hasStatusMark);
	const brands = marked.map(agentBrand);
	// Only the sessions shown as letters need telling apart by them.
	const lettered = marked.filter((_, index) => brands[index] === null);
	const initials = sessionInitials(lettered.map(session => session.name));
	const marks = marked.map((session, index) => {
		const wasSeen = isSeen(seen, session);
		return {
			id: session.id,
			initial: brands[index] === null ? initials[lettered.indexOf(session)]! : "",
			brand: brands[index]!,
			status: shownStatus(session),
			badge: childBadge(session),
			seen: wasSeen,
			words: describeSessionStatus(session, wasSeen),
		};
	});
	const others = sessions.filter(session => !hasStatusMark(session) && session.state.kind === "running").length;
	const othersWords = others === 0 ? "" : marks.length > 0 ? describeOtherSessions(others) : describeRunningSessions(others);
	const parts = marks.map(mark => `${mark.words}.`);
	if (others > 0) parts.push(`${othersWords}.`);
	const { shown, hidden } = fitMarks(marks);
	return { marks, shown, hidden, others, othersWords, sentence: parts.join(" ") };
}

/** The marks a row has places for, as `describeRowSessions` says, and the rest as a count with their words. */
function fitMarks(marks: readonly RowSessionMark[]): { shown: RowSessionMark[]; hidden: { count: number; words: string } } {
	if (marks.length <= ROW_AGENT_MARKS) return { shown: [...marks], hidden: { count: 0, words: "" } };
	// A child that needs the person makes its session need them too. An unseen status asks more of the person than the same status seen.
	const rank = (mark: RowSessionMark) => Math.min(urgencyRank(mark.status.kind) * 2 + (mark.seen ? 1 : 0), mark.badge ? urgencyRank(mark.badge.status.kind) * 2 : Infinity);
	const kept = new Set([...marks].sort((one, other) => rank(one) - rank(other)).slice(0, ROW_AGENT_MARKS - 1));
	const rest = marks.filter(mark => !kept.has(mark));
	const words = `${rest.length} more: ${rest.map(mark => `${mark.words}.`).join(" ")}`;
	return { shown: marks.filter(mark => kept.has(mark)), hidden: { count: rest.length, words } };
}

/** The words for running sessions beside agents, such as "2 other sessions running". */
export function describeOtherSessions(count: number): string {
	return count === 1 ? "1 other session running" : `${count} other sessions running`;
}

/** The sidebar's words for how many sessions of a worktree run, such as "2 sessions running". */
export function describeRunningSessions(count: number): string {
	return count === 1 ? "1 session running" : `${count} sessions running`;
}

/** The warning in the Done dialog for a worktree where sessions still run. */
export function describeDoneSessionsWarning(running: number): string {
	return running === 1
		? "A session is running in this worktree. Removing the worktree ends it and everything running in it."
		: `${running} sessions are running in this worktree. Removing the worktree ends them and everything running in them.`;
}

/**
 * Whether output leaves the terminal on the alternate screen, which
 * full-screen programs such as vim, less, and htop draw on. They switch to it
 * with `CSI ? 1049 h` (or the older 1047 and 47) and back with `l`.
 */
export function leftInAlternateScreen(data: string): boolean {
	let on = -1;
	let off = -1;
	for (const mode of ["1049", "1047", "47"]) {
		on = Math.max(on, data.lastIndexOf(`\x1b[?${mode}h`));
		off = Math.max(off, data.lastIndexOf(`\x1b[?${mode}l`));
	}
	return on > off;
}

/** The toast when running sessions ended because their worktree is no longer listed. One per worktree. */
export function describeOrphanTerminal(path: string, count = 1): string {
	const what = count === 1 ? "the session" : `${count} sessions`;
	return `Ended ${what} in ${path}, because Timber no longer lists that worktree`;
}

/** The toast when sessions saved at the last quit could not be opened again, such as an agent no longer in Settings. */
export function describeRestoreFailures(count: number): string {
	return `Could not open ${count === 1 ? "a session" : `${count} sessions`} from the last time again`;
}
