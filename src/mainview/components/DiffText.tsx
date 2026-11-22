import { memo, useEffect, useMemo, useState } from "react";
import { StyleModule } from "style-mod";
import type { DiffLineKind, DiffSection } from "../../shared/file-changes";
import { type CodeSpan, type DiffColors, colorDiff, diffLanguage, lineSegments } from "../diff-highlight";
import { type WordRange, changedWords } from "../diff-words";
import { codeHighlightStyle } from "../editor-language";

/** What colors a diff: its code's spans, null while plain, and the changed words of each line. */
export interface DiffMarks {
	colors: DiffColors | null;
	words: (WordRange | null)[][][];
}

/**
 * The colors and changed words of a diff's sections. The language's parser
 * loads once; after that a diff read again is colored at once, so a refresh
 * does not flash plain text.
 */
export function useDiffMarks(path: string, sections: readonly DiffSection[]): DiffMarks {
	const picked = useMemo(() => diffLanguage(path, sections), [path, sections]);
	const [, setLoaded] = useState(0);
	const support = picked.kind === "colored" ? picked.description.support : undefined;
	useEffect(() => {
		if (picked.kind !== "colored" || picked.description.support !== undefined) return;
		let live = true;
		picked.description.load().then(() => {
			if (live) setLoaded(count => count + 1);
		}, () => {});
		return () => {
			live = false;
		};
	}, [picked]);
	useEffect(() => {
		// The editor's colors are classes; the diff can show before any editor put them on the page.
		if (codeHighlightStyle.module !== null) StyleModule.mount(document, codeHighlightStyle.module);
	}, []);
	const colors = useMemo(() => support === undefined ? null : colorDiff(support.language, sections), [support, sections]);
	const words = useMemo(() => sections.map(section => section.hunks.map(hunk => changedWords(hunk.lines))), [sections]);
	return { colors, words };
}

/** A diff line's text, colored as code, with its changed words marked. */
export const DiffText = memo(function DiffText({ text, kind, spans, word }: { text: string; kind: DiffLineKind; spans: readonly CodeSpan[] | undefined; word: WordRange | null }) {
	if (kind === "note" || ((spans === undefined || spans.length === 0) && word === null)) return <span className="diff-text">{text}</span>;
	return (
		<span className="diff-text">
			{lineSegments(text, spans ?? [], word).map((segment, index) => {
				const className = segment.word ? `diff-word${segment.className === null ? "" : ` ${segment.className}`}` : segment.className;
				return className === null ? segment.text : <span key={index} className={className}>{segment.text}</span>;
			})}
		</span>
	);
});
