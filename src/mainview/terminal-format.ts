import { type TerminalSession, describeTerminalExit, sessionKindName } from "../shared/terminal";

export { describeQuitRequest } from "../shared/terminal";

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

/** The hint beside a session: how copy, paste, links, and moving between sessions work here. */
export function terminalHint(mac: boolean): string {
	return mac
		? "Cmd+C copies, Cmd+V pastes, Cmd+click opens a link, Cmd+Shift+[ and ] switch sessions, Cmd+Shift+S goes to the chips"
		: "Ctrl+Shift+C copies, Ctrl+Shift+V pastes, Ctrl+click opens a link, Ctrl+PageUp and PageDown switch sessions, Ctrl+Shift+S goes to the chips";
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

/** The element id of a session's chip, so focus can be put on it from anywhere. */
export function sessionChipId(id: string): string {
	return `session-chip-${id}`;
}

/** The short mark on the chip of a session that ended, such as "exit 0". */
export function shortExit(state: TerminalSession["state"]): string | null {
	if (state.kind === "running") return null;
	if (state.exitCode !== null) return `exit ${state.exitCode}`;
	return state.signal ?? "ended";
}

/** The words for a session's state on its chip. */
export function describeTerminalState(session: Pick<TerminalSession, "state">): string {
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
 * it ended, and whether it printed since it was last on screen. The same
 * words are the chip's tooltip.
 */
export function describeSessionChip(session: Pick<TerminalSession, "kind" | "name" | "state" | "shell">, unseen: boolean): string {
	const parts = [`${sessionKindName(session.kind)}, ${shellName(session.shell)}`];
	if (session.state.kind === "exited") parts.push(describeTerminalExit(session.state));
	if (unseen) parts.push("New output since you last looked");
	return parts.join(". ");
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
