import { type KeyboardEvent as ReactKeyboardEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { type ChopKind, type ChopList, type ListedChop, type PersonalChop, sameChopName } from "../../shared/chops";
import {
	type ChopForm, type ChopTarget, blankChopForm, chopEditBlockedReason, chopFormNotes, chopFormOf, chopTargetOf, chopsWithSaved, chopsWithout, describeChopDelete, panelChopScopeOptions,
} from "../chop-format";
import {
	CHOPS_CLOSE_LABEL, CHOPS_FILTER_LABEL, CHOPS_NEW_LABEL, CHOPS_PANEL_ID, CHOPS_PANEL_TITLE, CHOPS_TABS, type ChopRowMenuId, type ChopsPanelRow,
	chopMatches, chopRowMenuItems, chopRowMenuLabel, chopsNewBlockedReason, chopsPanelModel, chopsTabAfterKey, chopsTabLabel, takesChopsPanelKey,
} from "../chops-panel-format";
import { runChopIn } from "../palette-run";
import { useAppState, useStore } from "../store/react";
import type { AppStore } from "../store/store";
import { WORKTREE_MENU_SHORTCUTS, opensWorktreeMenu } from "../worktree-menu-format";
import { ChopFormView, DeleteChopView, FileChopView } from "./ChopEditor";
import { estimateTerminalSize } from "./TerminalPanel";
import { WorktreeMenu } from "./WorktreeMenu";
import { SidePanelTitle, hideSidePanel, toggleSidePanel, useSidePanelFocus } from "./SidePanel";

function panelElement(): HTMLElement | null {
	return document.getElementById(CHOPS_PANEL_ID);
}

/** Show the chops panel when it is hidden and hide it when it shows, from the title bar button or the shortcut (see ./SidePanel.tsx). */
export function toggleChopsPanel(store: AppStore): boolean {
	return toggleSidePanel(store, "chops");
}

/** A repository as the panel's form names it: its primary checkout and its name. */
interface PanelRepository {
	path: string;
	name: string;
}

/** What the panel is making, changing, showing, or asking to delete, with the repository whose list it was opened from. */
type Editing =
	| { mode: "new"; repository: PanelRepository; form: ChopForm }
	| { mode: "edit"; repository: PanelRepository; target: ChopTarget; form: ChopForm }
	| { mode: "view"; repository: PanelRepository; name: string }
	/** `from` is the edit form it was asked from, which Cancel goes back to. */
	| { mode: "delete"; repository: PanelRepository; target: ChopTarget; from?: Extract<Editing, { mode: "edit" }> };

/** What is open in the panel, and how its save stands. */
interface PanelEdit {
	editing: Editing | null;
	/** Whether a save or delete is waiting for its answer. While it waits, the form takes no change and nothing else opens. */
	saving: boolean;
	failure: string | null;
	/** Whether Save was tried with a problem, so the problem is said as an alert. */
	tried: boolean;
}

/*
 * Kept here, as `returnTo` is, because the panel is not drawn while it is
 * hidden: a form half typed is still there when the panel shows again, also
 * after another repository was selected, and a save that answers while the
 * panel is hidden or drawn anew still closes its form. It saves for the
 * repository it was opened for.
 */
let panelEdit: PanelEdit = { editing: null, saving: false, failure: null, tried: false };
const panelEditListeners = new Set<() => void>();

function changePanelEdit(change: Partial<PanelEdit>): void {
	panelEdit = { ...panelEdit, ...change };
	for (const listener of [...panelEditListeners]) listener();
}

const readPanelEdit = () => panelEdit;

function subscribePanelEdit(listener: () => void): () => void {
	panelEditListeners.add(listener);
	return () => panelEditListeners.delete(listener);
}

/** Where the keyboard goes once the panel is drawn again. */
type FocusAim = "form" | "cancel" | "close" | "new" | { back: string | null } | { run: string; list: ChopList | null };

/** Whether a listed row is the chop being changed, shown, or deleted. */
function isEditedRow(editing: Editing, chop: ListedChop, repository: string | null): boolean {
	if (editing.mode === "new" || repository !== editing.repository.path) return false;
	if (editing.mode === "view") return chop.source === "repository-file" && sameChopName(chop.name, editing.name);
	const target = chopTargetOf(chop, repository);
	return target !== null && target.repository === editing.target.repository && sameChopName(target.name, editing.target.name);
}

/**
 * The chops panel, on the right of the workspace: the chops of the selected
 * worktree's repository in a Commands and a Prompts tab, each with its
 * count, a filter over names and text, and each chop's name, source, and
 * text, so what runs shows before it runs. Run, Send, or Copy goes through
 * the palette's path (`runChopIn`), which asks before a repository chop's
 * first run. The footer says where the next run goes, or why nothing can
 * run. Its Close button only hides it: the saved chops and "Use chops" stay
 * as they are.
 *
 * Its "+" makes a chop in a form above the list. A double click on a row's
 * name, its right-click menu, or its actions button changes one of the
 * person's own chops in place, or asks before deleting it; a chop from
 * `.timber/chops.json` is only shown. Each save writes the whole personal
 * list, as Settings, Chops does, from what is saved when it starts.
 */
export function ChopsPanel() {
	const store = useStore();
	const state = useAppState();
	const titleId = useId();
	const baseId = useId();
	const [tab, setTab] = useState<ChopKind>("command");
	const [query, setQuery] = useState("");
	const { editing, saving, failure, tried } = useSyncExternalStore(subscribePanelEdit, readPanelEdit, readPanelEdit);
	const setEditing = (next: Editing | null) => changePanelEdit({ editing: next });
	const [menu, setMenu] = useState<{ name: string; at: { left: number; top: number }; byKey: boolean } | null>(null);
	const focusNext = useRef<FocusAim | null>(null);
	const nameRef = useRef<HTMLInputElement>(null);
	const cancelRef = useRef<HTMLButtonElement>(null);
	const closeRef = useRef<HTMLButtonElement>(null);
	const newRef = useRef<HTMLButtonElement>(null);
	// Shown by the button or the shortcut before React drew it: take the keyboard now.
	useSidePanelFocus("chops");
	const model = chopsPanelModel(state, tab, query);
	const repositoryName = state.repositories.find(repository => repository.path === model.repository)?.name ?? "the repository";
	const listedRepository = model.repository === null ? null : { path: model.repository, name: repositoryName };
	const editBlocked = chopEditBlockedReason(state.preferencesProblem);
	const newBlocked = chopsNewBlockedReason(model, editBlocked);

	useEffect(() => {
		const aim = focusNext.current;
		if (aim === null) return;
		// The person took the keyboard elsewhere, such as to a terminal, while the panel waited: it stays there.
		const active = document.activeElement;
		if (active instanceof HTMLElement && active !== document.body && !(panelElement()?.contains(active) ?? false)) {
			focusNext.current = null;
			return;
		}
		let target: HTMLElement | null = null;
		if (aim === "form") target = nameRef.current;
		else if (aim === "cancel") target = cancelRef.current;
		else if (aim === "close") target = closeRef.current;
		else if (aim === "new") target = newRef.current;
		else if ("back" in aim) {
			// Back to the row it was opened from, whose actions button is drawn again once the row is.
			const buttons = panelElement()?.querySelectorAll<HTMLElement>("[data-chop-actions]") ?? [];
			target = [...buttons].find(button => aim.back !== null && sameChopName(button.dataset.chopActions ?? "", aim.back)) ?? newRef.current;
		} else {
			const rows = panelElement()?.querySelectorAll<HTMLElement>("[data-chop-run]") ?? [];
			target = [...rows].find(row => sameChopName(row.dataset.chopRun ?? "", aim.run)) ?? null;
			// Read again and still not listed, such as a chop for every repository that one for this repository hides.
			if (target === null && model.list !== aim.list) target = newRef.current;
		}
		// A saved chop's row shows once the chops are read again.
		if (target === null) return;
		focusNext.current = null;
		target.focus();
	});

	const tabId = (kind: ChopKind) => `${baseId}-tab-${kind}`;
	const listId = `${baseId}-list`;
	const footerId = `${baseId}-footer`;
	const textId = (index: number) => `${baseId}-text-${index}`;
	const actionsId = (index: number) => `${baseId}-actions-${index}`;
	const showTab = (kind: ChopKind) => setTab(kind);
	const onTabKey = (event: ReactKeyboardEvent<HTMLDivElement>) => {
		const next = chopsTabAfterKey(tab, event.key);
		if (next === null) return;
		event.preventDefault();
		setTab(next);
		document.getElementById(tabId(next))?.focus();
	};
	const choose = (row: ChopsPanelRow, clicks: number) => {
		// Not `disabled`, so the button keeps the keyboard while a session starts, and says why with its tooltip and the footer.
		if (model.blocked !== null || model.repository === null) return;
		// A double click chooses once: a prompt to a running agent waits for nothing, so a second click would send it again.
		if (clicks > 1) return;
		const selection = state.selection;
		if (selection === null) return;
		// Copying shows nothing new, so the view the person is on stays.
		runChopIn(store, model.repository, selection.worktree, row.chop.name, () => estimateTerminalSize(document.getElementById("workspace-panel")), row.action !== "copy");
	};

	const formOpen = editing !== null && (editing.mode === "new" || editing.mode === "edit");
	const start = (next: Editing, aim: FocusAim) => {
		focusNext.current = aim;
		changePanelEdit({ editing: next, tried: false, failure: null });
	};
	// One form at a time, so nothing typed is dropped: asking for another goes back to the one open. Nothing opens while a save waits.
	const busyElsewhere = () => {
		if (panelEdit.saving) return true;
		if (formOpen) nameRef.current?.focus();
		// A delete asked from an edit form holds what was typed there too.
		const askedFromForm = editing?.mode === "delete" && editing.from !== undefined;
		if (askedFromForm) cancelRef.current?.focus();
		return formOpen || askedFromForm;
	};
	const openNew = () => {
		if (newBlocked !== null || listedRepository === null || busyElsewhere()) return;
		start({ mode: "new", repository: listedRepository, form: blankChopForm(tab, listedRepository.path) }, "form");
	};
	const openChop = (chop: ListedChop, mode: ChopRowMenuId) => {
		if (listedRepository === null || busyElsewhere()) return;
		if (chop.source === "repository-file") {
			start({ mode: "view", repository: listedRepository, name: chop.name }, "close");
			return;
		}
		// As the menu's Edit and Delete are off: nothing of the person's can change now.
		if (editBlocked !== null) return;
		const target = chopTargetOf(chop, listedRepository.path)!;
		if (mode === "delete") {
			start({ mode: "delete", repository: listedRepository, target }, "cancel");
			return;
		}
		const form = chopFormOf(state.preferences.chops, target);
		if (form !== null) start({ mode: "edit", repository: listedRepository, target, form }, "form");
	};
	const cancel = () => {
		if (panelEdit.saving || editing === null) return;
		// The question asked from an edit form goes back to the form, with what was typed.
		if (editing.mode === "delete" && editing.from) {
			start(editing.from, "form");
			return;
		}
		focusNext.current = { back: editing.mode === "new" ? null : editing.mode === "view" ? editing.name : editing.target.name };
		setEditing(null);
	};
	const persist = async (chops: PersonalChop[], repository: string, done: () => void) => {
		changePanelEdit({ saving: true, failure: null });
		const result = await store.savePreferences({ chops });
		if (result.outcome !== "saved") {
			changePanelEdit({ saving: false, failure: result.message });
			return;
		}
		changePanelEdit({ saving: false });
		done();
		// The keeper reads the selected worktree's repository again; with none selected, the list on screen is read here.
		if (store.getState().chops?.repository === repository) void store.readChops(repository);
	};

	const original = editing?.mode === "edit" ? editing.target : null;
	const check = formOpen ? chopsWithSaved(state.preferences.chops, original, editing.form) : null;
	const problem = check !== null && !check.ok ? check.problem : null;
	const save = () => {
		if (!formOpen || panelEdit.saving || editBlocked !== null) return;
		const now = chopsWithSaved(store.getState().preferences.chops, original, editing.form);
		if (!now.ok) {
			changePanelEdit({ tried: true });
			return;
		}
		// A form kept while its repository left the list would save a chop for a repository the app no longer shows.
		if (now.chop.repository !== null && !store.getState().repositories.some(repository => repository.path === now.chop.repository)) {
			changePanelEdit({ failure: `${editing.repository.name} is no longer in the list. Choose Every repository, or cancel.` });
			return;
		}
		const listAtSave = model.list;
		void persist(now.chops, editing.repository.path, () => {
			changePanelEdit({ tried: false });
			setTab(now.chop.kind);
			if (!chopMatches(now.chop, query)) setQuery("");
			focusNext.current = { run: now.chop.name, list: listAtSave };
			setEditing(null);
		});
	};
	const remove = () => {
		if (editing?.mode !== "delete" || panelEdit.saving || editBlocked !== null) return;
		const chops = chopsWithout(store.getState().preferences.chops, editing.target);
		if (chops === null) {
			changePanelEdit({ failure: `${editing.target.name} is no longer saved.` });
			return;
		}
		void persist(chops, editing.repository.path, () => {
			focusNext.current = "new";
			setEditing(null);
		});
	};

	const editorId = `${baseId}-editor`;
	const editor = (): ReactNode => {
		if (editing === null) return null;
		switch (editing.mode) {
			case "new":
			case "edit": {
				const { mode, form, repository } = editing;
				const shown = repository.path === model.repository ? model.list : null;
				return (
					<ChopFormView
						idBase={editorId}
						mode={mode}
						form={form}
						scopeOptions={panelChopScopeOptions(repository)}
						agents={state.preferences.agents}
						problem={problem}
						tried={tried}
						notes={chopFormNotes(form, shown, repository.path, original)}
						failure={failure}
						blocked={editBlocked}
						saving={saving}
						nameRef={nameRef}
						onChange={change => {
							// What is being saved stays as it was sent.
							if (panelEdit.saving) return;
							changePanelEdit({ failure: null, editing: { ...editing, form: { ...form, ...change } } });
						}}
						onSave={save}
						onCancel={cancel}
						onDelete={editing.mode === "edit" ? () => start({ mode: "delete", repository, target: editing.target, from: editing }, "cancel") : undefined}
					/>
				);
			}
			case "view": {
				const list = editing.repository.path === model.repository && model.list?.outcome === "listed" ? model.list : null;
				const chop = list?.chops.find(candidate => candidate.source === "repository-file" && sameChopName(candidate.name, editing.name));
				if (list === null || chop === undefined) return null;
				return <FileChopView idBase={editorId} chop={chop} path={list.path} closeRef={closeRef} onClose={cancel} />;
			}
			case "delete":
				return (
					<DeleteChopView
						idBase={editorId}
						question={describeChopDelete(editing.target, editing.repository.name)}
						failure={failure}
						blocked={editBlocked}
						saving={saving}
						cancelRef={cancelRef}
						onDelete={remove}
						onCancel={cancel}
					/>
				);
		}
	};
	// A file chop shown that is no longer listed here closes, so nothing waits on a view that is not drawn.
	const viewGone = editing?.mode === "view" && editor() === null;
	useEffect(() => {
		if (viewGone && panelEdit.editing?.mode === "view") {
			focusNext.current = null;
			setEditing(null);
		}
	});
	const editedIndex = editing === null ? -1 : model.rows.findIndex(row => isEditedRow(editing, row.chop, model.repository));
	// In place of its row when the row shows; otherwise, as for a new chop, above the list.
	const editorOnTop = editing !== null && editedIndex === -1;

	const openMenuAt = (row: ChopsPanelRow, at: { left: number; top: number }, byKey: boolean) => setMenu({ name: row.chop.name, at, byKey });
	const menuRow = menu === null ? null : model.rows.find(row => row.chop.name === menu.name) ?? null;
	// A menu whose row left the list is put away, so it does not come back with a chop of that name.
	useEffect(() => {
		if (menu !== null && menuRow === null) setMenu(null);
	});
	const actionsButton = (name: string) => {
		const index = model.rows.findIndex(row => row.chop.name === name);
		return index === -1 ? null : document.getElementById(actionsId(index));
	};

	const listed = model.failure === null && model.empty === null;
	return (
		<aside id={CHOPS_PANEL_ID} className="chops-panel" data-view="chops" aria-labelledby={titleId} tabIndex={-1}>
			<div className="chops-panel-head">
				<SidePanelTitle view="chops" titleId={titleId} title={CHOPS_PANEL_TITLE} />
				<button
					ref={newRef}
					type="button"
					className="icon-button chops-panel-new"
					aria-label={CHOPS_NEW_LABEL}
					aria-disabled={newBlocked !== null}
					title={newBlocked ?? CHOPS_NEW_LABEL}
					onClick={openNew}
				>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M8 3v10M3 8h10" />
					</svg>
				</button>
				<button type="button" className="icon-button chops-panel-close" aria-label={CHOPS_CLOSE_LABEL} title={CHOPS_CLOSE_LABEL} onClick={() => hideSidePanel(store)}>
					<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
						<path d="M4 4l8 8M12 4l-8 8" />
					</svg>
				</button>
			</div>
			{listed && (
				<div className="chops-panel-tools">
					<div className="chops-panel-tabs" role="tablist" aria-label={`Chops of ${repositoryName}`} onKeyDown={onTabKey}>
						{CHOPS_TABS.map(kind => (
							<button
								key={kind}
								type="button"
								role="tab"
								id={tabId(kind)}
								className={kind === tab ? "chops-panel-tab selected" : "chops-panel-tab"}
								aria-selected={kind === tab}
								aria-controls={listId}
								// Only the tab that shows is a tab stop. The arrows reach the other.
								tabIndex={kind === tab ? 0 : -1}
								onClick={() => showTab(kind)}
							>
								{chopsTabLabel(kind)} <span className="chops-panel-count">{model.counts[kind]}</span>
							</button>
						))}
					</div>
					<input
						type="search"
						className="filter chops-panel-filter"
						placeholder={CHOPS_FILTER_LABEL}
						aria-label={CHOPS_FILTER_LABEL}
						aria-controls={listId}
						value={query}
						onChange={event => setQuery(event.target.value)}
					/>
				</div>
			)}
			<div className="chops-panel-body">
				{editorOnTop && editor()}
				{model.failure !== null && <p className="dialog-note">{model.failure}</p>}
				{model.empty !== null && <p className="dialog-note" role={model.reading ? "status" : undefined}>{model.empty}</p>}
				{model.empty !== null && !model.reading && newBlocked === null && editing === null && (
					<button type="button" className="button quiet chops-panel-empty-new" onClick={openNew}>{CHOPS_NEW_LABEL}</button>
				)}
				{listed && (
					<div id={listId} role="tabpanel" aria-labelledby={tabId(tab)}>
						<p className="dialog-note chops-panel-none" role="status">{model.tabEmpty ?? ""}</p>
						{model.rows.length > 0 && (
							<ul className="chops-panel-list" aria-label={`${chopsTabLabel(tab)} of ${repositoryName}`}>
								{model.rows.map((row, index) => (
									<li
										key={row.chop.name}
										className="chops-panel-item"
										onContextMenu={event => {
											if (index === editedIndex) return;
											event.preventDefault();
											// A browser may follow Shift+F10 with a contextmenu event; the menu the key opened stays where it is.
											if (menu?.byKey && menu.name === row.chop.name) return;
											openMenuAt(row, { left: event.clientX, top: event.clientY }, false);
										}}
										onKeyDown={event => {
											if (index === editedIndex || !opensWorktreeMenu(event)) return;
											event.preventDefault();
											const box = document.getElementById(actionsId(index))?.getBoundingClientRect();
											openMenuAt(row, { left: box?.left ?? 0, top: box?.bottom ?? 0 }, true);
										}}
									>
										{index === editedIndex ? editor() : (
											<>
												<div className="chops-panel-row">
													<p className="chop-item-head" title={row.chop.source === "repository-file" ? "Double-click to view" : "Double-click to edit"} onDoubleClick={() => openChop(row.chop, "edit")}>
														<span className="chop-item-name">{row.chop.name}</span>{" "}
														<span className="chop-item-meta" title={row.sourceTitle}>{row.source}</span>
													</p>
													<button
														type="button"
														id={actionsId(index)}
														data-chop-actions={row.chop.name}
														className="icon-button chops-panel-actions"
														aria-label={chopRowMenuLabel(row.chop.name)}
														aria-haspopup="menu"
														aria-expanded={menu?.name === row.chop.name}
														aria-keyshortcuts={WORKTREE_MENU_SHORTCUTS}
														title={chopRowMenuLabel(row.chop.name)}
														onClick={event => {
															const box = event.currentTarget.getBoundingClientRect();
															openMenuAt(row, { left: box.left, top: box.bottom }, false);
														}}
													>
														<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
															<circle cx="3.5" cy="8" r="1.25" />
															<circle cx="8" cy="8" r="1.25" />
															<circle cx="12.5" cy="8" r="1.25" />
														</svg>
													</button>
													<button
														type="button"
														className="button quiet chops-panel-run"
														data-chop-run={row.chop.name}
														aria-label={row.label}
														aria-disabled={model.blocked !== null}
														aria-describedby={`${textId(index)} ${footerId}`}
														title={model.blocked ?? row.label}
														onClick={event => choose(row, event.detail)}
													>
														{row.word}
													</button>
												</div>
												{/* Focusable, so a long text that scrolls can be read by keyboard before it runs. */}
												<pre id={textId(index)} className="chops-panel-text" tabIndex={0}>{row.chop.text}</pre>
											</>
										)}
									</li>
								))}
							</ul>
						)}
					</div>
				)}
			</div>
			{listed && <p id={footerId} className="chops-panel-footer">{model.footer}</p>}
			{menu !== null && menuRow !== null && (
				<WorktreeMenu<ChopRowMenuId>
					label={chopRowMenuLabel(menuRow.chop.name)}
					items={chopRowMenuItems(menuRow.chop.source, editBlocked)}
					at={menu.at}
					onClose={backToRow => {
						const name = menu.name;
						setMenu(null);
						if (backToRow) actionsButton(name)?.focus();
					}}
					onChoose={id => openChop(menuRow.chop, id)}
				/>
			)}
		</aside>
	);
}

/**
 * Shows or hides the chops panel from the keyboard, as the title bar's
 * Chops button does. It draws nothing. It listens on the window in the
 * capture phase, so it hears the keys of a focused terminal too. The key is
 * taken from the page only when it showed or hid the panel: with chops off,
 * a dialog open, or Timber not ready, it goes on as if the app had no such
 * key.
 */
export function ChopsShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!takesChopsPanelKey(event, store.getState())) return;
			event.preventDefault();
			// A held chord shows or hides the panel once.
			if (!event.repeat) toggleChopsPanel(store);
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
