import type { SidePanelView } from "../shared/layout";
import { type AppState, canToggleSidePanel } from "./store/state";

/**
 * Words and keys of the side panel's file explorer and of the switch
 * between it and the chops. Pure, so they can be tested without a window.
 */

/** The `id` of the title bar's Files button, where focus goes back when nothing else can take it. */
export const FILES_BUTTON_ID = "titlebar-files";

export const FILES_PANEL_TITLE = "Files";
export const FILES_BUTTON_LABEL = "Files";
export const FILES_CLOSE_LABEL = "Hide the files panel";
export const FILES_IGNORED_LABEL = "Show ignored files";
export const SIDE_PANEL_SWITCH_LABEL = "Show in the side panel";

/** The words of each view, on the switch in the panel's header. */
export const SIDE_PANEL_VIEW_LABELS: Readonly<Record<SidePanelView, string>> = { chops: "Chops", files: "Files", changes: "Changes" };

/** The `id` of a view's button on the switch, so focus can land on it after the switch draws anew. */
export const sidePanelViewButtonId = (view: SidePanelView) => `side-panel-view-${view}`;

/**
 * The shortcut that shows or hides the file explorer. Ctrl+Shift+E keeps
 * the app's own pattern (Ctrl+Shift+P, Ctrl+Shift+J, Ctrl+Shift+K), is
 * where code editors put their explorer, and takes nothing from a terminal
 * program, which cannot tell it from Ctrl+E.
 */
export const FILES_PANEL_SHORTCUT = "Ctrl+Shift+E";
export const FILES_PANEL_SHORTCUT_MAC = "Cmd+Shift+E";

export function filesPanelShortcut(mac: boolean): string {
	return mac ? FILES_PANEL_SHORTCUT_MAC : FILES_PANEL_SHORTCUT;
}

/** The Files button's tooltip: what a click does now, and the shortcut for this platform. */
export function filesButtonHint(open: boolean, mac: boolean): string {
	return `${open ? "Hide" : "Show"} files (${filesPanelShortcut(mac)})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift+E, or Cmd+Shift+E on macOS. Either modifier counts, as for the chops panel's shortcut. */
export function isFilesPanelShortcut(event: Keys): boolean {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey) return false;
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "e";
}

/** Whether the app takes this key from the page, and from a terminal's program, to show or hide the file explorer. */
export function takesFilesPanelKey(event: Keys, state: AppState): boolean {
	return isFilesPanelShortcut(event) && canToggleSidePanel(state, "files");
}

/** What the explorer says in place of the tree, or null when it shows the tree. */
export function describeFilesPanelEmpty(selected: { name: string; pathExists: boolean } | null): string | null {
	if (selected === null) return "Select a worktree to see its files.";
	if (!selected.pathExists) return `The folder of ${selected.name} is missing.`;
	return null;
}
