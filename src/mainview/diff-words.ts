import type { DiffLine } from "../shared/file-changes";

/**
 * Which words changed inside an edited line of a diff. Each run of removed
 * lines is paired with the run of added lines right after it, line by line,
 * and each pair marks the one stretch between their shared start and end.
 * Pure, so it is tested without a window.
 */

/** A stretch of a line's text, by character offsets. */
export interface WordRange {
	from: number;
	to: number;
}

/** Fewer shared characters than this, or than this share of the shorter line, and the line counts as rewritten. */
const MIN_SHARED_CHARACTERS = 4;
const MIN_SHARED_SHARE = 0.3;

const isWord = (character: string | undefined) => character !== undefined && /[\p{L}\p{N}_$]/u.test(character);
const indent = (text: string) => text.length - text.trimStart().length;

/**
 * The changed stretch of a removed line and of the added line it became,
 * widened to whole words. Null for a side with nothing of its own, and for
 * both when the lines are the same or almost entirely different.
 */
export function wordRanges(removed: string, added: string): [WordRange | null, WordRange | null] {
	const shortest = Math.min(removed.length, added.length);
	let start = 0;
	while (start < shortest && removed[start] === added[start]) start++;
	let end = 0;
	while (end < shortest - start && removed[removed.length - 1 - end] === added[added.length - 1 - end]) end++;
	// A word changed in its middle is marked whole.
	while (start > 0 && isWord(removed[start - 1]) && (isWord(removed[start]) || isWord(added[start]))) start--;
	while (end > 0 && isWord(removed[removed.length - end]) && (isWord(removed[removed.length - end - 1]) || isWord(added[added.length - end - 1]))) end--;

	const removedRange = removed.length - end > start ? { from: start, to: removed.length - end } : null;
	const addedRange = added.length - end > start ? { from: start, to: added.length - end } : null;
	if (removedRange === null && addedRange === null) return [null, null];
	// Shared indentation says nothing about whether the code is alike.
	const shared = start - Math.min(start, indent(removed), indent(added)) + end;
	const shorter = Math.min(removed.trim().length, added.trim().length);
	if (shared < MIN_SHARED_CHARACTERS || shared < shorter * MIN_SHARED_SHARE) return [null, null];
	return [removedRange, addedRange];
}

/** For each line of a hunk, the stretch of it that changed, or null. Git's notes are skipped over when pairing. */
export function changedWords(lines: readonly DiffLine[]): (WordRange | null)[] {
	const ranges: (WordRange | null)[] = lines.map(() => null);
	let at = 0;
	const run = (kind: "removed" | "added") => {
		const found: number[] = [];
		while (at < lines.length && (lines[at]!.kind === kind || lines[at]!.kind === "note")) {
			if (lines[at]!.kind === kind) found.push(at);
			at++;
		}
		return found;
	};
	while (at < lines.length) {
		if (lines[at]!.kind !== "removed") {
			at++;
			continue;
		}
		const removed = run("removed");
		const added = run("added");
		for (let pair = 0; pair < Math.min(removed.length, added.length); pair++) {
			const [one, other] = wordRanges(lines[removed[pair]!]!.text, lines[added[pair]!]!.text);
			ranges[removed[pair]!] = one;
			ranges[added[pair]!] = other;
		}
	}
	return ranges;
}
