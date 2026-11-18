import { type TerminalAppearance, defaultTerminalAppearance, fontIsInstalled, sameTerminalAppearance } from "../shared/terminal-appearance";

/**
 * The font, text size, and cursor every terminal is drawn with: the saved
 * ones from Settings, Terminal. It is its own small module, as the colors
 * are, so the interface can set it without loading the terminal, which is
 * loaded only once a terminal shows.
 */

let appearance: TerminalAppearance = defaultTerminalAppearance();
const listeners = new Set<(appearance: TerminalAppearance) => void>();

export function terminalAppearance(): TerminalAppearance {
	return appearance;
}

/** Draw every terminal, and every later one, like this. */
export function setTerminalAppearance(next: TerminalAppearance): void {
	if (sameTerminalAppearance(next, appearance)) return;
	appearance = next;
	for (const listener of listeners) listener(appearance);
}

/** Hear of every change of the appearance. Returns how to stop. */
export function watchTerminalAppearance(listener: (appearance: TerminalAppearance) => void): () => void {
	listeners.add(listener);
	return () => listeners.delete(listener);
}

let canvas: CanvasRenderingContext2D | null | undefined;

/**
 * Whether this computer has the font family, measured in a canvas. True when
 * it cannot be measured, so Settings never warns without cause.
 */
export function terminalFontInstalled(fontFamily: string): boolean {
	if (canvas === undefined) canvas = typeof document === "undefined" ? null : document.createElement("canvas").getContext("2d");
	const context = canvas;
	if (context === null) return true;
	return fontIsInstalled(fontFamily, font => {
		context.font = font;
		return context.measureText("mmmmmmmmmmlli10OWW@#").width;
	});
}
