/**
 * Where the keyboard goes when the window gets the focus back, as after
 * Alt+Tab or a click from another app. What had it stays when it still shows.
 * Otherwise the shown file's editor or the shown session's terminal takes it,
 * so typing does not go nowhere, or to a spot that is no longer on screen,
 * such as the terminal of the worktree shown before.
 */

/** What is on screen when the window gets the focus back. */
export interface ReturnScene {
	/** Whether what had the keyboard, now or when the window lost it, still shows. */
	held: boolean;
	/** Whether a dialog or the palette is open over the window. It keeps the keyboard. */
	dialog: boolean;
	/** Whether the shown tab is a file in the editor. */
	editor: boolean;
	/** Whether a session shows on the Workspace tab. */
	session: boolean;
}

export type ReturnTarget = "held" | "editor" | "terminal" | "none";

/** Where the keyboard goes on the window's return. `none` leaves it where the browser put it. */
export function returnTarget(scene: ReturnScene): ReturnTarget {
	if (scene.dialog) return "none";
	if (scene.held) return "held";
	if (scene.editor) return "editor";
	if (scene.session) return "terminal";
	return "none";
}

/** The part of an element this needs, so it can be tested without a window. */
export interface ReturnElement {
	readonly isConnected: boolean;
	getClientRects(): { readonly length: number };
	focus(): void;
}

/** Whether an element is on screen: in the page, and not inside something hidden. */
export function elementShows(element: ReturnElement | null): element is ReturnElement {
	return element !== null && element.isConnected && element.getClientRects().length > 0;
}

/** What the window holds that this asks about, read when the window gets the focus back. */
export interface ReturnPlaces {
	dialogOpen(): boolean;
	/** The editor of the file on the shown tab, or null when no file shows. */
	shownEditor(): ReturnElement | null;
	/** Whether a session shows on the Workspace tab. */
	sessionShows(): boolean;
	/** Put the keyboard in the shown session's terminal. */
	focusTerminal(): void;
}

export interface ReturnPage {
	document: { readonly activeElement: unknown; readonly body: unknown };
	window: Pick<Window, "addEventListener" | "removeEventListener">;
}

/**
 * Put the keyboard back each time the window gets the focus, by
 * `returnTarget`. A click that brings the window back and lands where
 * nothing takes the keyboard, so it goes to the page, gets the same rule
 * once more. Returns a function that stops.
 *
 * It runs at once in the focus event, so a click on a button or in a
 * terminal still gives that the keyboard after it.
 */
export function followFocusReturn(places: ReturnPlaces, page: ReturnPage = { document, window } as unknown as ReturnPage): () => void {
	let left: ReturnElement | null = null;
	let returning = false;
	const active = (): ReturnElement | null => {
		const element = page.document.activeElement;
		return element === null || element === page.document.body ? null : element as ReturnElement;
	};
	const place = () => {
		const now = active();
		const held = elementShows(now) ? now : elementShows(left) ? left : null;
		const editor = places.shownEditor();
		const target = returnTarget({ held: held !== null, dialog: places.dialogOpen(), editor: elementShows(editor), session: places.sessionShows() });
		if (target === "held" && held !== now) held!.focus();
		else if (target === "editor") editor!.focus();
		else if (target === "terminal") places.focusTerminal();
	};
	const onBlur = (event: Event) => {
		// Focus events of elements do not bubble, but a listener hears its own target: only the window's own.
		if (event.target !== page.window) return;
		left = active();
		returning = false;
	};
	const onFocus = (event: Event) => {
		if (event.target !== page.window) return;
		place();
		returning = true;
	};
	const onPointerDown = () => {
		if (!returning) return;
		returning = false;
		// The click moves the keyboard after this event, so look once it did.
		setTimeout(() => {
			if (active() === null) place();
		}, 0);
	};
	const onKeyDown = () => {
		returning = false;
	};
	page.window.addEventListener("blur", onBlur);
	page.window.addEventListener("focus", onFocus);
	page.window.addEventListener("pointerdown", onPointerDown, true);
	page.window.addEventListener("keydown", onKeyDown, true);
	return () => {
		page.window.removeEventListener("blur", onBlur);
		page.window.removeEventListener("focus", onFocus);
		page.window.removeEventListener("pointerdown", onPointerDown, true);
		page.window.removeEventListener("keydown", onKeyDown, true);
	};
}
