import { useEffect } from "react";
import { takesPaletteKey } from "../palette";
import { useStore } from "../store/react";

/**
 * Opens the command palette from the keyboard, and closes it again, with the
 * key set in Settings, Shortcuts. It draws nothing. It listens on the window in the capture phase, so it hears the
 * keys of a focused terminal too. Another dialog that is open keeps the
 * keyboard: the palette never replaces it.
 */
export function PaletteShortcut() {
	const store = useStore();
	useEffect(() => {
		const onKeyDown = (event: KeyboardEvent) => {
			if (!takesPaletteKey(event, store.getState())) return;
			const before = store.getState().dialog;
			store.togglePalette();
			// Only a key that opened or closed the palette is taken from the page.
			if (store.getState().dialog !== before) event.preventDefault();
		};
		window.addEventListener("keydown", onKeyDown, true);
		return () => window.removeEventListener("keydown", onKeyDown, true);
	}, [store]);
	return null;
}
