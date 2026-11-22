import { type KeyboardEvent as ReactKeyboardEvent, type PointerEvent, type ReactNode, useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { type ChopArrangement, type ChopArrangements, type ChopPlace, arrangeChops, chopArrangementOf, describeChopAtEnd, describeChopPlace, placeChop, renameInArrangements, stepChop, toggleChopFavorite, withChopArrangement } from "../../shared/chop-order";
import { withFileChopSound } from "../../shared/chop-sounds";
import { type ChopKind, type ChopList, type ListedChop, type PersonalChop, listedChops, sameChopName } from "../../shared/chops";
import type { SoundChoice } from "../../shared/sound-setting";
import {
	type ChopForm, type ChopTarget, blankChopForm, chopEditBlockedReason, chopRenames, chopFormNotes, chopFormOf, chopTargetOf, chopsWithSaved, chopsWithout, describeChopDelete, panelChopScopeOptions,
} from "../chop-format";
import {
	CHOPS_CLOSE_LABEL, CHOPS_FAVORITES_DROP, CHOPS_FAVORITES_HEADING, CHOPS_FILTER_LABEL, CHOPS_NEW_LABEL, CHOPS_PANEL_ID, CHOPS_PANEL_TITLE, CHOPS_REST_HEADING, CHOPS_TABS,
	MOVE_CHOP_HINT, type ChopRowMenuId, type ChopsPanelRow, chopDropPlace, chopsDragScroll, listedChopArrangement, pendingChopRenames, chopMatches, chopRowMenuItems, chopRowMenuLabel, chopsNewBlockedReason, chopsPanelModel, chopsTabAfterKey, chopsTabLabel,
	favoriteChopHint, favoriteChopLabel, moveChopLabel, takesChopsPanelKey,
} from "../chops-panel-format";
import { DRAG_THRESHOLD, MOVE_REPOSITORY_SHORTCUTS, moveStep } from "../repository-drag";
import { shownChopOrder } from "../store/state";
import { describeSoundOutcome } from "../notifications-format";
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
	/** Counts each form or view opened, so a file dialog that answers after it closed changes nothing. */
	opened: number;
	/** What choosing, playing, or saving the sound last came to, when it went wrong, or null. */
	soundProblem: string | null;
	/** The file "Your own file" last chose in the form or view open now. */
	customSoundPath: string | undefined;
	/** Whether a file chop's sound waits for its save. While it waits, its picker takes no change. */
	soundSaving: boolean;
}

/*
 * Kept here, as `returnTo` is, because the panel is not drawn while it is
 * hidden: a form half typed is still there when the panel shows again, also
 * after another repository was selected, and a save that answers while the
 * panel is hidden or drawn anew still closes its form. It saves for the
 * repository it was opened for.
 */
let panelEdit: PanelEdit = { editing: null, saving: false, failure: null, tried: false, opened: 0, soundProblem: null, customSoundPath: undefined, soundSaving: false };
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

/** The controls of a row the keyboard can be sent back to after a move, by their `data-chop-*` attribute. */
type RowControl = "handle" | "star" | "actions" | "run" | "text";
const ROW_CONTROLS: readonly RowControl[] = ["handle", "star", "actions", "run", "text"];

/** Where the keyboard goes once the panel is drawn again. */
type FocusAim = "form" | "cancel" | "close" | "new" | { back: string | null } | { run: string; list: ChopList | null } | { control: RowControl; name: string };

/** Which control of a row an element is, or the handle when it is none of them. */
function rowControlOf(element: EventTarget | null): RowControl {
	if (!(element instanceof HTMLElement)) return "handle";
	return ROW_CONTROLS.find(control => element.closest(`[data-chop-${control}]`) !== null) ?? "handle";
}

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
	const { editing, saving, failure, tried, soundProblem, customSoundPath, soundSaving } = useSyncExternalStore(subscribePanelEdit, readPanelEdit, readPanelEdit);
	const setEditing = (next: Editing | null) => changePanelEdit({ editing: next });
	const [menu, setMenu] = useState<{ name: string; at: { left: number; top: number }; byKey: boolean } | null>(null);
	/** What the live region last said about a move or a star, and whether to end it with a no-break space, so the same words said again change the text and are heard again. */
	const [said, setSaidState] = useState({ text: "", odd: true });
	const setSaid = (text: string) => setSaidState(last => ({ text, odd: !last.odd }));
	/** The latest move or star, so only its save's failure is said: a later save holds an earlier one's change. */
	const arrangeTicket = useRef(0);
	const [drag, setDrag] = useState<{ name: string; place: ChopPlace } | null>(null);
	const press = useRef<{ name: string; pointerId: number; startY: number; dragging: boolean } | null>(null);
	/** Where the pointer of a drag is, and the frame that scrolls the list for it, if one waits. */
	const pointerY = useRef(0);
	const scrollFrame = useRef<number | null>(null);
	const showDropRef = useRef<((name: string, y: number) => void) | null>(null);
	const restHeadingRef = useRef<HTMLHeadingElement>(null);
	const dropZoneRef = useRef<HTMLParagraphElement>(null);
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
		else if ("control" in aim) {
			const controls = panelElement()?.querySelectorAll<HTMLElement>(`[data-chop-${aim.control}]`) ?? [];
			target = [...controls].find(control => sameChopName(control.getAttribute(`data-chop-${aim.control}`) ?? "", aim.name)) ?? null;
		} else if ("back" in aim) {
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
		// Back to the form a delete was asked from: the file it chose is still its own.
		const back = next.mode === "edit" && editing?.mode === "delete" && editing.from === next;
		changePanelEdit({
			editing: next, tried: false, failure: null, soundProblem: null,
			...(back ? {} : { opened: panelEdit.opened + 1, customSoundPath: next.mode === "edit" && next.form.sound?.kind === "custom" ? next.form.sound.path : undefined }),
		});
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
	const persist = async (chops: PersonalChop[], repository: string, done: () => void, chopOrder: ChopArrangements | null = null) => {
		changePanelEdit({ saving: true, failure: null });
		const result = chopOrder === null ? await store.savePreferences({ chops }) : await store.saveChopOrder(chopOrder, { chops });
		if (result.outcome !== "saved") {
			// Nothing was renamed, so the rows keep the saved order by their names.
			store.noteChopRenames([]);
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
		// A renamed chop keeps its place and its star, saved with it, from the order on screen.
		const order = shownChopOrder(store.getState());
		const renames = original === null ? [] : chopRenames(now.chops, [{ from: original, to: now.chop }]);
		const renamed = renames.length === 0 ? null : renameInArrangements(order, renames);
		store.noteChopRenames(renames);
		void persist(now.chops, editing.repository.path, () => {
			changePanelEdit({ tried: false });
			setTab(now.chop.kind);
			if (!chopMatches(now.chop, query)) setQuery("");
			focusNext.current = { run: now.chop.name, list: listAtSave };
			setEditing(null);
		}, renamed);
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

	/**
	 * Move or star a chop: the order on screen changes at once and is saved
	 * as the `chopOrder` preference, never in the repository. The live region
	 * says where the chop is now, and the keyboard goes back to the control
	 * that had it.
	 */
	const arrange = (name: string, change: (chops: readonly ListedChop[], arrangement: ChopArrangement) => ChopArrangement, control: RowControl) => {
		const repository = model.repository;
		if (repository === null || panelEdit.saving) return;
		if (editBlocked !== null) {
			setSaid(editBlocked);
			return;
		}
		// From the store, not from the last render: keys can arrive faster than the panel is drawn again.
		const order = shownChopOrder(store.getState());
		const chops = listedChops(model.list);
		// By the names listed, also for a chop renamed but not read again yet; saved under the new names.
		const renames = pendingChopRenames(store.getState(), model.list);
		const listedNext = change(chops, listedChopArrangement(store.getState(), repository, model.list));
		const next = renames.length === 0 ? listedNext : chopArrangementOf(renameInArrangements({ [repository]: listedNext }, renames), repository);
		const shown = arrangeChops(chops, listedNext).filter(({ chop }) => chop.kind === tab && chopMatches(chop, query));
		focusNext.current = { control, name };
		setSaid(describeChopPlace(shown, name));
		const ticket = ++arrangeTicket.current;
		void store.saveChopOrder(withChopArrangement(order, repository, next)).then(result => {
			if (result.outcome !== "saved" && ticket === arrangeTicket.current) setSaid(`The order of the chops could not be saved: ${result.message}`);
		});
	};
	const place = (name: string, at: ChopPlace, control: RowControl) => arrange(name, (chops, arrangement) => placeChop(chops, arrangement, name, at), control);
	const toggleFavorite = (name: string) => arrange(name, (chops, arrangement) => toggleChopFavorite(chops, arrangement, name), "star");
	const onRowStep = (row: ChopsPanelRow, step: -1 | 1, from: EventTarget | null) => {
		// From the store, as `arrange` reads it: a second key can come before the panel is drawn again.
		const now = chopsPanelModel(store.getState(), tab, query);
		const at = stepChop(now.arranged, now.rows, row.chop.name, step);
		if (at === null) setSaid(describeChopAtEnd(row.chop.name, row.favorite, step));
		else place(row.chop.name, at, rowControlOf(from));
	};

	// Dragging a row by its handle: a line shows where it will land, and a drop above the rest's heading pins it.
	const dropPlaceAt = (name: string, y: number): ChopPlace => {
		const slots = model.rows.filter(row => row.chop.name !== name).flatMap(row => {
			const box = panelElement()?.querySelector<HTMLElement>(`[data-chop-row="${CSS.escape(row.chop.name)}"]`)?.getBoundingClientRect();
			return box === undefined ? [] : [{ name: row.chop.name, favorite: row.favorite, middle: box.top + box.height / 2 }];
		});
		const heading = restHeadingRef.current?.getBoundingClientRect();
		const zone = dropZoneRef.current?.getBoundingClientRect();
		const line = heading !== undefined ? heading.top + heading.height / 2 : zone !== undefined ? zone.bottom : null;
		return chopDropPlace(slots, line, y);
	};
	const onHandlePointerDown = (name: string, event: PointerEvent<HTMLButtonElement>) => {
		if (event.button !== 0 || editBlocked !== null || panelEdit.saving) return;
		press.current = { name, pointerId: event.pointerId, startY: event.clientY, dragging: false };
	};
	const onHandlePointerMove = (event: PointerEvent<HTMLButtonElement>) => {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		// Let go somewhere the handle did not hear, such as beside it before the drag began: the press is over.
		if (event.buttons === 0) {
			onHandlePointerCancel();
			return;
		}
		if (!current.dragging) {
			if (Math.abs(event.clientY - current.startY) < DRAG_THRESHOLD) return;
			current.dragging = true;
			event.currentTarget.setPointerCapture(event.pointerId);
		}
		pointerY.current = event.clientY;
		showDropAt(current.name, event.clientY);
		if (scrollFrame.current === null) scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
	};
	/** Show where a dragged chop would land for a pointer at `y`. */
	const showDropAt = (name: string, y: number) => {
		const at = dropPlaceAt(name, y);
		setDrag(last => last?.name === name && last.place.favorite === at.favorite && last.place.before === at.before ? last : { name, place: at });
	};
	// The latest render's, for the frame loop below, which outlives the render that started it.
	showDropRef.current = showDropAt;
	const onHandlePointerUp = (event: PointerEvent<HTMLButtonElement>) => {
		const current = press.current;
		if (!current || current.pointerId !== event.pointerId) return;
		press.current = null;
		setDrag(null);
		if (current.dragging) place(current.name, dropPlaceAt(current.name, event.clientY), "handle");
	};
	function onHandlePointerCancel() {
		press.current = null;
		setDrag(null);
	}
	/**
	 * While a chop is dragged near the top or bottom of the list, or past
	 * it, the list scrolls a little each frame (`chopsDragScroll`), so a chop
	 * can go anywhere in a long list, and where it would land follows.
	 */
	function scrollWhileDragging() {
		scrollFrame.current = null;
		const current = press.current;
		const body = panelElement()?.querySelector<HTMLElement>(".chops-panel-body");
		if (!current?.dragging || !body) return;
		const box = body.getBoundingClientRect();
		const step = chopsDragScroll(pointerY.current, box.top, box.bottom);
		if (step === 0) return;
		const before = body.scrollTop;
		body.scrollTop = before + step;
		if (body.scrollTop === before) return;
		showDropRef.current?.(current.name, pointerY.current);
		scrollFrame.current = requestAnimationFrame(scrollWhileDragging);
	}
	// While a handle is pressed: a release the handle did not hear ends the press, and Escape puts a drag away, wherever the keyboard is.
	useEffect(() => {
		const onUp = (event: globalThis.PointerEvent) => {
			if (press.current?.pointerId === event.pointerId) onHandlePointerCancel();
		};
		const onKey = (event: KeyboardEvent) => {
			if (event.key !== "Escape" || !press.current?.dragging) return;
			event.preventDefault();
			event.stopPropagation();
			onHandlePointerCancel();
		};
		window.addEventListener("pointerup", onUp);
		window.addEventListener("pointercancel", onUp);
		window.addEventListener("keydown", onKey, true);
		return () => {
			if (scrollFrame.current !== null) cancelAnimationFrame(scrollFrame.current);
			window.removeEventListener("pointerup", onUp);
			window.removeEventListener("pointercancel", onUp);
			window.removeEventListener("keydown", onKey, true);
		};
	}, []);

	/** Play a sound as a preview, and say when it could not play. */
	const previewSound = async (sound: SoundChoice | null) => {
		if (sound === null) return;
		const opened = panelEdit.opened;
		const said = describeSoundOutcome(await store.playSound(sound));
		if (panelEdit.opened === opened) changePanelEdit({ soundProblem: said });
	};
	/** Ask for a sound file of the person's own: the form takes it, or a file chop's sound is saved with it. Dropped when what asked closed meanwhile. */
	const chooseSoundFile = async (then: (sound: SoundChoice) => void) => {
		const opened = panelEdit.opened;
		const result = await store.chooseSoundFile();
		if (panelEdit.opened !== opened || panelEdit.editing === null) return;
		if (result.outcome === "chosen") {
			changePanelEdit({ customSoundPath: result.path, soundProblem: null });
			then({ kind: "custom", path: result.path });
		} else if (result.outcome === "refused") changePanelEdit({ soundProblem: result.message });
	};
	const chooseFormSoundFile = () => void chooseSoundFile(sound => {
		const now = panelEdit.editing;
		if (panelEdit.saving || (now?.mode !== "new" && now?.mode !== "edit")) return;
		changePanelEdit({ failure: null, editing: { ...now, form: { ...now.form, sound } } });
	});
	/**
	 * Save the sound of a chop from the repository file at once, in the app's
	 * settings (`fileChopSounds`), never in the file, from what is saved when
	 * the save starts. One save at a time, so none undoes another.
	 */
	const saveFileChopSound = async (repository: string, name: string, sound: SoundChoice | null) => {
		// From the store, not the render: a file dialog may answer after saves became blocked.
		if (panelEdit.soundSaving || chopEditBlockedReason(store.getState().preferencesProblem) !== null) return;
		const opened = panelEdit.opened;
		changePanelEdit({ soundSaving: true, soundProblem: null });
		const next = withFileChopSound(store.getState().preferences.fileChopSounds, repository, name, sound);
		const result = await store.savePreferences({ fileChopSounds: next });
		// A failure is said only in the view it was saved from, not in a form opened since.
		const said = result.outcome !== "saved" && panelEdit.opened === opened ? { soundProblem: `Not saved: ${result.message}` } : {};
		changePanelEdit({ soundSaving: false, ...said });
		if (result.outcome === "saved" && store.getState().chops?.repository === repository) void store.readChops(repository);
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
						soundProblem={soundProblem}
						customSoundPath={customSoundPath}
						nameRef={nameRef}
						onChange={change => {
							// What is being saved stays as it was sent.
							if (panelEdit.saving) return;
							changePanelEdit({ failure: null, ...(change.sound === undefined ? {} : { soundProblem: null }), editing: { ...editing, form: { ...form, ...change } } });
						}}
						onChooseSoundFile={chooseFormSoundFile}
						onPlaySound={() => void previewSound(form.sound)}
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
				const repository = editing.repository.path;
				return (
					<FileChopView
						idBase={editorId}
						chop={chop}
						path={list.path}
						saving={soundSaving}
						blocked={editBlocked}
						soundProblem={soundProblem}
						customSoundPath={customSoundPath ?? (chop.sound?.kind === "custom" ? chop.sound.path : undefined)}
						closeRef={closeRef}
						onClose={cancel}
						onPickSound={sound => void saveFileChopSound(repository, chop.name, sound)}
						onChooseSoundFile={() => void chooseSoundFile(sound => void saveFileChopSound(repository, chop.name, sound))}
						onPlaySound={() => void previewSound(chop.sound)}
					/>
				);
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

	// Each row's ids count across both parts, so they stay unique.
	const favoriteRows = model.rows.filter(row => row.favorite);
	const otherRows = model.rows.filter(row => !row.favorite);
	const lastOf = (rows: readonly ChopsPanelRow[]) => rows.at(-1)?.chop.name ?? null;
	const rowClass = (row: ChopsPanelRow) => {
		const names = ["chops-panel-item"];
		if (drag === null) return names[0];
		if (drag.name === row.chop.name) names.push("dragging");
		if (drag.place.favorite === row.favorite && drag.place.before !== null && sameChopName(drag.place.before, row.chop.name)) names.push("drop-before");
		if (drag.place.before === null && drag.place.favorite === row.favorite && lastOf(row.favorite ? favoriteRows : otherRows) === row.chop.name) names.push("drop-after");
		return names.join(" ");
	};
	const dropAfterHeading = drag !== null && !drag.place.favorite && drag.place.before === null && otherRows.length === 0;
	const renderRow = (row: ChopsPanelRow) => {
		const index = model.rows.indexOf(row);
		return (
			<li
				key={row.chop.name}
				data-chop-row={row.chop.name}
				className={rowClass(row)}
				onContextMenu={event => {
					if (index === editedIndex) return;
					event.preventDefault();
					// A browser may follow Shift+F10 with a contextmenu event; the menu the key opened stays where it is.
					if (menu?.byKey && menu.name === row.chop.name) return;
					openMenuAt(row, { left: event.clientX, top: event.clientY }, false);
				}}
				onKeyDown={event => {
					if (index === editedIndex) return;
					const step = moveStep(event);
					if (step !== 0) {
						event.preventDefault();
						onRowStep(row, step, event.target);
						return;
					}
					if (!opensWorktreeMenu(event)) return;
					event.preventDefault();
					const box = document.getElementById(actionsId(index))?.getBoundingClientRect();
					openMenuAt(row, { left: box?.left ?? 0, top: box?.bottom ?? 0 }, true);
				}}
			>
				{index === editedIndex ? editor() : (
					<>
						<div className="chops-panel-row">
							<button
								type="button"
								className="icon-button chops-panel-handle"
								data-chop-handle={row.chop.name}
								aria-label={moveChopLabel(row.chop.name)}
								aria-keyshortcuts={MOVE_REPOSITORY_SHORTCUTS}
								aria-disabled={editBlocked !== null}
								title={editBlocked ?? MOVE_CHOP_HINT}
								onPointerDown={event => onHandlePointerDown(row.chop.name, event)}
								onPointerMove={onHandlePointerMove}
								onPointerUp={onHandlePointerUp}
								onPointerCancel={onHandlePointerCancel}
								onLostPointerCapture={onHandlePointerCancel}
							>
								<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
									<circle cx="6" cy="4" r="1.1" />
									<circle cx="10" cy="4" r="1.1" />
									<circle cx="6" cy="8" r="1.1" />
									<circle cx="10" cy="8" r="1.1" />
									<circle cx="6" cy="12" r="1.1" />
									<circle cx="10" cy="12" r="1.1" />
								</svg>
							</button>
							<button
								type="button"
								className={row.favorite ? "icon-button chops-panel-star favorite" : "icon-button chops-panel-star"}
								data-chop-star={row.chop.name}
								aria-label={favoriteChopLabel(row.chop.name)}
								aria-pressed={row.favorite}
								aria-disabled={editBlocked !== null}
								title={editBlocked ?? favoriteChopHint(row.favorite)}
								onClick={() => toggleFavorite(row.chop.name)}
							>
								<svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill={row.favorite ? "currentColor" : "none"} stroke="currentColor" strokeWidth="1.3" strokeLinejoin="round">
									<path d="M8 1.8l1.9 3.9 4.3.6-3.1 3 .7 4.3L8 11.6l-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
								</svg>
							</button>
							<p className="chop-item-head" title={row.chop.source === "repository-file" ? "Double-click to view" : "Double-click to edit"} onDoubleClick={() => openChop(row.chop, "edit")}>
								<span className="chop-item-name">{row.chop.name}</span>{" "}
								<span className="chop-item-meta" title={row.sourceTitle}>{row.source}</span>
								{row.sound !== null && <span className="chop-item-meta chop-item-sound" title={row.soundTitle ?? undefined}>{row.sound}</span>}
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
								// No tooltip while its menu is open: it would cover the menu.
								title={menu?.name === row.chop.name ? undefined : chopRowMenuLabel(row.chop.name)}
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
						<pre id={textId(index)} className="chops-panel-text" data-chop-text={row.chop.name} tabIndex={0}>{row.chop.text}</pre>
					</>
				)}
			</li>
		);
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
							{favoriteRows.length === 0 && drag !== null && (
								<p ref={dropZoneRef} className={drag.place.favorite ? "chops-panel-drop active" : "chops-panel-drop"}>{CHOPS_FAVORITES_DROP}</p>
							)}
							{favoriteRows.length > 0 && (
								<>
									<h3 className="chops-panel-section">{CHOPS_FAVORITES_HEADING}</h3>
									<ul className="chops-panel-list" aria-label={`Favorite ${chopsTabLabel(tab).toLowerCase()} of ${repositoryName}`}>
										{favoriteRows.map(renderRow)}
									</ul>
									{/* With every chop of the tab a favorite, only while dragging, as the place to drop one out of Favorites. */}
									{(otherRows.length > 0 || drag !== null) && (
										<h3 ref={restHeadingRef} className={dropAfterHeading ? "chops-panel-section drop-after" : "chops-panel-section"}>{CHOPS_REST_HEADING}</h3>
									)}
								</>
							)}
							{otherRows.length > 0 && (
								<ul className="chops-panel-list" aria-label={`${favoriteRows.length > 0 ? "Other " + chopsTabLabel(tab).toLowerCase() : chopsTabLabel(tab)} of ${repositoryName}`}>
									{otherRows.map(renderRow)}
								</ul>
							)}
					</div>
				)}
			</div>
			{listed && <p id={footerId} className="chops-panel-footer">{model.footer}</p>}
			<p className="visually-hidden" role="status" aria-live="polite">{said.text === "" ? "" : `${said.text}${said.odd ? "\u00a0" : ""}`}</p>
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
