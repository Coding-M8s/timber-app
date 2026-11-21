import { describe, expect, test } from "bun:test";
import type { DiffLine, FileDiff, FileChangeTarget } from "../src/shared/file-changes";
import {
	NOTE_LINE_LIMIT, OUTDATED_MARK, QUOTE_LENGTH_LIMIT, type ReviewNote, buildReviewMessage, chooseNoteLine, markOutdated, normalizeNoteText, notableLine, notedFiles, notedLines, noteLinesShown, noteLocation, noteProblem, noteSpan, quoteLine, quotedParts,
} from "../src/shared/review";
import { cleanLine } from "../src/shared/safe-text";
import { PASTE_TEXT_LIMIT, bracketedPaste, createPasteModeScanner, pasteProblem } from "../src/shared/terminal";

const file: FileChangeTarget = { area: "base", path: "src/a.ts", previousPath: null };
const context = (text: string, oldLine: number, newLine: number): DiffLine => ({ kind: "context", text, oldLine, newLine });
const added = (text: string, newLine: number): DiffLine => ({ kind: "added", text, oldLine: null, newLine });
const removed = (text: string, oldLine: number): DiffLine => ({ kind: "removed", text, oldLine, newLine: null });

const hunk: DiffLine[] = [
	context("import x from \"x\";", 1, 1),
	removed("const a = 1;", 2),
	added("const a = 2;", 2),
	added("const b = 3;", 3),
	{ kind: "note", text: "No newline at end of file", oldLine: null, newLine: null },
];

function note(lines: DiffLine[], text: string, overrides: Partial<ReviewNote> = {}): ReviewNote {
	return { id: "n1", comparison: "base", file, lines: lines.filter(notableLine), text, outdated: false, ...overrides };
}

const textDiff = (lines: DiffLine[]): FileDiff => ({ kind: "text", sections: [{ header: [], hunks: [{ header: "@@ -1,2 +1,3 @@", lines }] }] });

describe("where a note is", () => {
	test("one line and a run of lines use the numbers of the file as it is now", () => {
		expect(noteLocation(note([hunk[2]!], ""))).toBe("src/a.ts:2");
		expect(noteLocation(note(hunk.slice(1, 4), ""))).toBe("src/a.ts:2-3");
	});

	test("lines that are only removed say they use the old numbers", () => {
		expect(noteLocation(note([hunk[1]!], ""))).toBe("src/a.ts:2 (removed line, numbered as before the change)");
		expect(noteLocation(note([removed("a", 7), removed("b", 8)], ""))).toBe("src/a.ts:7-8 (removed lines, numbered as before the change)");
	});

	test("a path with a control character in it is cleaned", () => {
		expect(noteLocation({ file: { ...file, path: "src/\x1b[201~evil.ts" }, lines: [added("x", 1) as never] })).toBe("src/\ufffd[201~evil.ts:1");
	});
});

describe("a note's reference", () => {
	test("names the lines with the numbers of the file as it is now, or the old ones for removed lines", () => {
		expect(noteSpan(note(hunk.slice(1, 4), ""))).toEqual({ lines: "2-3", removed: false });
		expect(noteSpan(note([removed("a", 7), removed("b", 8)], ""))).toEqual({ lines: "7-8", removed: true });
	});

	test("shows its first line with Git's marker apart, cleaned as quoted", () => {
		expect(quotedParts({ kind: "added", text: "a\x1b[201~b\r", oldLine: null, newLine: 1 })).toEqual({ marker: "+", text: "a\ufffd[201~b" });
		expect(quotedParts({ kind: "context", text: "\tsame", oldLine: 1, newLine: 1 })).toEqual({ marker: " ", text: "\tsame" });
	});
});

describe("which lines can have a note", () => {
	test("a run of lines in one hunk, either way round", () => {
		expect(notedLines(hunk, 3, 1)?.map(line => line.text)).toEqual(["const a = 1;", "const a = 2;", "const b = 3;"]);
	});

	test("not Git's notes, not lines without numbers, and not too many", () => {
		expect(notedLines(hunk, 3, 4)).toBeNull();
		expect(notedLines([{ kind: "context", text: "combined", oldLine: null, newLine: null }], 0, 0)).toBeNull();
		const long = Array.from({ length: NOTE_LINE_LIMIT + 1 }, (_, index) => added(`${index}`, index + 1));
		expect(notedLines(long, 0, NOTE_LINE_LIMIT)).toBeNull();
		expect(notedLines(long, 0, NOTE_LINE_LIMIT - 1)).toHaveLength(NOTE_LINE_LIMIT);
	});
});

describe("the text of a note", () => {
	test("is kept with \\n line breaks and no spaces at the end", () => {
		expect(normalizeNoteText("one\r\ntwo  \r\n")).toBe("one\ntwo");
	});

	test("must say something and hold only line breaks, tabs, and visible characters", () => {
		expect(noteProblem("")).not.toBeNull();
		expect(noteProblem("  \n ")).not.toBeNull();
		expect(noteProblem("Rename\tthis\nplease")).toBeNull();
		expect(noteProblem("bad \x1b[201~ end")).not.toBeNull();
		expect(noteProblem("hidden \u202e text")).not.toBeNull();
		expect(noteProblem("x".repeat(10_001))).not.toBeNull();
	});
});

describe("quoting a line", () => {
	test("keeps Git's marker and drops a Windows line ending", () => {
		expect(quoteLine({ kind: "added", text: "const a = 2;\r", oldLine: null, newLine: 2 })).toBe("> +const a = 2;");
		expect(quoteLine({ kind: "removed", text: "gone", oldLine: 2, newLine: null })).toBe("> -gone");
		expect(quoteLine({ kind: "context", text: "\tsame", oldLine: 1, newLine: 1 })).toBe(">  \tsame");
	});

	test("a control character in the file can never reach the agent", () => {
		expect(quoteLine({ kind: "added", text: "a\x1b[201~b\x07c", oldLine: null, newLine: 1 })).toBe("> +a\ufffd[201~b\ufffdc");
	});

	test("a very long line is cut", () => {
		const quoted = quoteLine({ kind: "added", text: "x".repeat(QUOTE_LENGTH_LIMIT + 50), oldLine: null, newLine: 1 });
		expect(quoted).toBe(`> +${"x".repeat(QUOTE_LENGTH_LIMIT)} [cut]`);
	});

	test("a cut never leaves half of a character, so the review can still be pasted", () => {
		const text = `${"a".repeat(QUOTE_LENGTH_LIMIT - 1)}\u{1f600}tail`;
		const quoted = quoteLine({ kind: "added", text, oldLine: null, newLine: 1 });
		expect(quoted).toBe(`> +${"a".repeat(QUOTE_LENGTH_LIMIT - 1)}\ufffd [cut]`);
		expect(pasteProblem(quoted)).toBeNull();
	});

	test("cleaning a line keeps tabs and replaces lone surrogates", () => {
		expect(cleanLine("a\tb\ud800c\u202ed")).toBe("a\tb\ufffdc\ufffdd");
	});
});

describe("the review message", () => {
	const first = note(hunk.slice(1, 3), "Why 2?\nIt was 1 on purpose.");
	const second = note([added("export {}", 9)], "Drop this.", { id: "n2", file: { area: "base", path: "src/b.ts", previousPath: null }, outdated: true });

	test("holds every note on every file, in order, each with where it is, its lines, and what was written", () => {
		expect(buildReviewMessage([first, second])).toBe([
			"Review notes (2 notes)",
			"",
			"src/a.ts:2",
			"> -const a = 1;",
			"> +const a = 2;",
			"Why 2?",
			"It was 1 on purpose.",
			"",
			`src/b.ts:9 ${OUTDATED_MARK}`,
			"> +export {}",
			"Drop this.",
		].join("\n"));
	});

	test("one note says so", () => {
		expect(buildReviewMessage([first]).split("\n")[0]).toBe("Review notes (1 note)");
	});

	test("can always be pasted, whatever the file held", () => {
		const nasty = note([added("\x1b[201~\x1b]0;title\x07\u2028", 1)], "ok", { file: { ...file, path: "a\x1bb" } });
		expect(pasteProblem(buildReviewMessage([nasty]))).toBeNull();
	});
});

describe("outdated notes", () => {
	const kept = note(hunk.slice(1, 3), "n");

	test("stay as they are while their lines are there as they were", () => {
		const notes = [kept];
		expect(markOutdated(notes, "base", file, textDiff(hunk))).toBe(notes);
	});

	test("are marked when a line changed, and stay marked", () => {
		const changed = textDiff([context("import x from \"x\";", 1, 1), removed("const a = 1;", 2), added("const a = 42;", 2)]);
		const marked = markOutdated([kept], "base", file, changed);
		expect(marked[0]!.outdated).toBe(true);
		expect(marked[0]!.lines).toEqual(kept.lines);
		expect(markOutdated(marked, "base", file, textDiff(hunk))[0]!.outdated).toBe(true);
	});

	test("still show where some of their old lines are there as they were, and nowhere else", () => {
		const changed = textDiff([context("import x from \"x\";", 1, 1), removed("const a = 1;", 2), added("const a = 42;", 2)]);
		expect(noteLinesShown(kept, changed)).toBe(true);
		// Only the changed line was noted: nothing of it is left.
		expect(noteLinesShown(note([hunk[2]!], "n"), changed)).toBe(false);
		// The same text at another number is not taken for it.
		expect(noteLinesShown(note([hunk[2]!], "n"), textDiff([added("const a = 2;", 9)]))).toBe(false);
		expect(noteLinesShown(kept, { kind: "unchanged" })).toBe(false);
	});

	test("are marked when the file is no longer changed there", () => {
		expect(markOutdated([kept], "base", file, { kind: "unchanged" })[0]!.outdated).toBe(true);
	});

	test("are left alone by a binary or too large diff, another file, or another comparison", () => {
		const notes = [kept];
		expect(markOutdated(notes, "base", file, { kind: "binary" })).toBe(notes);
		expect(markOutdated(notes, "base", file, { kind: "too-large", lines: null })).toBe(notes);
		expect(markOutdated(notes, "base", { ...file, path: "src/other.ts" }, { kind: "unchanged" })).toBe(notes);
		expect(markOutdated(notes, "uncommitted", file, { kind: "unchanged" })).toBe(notes);
	});

	test("the files a review is on are each named once", () => {
		const other = note([added("x", 1)], "n", { id: "n3", comparison: "uncommitted" });
		expect(notedFiles([kept, { ...kept, id: "n2" }, other])).toEqual([{ comparison: "base", file }, { comparison: "uncommitted", file }]);
	});
});

describe("pasting into a session", () => {
	test("is one bracketed paste with each line break as a carriage return", () => {
		expect(bracketedPaste("one\ntwo")).toBe("\x1b[200~one\rtwo\x1b[201~");
	});

	test("refuses text that could end the paste early or hide what it says", () => {
		expect(pasteProblem("fine\n\ttext")).toBeNull();
		expect(pasteProblem("")).not.toBeNull();
		expect(pasteProblem("a\x1b[201~b")).not.toBeNull();
		expect(pasteProblem("a\rb")).not.toBeNull();
		expect(pasteProblem("a\u202eb")).not.toBeNull();
		expect(pasteProblem("x".repeat(PASTE_TEXT_LIMIT + 1))).not.toBeNull();
		expect(pasteProblem(42)).not.toBeNull();
	});
});

describe("following bracketed paste mode", () => {
	test("is off until the program asks, and off again when it stops", () => {
		const scanner = createPasteModeScanner();
		expect(scanner.on()).toBe(false);
		scanner.scan("hello \x1b[?2004h prompt");
		expect(scanner.on()).toBe(true);
		scanner.scan("\x1b[?2004l");
		expect(scanner.on()).toBe(false);
	});

	test("reads mode 2004 among others in one sequence", () => {
		const scanner = createPasteModeScanner();
		scanner.scan("\x1b[?1049;2004h");
		expect(scanner.on()).toBe(true);
		scanner.scan("\x1b[?1004;1049h");
		expect(scanner.on()).toBe(true);
		scanner.scan("\x1b[?20040h");
		expect(scanner.on()).toBe(true);
		scanner.scan("\x1b[?1049;2004l");
		expect(scanner.on()).toBe(false);
	});

	test("reads a sequence split between parts", () => {
		for (const at of [1, 2, 3, 5, 7]) {
			const scanner = createPasteModeScanner();
			const sequence = "text\x1b[?2004h";
			scanner.scan(sequence.slice(0, 4 + at));
			scanner.scan(sequence.slice(4 + at));
			expect(scanner.on()).toBe(true);
		}
	});

	test("a full reset or the end of the program turns it off", () => {
		const scanner = createPasteModeScanner();
		scanner.scan("\x1b[?2004h");
		scanner.scan("\x1bc");
		expect(scanner.on()).toBe(false);
		scanner.scan("\x1b[?2004h");
		scanner.reset();
		expect(scanner.on()).toBe(false);
	});
});

describe("choosing lines for a note", () => {
	const at = (line: number, hunk = 0) => ({ key: "f", comparison: "base" as const, section: 0, hunk, line });

	test("a line starts a note on it, with the lines as they show", () => {
		const draft = chooseNoteLine(null, at(2), hunk, false)!;
		expect(draft).toMatchObject({ anchor: 2, end: 2, text: "" });
		expect(draft.lines.map(line => line.text)).toEqual(["const a = 2;"]);
	});

	test("extending in the same hunk makes a range either way round and keeps the text typed", () => {
		const draft = { ...chooseNoteLine(null, at(3), hunk, false)!, text: "typed" };
		const range = chooseNoteLine(draft, at(1), hunk, true)!;
		expect(range).toMatchObject({ anchor: 3, end: 1, text: "typed" });
		expect(range.lines.map(line => line.kind)).toEqual(["removed", "added", "added"]);
	});

	test("extending to another hunk starts afresh there, keeping the text", () => {
		const draft = { ...chooseNoteLine(null, at(3), hunk, false)!, text: "typed" };
		expect(chooseNoteLine(draft, at(0, 1), hunk, true)).toMatchObject({ hunk: 1, anchor: 0, end: 0, text: "typed" });
	});

	test("a line that cannot take a note, or a range too long, leaves the draft", () => {
		const draft = chooseNoteLine(null, at(0), hunk, false)!;
		expect(chooseNoteLine(draft, at(4), hunk, false)).toBe(draft);
		expect(chooseNoteLine(draft, at(4), hunk, true)).toBe(draft);
		const long = Array.from({ length: NOTE_LINE_LIMIT + 1 }, (_, index) => added(`${index}`, index + 1));
		const first = chooseNoteLine(null, at(0), long, false)!;
		expect(chooseNoteLine(first, at(NOTE_LINE_LIMIT), long, true)).toBe(first);
		expect(chooseNoteLine(first, at(NOTE_LINE_LIMIT - 1), long, true)!.lines).toHaveLength(NOTE_LINE_LIMIT);
	});
});
