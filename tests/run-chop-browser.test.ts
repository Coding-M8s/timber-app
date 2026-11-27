import { describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath } from "./support/browser";
import { ACTIVE, BUTTON, PANEL_HIDDEN, SET_VALUE, STORE, openChopsPage } from "./support/chops-panel";

/**
 * The chop search in a real browser, over the mock engine: its shortcut from
 * anywhere with the chops panel hidden, typing, Tab, Enter, Ctrl+Enter, and
 * Escape. Its ranking and its words are tested without a window
 * (run-chop.test.tsx). Skipped where no browser is installed.
 */

const SEARCH = `document.querySelector('dialog.run-chop[open]')`;
const OPEN = `${SEARCH} !== null`;
const CLOSED = `${SEARCH} === null`;
const ROWS = `[...document.querySelectorAll("dialog.run-chop .run-chop-row .palette-label")].map(label => label.textContent).join(",")`;
const HELLO = { name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null };

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the chop search in a real browser", () => {
	let page: BrowserPage;
	openChopsPage(opened => (page = opened));

	const ready = async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [${JSON.stringify(HELLO)}] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.until(`${STORE}.getState().chops?.list?.outcome === "listed" && ${STORE}.getState().chops.list.chops.some(chop => chop.name === "Hello")`, "the chops were read");
	};

	test("Ctrl+Shift+T opens it from anywhere with the panel hidden, takes the keyboard, and closes it again", async () => {
		await ready();
		expect(await page.evaluate<boolean>(PANEL_HIDDEN)).toBe(true);
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const before = await page.evaluate<string>(ACTIVE);
		await page.press("T", "ctrlShift");
		await page.until(OPEN, "the search opened");
		expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("palette-input") === true`)).toBe(true);
		expect(await page.evaluate<boolean>(PANEL_HIDDEN)).toBe(true);
		await page.press("T", "ctrlShift");
		await page.until(CLOSED, "the search closed");
		expect(await page.evaluate<string>(ACTIVE)).toBe(before);
	}, 30_000);

	test("typing narrows the list, Tab shows one kind, and Enter runs the chop in the selected worktree", async () => {
		await ready();
		await page.press("T", "ctrlShift");
		await page.until(OPEN, "the search opened");
		await page.type("hel");
		await page.until(`${ROWS} === "Hello"`, "the search found Hello");
		// Tab: only commands, then only prompts, where Hello is not.
		await page.press("Tab");
		await page.until(`document.querySelector("dialog.run-chop .run-chop-filter").textContent === "Commands"`, "Commands showed");
		await page.press("Tab");
		await page.until(`document.querySelector("dialog.run-chop .run-chop-filter").textContent === "Prompts"`, "Prompts showed");
		expect(await page.evaluate<string>(ROWS)).toBe("");
		await page.press("Tab", "shift");
		await page.until(`${ROWS} === "Hello"`, "back to Commands");
		expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("palette-input") === true`)).toBe(true);
		await page.press("Enter");
		await page.until(CLOSED, "the search closed");
		await page.until(`${STORE}.getState().terminals.some(session => session.name === "Hello" && session.state.kind === "running")`, "Hello started");
		expect(await page.evaluate<boolean>(`${STORE}.getState().terminals.find(session => session.name === "Hello").worktree === ${STORE}.getState().repositories[0].worktrees[1].id`)).toBe(true);
		expect(await page.evaluate<string>(`${STORE}.getState().lastChops[${STORE}.getState().repositories[0].path]`)).toBe("Hello");
	}, 30_000);

	test("Ctrl+Enter edits the text for one run; Escape goes back to the list, and a second Escape closes", async () => {
		await ready();
		await page.press("T", "ctrlShift");
		await page.until(OPEN, "the search opened");
		await page.type("hello");
		await page.until(`${ROWS} === "Hello"`, "the search found Hello");
		await page.press("Enter", "ctrl");
		await page.until(`document.activeElement?.tagName === "TEXTAREA" && document.activeElement.value === "pwd"`, "the text showed to edit");
		await page.press("Escape");
		await page.until(`document.activeElement?.classList.contains("palette-input") === true`, "back to the list");
		expect(await page.evaluate<boolean>(OPEN)).toBe(true);
		await page.press("Escape");
		await page.until(CLOSED, "the search closed");

		await page.press("T", "ctrlShift");
		await page.until(OPEN, "the search opened again");
		await page.type("hello");
		await page.until(`${ROWS} === "Hello"`, "the search found Hello");
		await page.press("Enter", "ctrl");
		await page.until(`document.activeElement?.tagName === "TEXTAREA"`, "the text showed to edit");
		await page.evaluate(SET_VALUE("dialog.run-chop textarea", "pwd -P"));
		await page.press("Enter");
		await page.until(CLOSED, "the search closed");
		await page.until(`${STORE}.getState().terminals.some(session => session.name === "Hello" && session.state.kind === "running")`, "Hello started");
		// The chop as saved is unchanged.
		expect(await page.evaluate<string>(`${STORE}.getState().preferences.chops[0].text`)).toBe("pwd");
	}, 30_000);

	test("Settings, Shortcuts takes a new search key by pressing it, refuses the terminal's copy and the palette's with the reason, and the new key opens the search", async () => {
		await ready();
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "shortcuts" })`);
		const FIELD = `document.querySelector('.shortcut-field[data-shortcut="run-chop"]')`;
		await page.until(`${FIELD} !== null`, "the shortcut field showed");
		await page.evaluate(`${FIELD}.querySelector("input").focus()`);
		expect(await page.evaluate<string>(`${FIELD}.querySelector("input").value`)).toBe("Ctrl+Shift+T");
		await page.press("C", "ctrlShift");
		await page.until(`${FIELD}.querySelector('[role="alert"]')?.textContent === "Ctrl+Shift+C copies in a terminal on Linux and Windows, so it cannot be the key that searches and runs a chop."`, "the terminal's copy was refused");
		await page.press("P", "ctrlShift");
		await page.until(`${FIELD}.querySelector('[role="alert"]')?.textContent === "Ctrl+Shift+P already opens the command palette. Change that one first."`, "the palette's key was refused");
		expect(await page.evaluate<string>(`${FIELD}.querySelector("input").value`)).toBe("Ctrl+Shift+T");
		expect(await page.evaluate<string>(`${STORE}.getState().dialog.kind`)).toBe("settings");
		await page.press("K", "ctrlShift");
		await page.until(`${FIELD}.querySelector('[role="alert"]')?.textContent === "Ctrl+Shift+K already shows or hides the chops panel. Change that one first."`, "the panel's key was refused");
		await page.press("Y", "ctrlShift");
		await page.until(`${FIELD}.querySelector("input").value === "Ctrl+Shift+Y"`, "the new key showed");
		expect(await page.evaluate<boolean>(`${FIELD}.querySelector('[role="alert"]') === null`)).toBe(true);
		// Every section is in the page; the Shortcuts one's Save is the one with something to save.
		await page.evaluate(`${FIELD}.closest("form").querySelector('button[type="submit"]').click()`);
		await page.until(`${STORE}.getState().preferences.shortcuts["run-chop"] === "Ctrl+Shift+Y"`, "the key was saved");
		await page.evaluate(`${STORE}.closeDialog()`);
		await page.until(`${STORE}.getState().dialog === null`, "Settings closed");
		await page.press("Y", "ctrlShift");
		await page.until(OPEN, "the new key opened the search");
	}, 30_000);

	test("the palette's key moved in Settings, Shortcuts opens the palette, and the key set aside opens nothing", async () => {
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "shortcuts" })`);
		const FIELD = `document.querySelector('.shortcut-field[data-shortcut="palette"]')`;
		await page.until(`${FIELD} !== null`, "the palette's field showed");
		await page.evaluate(`${FIELD}.querySelector("input").focus()`);
		await page.press("O", "ctrlShift");
		await page.until(`${FIELD}.querySelector("input").value === "Ctrl+Shift+O"`, "the new key showed");
		await page.evaluate(`${FIELD}.closest("form").querySelector('button[type="submit"]').click()`);
		await page.until(`${STORE}.getState().preferences.shortcuts.palette === "Ctrl+Shift+O"`, "the key was saved");
		await page.evaluate(`${STORE}.closeDialog()`);
		await page.until(`${STORE}.getState().dialog === null`, "Settings closed");
		// The title bar's button names the key as set.
		expect(await page.evaluate<string>(`document.querySelector(".titlebar-palette").title`)).toContain("(Ctrl+Shift+O)");
		await page.press("P", "ctrlShift");
		await Bun.sleep(200);
		expect(await page.evaluate<boolean>(`${STORE}.getState().dialog === null`)).toBe(true);
		await page.press("O", "ctrlShift");
		await page.until(`${STORE}.getState().dialog?.kind === "palette"`, "the new key opened the palette");
		await page.press("O", "ctrlShift");
		await page.until(`${STORE}.getState().dialog === null`, "the new key closed it again");
		await page.evaluate(`${STORE}.savePreferences({ shortcuts: {} })`);
	}, 30_000);

	test("with Use chops off, the key opens nothing", async () => {
		await page.evaluate(`${STORE}.savePreferences({ useChops: false })`);
		await page.until(`document.querySelector(${JSON.stringify(BUTTON)}) === null`, "chops were turned off");
		await page.press("T", "ctrlShift");
		await Bun.sleep(200);
		expect(await page.evaluate<boolean>(CLOSED)).toBe(true);
		expect(await page.evaluate<boolean>(`${STORE}.getState().dialog === null`)).toBe(true);
	}, 30_000);
});
