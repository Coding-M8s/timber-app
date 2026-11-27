import { type ArrangedChop, type ChopArrangement, type ChopRename, NO_CHOP_ARRANGEMENT, arrangeChops, chopArrangementOf, renameInArrangements } from "../shared/chop-order";
import { defaultAgent, defaultAgentName, describeMissingPick, whyNoDefaultAgent } from "../shared/agent-lookup";
import { DEFAULT_SHORTCUTS, type ShortcutLetter, describeChord, matchesChord, shortcutLetter } from "../shared/shortcuts";
import { type ChopKind, type ChopList, type ChopSource, type ListedChop, listedChops } from "../shared/chops";
import { promptTarget } from "./agent-sessions";
import { type ChopAction, chopAction, chopButtonLabel, describeChopSource } from "./chop-format";
import { worktreeLabel } from "./format";
import { soundName } from "./notifications-format";
import { chopBlockedReason, chopPlace } from "./palette";
import { type AppState, canToggleChopsPanel, offeredChops, repositoryPick, selectedWorktree, shownChopOrder } from "./store/state";

/**
 * Words and keys of the chops panel: the title bar's Chops button, the
 * panel's frame, and the shortcut that shows or hides it. Pure, so they can
 * be tested without a window.
 *
 * Whether any of it is offered is `chopsEnabled` in ./store/state.ts: with
 * "Use chops" off in Settings, there is no button, no panel, and no
 * shortcut, and the saved chops are kept. The rest of the window offers
 * chops through `offeredChops`.
 */

/** The `id` of the panel, which the button and the panel's edge say they control. */
export const CHOPS_PANEL_ID = "chops-panel";
/** The `id` of the title bar's Chops button, where focus goes back when nothing else can take it. */
export const CHOPS_BUTTON_ID = "titlebar-chops";

export const CHOPS_PANEL_TITLE = "Chops";
/**
 * What a chop is, in one sentence: the tooltip of the side panel switch's
 * Chops button, the panel's visible title, and the first sentence the panel
 * says while it has no chops.
 */
export const CHOPS_DEFINITION = "Chops are saved commands and agent prompts to run in a worktree.";
export const CHOPS_BUTTON_LABEL = "Chops";
export const CHOPS_CLOSE_LABEL = "Hide the chops panel";
export const CHOPS_NEW_LABEL = "New chop";
export const CHOPS_WIDTH_LABEL = "Chops panel width";

/**
 * The shortcut that shows or hides the chops panel. The design mock's
 * Ctrl+Alt+C was a placeholder: on Windows, AltGr reaches the page as
 * Ctrl+Alt, so it would take a character such as the Polish "ć" from
 * anyone typing it, and in a terminal Ctrl+Alt+C is Escape then Ctrl+C to
 * the program. Ctrl+Shift+K keeps the app's own pattern (Ctrl+Shift+P,
 * Ctrl+Shift+J, Ctrl+Shift+S), clashes with none of its keys or the
 * desktops' usual ones, and takes nothing from a terminal program, which
 * cannot tell it from Ctrl+K. It is the default: Settings, Chops can set
 * another (../shared/shortcuts.ts).
 */
export const CHOPS_PANEL_SHORTCUT = "Ctrl+Shift+K";
export const CHOPS_PANEL_SHORTCUT_MAC = "Cmd+Shift+K";

/** The panel's shortcut for this platform: the key set in Settings, Shortcuts, or Ctrl+Shift+K (Cmd+Shift+K on macOS). */
export function chopsPanelShortcut(mac: boolean, letter: ShortcutLetter = DEFAULT_SHORTCUTS["chops-panel"]): string {
	return describeChord(letter, mac);
}

/** The Chops button's tooltip: what a click does now, and the shortcut as set, for this platform. */
export function chopsButtonHint(open: boolean, mac: boolean, letter: ShortcutLetter = DEFAULT_SHORTCUTS["chops-panel"]): string {
	return `${open ? "Hide" : "Show"} chops (${chopsPanelShortcut(mac, letter)})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift and the letter set, Ctrl+Shift+K until another is, or Cmd+Shift on macOS. Either modifier counts, as for the palette's shortcut. */
export function isChopsPanelShortcut(event: Keys, letter: ShortcutLetter = DEFAULT_SHORTCUTS["chops-panel"]): boolean {
	return matchesChord(event, letter);
}

/**
 * Whether the app takes this key from the page, and from a terminal's
 * program, to show or hide the chops panel: the chord as set in Settings,
 * while the panel can be shown or hidden. With chops off, a dialog open, or
 * Timber not ready, the key goes on to the page and the program as if the
 * app had none.
 */
export function takesChopsPanelKey(event: Keys, state: AppState): boolean {
	return isChopsPanelShortcut(event, shortcutLetter(state.preferences.shortcuts, "chops-panel")) && canToggleChopsPanel(state);
}

/**
 * What the panel says while it has nothing to list: with no worktree
 * selected and no chops read yet, that one should be selected; with one
 * selected, that they are being read; then what a chop is, that there are
 * none, and how to make one.
 */
export function describeChopsPanelEmpty(selected: boolean, listed: number | null): string | null {
	if (listed === null) return selected ? "Reading the chops" : "Select a worktree to see the chops of its repository.";
	if (listed === 0) return `${CHOPS_DEFINITION} None yet. Make one with New chop, or share some with everyone in .timber/chops.json.`;
	return null;
}

/** The panel's tabs: one for commands, one for prompts. */
export const CHOPS_TABS: readonly ChopKind[] = ["command", "prompt"];

const TAB_WORDS: Record<ChopKind, { tab: string; plural: string }> = {
	command: { tab: "Commands", plural: "commands" },
	prompt: { tab: "Prompts", plural: "prompts" },
};

export function chopsTabLabel(kind: ChopKind): string {
	return TAB_WORDS[kind].tab;
}

/** The tab the arrow keys, Home, or End move to, or null for any other key. Two tabs: either arrow goes to the other. */
export function chopsTabAfterKey(current: ChopKind, key: string): ChopKind | null {
	switch (key) {
		case "ArrowLeft":
		case "ArrowRight":
			return current === "command" ? "prompt" : "command";
		case "Home":
			return "command";
		case "End":
			return "prompt";
		default:
			return null;
	}
}

export const CHOPS_FILTER_LABEL = "Filter chops";

const SOURCE_SHORT: Record<ChopSource, string> = {
	"repository-file": ".timber",
	"personal-repository": "this repository",
	"personal-every": "every repository",
};

/** Where a chop comes from, in the panel's few words. The tooltip says it in full (`describeChopSource`). */
export function chopSourceShort(source: ChopSource): string {
	return SOURCE_SHORT[source];
}

/** A row's sound tooltip: what plays as the chop starts, or that chop sounds are off. */
export function describeChopSound(name: string, playChopSounds: boolean): string {
	return playChopSounds ? `Plays ${name} when it starts` : `Sound: ${name}. Chop sounds are off in Settings, Chops.`;
}

/** Whether a chop's name or text has the query, ignoring case. An empty query has every chop. */
export function chopMatches(chop: Pick<ListedChop, "name" | "text">, query: string): boolean {
	const wanted = query.trim().toLowerCase();
	return wanted === "" || chop.name.toLowerCase().includes(wanted) || chop.text.toLowerCase().includes(wanted);
}

/** What a tab says when it lists nothing: no chop matches the filter, or it has none of its kind. */
export function describeChopsTabEmpty(kind: ChopKind, query: string): string {
	const wanted = query.trim();
	if (wanted !== "") return `No ${TAB_WORDS[kind].plural} match "${wanted}".`;
	return `No ${TAB_WORDS[kind].plural} yet. Make one with New chop.`;
}

/** The visible word of a row's button. Its accessible name is `chopButtonLabel`, which names the chop. */
export function chopRunWord(action: ChopAction): string {
	switch (action) {
		case "run":
			return "Run";
		case "send":
			return "Send";
		case "copy":
			return "Copy";
	}
}

export interface ChopsPanelRow extends ArrangedChop {
	chop: ListedChop;
	/** Where it comes from, short, and in full for the tooltip. */
	source: string;
	sourceTitle: string;
	/** Its sound in a few words, and in full for the tooltip, or null for none. */
	sound: string | null;
	soundTitle: string | null;
	action: ChopAction;
	/** The button's visible word, and its accessible name. */
	word: string;
	label: string;
}

export interface ChopsPanelModel {
	/** The repository whose chops are listed, by its primary checkout, or null when none are. */
	repository: string | null;
	/** The list read for `repository`, or null. */
	list: ChopList | null;
	/** Why the list could not be read, or null. */
	failure: string | null;
	/** What shows in place of the tabs while there is nothing to list, or null. */
	empty: string | null;
	/** Whether the selected worktree's repository's chops are being read. */
	reading: boolean;
	/** How many chops of each kind, whatever the filter. */
	counts: Record<ChopKind, number>;
	/** The repository's order and favorites, as shown now. Empty when no repository's chops are listed. */
	arrangement: ChopArrangement;
	/** Every chop listed, both kinds, favorites first, in the person's order (`arrangeChops`). */
	arranged: ArrangedChop[];
	/** The chops of the tab that match the filter, in the person's order: favorites first. */
	rows: ChopsPanelRow[];
	/** What the tab says when `rows` is empty, or null. */
	tabEmpty: string | null;
	/** Why this tab's chops cannot be chosen now, or null. Every row of a tab does the same, so it holds for each. */
	blocked: string | null;
	/** Where the next run goes, or, while blocked, why nothing runs. */
	footer: string;
}

/**
 * Where a choice of the tab goes now, in words: a command to a new terminal
 * in the selected worktree; a prompt to its only agent, to a new agent, to
 * the one the person picks, or to the clipboard with no agent saved.
 */
function describeTarget(state: AppState, kind: ChopKind, action: ChopAction): string {
	const selection = selectedWorktree(state)!;
	const where = worktreeLabel(selection.worktree);
	if (kind === "command") return `Commands run in a new terminal in ${where}.`;
	if (action === "copy") return "No agent is saved in Settings, Agents, so a prompt is copied to the clipboard.";
	const target = promptTarget(state.terminals, selection.worktree.id);
	switch (target.kind) {
		case "session": {
			const session = state.terminals.find(candidate => candidate.id === target.session);
			return `Prompts go to ${session?.name ?? "the agent running"} in ${where}.`;
		}
		case "new": {
			// The default agent: the repository's, or the first saved one found.
			const { agents } = state.preferences;
			const pick = repositoryPick(state, selection.repository.path);
			const fallback = defaultAgent(agents, state.agentLocations, pick);
			if (fallback !== null) return `Prompts start a new agent in ${where}: the one the chop names, or ${fallback.name}.`;
			const why = whyNoDefaultAgent(agents, state.agentLocations, pick);
			if (typeof why === "object") {
				return `Prompts start the agent the chop names in ${where}. ${describeMissingPick(why)}, so a prompt that names none is copied to the clipboard.`;
			}
			if (why === "none-found") {
				return `Prompts start the agent the chop names in ${where}. None of the agents in Settings, Agents was found, so a prompt that names none is copied to the clipboard.`;
			}
			return `Prompts start a new agent in ${where}: the one the chop names, or ${defaultAgentName(agents, state.agentLocations, pick) ?? "the first agent found"}.`;
		}
		case "ask":
			return `You pick the agent in ${where} when you send a prompt.`;
	}
}

/**
 * What the chops panel shows for a tab and a filter. The chops are the
 * selected worktree's repository's; with no worktree selected, the ones last
 * read stay listed, as in the palette, and none can be chosen. Each row runs
 * through the same path as the palette, and is blocked for the same reason
 * (`chopBlockedReason`).
 */
export function chopsPanelModel(state: AppState, tab: ChopKind, query: string): ChopsPanelModel {
	const selected = selectedWorktree(state);
	const offered = offeredChops(state);
	const read = selected === null ? offered : offered?.repository === selected.repository.path ? offered : null;
	const list = read?.list ?? null;
	const chops = listedChops(list);
	const failure = list !== null && list.outcome !== "listed" ? list.message : null;
	const empty = failure === null ? describeChopsPanelEmpty(selected !== null, list === null ? null : chops.length) : null;
	const counts: Record<ChopKind, number> = { command: 0, prompt: 0 };
	for (const chop of chops) counts[chop.kind] += 1;
	const action = chopAction(tab, state.preferences.agents.length);
	const blocked = chopBlockedReason(action, chopPlace(state));
	const repository = read?.repository ?? null;
	const arrangement = repository === null ? NO_CHOP_ARRANGEMENT : listedChopArrangement(state, repository, list);
	const arranged = arrangeChops(chops, arrangement);
	const rows = arranged
		.filter(({ chop }) => chop.kind === tab && chopMatches(chop, query))
		.map(({ chop, favorite }) => ({
			chop,
			favorite,
			source: chopSourceShort(chop.source),
			sourceTitle: describeChopSource(chop.source),
			sound: chop.sound === null ? null : soundName(chop.sound),
			soundTitle: chop.sound === null ? null : describeChopSound(soundName(chop.sound), state.preferences.playChopSounds),
			action,
			word: chopRunWord(action),
			label: chopButtonLabel(chop.name, action),
		}));
	return {
		repository,
		list,
		failure,
		empty,
		reading: selected !== null && list === null,
		counts,
		arrangement,
		arranged,
		rows,
		tabEmpty: chops.length > 0 && rows.length === 0 ? describeChopsTabEmpty(tab, query) : null,
		blocked,
		footer: blocked ?? describeTarget(state, tab, action),
	};
}

/**
 * Why the panel's "New chop" cannot make one now, or null: changes are
 * blocked (`chopEditBlockedReason`), or no list of a repository is shown,
 * so a new chop would have nowhere to show.
 */
export function chopsNewBlockedReason(model: Pick<ChopsPanelModel, "repository" | "failure" | "reading">, editBlocked: string | null): string | null {
	if (editBlocked !== null) return editBlocked;
	if (model.repository === null) return model.reading ? "The chops are being read." : "Select a worktree to make a chop for its repository.";
	if (model.failure !== null) return "The chops of this repository could not be listed, so a new one would not show. Make it in Settings, Chops.";
	return null;
}

export type ChopRowMenuId = "edit" | "delete" | "view";

/** The label of a row's actions button and its menu. */
export function chopRowMenuLabel(name: string): string {
	return `Actions for ${name}`;
}

/**
 * The entries of a row's menu: Edit and Delete for the person's own chop,
 * off with the reason while changes are blocked, and View for a chop from
 * the repository file, which the app never changes.
 */
export function chopRowMenuItems(source: ChopSource, editBlocked: string | null): { id: ChopRowMenuId; label: string; disabled: boolean; note: string | null; description: string | null }[] {
	if (source === "repository-file") return [{ id: "view", label: "View", disabled: false, note: null, description: "Show it whole. The app never changes .timber/chops.json." }];
	const off = editBlocked !== null;
	return [
		{ id: "edit", label: "Edit", disabled: off, note: editBlocked, description: off ? null : "Change it here. Settings shows the same chops." },
		{ id: "delete", label: "Delete", disabled: off, note: null, description: editBlocked ?? "Asks first." },
	];
}

/** The hint a row's handle gives in its tooltip. */
export const MOVE_CHOP_HINT = "Drag to reorder, or press Alt+Up or Alt+Down. Drop into Favorites to pin it.";

/** The label of a row's drag handle. */
export function moveChopLabel(name: string): string {
	return `Move ${name}`;
}

/** The label of a row's star, a toggle that says whether the chop is a favorite with `aria-pressed`. */
export function favoriteChopLabel(name: string): string {
	return `Favorite ${name}`;
}

/** What a starred or unstarred chop's star says in its tooltip. */
export function favoriteChopHint(favorite: boolean): string {
	return favorite ? "Unpin from Favorites" : "Pin to Favorites, at the top of its tab";
}

export const CHOPS_FAVORITES_HEADING = "Favorites";
export const CHOPS_REST_HEADING = "Other chops";
/** What the drop zone at the top says while a chop is dragged and no favorite shows. */
export const CHOPS_FAVORITES_DROP = "Drop here to pin to Favorites";

/** A row the pointer can be over while a chop is dragged, top to bottom as shown: its part and its vertical middle. */
export interface ChopDropSlot {
	name: string;
	favorite: boolean;
	middle: number;
}

/**
 * Where a dragged chop lands for a pointer at `y`. `slots` never include
 * the dragged chop. `line` is where Favorites end and the rest begins: the
 * middle of the rest's heading, or the bottom of the drop zone shown while
 * no favorite does; null for no Favorites to drop into. Above it lands in Favorites, which pins the chop;
 * below it, in the rest. Within its part, above a row's middle lands
 * before that row, and past the last row at the end of the part.
 */
export function chopDropPlace(slots: readonly ChopDropSlot[], line: number | null, y: number): { favorite: boolean; before: string | null } {
	const favorite = line !== null && y < line;
	const before = slots.find(slot => slot.favorite === favorite && y < slot.middle);
	return { favorite, before: before?.name ?? null };
}

/** The renames still waiting for the chop list to be read again: the list shown is the one they were saved against. Empty otherwise. */
export function pendingChopRenames(state: Pick<AppState, "chopRenaming">, list: ChopList | null): readonly ChopRename[] {
	const renaming = state.chopRenaming;
	return renaming !== null && renaming.list === list ? renaming.renames : [];
}

/**
 * A repository's order by the names `list` shows: the order on screen,
 * with chops renamed but still listed under their old names
 * (`pendingChopRenames`) found by those names, so a row does not jump
 * until the list is read again.
 */
export function listedChopArrangement(state: Pick<AppState, "chopRenaming" | "chopOrderAim" | "preferences">, repository: string, list: ChopList | null): ChopArrangement {
	const saved = chopArrangementOf(shownChopOrder(state), repository);
	const renames = pendingChopRenames(state, list);
	if (renames.length === 0) return saved;
	return chopArrangementOf(renameInArrangements({ [repository]: saved }, renames.map(rename => ({ ...rename, from: rename.to, to: rename.from }))), repository);
}

/** How near, in pixels, to the top or bottom of the panel's list a dragged chop scrolls it. */
export const CHOPS_DRAG_SCROLL_EDGE = 32;
/** The most the list scrolls in one frame while a chop is dragged, in pixels. */
export const CHOPS_DRAG_SCROLL_STEP = 12;

/**
 * How far the panel's list scrolls this frame while a chop is dragged with
 * the pointer at `y`: up near its top, down near its bottom, faster the
 * nearer the edge, and also past the edge. The list's box runs from `top`
 * to `bottom`. Zero away from the edges.
 */
export function chopsDragScroll(y: number, top: number, bottom: number): number {
	const edge = Math.min(CHOPS_DRAG_SCROLL_EDGE, (bottom - top) / 2);
	if (edge <= 0) return 0;
	const speed = (depth: number) => Math.ceil(CHOPS_DRAG_SCROLL_STEP * Math.min(1, depth / edge));
	if (y < top + edge) return -speed(top + edge - y);
	if (y > bottom - edge) return speed(y - (bottom - edge));
	return 0;
}
