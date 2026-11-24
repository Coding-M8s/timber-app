import type { WindowState } from "./store/store";

/** The parts of the page that say whether the window shows and has the focus. Tests pass their own. */
export interface WindowSource {
	document: Pick<Document, "visibilityState" | "hasFocus" | "addEventListener" | "removeEventListener">;
	window: Pick<Window, "addEventListener" | "removeEventListener">;
}

/** How the window is now, as the page sees it. */
export function readWindowState(source: WindowSource): WindowState {
	return { visible: source.document.visibilityState !== "hidden", focused: source.document.hasFocus() };
}

/**
 * Report how the window is now, and again whenever it is hidden, shown,
 * focused, or loses the focus. Returns a function that stops reporting.
 *
 * The desktop webview was seen firing the window's focus and blur on Linux
 * under Hyprland (docs/verification.md, issue 392); other platforms are not
 * verified. Without them the window counts as shown, so changes still come
 * through, only without the pause while hidden.
 */
export function followWindowState(report: (state: WindowState) => void, source: WindowSource = { document, window }): () => void {
	const tell = () => report(readWindowState(source));
	source.document.addEventListener("visibilitychange", tell);
	source.window.addEventListener("focus", tell);
	source.window.addEventListener("blur", tell);
	tell();
	return () => {
		source.document.removeEventListener("visibilitychange", tell);
		source.window.removeEventListener("focus", tell);
		source.window.removeEventListener("blur", tell);
	};
}
