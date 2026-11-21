import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The chops panel in a real browser, over the mock engine: the button, the
 * shortcut, where the keyboard goes, and the "Use chops" switch. The rest is
 * tested without a window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const PANEL_SHOWN = `document.getElementById("chops-panel") !== null`;
const PANEL_HIDDEN = `document.getElementById("chops-panel") === null`;
const BUTTON = "#titlebar-chops";
const FOCUS_IN_PANEL = `document.getElementById("chops-panel")?.contains(document.activeElement) === true`;
const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	return active.id || active.getAttribute("aria-label") || active.className;
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the chops panel in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	// The page counts as loaded once the repositories are listed, which can be before Timber is ready; chops wait for both.
	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(BUTTON)}) !== null`, "chops were offered");
	}, 30_000);

	test("the button shows the panel and gives it the keyboard; Close only hides it and gives the keyboard back", async () => {
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(BUTTON)}).getAttribute("aria-pressed")`)).toBe("false");
		await page.click(BUTTON);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(BUTTON)}).getAttribute("aria-pressed")`)).toBe("true");
		// By keyboard: Tab reaches the Close button inside the panel, and Enter hides it.
		await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Hide the chops panel");
		await page.press("Enter");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe("titlebar-chops");
		expect(await page.evaluate<boolean>(`${STORE}.getState().layout.chopsOpen`)).toBe(false);
		// Hidden, not turned off: the button is still there.
		expect(await page.evaluate<boolean>(`${STORE}.getState().preferences.useChops`)).toBe(true);
	}, 30_000);

	test("the shortcut shows the panel from wherever the keyboard is, and hiding it gives the keyboard back there", async () => {
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const before = await page.evaluate<string>(ACTIVE);
		await page.press("K", "ctrlShift");
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		await page.press("K", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe(before);
	}, 30_000);

	test("hidden while the keyboard is elsewhere, the keyboard stays where it is", async () => {
		await page.press("K", "ctrlShift");
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const elsewhere = await page.evaluate<string>(ACTIVE);
		await page.press("K", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe(elsewhere);
	}, 30_000);

	test("a panel shown by the store alone, as the saved layout shows it at start, takes nothing from the keyboard", async () => {
		await page.evaluate(`${STORE}.toggleChopsPanel()`);
		await page.until(PANEL_SHOWN, "the panel showed");
		expect(await page.evaluate<boolean>(FOCUS_IN_PANEL)).toBe(false);
	}, 30_000);

	test("its edge resizes it by keyboard, and the width is saved when the key is let go", async () => {
		await page.click(BUTTON);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.evaluate(`document.querySelector('[aria-label="Chops panel width"]').focus()`);
		const start = await page.evaluate<number>(`${STORE}.getState().layout.chopsWidth`);
		await page.press("ArrowLeft");
		expect(await page.evaluate<number>(`${STORE}.getState().layout.chopsWidth`)).toBe(start + 16);
		await page.press("End");
		await page.until(`${STORE}.getState().layout.chopsWidth === 560`, "the panel went to its widest");
		// The window is 1300 pixels wide, so the panel is drawn at a third of it, not at 560.
		const DRAWN = `Math.round(document.getElementById("chops-panel").getBoundingClientRect().width)`;
		const widest = await page.evaluate<number>(DRAWN);
		expect(widest).toBeLessThan(560);
		expect(widest).toBeGreaterThan(start);
		// A step from there narrows what is on screen at once, with no dead zone above the cap.
		await page.press("ArrowRight");
		expect(await page.evaluate<number>(`${STORE}.getState().layout.chopsWidth`)).toBe(widest - 16);
		await page.until(`${DRAWN} === ${widest - 16}`, "the drawn panel narrowed");
	}, 30_000);

	test("hidden after what had the keyboard is gone, the keyboard goes to the Chops button", async () => {
		await page.evaluate(`(() => { const field = document.createElement("button"); field.id = "chops-test-origin"; document.body.append(field); field.focus(); })()`);
		await page.press("K", "ctrlShift");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		await page.evaluate(`document.getElementById("chops-test-origin").remove()`);
		await page.press("K", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe("titlebar-chops");
	}, 30_000);

	test("the shortcut does nothing while a dialog is open, and leaves the key to the page", async () => {
		await page.evaluate(`${STORE}.openPalette()`);
		await page.until(`${STORE}.getState().dialog !== null`, "the palette opened");
		await page.evaluate(`window.chopsKeyTaken = null; window.addEventListener("keydown", event => { if (event.key === "K") window.chopsKeyTaken = event.defaultPrevented; })`);
		await page.press("K", "ctrlShift");
		expect(await page.evaluate<boolean | null>("window.chopsKeyTaken")).toBe(false);
		expect(await page.evaluate<boolean>(`${STORE}.getState().layout.chopsOpen`)).toBe(false);
	}, 30_000);

	test("Use chops off in Settings removes the button, the panel, and the shortcut, and keeps the saved chops", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Test", kind: "command", text: "bun test", description: "", agent: null, repository: null }] })`);
		await page.press("K", "ctrlShift");
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "chops" })`);
		await page.until(`document.querySelector('.settings-dialog input[role="switch"]') !== null`, "Settings showed the Chops section");
		expect(await page.evaluate<boolean>(`document.querySelector('.settings-dialog input[role="switch"]').checked`)).toBe(true);
		await page.click(`.settings-dialog input[role="switch"]`);
		await page.click(`.settings-dialog button[type="submit"][aria-disabled="false"]`);
		await page.until(`${STORE}.getState().preferences.useChops === false`, "Use chops was saved off");
		await page.evaluate(`${STORE}.closeDialog()`);
		await page.until(`${STORE}.getState().dialog === null`, "Settings closed");
		expect(await page.evaluate<boolean>(PANEL_HIDDEN)).toBe(true);
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(BUTTON)}) === null`)).toBe(true);
		await page.evaluate(`window.chopsKeyTaken = null; window.addEventListener("keydown", event => { if (event.key === "K") window.chopsKeyTaken = event.defaultPrevented; })`);
		await page.press("K", "ctrlShift");
		expect(await page.evaluate<boolean | null>("window.chopsKeyTaken")).toBe(false);
		expect(await page.evaluate<boolean>(PANEL_HIDDEN)).toBe(true);
		expect(await page.evaluate<string[]>(`${STORE}.getState().preferences.chops.map(chop => chop.name)`)).toEqual(["Test"]);
		// On again: the button, and the panel as it was left, come back.
		await page.evaluate(`${STORE}.savePreferences({ useChops: true })`);
		await page.until(`document.querySelector(${JSON.stringify(BUTTON)}) !== null`, "the button came back");
		expect(await page.evaluate<boolean>(PANEL_SHOWN)).toBe(true);
	}, 30_000);
});
