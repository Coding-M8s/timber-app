import { type ReactNode, useId } from "react";
import type { Worktree } from "../../shared/model";
import { type RowMarker, type RowMarkerKind, describeRow, describeRowMarkers, describeWorktreeKind, worktreeLabel } from "../format";

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
	"sync-unknown": "sync-note",
	"detached": "row-flag",
	"folder-missing": "row-flag",
	"status-unknown": "row-flag",
	"locked": "row-flag",
	"prunable": "row-flag",
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

interface WorktreeRowProps {
	worktree: Worktree;
	selected: boolean;
	onSelect: () => void;
	/**
	 * Controls for the worktree beside the row, such as "Open in editor". The
	 * row is itself a button, so they sit next to it, not inside it.
	 */
	actions?: ReactNode;
}

/** One worktree in the sidebar. What it is marked with comes from `describeRowMarkers`; this only draws it. */
export function WorktreeRow({ worktree, selected, onSelect, actions }: WorktreeRowProps) {
	const descriptionId = useId();
	const markers = describeRowMarkers(worktree);
	const at = (place: RowMarker["place"]) => markers.filter(marker => marker.place === place).map(marker => <Marker key={marker.kind} marker={marker} />);
	const flags = at("state");
	const row = (
		<button
			type="button"
			className={selected ? "row selected" : "row"}
			aria-current={selected}
			aria-describedby={markers.length > 0 ? descriptionId : undefined}
			title={worktree.path}
			onClick={onSelect}
		>
			<span className="row-line">
				<span className="row-name">{worktreeLabel(worktree)}</span>
				{at("branch")}
			</span>
			<span className="row-line row-meta">
				<span className="row-sub">{describeWorktreeKind(worktree)}</span>
				{flags.length > 0 && <span className="row-flags">{flags}</span>}
				{at("changes")}
			</span>
			{markers.length > 0 && <span id={descriptionId} className="row-description" hidden>{describeRow(markers)}</span>}
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
