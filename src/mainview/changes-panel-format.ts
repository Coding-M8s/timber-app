import type { FileChangeTarget } from "../shared/file-changes";
import { describeNoteCount } from "./review-format";
import { type AppState, canToggleSidePanel, shownDiffTab } from "./store/state";

/**
 * Words and keys of the side panel's Changes view and of the diff tab it
 * opens. Pure, so they can be tested without a window.
 */

/** The `id` of the title bar's Changes button, where focus goes back when nothing else can take it. */
export const CHANGES_BUTTON_ID = "titlebar-changes";

export const CHANGES_PANEL_TITLE = "Changes";
export const CHANGES_BUTTON_LABEL = "Changes";
export const CHANGES_CLOSE_LABEL = "Hide the changes panel";

/** The hint in the Review section before the first note. */
export const NO_NOTES_HINT = "Click a line number in a diff to leave a note. Notes collect here, and Send review pastes them into an agent.";

/**
 * The shortcut that shows or hides the Changes view. Ctrl+Shift+G keeps the
 * app's own pattern (Ctrl+Shift+E for the files, Ctrl+Shift+K for the
 * chops), is where code editors put their source control view, and takes
 * nothing from a terminal program, which cannot tell it from Ctrl+G.
 */
export const CHANGES_PANEL_SHORTCUT = "Ctrl+Shift+G";
export const CHANGES_PANEL_SHORTCUT_MAC = "Cmd+Shift+G";

export function changesPanelShortcut(mac: boolean): string {
	return mac ? CHANGES_PANEL_SHORTCUT_MAC : CHANGES_PANEL_SHORTCUT;
}

/** The Changes button's tooltip: what a click does now, and the shortcut for this platform. */
export function changesButtonHint(open: boolean, mac: boolean): string {
	return `${open ? "Hide" : "Show"} changes (${changesPanelShortcut(mac)})`;
}

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/** Ctrl+Shift+G, or Cmd+Shift+G on macOS. Either modifier counts, as for the other side panel shortcuts. */
export function isChangesPanelShortcut(event: Keys): boolean {
	if (event.type !== "keydown" || event.altKey || !event.shiftKey) return false;
	return (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "g";
}

/** Whether the app takes this key from the page, and from a terminal's program, to show or hide the Changes view. */
export function takesChangesPanelKey(event: Keys, state: AppState): boolean {
	return isChangesPanelShortcut(event) && canToggleSidePanel(state, "changes");
}

/** Alt+Up or Alt+Down alone: the step to the diff tab's previous or next file, or null for any other key. */
export function fileStepOf(event: Keys): 1 | -1 | null {
	if (event.type !== "keydown" || !event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return null;
	return event.key === "ArrowUp" ? -1 : event.key === "ArrowDown" ? 1 : null;
}

/**
 * The step the app takes this key for, or null: Alt+Up and Alt+Down while
 * the selected worktree's diff tab shows and no dialog or question is open,
 * unless the key goes to a field that edits text, where it moves the cursor.
 */
export function takesFileStepKey(event: Keys, state: AppState, inTextField: boolean): 1 | -1 | null {
	const step = fileStepOf(event);
	if (step === null || inTextField || state.dialog !== null || state.quitRequest !== null) return null;
	if (state.tab !== "diff" || state.board !== null || shownDiffTab(state) === null) return null;
	return step;
}

/** What the Changes view says in place of the list when no worktree is selected, or null when it shows the list. */
export function describeChangesPanelEmpty(selected: boolean): string | null {
	return selected ? null : "Select a worktree to see its changes.";
}

/** The diff tab's name: the file's name, without its folders. */
export function diffTabLabel(file: Pick<FileChangeTarget, "path">): string {
	return file.path.slice(file.path.lastIndexOf("/") + 1) || file.path;
}

/** The diff tab's tooltip: the whole path, and where it was renamed from. */
export function diffTabTitle(file: Pick<FileChangeTarget, "path" | "previousPath">): string {
	return file.previousPath === null ? `Diff of ${file.path}` : `Diff of ${file.path}, renamed from ${file.previousPath}`;
}

/** The words the side panel's switch says for the Changes view with notes waiting, as a screen reader hears them. */
export function describeChangesViewNotes(count: number): string {
	return count === 0 ? "" : `, ${describeNoteCount(count)}`;
}

/** The Review button of a diff tab, which opens the Changes view at its Review section. */
export function reviewButtonLabel(count: number): string {
	return `Review, ${describeNoteCount(count)}. Show the Changes view`;
}
