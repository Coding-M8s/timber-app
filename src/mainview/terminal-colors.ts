import { DEFAULT_DARK_THEME } from "../shared/builtin-themes";
import type { Theme } from "../shared/theme";

/**
 * The colors every terminal is drawn in: the theme's. It is its own small
 * module so the theme can be applied without loading the terminal, which is
 * loaded only once a terminal shows.
 */
export type TerminalColors = Theme["terminal"];

/**
 * The least contrast, as WCAG 2 measures it, of a terminal's text on its
 * cell's background: AA for text. Where a program's color is fainter, as the
 * grey agents print often is, xterm draws a lighter or darker shade of it, so
 * each color keeps its hue. xterm halves the minimum for dim text, which it
 * draws faint on purpose, and leaves box and block characters as they are.
 */
export const TERMINAL_MINIMUM_CONTRAST = 4.5;

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
