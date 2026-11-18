/**
 * How terminals are drawn: the font family, the text size, and the cursor's
 * shape, chosen in Settings, Terminal. Everything here is pure.
 */

/** The font every terminal uses unless another is chosen. It is built into the app. */
export const DEFAULT_TERMINAL_FONT = "Geist Mono";
export const DEFAULT_TERMINAL_FONT_SIZE = 13;
export const MIN_TERMINAL_FONT_SIZE = 10;
export const MAX_TERMINAL_FONT_SIZE = 24;
/** A family name longer than this is not a font name. */
export const MAX_TERMINAL_FONT_LENGTH = 200;

/** The shapes the cursor can take: a cell-sized block, or a thin line before the cell. */
export const TERMINAL_CURSORS = ["block", "bar"] as const;
export type TerminalCursor = typeof TERMINAL_CURSORS[number];

export interface TerminalAppearance {
	/** The family as the person typed it, or the empty string for the built-in Geist Mono. */
	fontFamily: string;
	/** In CSS pixels, from MIN_TERMINAL_FONT_SIZE to MAX_TERMINAL_FONT_SIZE. */
	fontSize: number;
	cursor: TerminalCursor;
}

/**
 * The fonts after the chosen one: the built-in Geist Mono, which stands in
 * for a family that is not installed, then the icon fonts, for the symbols
 * prompts and agents print that Geist Mono does not have.
 */
const FALLBACK_FONTS = ["\"Geist Mono\"", "\"Symbols Nerd Font Mono\"", "\"Symbols Nerd Font\"", "ui-monospace", "\"Cascadia Code\"", "Consolas", "monospace"];

/** How much of the cell xterm gives one character, as a share of the text size, for estimating before a terminal is drawn. */
const CELL_WIDTH = 0.6;
/** The line height every terminal is drawn with. */
export const TERMINAL_LINE_HEIGHT = 1.2;

export function defaultTerminalAppearance(): TerminalAppearance {
	return { fontFamily: "", fontSize: DEFAULT_TERMINAL_FONT_SIZE, cursor: "block" };
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * A family name from outside, trimmed, or undefined when it cannot be one:
 * not text, too long, or with a character that would end the name in CSS or
 * start a list of fonts. The name of the built-in font is kept as empty, so
 * it reads as the default.
 */
export function readTerminalFont(value: unknown): string | undefined {
	if (typeof value !== "string") return undefined;
	const family = value.trim();
	if (family.length > MAX_TERMINAL_FONT_LENGTH || /["',;\\{}<>\p{Cc}]/u.test(family)) return undefined;
	return family.toLowerCase() === DEFAULT_TERMINAL_FONT.toLowerCase() ? "" : family;
}

/** A text size from outside, whole and within the limits, or undefined when it is not a number. */
export function readTerminalFontSize(value: unknown): number | undefined {
	if (typeof value !== "number" || !Number.isFinite(value)) return undefined;
	return Math.min(MAX_TERMINAL_FONT_SIZE, Math.max(MIN_TERMINAL_FONT_SIZE, Math.round(value)));
}

export function readTerminalCursor(value: unknown): TerminalCursor | undefined {
	return TERMINAL_CURSORS.includes(value as TerminalCursor) ? value as TerminalCursor : undefined;
}

/**
 * The appearance from outside, or undefined when any part of it cannot be
 * read, so a save from Settings is refused instead of keeping something else.
 * A size outside the limits is clamped, not refused.
 */
export function readTerminalAppearance(value: unknown): TerminalAppearance | undefined {
	if (!isRecord(value)) return undefined;
	const fontFamily = readTerminalFont(value.fontFamily);
	const fontSize = readTerminalFontSize(value.fontSize);
	const cursor = readTerminalCursor(value.cursor);
	if (fontFamily === undefined || fontSize === undefined || cursor === undefined) return undefined;
	return { fontFamily, fontSize, cursor };
}

/** What the settings file keeps of an appearance it cannot read whole: each part that can be read, and the default for the rest. */
export function salvageTerminalAppearance(value: unknown): TerminalAppearance {
	const fallback = defaultTerminalAppearance();
	if (!isRecord(value)) return fallback;
	return {
		fontFamily: readTerminalFont(value.fontFamily) ?? fallback.fontFamily,
		fontSize: readTerminalFontSize(value.fontSize) ?? fallback.fontSize,
		cursor: readTerminalCursor(value.cursor) ?? fallback.cursor,
	};
}

export function sameTerminalAppearance(one: TerminalAppearance, other: TerminalAppearance): boolean {
	return one.fontFamily === other.fontFamily && one.fontSize === other.fontSize && one.cursor === other.cursor;
}

export function writeTerminalAppearance(appearance: TerminalAppearance): Record<string, unknown> {
	return { fontFamily: appearance.fontFamily, fontSize: appearance.fontSize, cursor: appearance.cursor };
}

/** The family as CSS takes it: the chosen one first, then the fallbacks. */
export function terminalFontStack(fontFamily: string): string {
	return fontFamily === "" ? FALLBACK_FONTS.join(", ") : [`"${fontFamily}"`, ...FALLBACK_FONTS].join(", ");
}

/**
 * Whether a family is installed, from the width of the same text drawn with
 * it and with two generic families as stand-ins. A family the system does
 * not have is drawn in the stand-in, so both widths match the stand-ins'.
 * `measure` draws the text in a CSS font and returns its width.
 */
export function fontIsInstalled(fontFamily: string, measure: (font: string) => number): boolean {
	if (fontFamily === "") return true;
	return ["monospace", "serif"].some(generic => measure(`72px "${fontFamily}", ${generic}`) !== measure(`72px ${generic}`));
}

/** The columns and rows a terminal of this size will about have, before it is drawn and can measure itself. */
export function estimateTerminalCells(width: number, height: number, fontSize: number): { cols: number; rows: number } {
	if (width === 0 || height === 0) return { cols: 80, rows: 24 };
	// The row of chips and the terminal's padding take about 50 pixels, and the sides 16.
	return {
		cols: Math.max(20, Math.floor((width - 16) / (fontSize * CELL_WIDTH))),
		rows: Math.max(5, Math.floor((height - 50) / (fontSize * TERMINAL_LINE_HEIGHT))),
	};
}
