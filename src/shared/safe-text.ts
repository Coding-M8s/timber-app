/**
 * Text that is shown to the person and then sent to a terminal: what it says
 * must be what they saw. Pure, shared by chops (./chops.ts) and review notes
 * (./review.ts), and by the main process before it pastes into a session.
 */

/**
 * Line breaks and tabs only: every other control character (C0, DEL, C1),
 * every invisible format character (`\p{Cf}`: bidirectional overrides and
 * isolates, zero-width spaces, tag characters) except the zero-width joiner
 * that emoji are made with, and the line and paragraph separators. An escape
 * sequence could end a bracketed paste early, and an override could hide
 * what the text says.
 */
export const FORBIDDEN_IN_TEXT = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f\u2028\u2029]|(?!\u200d)\p{Cf}/u;
/** The same, and no line breaks or tabs either, for one line. */
export const FORBIDDEN_IN_LINE = /[\u0000-\u001f\u007f-\u009f\u2028\u2029]|(?!\u200d)\p{Cf}/u;

/** Whether text holds only what it may show: line breaks, tabs, and visible characters, with no lone surrogate. */
export function isSafeText(text: string): boolean {
	return !FORBIDDEN_IN_TEXT.test(text) && text.isWellFormed();
}

/** Whether one line holds only visible characters: no line break, no tab, no lone surrogate. */
export function isSafeLine(text: string): boolean {
	return !FORBIDDEN_IN_LINE.test(text) && text.isWellFormed();
}

const FORBIDDEN_IN_LINE_ALL = new RegExp(FORBIDDEN_IN_LINE.source, "gu");

/**
 * One line of someone else's text, such as a line of a file or a path, made
 * safe to show and send: a tab stays, and every character `isSafeLine`
 * refuses, and every lone surrogate, becomes U+FFFD, so it is seen to be
 * there and can never act.
 */
export function cleanLine(text: string): string {
	return text.toWellFormed().replace(FORBIDDEN_IN_LINE_ALL, character => character === "\t" ? "\t" : "\ufffd");
}
