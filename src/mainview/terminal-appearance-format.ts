import {
	DEFAULT_TERMINAL_FONT, MAX_TERMINAL_FONT_LENGTH, MAX_TERMINAL_FONT_SIZE, MIN_TERMINAL_FONT_SIZE, type TerminalAppearance, type TerminalCursor,
	readTerminalFont, readTerminalFontSize, sameTerminalAppearance,
} from "../shared/terminal-appearance";
import type { SessionNaming } from "../shared/terminal";

/**
 * The words and the rules of Settings, Terminal, apart from drawing it.
 * Everything here is pure.
 */

export const TERMINAL_CURSOR_LABELS: Record<TerminalCursor, string> = {
	block: "Block",
	bar: "Bar",
};

export const TERMINAL_CURSOR_HINTS: Record<TerminalCursor, string> = {
	block: "Fills the whole cell.",
	bar: "A thin line before the cell.",
};

export const SESSION_NAMING_LABELS: Record<SessionNaming, string> = {
	plain: "Terminal or the agent",
	branch: "Branch",
	issue: "Issue key",
};

export const SESSION_NAMING_HINTS: Record<SessionNaming, string> = {
	plain: "Terminal, Terminal 2, Codex, and so on.",
	branch: "The worktree's branch, such as feature-login or Codex: feature-login.",
	issue: "The issue key in the branch, such as GH-122 or Codex: GH-122, or #122 for a branch that starts with a number. A branch with no key gives its name.",
};

/** What the fields hold, as typed. */
export interface TerminalDraft {
	fontFamily: string;
	fontSize: string;
	cursor: TerminalCursor;
}

export function terminalDraftOf(appearance: TerminalAppearance): TerminalDraft {
	return { fontFamily: appearance.fontFamily, fontSize: String(appearance.fontSize), cursor: appearance.cursor };
}

export interface TerminalDraftModel {
	/** What Save writes, or null while a field cannot be saved. A size outside the limits is clamped. */
	appearance: TerminalAppearance | null;
	canSave: boolean;
	/** Which field cannot be saved, or null. */
	invalid: "font" | "size" | null;
	/** Why that field cannot be saved, or null. */
	error: string | null;
}

export function terminalDraftModel(draft: TerminalDraft, saved: TerminalAppearance): TerminalDraftModel {
	const fontFamily = readTerminalFont(draft.fontFamily);
	if (fontFamily === undefined) {
		const error = draft.fontFamily.trim().length > MAX_TERMINAL_FONT_LENGTH
			? `A font name has at most ${MAX_TERMINAL_FONT_LENGTH} characters.`
			: "Type one font's name, without quotes, commas, or semicolons. The app adds the fallback fonts itself.";
		return { appearance: null, canSave: false, invalid: "font", error };
	}
	const text = draft.fontSize.trim();
	const fontSize = /^\d+(\.\d+)?$/.test(text) ? readTerminalFontSize(Number(text)) : undefined;
	if (fontSize === undefined) {
		return { appearance: null, canSave: false, invalid: "size", error: `The text size is a number from ${MIN_TERMINAL_FONT_SIZE} to ${MAX_TERMINAL_FONT_SIZE}.` };
	}
	const appearance = { fontFamily, fontSize, cursor: draft.cursor };
	return { appearance, canSave: !sameTerminalAppearance(appearance, saved), invalid: null, error: null };
}

/** The note under the font field when the family is not on this computer, or null. */
export function missingFontNote(fontFamily: string, installed: boolean): string | null {
	const family = fontFamily.trim();
	if (installed || family === "") return null;
	return `${family} is not installed on this computer, so terminals use ${DEFAULT_TERMINAL_FONT}. Check the name as your system lists it, such as "JetBrainsMono Nerd Font".`;
}
