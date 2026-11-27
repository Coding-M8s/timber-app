import { type CSSProperties, type FocusEvent, type KeyboardEvent, type MouseEvent, type ReactNode, useEffect, useId, useRef, useState } from "react";
import type { Worktree } from "../../shared/model";
import type { PullRequest, PullRequestEntry, PullRequestHost } from "../../shared/pull-requests";
import type { TerminalSession } from "../../shared/terminal";
import type { IssueEntry, RemovalStatus } from "../store/state";
import { describeRowTitle } from "../base-format";
import { describeIssue, issueTitlePart } from "../issue-format";
import { type RowMarker, type RowMarkerKind, describeRow, describeRowMarkers, describeWorktreeKind, worktreeLabel } from "../format";
import type { SeenStatuses } from "../seen-status";
import { type RowSessionMark, describeRowSessions } from "../terminal-format";
import { WORKTREE_MENU_SHORTCUTS, type WorktreeMenuItemId, describeWorktreeMenu, opensWorktreeMenu, worktreeMenuItems } from "../worktree-menu-format";
import { DEFAULT_TAGS, type Tag, describeTag, tagColorVariable } from "../../shared/worktree-tags";
import { AgentIcon } from "./AgentIcon";
import { ChildBadge } from "./ChildTasks";
import { describeOpenPullRequest } from "../pull-request-format";
import { type RowProgress, describeRowProgress, pullRequestStateWord } from "../row-progress-format";
import { ProgressMark } from "./ProgressMark";
import { StatusGlyph } from "./StatusGlyph";
import { WorktreeMenu } from "./WorktreeMenu";
import type { SyncActionKind } from "../../shared/sync-actions";
import { ASKING_SYNC, type SyncControl, type SyncOptions, describeSyncControls } from "../sync-action-format";

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
	"removing": "row-flag removing",
	"removal-waiting": "row-flag removing",
	"removal-failed": "row-flag failing",
	"detached": "row-flag",
	"folder-missing": "row-flag",
	"status-unknown": "row-flag",
	"locked": "row-flag",
	"prunable": "row-flag",
	"base-unknown": "row-flag",
	"base-counts": "row-flag base-counts",
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

/** The small arrow after a pull request's number: it opens elsewhere, in the browser. */
function OutArrow() {
	return (
		<svg aria-hidden="true" width="8" height="8" viewBox="0 0 8 8" fill="none" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round">
			<path d="M2.5 1.5h4v4M6.5 1.5 1.5 6.5" />
		</svg>
	);
}

/**
 * The pull request on the row: its number as a button that opens it in the
 * browser, then the word for its state with the state's sentence as its
 * tooltip. The number is a real button because it sits on the row's second
 * line, outside the row's own button. Without a way to open it, the number
 * and word are one marker, as any other.
 */
function PullRequestMarker({ marker, pull, host, progress, onOpen }: { marker: RowMarker; pull: PullRequest; host: PullRequestHost | undefined; progress: RowProgress | null; onOpen: ((url: string) => void) | undefined }) {
	const word = pullRequestStateWord(pull.state, progress);
	if (onOpen === undefined) return <Marker marker={{ ...marker, text: word === null ? `#${pull.number}` : `#${pull.number} ${word}` }} />;
	const open = describeOpenPullRequest(pull, host);
	return (
		<span className={`${markerClass[marker.kind]} row-pull`}>
			<button
				type="button"
				className="row-pull-link"
				aria-label={open}
				title={`${open}.`}
				onClick={event => {
					// Opening it does not also select the worktree, as a click elsewhere on the line does.
					event.stopPropagation();
					onOpen(pull.url);
				}}
			>
				#{pull.number}
				<OutArrow />
			</button>
			{word !== null && <span className="row-pull-state" title={marker.tooltip} aria-hidden="true">{word}</span>}
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
		<span className={`row-agent status-${mark.status.kind}${mark.brand ? " branded" : ""}${mark.seen ? " seen" : ""}`} title={mark.words} aria-hidden="true">
			<StatusGlyph status={mark.status} seen={mark.seen} />
			{mark.brand ? <AgentIcon brand={mark.brand} /> : <span className="row-agent-letters">{mark.initial}</span>}
			{mark.badge !== null && <ChildBadge badge={mark.badge} />}
		</span>
	);
}

interface WorktreeRowProps {
	worktree: Worktree;
	selected: boolean;
	onSelect: () => void;
	/** The name the row shows instead of the branch, such as an arena attempt's label. */
	label?: string | undefined;
	/** The pull request Timber found for the worktree's branch, or null for none or not known. */
	pullRequest?: PullRequestEntry | null;
	/** Where the repository's pull requests were read from, for the words of their markers. */
	pullRequestHost?: PullRequestHost | undefined;
	/** Open the pull request's link in the browser. With it, the row's pull request number is a button that does so. */
	onOpenPullRequest?: ((url: string) => void) | undefined;
	/** The store's last answer for the worktree's linked issue, if any. Its short form goes in the row's tooltip. */
	issue?: IssueEntry | undefined;
	/** Where a removal of the worktree stands, or null when none runs or failed. */
	removal?: RemovalStatus | null;
	/**
	 * The worktree's sessions, running or exited, in the order they started.
	 * Each agent gets a mark with its state; other running sessions are a
	 * count. Nothing shows when there are none.
	 */
	sessions?: readonly TerminalSession[];
	/** The Done, Error, and crash statuses the person has seen, which show quiet (see ../seen-status.ts). */
	seen?: SeenStatuses;
	/** The worktree's tag (issue 409), washed over the row in its color and said in its tooltip and description. Work unless given. */
	tag?: Tag;
	/** The saved tags, for the Tag entry of the row's menu. No Tag entry when left out. */
	tags?: readonly Tag[];
	/** The sentence of a port this worktree shares with another, or null. Only then does the row show a warning. */
	portClash?: string | null;
	/**
	 * Controls for the worktree beside the row, such as "Open in editor". The
	 * row is itself a button, so they sit next to it, not inside it.
	 */
	actions?: ReactNode;
	/**
	 * An entry of the row's menu was chosen, for this row's worktree whatever
	 * is selected. The menu opens on a right-click anywhere on the row, or
	 * with Shift+F10 or the context menu key on the focused row. Without it
	 * the row has no menu. A disabled entry is never passed here.
	 */
	onMenuChoice?: (id: WorktreeMenuItemId) => void;
	/**
	 * A sync action's control was chosen, such as Pull, for this row's
	 * worktree. With it, a marker that has an action, such as the behind count,
	 * becomes a control beside the row in its place. Without it, the marker
	 * stays a marker.
	 */
	onSyncAction?: (action: SyncActionKind) => void;
	/** Whether Pull asks first here, and whether a pull without a dialog runs now. Asking, and none, by default. */
	syncOptions?: SyncOptions;
}

/** The marker each sync action's control takes the place of: Pull the behind count, Push the ahead count. */
const syncMarker: Record<SyncActionKind, RowMarkerKind> = { pull: "behind", push: "ahead" };

/** The arrow each sync action's control draws, as its marker does. */
const syncArrow: Record<SyncActionKind, "up" | "down"> = { pull: "down", push: "up" };

/** A sync action's control: the arrow and count of the marker it replaces, as a button of its own. */
function SyncActionButton({ control, onChoose, onFocus, onBlur }: { control: SyncControl; onChoose: () => void; onFocus: () => void; onBlur: (event: FocusEvent) => void }) {
	return (
		<button
			type="button"
			className={`${markerClass[syncMarker[control.action]]} row-sync-button`}
			aria-haspopup={control.opensDialog ? "dialog" : undefined}
			// Marked, not disabled, while it runs, so the keyboard stays on it.
			aria-disabled={control.busy ? true : undefined}
			aria-label={control.label}
			title={control.title}
			onClick={() => {
				if (!control.busy) onChoose();
			}}
			onFocus={onFocus}
			onBlur={onBlur}
		>
			<Arrow direction={syncArrow[control.action]} />
			{control.text}
		</button>
	);
}

/** One worktree in the sidebar. What it is marked with comes from `describeRowMarkers`; this only draws it. */
export function WorktreeRow({ worktree, label, selected, onSelect, pullRequest = null, pullRequestHost, onOpenPullRequest, issue, removal = null, sessions = [], seen = {}, tag = DEFAULT_TAGS[0]!, tags, portClash = null, actions, onMenuChoice, onSyncAction, syncOptions = ASKING_SYNC }: WorktreeRowProps) {
	const descriptionId = useId();
	const button = useRef<HTMLButtonElement>(null);
	// Where the open menu was asked to be, or null while it is closed.
	const [menuAt, setMenuAt] = useState<{ left: number; top: number } | null>(null);
	// A browser may follow Shift+F10 with a contextmenu event; the menu the key opened stays where it is.
	// Chrome sends that event to the focused menu item, which stops it, so this guard is for WebKitGTK,
	// the desktop window's engine. There the menu Shift+F10 opened was seen to stay under the row.
	const openedByKey = useRef(false);
	const closeMenu = (backToRow: boolean) => {
		openedByKey.current = false;
		setMenuAt(null);
		if (backToRow) button.current?.focus();
	};
	const onContextMenu = (event: MouseEvent<HTMLElement>) => {
		if (!onMenuChoice) return;
		event.preventDefault();
		if (openedByKey.current && menuAt !== null) return;
		setMenuAt({ left: event.clientX, top: event.clientY });
	};
	const onRowKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
		if (!onMenuChoice || !opensWorktreeMenu(event)) return;
		event.preventDefault();
		const box = event.currentTarget.getBoundingClientRect();
		openedByKey.current = true;
		setMenuAt({ left: box.left, top: box.bottom });
	};
	const markers = describeRowMarkers(worktree, pullRequest, removal, pullRequestHost);
	const linked = describeIssue(worktree.issue, issue);
	const running = describeRowSessions(sessions, seen);
	// The tag is said in words too, so it is never told by color alone.
	// After the row's state, which matters more.
	const description = [describeRow(markers), portClash, running.sentence, `${describeTag(tag)}.`].filter(Boolean).join(" ");
	// No sync action starts on a worktree that Timber is removing.
	const removing = removal?.kind === "running" || removal?.kind === "waiting";
	const syncControls = onSyncAction && !removing ? describeSyncControls(worktree, syncOptions) : [];
	// Whether the keyboard was on a sync control. A control goes once its branch caught up, such as after
	// a pull that ran without a dialog, and the keyboard then goes to the row instead of nowhere.
	const onSyncControl = useRef(false);
	useEffect(() => {
		if (syncControls.length > 0 || !onSyncControl.current) return;
		onSyncControl.current = false;
		if (document.activeElement === null || document.activeElement === document.body) button.current?.focus();
	}, [syncControls.length]);
	// A marker whose control is beside the row is not drawn twice. Its sentence stays in the row's description.
	const replaced = new Set(syncControls.map(control => syncMarker[control.action]));
	const progress = describeRowProgress(markers, pullRequest);
	const pull = pullRequest?.outcome === "found" ? pullRequest.pullRequest : null;
	const at = (place: RowMarker["place"]) => markers.filter(marker => marker.place === place && !replaced.has(marker.kind)).map(marker =>
		marker.kind === "pull-request" && pull !== null
			? <PullRequestMarker key={marker.kind} marker={marker} pull={pull} host={pullRequestHost} progress={progress} onOpen={onOpenPullRequest} />
			: <Marker key={marker.kind} marker={marker} />);
	const flags = [...at("state"), ...at("pull-request")];
	// No tooltip while the row's menu is open: it would cover the menu.
	const title = menuAt !== null ? undefined : `${describeRowTitle(worktree, linked && issueTitlePart(linked))}. ${describeTag(tag)}`;
	const name = label ?? worktreeLabel(worktree);
	const kind = describeWorktreeKind(worktree);
	const row = (
		<button
			type="button"
			className={selected ? "row selected" : "row"}
			aria-current={selected}
			// The kind sits on the second line, beside the button, so the name says it as it did when both lines were inside.
			aria-label={`${name} ${kind}`}
			aria-describedby={description !== "" ? descriptionId : undefined}
			aria-keyshortcuts={onMenuChoice ? WORKTREE_MENU_SHORTCUTS : undefined}
			title={title}
			ref={button}
			onClick={onSelect}
			onKeyDown={onRowKeyDown}
		>
			<span className="row-line">
				<span className="row-name">{name}</span>
				{at("branch")}
			</span>
			{description !== "" && <span id={descriptionId} className="row-description" hidden>{description}</span>}
		</button>
	);
	const meta = (
		// The second line sits beside the row's button, not in it, so the pull request's number can be a button of its own.
		// A click elsewhere on it selects the worktree, as the row does: a shortcut for the pointer. The keyboard selects
		// with the row's button, which describes everything on this line; a role here would wrap the number's button.
		<div className="row-line row-meta" title={title} onClick={onSelect}>
			{progress !== null && <ProgressMark progress={progress} />}
			<span className="row-sub">{kind}</span>
			{(flags.length > 0 || portClash !== null) && (
				<span className="row-flags">
					{flags}
					{portClash !== null && <span className="row-flag failing" title={portClash} aria-hidden="true">port clash</span>}
				</span>
			)}
			{(running.marks.length > 0 || running.others > 0) && (
				// Each agent's state as a shape and a color, past a few the rest as "+4", then the other sessions as a count.
				// Every sentence, the counted agents' too, is in the row's description.
				<span className="row-sessions" aria-hidden="true">
					{running.shown.map(mark => <SessionMark key={mark.id} mark={mark} />)}
					{running.hidden.count > 0 && <span className="row-agents-more" title={running.hidden.words}>+{running.hidden.count}</span>}
					{running.others > 0 && (
						<span className="row-shells" title={running.othersWords}>
							<span className="row-sessions-dot" />
							{running.others}
						</span>
					)}
				</span>
			)}
			{at("changes")}
		</div>
	);
	const itemClass = ["row-item", selected ? "selected" : "", syncControls.length > 0 ? "with-sync" : "", removal?.kind === "failed" ? "removal-failed" : "", actions !== undefined ? "with-actions" : ""].filter(Boolean).join(" ");
	return (
		// A right-click anywhere on the row, its actions included, opens its menu.
		// A removal that failed keeps its Details in view (see styles.css).
		<div className={itemClass} data-worktree-path={worktree.path} data-tag={tag.id} style={{ "--tag": tagColorVariable(tag.color) } as CSSProperties} onContextMenu={onContextMenu}>
			{row}
			{meta}
			{syncControls.length > 0 && onSyncAction && (
				// Where the marker was, beside the row's button: the row is a button, so a control cannot be inside it.
				<span className="row-sync">
					{syncControls.map(control => (
						<SyncActionButton
							key={control.action}
							control={control}
							onChoose={() => onSyncAction(control.action)}
							onFocus={() => {
								onSyncControl.current = true;
							}}
							onBlur={event => {
								// A control taken out of the page may lose focus to nothing: that is not the person moving on.
								if (event.relatedTarget !== null || event.currentTarget.isConnected) onSyncControl.current = false;
							}}
						/>
					))}
				</span>
			)}
			{actions !== undefined && <span className="row-actions">{actions}</span>}
			{menuAt !== null && onMenuChoice && (
				<WorktreeMenu
					label={describeWorktreeMenu(worktree)}
					items={worktreeMenuItems(worktree, removing, syncOptions, tags && { tags, current: tag.id })}
					at={menuAt}
					onClose={closeMenu}
					onChoose={onMenuChoice}
				/>
			)}
		</div>
	);
}
