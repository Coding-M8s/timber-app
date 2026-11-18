import { type ReactNode, useId } from "react";
import type { Worktree } from "../../shared/model";
import type { PullRequestEntry } from "../../shared/pull-requests";
import type { TerminalSession } from "../../shared/terminal";
import { describeRowTitle } from "../base-format";
import { type RowMarker, type RowMarkerKind, describeRow, describeRowMarkers, describeWorktreeKind, worktreeLabel } from "../format";
import { type RowSessionMark, describeRowSessions } from "../terminal-format";
import { AgentIcon } from "./AgentIcon";
import { StatusGlyph } from "./StatusGlyph";

function Arrow({ direction }: { direction: "up" | "down" }) {
	return (
		<svg aria-hidden="true" width="9" height="10" viewBox="0 0 9 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
			<path d={direction === "down" ? "M4.5 1.5v7M1.5 5.5l3 3 3-3" : "M4.5 8.5v-7M1.5 4.5l3-3 3 3"} />
		</svg>
	);
}

/** How each marker looks. Every color comes with a text or a shape, so none carries meaning alone. */
const markerClass: Record<RowMarkerKind, string> = {
	"behind": "sync behind",
	"ahead": "sync ahead",
	"local-only": "sync-note",
	"upstream-gone": "sync-note",
	"force-pushed": "sync-note rewritten",
	"sync-unknown": "sync-note",
	"detached": "row-flag",
	"folder-missing": "row-flag",
	"status-unknown": "row-flag",
	"locked": "row-flag",
	"prunable": "row-flag",
	"base-unknown": "row-flag",
	"pull-request": "row-flag pr",
	"checks-passing": "row-flag pr",
	"checks-failing": "row-flag pr failing",
	"checks-pending": "row-flag pr",
	"review-approved": "row-flag pr",
	"review-changes": "row-flag pr failing",
	"review-required": "row-flag pr",
	"modified": "count modified",
	"untracked": "count untracked",
};

/**
 * One marker. Its tooltip shows on hover. The row is a button, so a marker
 * cannot take focus or a role of its own: it is hidden from assistive
 * technology, which gets every marker's sentence as the row's description.
 */
function Marker({ marker }: { marker: RowMarker }) {
	return (
		<span className={markerClass[marker.kind]} title={marker.tooltip} aria-hidden="true">
			{marker.kind === "behind" && <Arrow direction="down" />}
			{marker.kind === "ahead" && <Arrow direction="up" />}
			{marker.text}
		</span>
	);
}

/**
 * One agent, or a session whose program reported a status: its state as a
 * shape and a color, with its initial. Its name and state in words are its
 * tooltip and part of the row's description.
 */
function SessionMark({ mark }: { mark: RowSessionMark }) {
	return (
		// One thin rounded outline in the state's color holds the state's shape and the agent's mark or letters.
		<span className={`row-agent status-${mark.status.kind}${mark.brand ? " branded" : ""}`} title={mark.words} aria-hidden="true">
			<StatusGlyph status={mark.status} />
			{mark.brand ? <AgentIcon brand={mark.brand} /> : <span className="row-agent-letters">{mark.initial}</span>}
		</span>
	);
}

interface WorktreeRowProps {
	worktree: Worktree;
	selected: boolean;
	onSelect: () => void;
	/** The pull request Timber found for the worktree's branch, or null for none or not known. */
	pullRequest?: PullRequestEntry | null;
	/**
	 * The worktree's sessions, running or exited, in the order they started.
	 * Each agent gets a mark with its state; other running sessions are a
	 * count. Nothing shows when there are none.
	 */
	sessions?: readonly TerminalSession[];
	/**
	 * Controls for the worktree beside the row, such as "Open in editor". The
	 * row is itself a button, so they sit next to it, not inside it.
	 */
	actions?: ReactNode;
}

/** One worktree in the sidebar. What it is marked with comes from `describeRowMarkers`; this only draws it. */
export function WorktreeRow({ worktree, selected, onSelect, pullRequest = null, sessions = [], actions }: WorktreeRowProps) {
	const descriptionId = useId();
	const markers = describeRowMarkers(worktree, pullRequest);
	const running = describeRowSessions(sessions);
	const description = [describeRow(markers), running.sentence].filter(Boolean).join(" ");
	const at = (place: RowMarker["place"]) => markers.filter(marker => marker.place === place).map(marker => <Marker key={marker.kind} marker={marker} />);
	const flags = [...at("state"), ...at("pull-request")];
	const row = (
		<button
			type="button"
			className={selected ? "row selected" : "row"}
			aria-current={selected}
			aria-describedby={description !== "" ? descriptionId : undefined}
			title={describeRowTitle(worktree)}
			onClick={onSelect}
		>
			<span className="row-line">
				<span className="row-name">{worktreeLabel(worktree)}</span>
				{at("branch")}
			</span>
			<span className="row-line row-meta">
				<span className="row-sub">{describeWorktreeKind(worktree)}</span>
				{flags.length > 0 && <span className="row-flags">{flags}</span>}
				{(running.marks.length > 0 || running.others > 0) && (
					// Each agent's state as a shape and a color, then the other sessions as a count. Their sentences are in the row's description.
					<span className="row-sessions" aria-hidden="true">
						{running.marks.map(mark => <SessionMark key={mark.id} mark={mark} />)}
						{running.others > 0 && (
							<span className="row-shells" title={running.othersWords}>
								<span className="row-sessions-dot" />
								{running.others}
							</span>
						)}
					</span>
				)}
				{at("changes")}
			</span>
			{description !== "" && <span id={descriptionId} className="row-description" hidden>{description}</span>}
		</button>
	);
	if (actions === undefined) return row;
	return (
		<div className={selected ? "row-item selected" : "row-item"}>
			{row}
			<span className="row-actions">{actions}</span>
		</div>
	);
}
