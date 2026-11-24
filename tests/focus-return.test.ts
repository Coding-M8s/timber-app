import { describe, expect, test } from "bun:test";
import { type ReturnElement, type ReturnPage, type ReturnPlaces, followFocusReturn, returnTarget } from "../src/mainview/focus-return";

describe("returnTarget", () => {
	const none = { held: false, dialog: false, editor: false, session: false };

	test("an open dialog keeps the keyboard, whatever else shows", () => {
		expect(returnTarget({ held: true, dialog: true, editor: true, session: true })).toBe("none");
		expect(returnTarget({ ...none, dialog: true, session: true })).toBe("none");
	});

	test("what had the keyboard keeps it while it still shows", () => {
		expect(returnTarget({ ...none, held: true, session: true })).toBe("held");
		expect(returnTarget({ ...none, held: true, editor: true })).toBe("held");
	});

	test("otherwise the file editor on the shown tab takes it, not a terminal", () => {
		expect(returnTarget({ ...none, editor: true })).toBe("editor");
	});

	test("otherwise the shown session's terminal takes it", () => {
		expect(returnTarget({ ...none, session: true })).toBe("terminal");
	});

	test("with no session showing, nothing moves", () => {
		expect(returnTarget(none)).toBe("none");
	});
});

/** An element the test shows, hides, or takes out of the page, and that records taking the keyboard. */
function element(page: { active: unknown }, name: string) {
	const made = {
		name,
		isConnected: true,
		shown: true,
		getClientRects: () => ({ length: made.shown ? 1 : 0 }),
		focus: () => void (page.active = made),
	};
	return made satisfies ReturnElement;
}

/** A window that fires focus, blur, pointerdown, and keydown as a browser would, with its own document. */
function fakeWindow(scene: { dialog?: boolean; session?: boolean; editor?: ReturnElement | null } = {}) {
	const view = new EventTarget();
	const body = { name: "body" };
	const doc = { active: body as unknown, get activeElement() { return doc.active; }, body };
	const focused: string[] = [];
	const places: ReturnPlaces = {
		dialogOpen: () => scene.dialog ?? false,
		shownEditor: () => scene.editor ?? null,
		sessionShows: () => scene.session ?? false,
		focusTerminal: () => {
			focused.push("terminal");
			doc.active = { name: "terminal" };
		},
	};
	const page: ReturnPage = { document: doc, window: view as unknown as ReturnPage["window"] };
	const fire = (type: string) => view.dispatchEvent(new Event(type));
	return { doc, body, places, page, focused, fire, scene };
}

describe("followFocusReturn", () => {
	test("puts the keyboard in the shown terminal when it was on a spot that no longer shows", () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		const old = element(win.doc, "old terminal");
		old.focus();
		win.fire("blur");
		// The worktree shown before went away while the window was in the background, with its terminal.
		old.isConnected = false;
		win.doc.active = win.body;
		win.fire("focus");
		expect(win.focused).toEqual(["terminal"]);
		stop();
	});

	test("puts the keyboard back where it was when the browser left it on the page", () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		const terminal = element(win.doc, "terminal");
		terminal.focus();
		win.fire("blur");
		win.doc.active = win.body;
		win.fire("focus");
		expect(win.doc.active).toBe(terminal);
		expect(win.focused).toEqual([]);
		stop();
	});

	test("leaves what still has the keyboard alone, such as a sidebar row", () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		const row = element(win.doc, "row");
		row.focus();
		win.fire("blur");
		win.fire("focus");
		expect(win.doc.active).toBe(row);
		expect(win.focused).toEqual([]);
		stop();
	});

	test("a spot that is still in the page but hidden does not count", () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		const hidden = element(win.doc, "hidden");
		hidden.focus();
		hidden.shown = false;
		win.fire("blur");
		win.fire("focus");
		expect(win.focused).toEqual(["terminal"]);
		stop();
	});

	test("an open dialog keeps the keyboard", () => {
		const win = fakeWindow({ session: true, dialog: true });
		const stop = followFocusReturn(win.places, win.page);
		win.fire("blur");
		win.fire("focus");
		expect(win.focused).toEqual([]);
		expect(win.doc.active).toBe(win.body);
		stop();
	});

	test("the shown file's editor takes it, not a terminal", () => {
		const win = fakeWindow({ session: true });
		const editor = element(win.doc, "editor");
		win.scene.editor = editor;
		const stop = followFocusReturn(win.places, win.page);
		win.fire("blur");
		win.fire("focus");
		expect(win.doc.active).toBe(editor);
		expect(win.focused).toEqual([]);
		stop();
	});

	test("with no session showing, the keyboard does not move", () => {
		const win = fakeWindow();
		const stop = followFocusReturn(win.places, win.page);
		win.fire("blur");
		win.fire("focus");
		expect(win.doc.active).toBe(win.body);
		expect(win.focused).toEqual([]);
		stop();
	});

	test("the click that brings the window back and lands on nothing focusable gets the same rule", async () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		win.fire("blur");
		win.fire("focus");
		expect(win.focused).toEqual(["terminal"]);
		win.fire("pointerdown");
		// The click on an empty spot moves the keyboard to the page.
		win.doc.active = win.body;
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(win.focused).toEqual(["terminal", "terminal"]);
		stop();
	});

	test("a later click, or one on something that takes the keyboard, is left alone", async () => {
		const win = fakeWindow({ session: true });
		const stop = followFocusReturn(win.places, win.page);
		win.fire("blur");
		win.fire("focus");
		win.fire("keydown");
		win.fire("pointerdown");
		win.doc.active = win.body;
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(win.focused).toEqual(["terminal"]);

		win.fire("blur");
		win.fire("focus");
		win.fire("pointerdown");
		const button = element(win.doc, "button");
		button.focus();
		await new Promise(resolve => setTimeout(resolve, 0));
		expect(win.doc.active).toBe(button);
		expect(win.focused).toEqual(["terminal", "terminal"]);
		stop();
	});

	test("nothing is heard once stopped", () => {
		const win = fakeWindow({ session: true });
		followFocusReturn(win.places, win.page)();
		win.fire("blur");
		win.fire("focus");
		expect(win.focused).toEqual([]);
	});
});
