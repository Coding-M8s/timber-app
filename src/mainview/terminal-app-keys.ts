import { isShortcut } from "../shared/shortcuts";
import { takesChangesPanelKey } from "./changes-panel-format";
import { takesChopsPanelKey } from "./chops-panel-format";
import { takesFilesPanelKey } from "./files-panel-format";
import { takesRunChopKey } from "./run-chop-format";
import type { AppState } from "./store/state";

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "shiftKey" | "metaKey" | "altKey">;

/**
 * Whether a focused terminal leaves this key to the app's window instead of
 * sending it to the program: one of the app's shortcuts, by the key set in
 * Settings, Shortcuts. A default set aside is the program's again. The
 * palette's key and the next session's are always the app's, so Ctrl+J
 * never reaches the program as a new line; the panels' keys and the chop
 * search's only while they can do something. The session chips' key and
 * the keys that move between sessions are `sessionKey`'s, which the
 * terminal handles itself.
 */
export function terminalLeavesToApp(event: Keys, state: AppState): boolean {
	const keys = state.preferences.shortcuts;
	return isShortcut(event, keys, "palette")
		|| isShortcut(event, keys, "next-waiting")
		|| takesChopsPanelKey(event, state)
		|| takesRunChopKey(event, state)
		|| takesFilesPanelKey(event, state)
		|| takesChangesPanelKey(event, state);
}
