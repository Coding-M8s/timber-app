import { type TerminalSession, describeTerminalExit } from "../shared/terminal";

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

/** The hint beside a session: how copy, paste, and links work here. */
export function terminalHint(mac: boolean): string {
	return mac
		? "Cmd+C copies, Cmd+V pastes, Cmd+click opens a link"
		: "Ctrl+Shift+C copies, Ctrl+Shift+V pastes, Ctrl+click opens a link";
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
export function closeTerminalLabel(session: Pick<TerminalSession, "state">): string {
	return session.state.kind === "running" ? "Close terminal and end its processes" : "Dismiss this terminal";
}

/** The warning in the Done dialog for a worktree whose terminal still runs. */
export const DONE_TERMINAL_WARNING = "A terminal is running in this worktree. Removing the worktree ends it and everything running in it.";

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

/** The toast when a terminal ended because its worktree is no longer listed. */
export function describeOrphanTerminal(path: string): string {
	return `Ended the terminal in ${path}, because Timber no longer lists that worktree`;
}
