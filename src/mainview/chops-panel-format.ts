import { type ChopKind, type ChopList, type ChopSource, type ListedChop, listedChops } from "../shared/chops";
import { promptTarget } from "./agent-sessions";
import { type ChopAction, chopAction, chopButtonLabel, describeChopSource } from "./chop-format";
import { worktreeLabel } from "./format";
import { chopBlockedReason, chopPlace } from "./palette";
import { type AppState, canToggleChopsPanel, offeredChops, selectedWorktree } from "./store/state";

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
 * cannot tell it from Ctrl+K.
 */
export const CHOPS_PANEL_SHORTCUT = "Ctrl+Shift+K";
export const CHOPS_PANEL_SHORTCUT_MAC = "Cmd+Shift+K";

export function chopsPanelShortcut(mac: boolean): string {
	return mac ? CHOPS_PANEL_SHORTCUT_MAC : CHOPS_PANEL_SHORTCUT;
}

/** The Chops button's tooltip: what a click does now, and the shortcut for this platform. */
export function chopsButtonHint(open: boolean, mac: boolean): string {
	return `${open ? "Hide" : "Show"} chops (${chopsPanelShortcut(mac)})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift+K, or Cmd+Shift+K on macOS. Either modifier counts, as for the palette's shortcut. */
export function isChopsPanelShortcut(event: Keys): boolean {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey) return false;
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k";
}

/**
 * Whether the app takes this key from the page, and from a terminal's
 * program, to show or hide the chops panel: the chord while the panel can
 * be shown or hidden. With chops off, a dialog open, or Timber not ready,
 * the key goes on to the page and the program as if the app had none.
 */
export function takesChopsPanelKey(event: Keys, state: AppState): boolean {
	return isChopsPanelShortcut(event) && canToggleChopsPanel(state);
}

/**
 * What the panel says while it has nothing to list: with no worktree
 * selected and no chops read yet, that one should be selected; with one
 * selected, that they are being read; then that there are none.
 */
export function describeChopsPanelEmpty(selected: boolean, listed: number | null): string | null {
	if (listed === null) return selected ? "Reading the chops" : "Select a worktree to see the chops of its repository.";
	if (listed === 0) return "No chops yet. Make one with New chop, or share some with everyone in .timber/chops.json.";
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

export interface ChopsPanelRow {
	chop: ListedChop;
	/** Where it comes from, short, and in full for the tooltip. */
	source: string;
	sourceTitle: string;
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
	/** The chops of the tab that match the filter, in listed order. */
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
		case "new":
			return `Prompts start a new agent in ${where}: the one the chop names, or ${state.preferences.agents[0]!.name}.`;
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
	const rows = chops
		.filter(chop => chop.kind === tab && chopMatches(chop, query))
		.map(chop => ({
			chop,
			source: chopSourceShort(chop.source),
			sourceTitle: describeChopSource(chop.source),
			action,
			word: chopRunWord(action),
			label: chopButtonLabel(chop.name, action),
		}));
	return {
		repository: read?.repository ?? null,
		list,
		failure,
		empty,
		reading: selected !== null && list === null,
		counts,
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
export function chopRowMenuItems(source: ChopSource, editBlocked: string | null): { id: ChopRowMenuId; label: string; disabled: boolean; note: string | null; title: string }[] {
	if (source === "repository-file") return [{ id: "view", label: "View", disabled: false, note: null, title: "Show it whole. The app never changes .timber/chops.json." }];
	const off = editBlocked !== null;
	return [
		{ id: "edit", label: "Edit", disabled: off, note: editBlocked, title: editBlocked ?? "Change it here. Settings shows the same chops." },
		{ id: "delete", label: "Delete", disabled: off, note: null, title: editBlocked ?? "Asks first." },
	];
}
