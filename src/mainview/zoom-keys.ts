import type { ZoomStep } from "../shared/zoom";

type Keys = Pick<KeyboardEvent, "type" | "key" | "ctrlKey" | "metaKey" | "altKey">;

/**
 * The zoom keys, as in browsers: Ctrl and plus (or equals, which shares its
 * key) to zoom in, Ctrl and minus to zoom out, and Ctrl and 0 for 100%. On
 * macOS Cmd instead of Ctrl. They are read by the character typed, so the
 * keypad and other keyboard layouts work too. Ctrl+Shift+minus types an
 * underscore and is left to a terminal program, which reads it as undo.
 */
export function zoomKey(event: Keys, mac: boolean): ZoomStep | null {
	if (event.type !== "keydown" || event.altKey) return null;
	const modified = mac ? event.metaKey && !event.ctrlKey : event.ctrlKey && !event.metaKey;
	if (!modified) return null;
	switch (event.key) {
		case "+":
		case "=":
			return "in";
		case "-":
			return "out";
		case "0":
			return "reset";
		default:
			return null;
	}
}
