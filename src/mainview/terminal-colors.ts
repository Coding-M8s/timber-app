import { DEFAULT_DARK_THEME } from "../shared/builtin-themes";
import type { Theme } from "../shared/theme";

/**
 * The colors every terminal is drawn in: the theme's. It is its own small
 * module so the theme can be applied without loading the terminal, which is
 * loaded only once a terminal shows.
 */
export type TerminalColors = Theme["terminal"];

let colors: TerminalColors = DEFAULT_DARK_THEME.terminal;
const listeners = new Set<(colors: TerminalColors) => void>();

export function terminalColors(): TerminalColors {
	return colors;
}

/** Draw every terminal, and every later one, in these colors. */
export function setTerminalColors(next: TerminalColors): void {
	if (next === colors) return;
	colors = next;
	for (const listener of listeners) listener(colors);
}

/** Hear of every change of the colors. Returns how to stop. */
export function watchTerminalColors(listener: (colors: TerminalColors) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}
