import { type AppState, canToggleChopsPanel } from "./store/state";

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

/** What the panel says while it has nothing to list. */
export function describeChopsPanelEmpty(selected: boolean, listed: number | null): string | null {
	if (!selected) return "Select a worktree to see the chops of its repository.";
	if (listed === null) return "Reading the chops";
	if (listed === 0) return "No chops yet. Add one in Settings, Chops, or share some in .timber/chops.json.";
	return null;
}
