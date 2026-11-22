import type { ReactNode } from "react";
import type { RowProgress, RowProgressKind } from "../row-progress-format";

/** Each state's shape, drawn on a 16 by 16 grid with round strokes. */
const SHAPES: Record<RowProgressKind, ReactNode> = {
	// A pull request: two commits on the left, an arrow over to the one on the right.
	"open": (
		<>
			<circle cx="4" cy="3.5" r="1.6" />
			<circle cx="4" cy="12.5" r="1.6" />
			<path d="M4 5.1v5.8" />
			<circle cx="12" cy="12.5" r="1.6" />
			<path d="M12 10.9V6a2 2 0 0 0-2-2H7.5" />
			<path d="M9 2.5 7.5 4 9 5.5" />
		</>
	),
	// The same, with the right side dashed: not ready yet.
	"draft": (
		<>
			<circle cx="4" cy="3.5" r="1.6" />
			<circle cx="4" cy="12.5" r="1.6" />
			<path d="M4 5.1v5.8" />
			<circle cx="12" cy="12.5" r="1.6" />
			<path d="M12 9.5v-.6M12 6.8v-.6M12 3.8v-.6" />
		</>
	),
	// A merge: the branch joins the line it came from.
	"merged": (
		<>
			<circle cx="4" cy="3.5" r="1.6" />
			<circle cx="4" cy="12.5" r="1.6" />
			<path d="M4 5.1v5.8" />
			<circle cx="12" cy="8.5" r="1.6" />
			<path d="M4.6 5a5 5 0 0 0 5.8 3.5" />
		</>
	),
	// A pull request struck out on its right.
	"closed": (
		<>
			<circle cx="4" cy="3.5" r="1.6" />
			<circle cx="4" cy="12.5" r="1.6" />
			<path d="M4 5.1v5.8" />
			<circle cx="12" cy="12.5" r="1.6" />
			<path d="M10 3l4 4M14 3l-4 4" />
		</>
	),
	// The upstream was rewritten: a loop that turns back on itself, around a commit.
	"force-pushed": (
		<>
			<path d="M13 8a5 5 0 1 1-1.5-3.6" />
			<path d="M12 1.8v2.9H9.1" />
			<circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none" />
		</>
	),
	// The upstream left the remote: a cloud, struck through.
	"upstream-gone": (
		<>
			<path d="M4.5 12.5h7a2.8 2.8 0 0 0 .3-5.6A4 4 0 0 0 4.2 7.6 2.5 2.5 0 0 0 4.5 12.5Z" />
			<path d="M2 2.5l12 11" />
		</>
	),
};

/**
 * A worktree's progress, leading the second line of its row: the state's
 * shape in its color. The row is described to assistive technology by its
 * markers' sentences, so the mark is hidden from it; its tooltip is the
 * sentence of the state it stands for.
 */
export function ProgressMark({ progress }: { progress: RowProgress }) {
	return (
		<span className={`row-progress progress-${progress.kind}`} title={progress.tooltip} aria-hidden="true">
			<svg width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
				{SHAPES[progress.kind]}
			</svg>
		</span>
	);
}
