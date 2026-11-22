import { Fragment, type KeyboardEvent, type MouseEvent, type PointerEvent, type ReactNode, useId, useMemo, useRef, useState } from "react";
import { MOVE_GROUP_HINT, describeGroupNameProblem, describeListNotice, describeReloadError, worktreeLabel } from "../format";
import { SETTINGS_LABEL, describeLayoutProblem } from "../shell";
import { DRAG_THRESHOLD, type GroupDropPlace, MOVE_REPOSITORY_SHORTCUTS, dropPlace, groupDropPlace, moveStep } from "../repository-drag";
import { describeGroupMenu, describeRepositoryMenu, groupMenuItems, repositoryMenuItems } from "../repository-menu-format";
import { GROUP_NEEDS_LOOK_TITLE, type ShownGroup, arrangeSidebar, canDragRepositories, chooseFromRepositoryMenu, dropSlotsOf, groupDropMark, groupDropSlotsOf, groupDropTarget, groupNeedsLook, repositoryDropMark } from "../sidebar-groups";
import { ancestorsOf } from "../../shared/repository-groups";
import { opensWorktreeMenu, repositoryMenuItems as cleanUpMenuItems } from "../worktree-menu-format";
import { clashMarksOf } from "../ports-format";
import { useAppState, useStore } from "../store/react";
import { isRunning } from "../store/state";
import { mostUrgent, summarizeStatuses } from "../../shared/session-status";
import { unseenStatuses } from "../seen-status";
import type { Repository, Worktree } from "../../shared/model";
import { SIDEBAR_ID } from "./SidebarResizer";
import { RepositorySection } from "./RepositorySection";
import { MoreIcon } from "./MoreIcon";
import { RepositoryMenu } from "./RepositoryMenu";
import { RepositoryGroupName } from "./RepositoryGroupName";
import { SidebarIconView } from "./SidebarIcon";
import { groupIcon } from "../../shared/sidebar-icons";

/** The name field in the sidebar: for a new group, maybe with a repository to put in it or a group to make it inside, or to rename a group. */
type Naming = { kind: "new"; repository?: string; parent?: string } | { kind: "rename"; id: string };

/** An open menu: of a repository header, or of a group header, and where it was asked to be. */
type OpenMenu = { kind: "repository"; path: string; at: { left: number; top: number } } | { kind: "group"; id: string; at: { left: number; top: number } };

/** Where a menu opened from the keyboard goes: under the control that has the keyboard. */
const underneath = (element: Element) => {
	const box = element.getBoundingClientRect();
	return { left: box.left, top: box.bottom };
};

export function Sidebar() {
	const store = useStore();
	const state = useAppState();
	// Rows that share a host port with another worktree get a warning (see ../ports-format.ts).
	const clashMarks = useMemo(() => clashMarksOf(state.portClashes, state.repositories), [state.portClashes, state.repositories]);
	const { repositories, loaded, repositoryGroups } = state;
	// While an issues board shows, no worktree row is the one shown.
	const selectedId = state.board === null ? state.selection?.worktree ?? null : null;
	const refreshing = isRunning(state, "reload-all");
	const failure = state.error && describeReloadError(state.error, repositories);
	const notice = state.notice && describeListNotice(state.notice, repositories);
	const adding = isRunning(state, "add-repository");
	const removing = (path: string) => state.operations.some(operation => operation.kind === "remove-repository" && operation.repository === path);
	const [filter, setFilter] = useState("");
	const idBase = useId();
	// Which repositories and groups are collapsed is part of the layout the store holds, so it is remembered between runs.
	const { collapsed, collapsedGroups } = state.layout;
	const layoutProblem = state.layoutProblem && describeLayoutProblem(state.layoutProblem);
	const query = filter.trim().toLowerCase();
	const now = Date.now();
	const fetchAsked = (path: string) => state.operations.some(operation => operation.kind === "fetch-repository" && operation.repository === path);
	const groupCount = repositoryGroups.groups.length;

	// A press on a header that has not moved far enough to be a drag yet, or the drag it became.
	const press = useRef<{ path: string; pointerId: number; startY: number; dragging: boolean } | null>(null);
	const [drag, setDrag] = useState<{ path: string; place: { group: string | null; before: string | null } } | null>(null);
	// The same for a group header, which moves among the groups.
	const groupPress = useRef<{ id: string; pointerId: number; startY: number; dragging: boolean } | null>(null);
	const [groupDrag, setGroupDrag] = useState<{ id: string; place: GroupDropPlace } | null>(null);
	// The click that ends a drag must not also open or close the group.
	const dragEnded = useRef(false);
	const groupElements = useRef(new Map<string, HTMLElement>());
	const headerButtons = useRef(new Map<string, HTMLButtonElement>());
	const repositoryGroupHeads = useRef(new Map<string, HTMLElement>());
	const repositoryGroupHeaders = useRef(new Map<string, HTMLButtonElement>());
	const newGroupButton = useRef<HTMLButtonElement>(null);
	const [naming, setNaming] = useState<Naming | null>(null);
	const [menu, setMenu] = useState<OpenMenu | null>(null);
	// A browser may follow Shift+F10 with a contextmenu event; the menu the key opened stays where it is (see WorktreeRow).
	const menuByKey = useRef(false);

	/**
	 * A drag just ended. The click that follows it is swallowed, and only that one: a header that moved into or out of
	 * a group is drawn anew, so its click may never come, and the next real click must not be lost instead.
	 */
	const endDrag = () => {
		dragEnded.current = true;
		setTimeout(() => {
			dragEnded.current = false;
		}, 0);
	};

	/** Give the keyboard to a control once the page has drawn it where it now is. */
	const focusLater = (target: () => HTMLElement | null | undefined) => requestAnimationFrame(() => target()?.focus());

	/** The identity the list has now for the worktree at this path, which is what the Done dialog is opened with. */
	const listedIdAt = (repositoryPath: string, path: string) =>
		repositories.find(repository => repository.path === repositoryPath)?.worktrees.find(worktree => worktree.path === path)?.id ?? null;

	const rows: { repository: Repository; matches: Worktree[] }[] = repositories.map(repository => ({
		repository,
		matches: repository.worktrees.filter(worktree => !query || worktreeLabel(worktree).toLowerCase().includes(query)),
	}));
	const nothingMatches = query !== "" && rows.every(row => row.matches.length === 0);
	const arranged = arrangeSidebar(rows, repositoryGroups, collapsedGroups, query);

	const boxOf = (name: string) => {
		const element = name.startsWith("group:") ? repositoryGroupHeads.current.get(name.slice("group:".length)) : groupElements.current.get(name);
		return element?.getBoundingClientRect();
	};
	const placeAt = (path: string, y: number) => dropPlace(dropSlotsOf(arranged, path, boxOf), y);
	const groupPlaceAt = (y: number) => groupDropPlace(groupDropSlotsOf(arranged.grouped, boxOf), y);

	/** The header of a group, or while it is not drawn, as inside a folded group, the nearest one around it that is. */
	const headerOrAround = (id: string) => () => {
		const groups = store.getState().repositoryGroups.groups;
		for (const candidate of [id, ...ancestorsOf(groups, id).map(group => group.id)]) {
			const header = repositoryGroupHeaders.current.get(candidate);
			if (header) return header;
		}
		return null;
	};

	function startNaming(next: Naming) {
		store.clearGroupNameProblem();
		setMenu(null);
		setNaming(next);
	}

	/** Put the name field away, and give the keyboard back to where naming started. */
	function stopNaming(focus: () => HTMLElement | null | undefined) {
		const was = naming;
		setNaming(null);
		store.clearGroupNameProblem();
		if (was) focusLater(focus);
	}

	const namingOpener = (was: Naming | null) => () => {
		if (was?.kind === "rename") return repositoryGroupHeaders.current.get(was.id);
		if (was?.kind === "new" && was.repository !== undefined) return headerButtons.current.get(was.repository);
		if (was?.kind === "new" && was.parent !== undefined) return headerOrAround(was.parent)();
		return newGroupButton.current;
	};

	async function submitName(name: string) {
		const was = naming;
		if (!was) return;
		const known = new Set(store.getState().repositoryGroups.groups.map(group => group.id));
		const saved = was.kind === "new" ? await store.createGroup(name, was.repository, was.parent) : await store.renameGroup(was.id, name);
		// A name that is empty or taken keeps the field, with the reason under it.
		if (!saved && store.getState().groupNameProblem) return;
		if (saved && was.kind === "new") {
			// The group made is the one that was not there before. None was made when its parent went meanwhile.
			const made = store.getState().repositoryGroups.groups.find(group => !known.has(group.id))?.id;
			stopNaming(made === undefined ? namingOpener(was) : () => repositoryGroupHeaders.current.get(made));
			return;
		}
		stopNaming(namingOpener(was));
	}

	function onHeaderPointerDown(path: string, event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || !canDragRepositories(repositories.length, groupCount)) return;
		press.current = { path, pointerId: event.pointerId, startY: event.clientY, dragging: false };
	}

	function onHeaderPointerMove(event: PointerEvent<HTMLButtonElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		if (!current.dragging) {
			if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return;
			current.dragging = true;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		const place = placeAt(current.path, event.clientY);
		if (drag?.path !== current.path || drag.place.group !== place.group || drag.place.before !== place.before) setDrag({ path: current.path, place });
	}

	function onHeaderPointerUp(event: PointerEvent<HTMLButtonElement>) {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		press.current = null;
		setDrag(null);
		if (!current.dragging) return;
		endDrag();
		const place = placeAt(current.path, event.clientY);
		void store.placeRepository(current.path, place.group, place.before);
	}

	function onHeaderPointerCancel() {
		press.current = null;
		setDrag(null);
	}

	function onRepositoryHeaderKeyDown(path: string, event: KeyboardEvent<HTMLButtonElement>) {
		if (opensWorktreeMenu(event)) {
			event.preventDefault();
			menuByKey.current = true;
			setMenu({ kind: "repository", path, at: underneath(event.currentTarget) });
			return;
		}
		const step = moveStep(event);
		if (step === 0) return;
		event.preventDefault();
		void store.stepRepository(path, step);
		// The header was moved in the page, so give it the focus back.
		focusLater(() => headerButtons.current.get(path));
	}

	function onGroupPointerDown(id: string, event: PointerEvent<HTMLButtonElement>) {
		if (event.button !== 0 || groupCount < 2) return;
		groupPress.current = { id, pointerId: event.pointerId, startY: event.clientY, dragging: false };
	}

	function onGroupPointerMove(event: PointerEvent<HTMLButtonElement>) {
		const current = groupPress.current;
		if (!current || current.pointerId !== event.pointerId) return;
		if (!current.dragging) {
			if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return;
			current.dragging = true;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		const place = groupPlaceAt(event.clientY);
		const same = groupDrag?.id === current.id && groupDrag.place.kind === place.kind && (place.kind === "end" || (groupDrag.place.kind !== "end" && groupDrag.place.id === place.id));
		if (!same) setGroupDrag({ id: current.id, place });
	}

	function onGroupPointerUp(event: PointerEvent<HTMLButtonElement>) {
		const current = groupPress.current;
		if (!current || current.pointerId !== event.pointerId) return;
		groupPress.current = null;
		setGroupDrag(null);
		if (!current.dragging) return;
		endDrag();
		const target = groupDropTarget(repositoryGroups.groups, current.id, groupPlaceAt(event.clientY));
		if (target) void store.moveGroup(current.id, target.parent, target.before);
	}

	function onGroupPointerCancel() {
		groupPress.current = null;
		setGroupDrag(null);
	}

	function onGroupHeaderKeyDown(id: string, event: KeyboardEvent<HTMLButtonElement>) {
		if (opensWorktreeMenu(event)) {
			event.preventDefault();
			menuByKey.current = true;
			setMenu({ kind: "group", id, at: underneath(event.currentTarget) });
			return;
		}
		const step = moveStep(event);
		if (step === 0) return;
		event.preventDefault();
		void store.stepGroup(id, step);
		focusLater(() => repositoryGroupHeaders.current.get(id));
	}

	function openMenuAt(next: OpenMenu, event: MouseEvent<HTMLElement>) {
		event.preventDefault();
		if (menuByKey.current && menu !== null) return;
		menuByKey.current = false;
		setMenu(next);
	}

	function closeMenu(backToOpener: boolean) {
		const was = menu;
		menuByKey.current = false;
		setMenu(null);
		if (!backToOpener || !was) return;
		if (was.kind === "repository") headerButtons.current.get(was.path)?.focus();
		else repositoryGroupHeaders.current.get(was.id)?.focus();
	}

	// Where the line that shows a repository's drop goes. Nothing while it would land where it is.
	const dropMark = drag ? repositoryDropMark(arranged, drag.path, drag.place) : null;

	// The same for a group: a line beside the group it lands next to, or around the one it goes inside or cannot go to.
	const groupMark = groupDrag ? groupDropMark(repositoryGroups.groups, groupDrag.id, groupDrag.place) : null;

	const section = ({ repository, matches }: { repository: Repository; matches: Worktree[] }) => {
		const index = repositories.indexOf(repository);
		const open = query ? matches.length > 0 : !collapsed.includes(repository.path);
		// Whatever opened a menu has no tooltip while it is open: the tooltip would cover the menu.
		const menuOpen = menu?.kind === "repository" && menu.path === repository.path;
		return (
			<Fragment key={repository.path}>
				{RepositorySection({
					state, store, repository, matches, query, now, idBase, index, selectedId, open,
					marks: [
						drag?.path === repository.path ? "dragging" : "",
						dropMark?.kind === "repository" && dropMark.path === repository.path ? `drop-${dropMark.side}` : "",
					].filter(Boolean),
					sectionRef: element => {
						if (element) groupElements.current.set(repository.path, element);
						else groupElements.current.delete(repository.path);
					},
					movable: repositories.length > 1,
					header: {
						ref: element => {
							if (element) headerButtons.current.set(repository.path, element);
							else headerButtons.current.delete(repository.path);
						},
						onPointerDown: event => onHeaderPointerDown(repository.path, event),
						onPointerMove: onHeaderPointerMove,
						onPointerUp: onHeaderPointerUp,
						onPointerCancel: onHeaderPointerCancel,
						onKeyDown: event => onRepositoryHeaderKeyDown(repository.path, event),
						onClick: () => {
							if (dragEnded.current) {
								dragEnded.current = false;
								return;
							}
							store.toggleGroup(repository.path);
						},
					},
					fetchAsked: fetchAsked(repository.path),
					clashMarks,
					removing: removing(repository.path),
					menuOpen,
					more: (
						<button
							type="button"
							className="icon-button group-more"
							aria-label={`More for ${repository.name}`}
							title={menuOpen ? undefined : `More for ${repository.name}`}
							aria-haspopup="menu"
							aria-expanded={menuOpen}
							onClick={event => {
								menuByKey.current = false;
								setMenu({ kind: "repository", path: repository.path, at: underneath(event.currentTarget) });
							}}
						>
							<MoreIcon />
						</button>
					),
					onHeadContextMenu: event => openMenuAt({ kind: "repository", path: repository.path, at: { left: event.clientX, top: event.clientY } }, event),
					listedIdAt: path => listedIdAt(repository.path, path),
				})}
				{menuOpen && (
					<RepositoryMenu
						label={describeRepositoryMenu(repository.name)}
						items={repositoryMenuItems(repositoryGroups, repository.path, cleanUpMenuItems(repository, state.pullRequests[repository.path])[0])}
						at={menu.at}
						onClose={closeMenu}
						onChoose={choice => {
							chooseFromRepositoryMenu(store, repository.path, choice, path => startNaming({ kind: "new", repository: path }));
							// Going into or out of a group moves the header in the page, so give it the focus back.
							if (choice.kind === "place" || choice.kind === "take-out") focusLater(() => headerButtons.current.get(repository.path));
						}}
					/>
				)}
			</Fragment>
		);
	};

	const nameField = (label: string, initial: string) => (
		<RepositoryGroupName
			label={label}
			initial={initial}
			problem={state.groupNameProblem && describeGroupNameProblem(state.groupNameProblem)}
			onSubmit={name => void submitName(name)}
			onCancel={() => stopNaming(namingOpener(naming))}
			onEdit={() => store.clearGroupNameProblem()}
		/>
	);

	const pendingGroup = (label: string) => (
		// A group not saved yet: only its name field, at the end where the group will be.
		<section className="repository-group pending" aria-label="Unsaved group">
			<div className="repository-group-head">{nameField(label, "")}</div>
		</section>
	);

	/** A group, its repositories, and its subgroups, each drawn the same way. */
	const groupSection = (shown: ShownGroup<{ repository: Repository; matches: Worktree[] }>): ReactNode => {
		const { group, items, children, open, paths } = shown;
		const folded = !open;
		// Only while the group is folded, what its repositories would show is summed up on its header. Seen ones are left out.
		const statuses = folded ? unseenStatuses(state.terminals.filter(session => paths.includes(session.repository)), state.seenStatuses) : [];
		const summary = summarizeStatuses(statuses);
		const summaryId = `${idBase}-group-summary-${group.id}`;
		const needsLook = folded && groupNeedsLook(state, paths);
		const needsLookId = `${idBase}-group-check-${group.id}`;
		const describedBy = [summary ? summaryId : "", needsLook ? needsLookId : ""].filter(Boolean).join(" ");
		const renaming = naming?.kind === "rename" && naming.id === group.id;
		const pendingHere = naming?.kind === "new" && naming.parent === group.id;
		// Whatever opened a menu has no tooltip while it is open: the tooltip would cover the menu.
		const groupMenuOpen = menu?.kind === "group" && menu.id === group.id;
		return (
			<section
				key={group.id}
				className={[
					"repository-group",
					groupDrag?.id === group.id ? "dragging" : "",
					groupMark?.kind === "line" && groupMark.id === group.id ? `drop-${groupMark.side}` : "",
					groupMark?.kind === "into" && groupMark.id === group.id ? "drop-into" : "",
					groupMark?.kind === "refused" && groupMark.id === group.id ? "drop-refused" : "",
					dropMark?.kind === "into" && dropMark.group === group.id ? "drop-into" : "",
					dropMark?.kind === "above-group" && dropMark.group === group.id ? "drop-before" : "",
				].filter(Boolean).join(" ")}
				aria-label={`Group ${group.name}`}
				data-group={group.id}
			>
				<div
					className="repository-group-head"
					ref={element => {
						if (element) repositoryGroupHeads.current.set(group.id, element);
						else repositoryGroupHeads.current.delete(group.id);
					}}
					onContextMenu={event => openMenuAt({ kind: "group", id: group.id, at: { left: event.clientX, top: event.clientY } }, event)}
				>
					{renaming ? nameField(`New name for ${group.name}`, group.name) : (
						<button
							type="button"
							className="repository-group-header"
							aria-expanded={open}
							aria-describedby={describedBy === "" ? undefined : describedBy}
							aria-keyshortcuts={groupCount > 1 ? MOVE_REPOSITORY_SHORTCUTS : undefined}
							title={groupMenuOpen ? undefined : groupCount > 1 ? `${group.name}. ${MOVE_GROUP_HINT}` : group.name}
							ref={element => {
								if (element) repositoryGroupHeaders.current.set(group.id, element);
								else repositoryGroupHeaders.current.delete(group.id);
							}}
							onPointerDown={event => onGroupPointerDown(group.id, event)}
							onPointerMove={onGroupPointerMove}
							onPointerUp={onGroupPointerUp}
							onPointerCancel={onGroupPointerCancel}
							onKeyDown={event => onGroupHeaderKeyDown(group.id, event)}
							onClick={() => {
								if (dragEnded.current) {
									dragEnded.current = false;
									return;
								}
								store.toggleRepositoryGroup(group.id);
							}}
						>
							<svg className={open ? "chevron open" : "chevron"} aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
								<path d="M3.5 2 6.5 5 3.5 8" />
							</svg>
							<SidebarIconView icon={groupIcon(state.sidebarIcons, group.id)} />
							<span className="repository-group-name">{group.name}</span>
							{summary && (
								// Its words are the button's description too.
								<span className={`group-status repository-group-status status-${mostUrgent(statuses)}`} aria-hidden="true">{summary}</span>
							)}
							{needsLook && <span className="group-flag repository-group-check" title={GROUP_NEEDS_LOOK_TITLE} aria-hidden="true">check</span>}
							<span className="repository-group-count">{paths.length}</span>
						</button>
					)}
					{summary && <span id={summaryId} hidden>{`Agents: ${summary}.`}</span>}
					{needsLook && <span id={needsLookId} hidden>{GROUP_NEEDS_LOOK_TITLE}</span>}
					<button
						type="button"
						className="icon-button repository-group-more"
						aria-label={`More for group ${group.name}`}
						title={groupMenuOpen ? undefined : `More for group ${group.name}`}
						aria-haspopup="menu"
						aria-expanded={groupMenuOpen}
						onClick={event => {
							menuByKey.current = false;
							setMenu({ kind: "group", id: group.id, at: underneath(event.currentTarget) });
						}}
					>
						<MoreIcon />
					</button>
					{groupMenuOpen && (
						<RepositoryMenu
							label={describeGroupMenu(group.name)}
							items={groupMenuItems(repositoryGroups.groups, group.id)}
							at={menu.at}
							onClose={closeMenu}
							onChoose={choice => {
								switch (choice.kind) {
									case "rename":
										startNaming({ kind: "rename", id: group.id });
										return;
									case "icon":
										store.openDialog({ kind: "sidebar-icon", target: { kind: "group", id: group.id } });
										return;
									case "new-subgroup":
										// The field goes at the end of the group, so a folded one opens.
										if (collapsedGroups.includes(group.id)) store.toggleRepositoryGroup(group.id);
										startNaming({ kind: "new", parent: group.id });
										return;
									case "step":
										void store.stepGroup(group.id, choice.step).then(() => focusLater(headerOrAround(group.id)));
										return;
									case "move":
										// Its header is drawn anew where it went, or not at all inside a folded group.
										void store.moveGroup(group.id, choice.parent, null).then(() => focusLater(headerOrAround(group.id)));
										return;
									case "delete":
										// Its header goes with it, so the keyboard goes to New group.
										void store.deleteGroup(group.id).then(() => focusLater(() => newGroupButton.current));
										return;
								}
							}}
						/>
					)}
				</div>
				{open && (items.length > 0 || children.length > 0 || pendingHere) && (
					<div className="repository-group-members">
						{items.map(section)}
						{children.map(groupSection)}
						{pendingHere && pendingGroup(`Name of the new group in ${group.name}`)}
					</div>
				)}
			</section>
		);
	};

	return (
		<aside id={SIDEBAR_ID} className="sidebar" aria-label="Worktrees">
			<div className="sidebar-tools">
				<input
					className="filter"
					type="search"
					aria-label="Filter worktrees"
					placeholder="Filter worktrees"
					value={filter}
					onChange={event => setFilter(event.target.value)}
				/>
				<button
					type="button"
					className="icon-button"
					aria-label="Refresh worktrees"
					title="Refresh worktrees"
					disabled={refreshing}
					onClick={() => void store.refresh()}
				>
					<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M13 8a5 5 0 1 1-1.5-3.6" />
						<path d="M13 2.6v2.9h-2.9" />
					</svg>
				</button>
				<button
					ref={newGroupButton}
					type="button"
					className="icon-button new-group"
					aria-label="New group"
					title="New group"
					disabled={naming?.kind === "new"}
					onClick={() => startNaming({ kind: "new" })}
				>
					<svg aria-hidden="true" width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
						<path d="M1.5 4.5v8h13v-7H8L6.5 3.5h-5z" />
						<path d="M8 7.5v4M6 9.5h4" />
					</svg>
				</button>
			</div>

			{!loaded && !failure && <p className="sidebar-note">Reading worktrees</p>}
			{failure && (
				<div className="sidebar-error" role="alert">
					<p className="sidebar-error-title">{failure.title}</p>
					<p className="sidebar-error-text">{failure.text}</p>
					{loaded && <p className="sidebar-error-text">Showing what was read last.</p>}
				</div>
			)}

			<div className="groups">
				{arranged.loose.map(section)}
				{arranged.grouped.map(groupSection)}
				{naming?.kind === "new" && naming.parent === undefined && pendingGroup("Name of the new group")}
			</div>

			{nothingMatches && <p className="sidebar-note">No worktree matches that filter.</p>}

			{loaded && (
				<div className="sidebar-foot">
					{notice && (
						<div className={notice.problem ? "sidebar-error" : "sidebar-error info"} role={notice.problem ? "alert" : "status"}>
							<p className="sidebar-error-title">{notice.title}</p>
							<p className="sidebar-error-text">{notice.text}</p>
							<button type="button" className="text-button" onClick={() => store.dismissNotice()}>Dismiss</button>
						</div>
					)}
					<button type="button" className="add-repository" disabled={adding} onClick={() => void store.addRepository()}>
						<svg aria-hidden="true" width="11" height="11" viewBox="0 0 11 11" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
							<path d="M5.5 1.5v8M1.5 5.5h8" />
						</svg>
						{adding ? "Choosing a folder" : "Add repository"}
					</button>
				</div>
			)}

			{/* Fixed at the bottom, whatever the list above holds. */}
			<div className="sidebar-bottom">
				{layoutProblem && (
					<div className="sidebar-error layout-problem" role="alert">
						<p className="sidebar-error-title">{layoutProblem.title}</p>
						<p className="sidebar-error-text">{layoutProblem.text}</p>
						<p className="sidebar-error-text">{layoutProblem.consequence}</p>
						<button type="button" className="text-button" onClick={() => store.dismissLayoutProblem()}>Dismiss</button>
					</div>
				)}
				<button
					type="button"
					className="icon-button sidebar-settings"
					aria-label={SETTINGS_LABEL}
					title={SETTINGS_LABEL}
					aria-haspopup="dialog"
					onClick={() => store.openDialog({ kind: "settings" })}
				>
					<svg aria-hidden="true" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.4">
						<circle cx="8" cy="8" r="4.3" />
						<circle cx="8" cy="8" r="1.5" />
						<path strokeWidth="2.2" d="M8 1.3v2.4M8 12.3v2.4M1.3 8h2.4M12.3 8h2.4M3.26 3.26l1.7 1.7M11.04 11.04l1.7 1.7M12.74 3.26l-1.7 1.7M4.96 11.04l-1.7 1.7" />
					</svg>
				</button>
			</div>
		</aside>
	);
}
