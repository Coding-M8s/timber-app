import type { Language } from "@codemirror/language";
import { highlightTree } from "@lezer/highlight";
import type { DiffLine, DiffSection } from "../shared/file-changes";
import type { WordRange } from "./diff-words";
import { type EditorLanguage, codeHighlightStyle, pickLanguage } from "./editor-language";

/**
 * How the Changes tab colors a diff: as the File tab's editor colors the
 * file, with the same language, parser, and colors, but no editor. Each
 * hunk's old side (context and removed lines) and new side (context and
 * added lines) is parsed as one piece of code. A hunk that starts inside a
 * multi-line comment or string is parsed from where it starts, so it may be
 * colored wrongly. Pure but for loading the language's parser.
 */

/** A stretch of a line's text with the class that colors it. */
export interface CodeSpan {
	from: number;
	to: number;
	className: string;
}

/** The spans of every line, by section, hunk, and line, as the diff holds them. */
export type DiffColors = CodeSpan[][][][];

/** The spans of each line of one hunk. Git's notes get none. */
export function colorHunk(language: Language, lines: readonly DiffLine[]): CodeSpan[][] {
	const spans: CodeSpan[][] = lines.map(() => []);
	for (const side of ["removed", "added"] as const) {
		const members = lines.flatMap((line, index) => line.kind === side || line.kind === "context" ? [index] : []);
		if (!members.some(index => lines[index]!.kind === side) && side === "removed") continue;
		// Context lines are parsed with both sides, and take their colors from the new one.
		const keeps = (index: number) => lines[index]!.kind === side || side === "added";
		const starts: number[] = [];
		let length = 0;
		for (const index of members) {
			starts.push(length);
			length += lines[index]!.text.length + 1;
		}
		const text = members.map(index => lines[index]!.text).join("\n");
		const tree = language.parser.parse(text);
		let at = 0;
		highlightTree(tree, codeHighlightStyle, (from, to, className) => {
			while (at + 1 < starts.length && starts[at + 1]! <= from) at++;
			// A token can run over several lines: it is cut at each line's end.
			for (let line = at; line < starts.length && starts[line]! < to; line++) {
				const start = starts[line]!;
				const end = start + lines[members[line]!]!.text.length;
				const piece = { from: Math.max(from, start) - start, to: Math.min(to, end) - start, className };
				if (piece.to > piece.from && keeps(members[line]!)) spans[members[line]!]!.push(piece);
			}
		});
	}
	return spans;
}

/**
 * The language to color a diff in, or why it stays plain: a kind of file the
 * editor does not color, or one over the editor's limits, measured by the
 * highest line number the diff shows and the length of its text.
 */
export function diffLanguage(path: string, sections: readonly DiffSection[]): EditorLanguage {
	let lines = 0;
	let length = 0;
	for (const section of sections) {
		for (const hunk of section.hunks) {
			for (const line of hunk.lines) {
				lines = Math.max(lines, line.oldLine ?? 0, line.newLine ?? 0);
				length += line.text.length + 1;
			}
		}
	}
	return pickLanguage(path, { lines, length });
}

/** The colors of every hunk of a diff, in a language already loaded. */
export function colorDiff(language: Language, sections: readonly DiffSection[]): DiffColors {
	return sections.map(section => section.hunks.map(hunk => colorHunk(language, hunk.lines)));
}

/** The colors of a diff, loading its language's parser first, or null when it stays plain. */
export async function highlightDiff(path: string, sections: readonly DiffSection[]): Promise<DiffColors | null> {
	const picked = diffLanguage(path, sections);
	if (picked.kind !== "colored") return null;
	const { language } = await picked.description.load();
	return colorDiff(language, sections);
}

/** One piece of a line as it is drawn: its text, the class that colors it, and whether it is a changed word. */
export interface LineSegment {
	text: string;
	className: string | null;
	word: boolean;
}

/** A line cut into pieces wherever its color or its changed words begin or end. */
export function lineSegments(text: string, spans: readonly CodeSpan[], word: WordRange | null): LineSegment[] {
	const cuts = new Set<number>([0, text.length]);
	for (const span of spans) {
		cuts.add(span.from);
		cuts.add(span.to);
	}
	if (word !== null) {
		cuts.add(word.from);
		cuts.add(word.to);
	}
	const points = [...cuts].filter(point => point >= 0 && point <= text.length).sort((one, other) => one - other);
	const segments: LineSegment[] = [];
	let span = 0;
	for (let index = 0; index + 1 < points.length; index++) {
		const from = points[index]!;
		const to = points[index + 1]!;
		while (span < spans.length && spans[span]!.to <= from) span++;
		const color = span < spans.length && spans[span]!.from <= from ? spans[span]!.className : null;
		const changed = word !== null && from >= word.from && to <= word.to;
		const last = segments[segments.length - 1];
		if (last !== undefined && last.className === color && last.word === changed) last.text += text.slice(from, to);
		else segments.push({ text: text.slice(from, to), className: color, word: changed });
	}
	return segments;
}
