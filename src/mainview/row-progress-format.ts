import type { PullRequestEntry } from "../shared/pull-requests";
import type { RowMarker } from "./format";

/**
 * A worktree's progress at a glance (issue 241): the one mark that leads the
 * second line of its row in the sidebar. Pure, so it can be tested without a
 * window.
 */

/** What the mark can say. Each has its own shape as well as its color, so none is told by color alone. */
export type RowProgressKind = "open" | "draft" | "merged" | "closed" | "force-pushed" | "upstream-gone";

export interface RowProgress {
	kind: RowProgressKind;
	/** The sentence of the marker the mark stands for, for its tooltip. The row's description already says it. */
	tooltip: string;
}

/**
 * The mark for a row, from its markers and its pull request, or null for
 * none. A row shows one: the most urgent wins. A rewritten upstream comes
 * first, as it changes what pulling or pushing would do; then a merged or
 * closed pull request, which says the worktree can go; then a deleted
 * upstream; then an open or draft pull request. A row with none of these,
 * such as a primary checkout or a branch that is only local, has no mark.
 */
export function describeRowProgress(markers: readonly RowMarker[], pullRequest: PullRequestEntry | null): RowProgress | null {
	const sentence = (kind: RowMarker["kind"]) => markers.find(marker => marker.kind === kind)?.tooltip;
	const forcePushed = sentence("force-pushed");
	if (forcePushed !== undefined) return { kind: "force-pushed", tooltip: forcePushed };
	const pull = pullRequest?.outcome === "found" ? pullRequest.pullRequest : null;
	const pullSentence = sentence("pull-request");
	if (pull !== null && pullSentence !== undefined && (pull.state === "merged" || pull.state === "closed")) return { kind: pull.state, tooltip: pullSentence };
	const gone = sentence("upstream-gone");
	if (gone !== undefined) return { kind: "upstream-gone", tooltip: gone };
	if (pull !== null && pullSentence !== undefined) return { kind: pull.state, tooltip: pullSentence };
	return null;
}

/**
 * The word that follows the pull request's number on the row. Draft, merged,
 * and closed always have theirs. An open one says "open" only when another
 * state's mark leads the line, such as force-pushed, so its state is never
 * left to the mark of something else.
 */
export function pullRequestStateWord(state: "open" | "draft" | "merged" | "closed", progress: RowProgress | null): string | null {
	if (state !== "open") return state;
	return progress?.kind === "open" ? null : "open";
}
