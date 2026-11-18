/**
 * When the window first shows (see docs/architecture.md, "Themes"). It is
 * made hidden and shown once the interface says it has drawn itself in the
 * saved theme, so the webview's own white background and the window
 * system's grey are never seen. If no word comes, as when the page failed
 * to load, it shows anyway after a while, so the app is never left
 * invisible.
 */

/** How long to wait for the interface before showing the window anyway. */
export const REVEAL_FALLBACK_MILLISECONDS = 4000;

export interface WindowReveal {
	/** The interface has drawn itself. Shows the window, once. */
	ready(): void;
	/** Whether the window was shown, and why. */
	shownBy(): "ready" | "fallback" | null;
}

export function createWindowReveal(
	show: (by: "ready" | "fallback") => void,
	schedule: (run: () => void, milliseconds: number) => () => void = (run, milliseconds) => {
		const timer = setTimeout(run, milliseconds);
		return () => clearTimeout(timer);
	},
	fallbackMilliseconds = REVEAL_FALLBACK_MILLISECONDS,
): WindowReveal {
	let shown: "ready" | "fallback" | null = null;
	const reveal = (by: "ready" | "fallback") => {
		if (shown !== null) return;
		shown = by;
		cancel();
		show(by);
	};
	const cancel = schedule(() => reveal("fallback"), fallbackMilliseconds);
	return {
		ready: () => reveal("ready"),
		shownBy: () => shown,
	};
}
