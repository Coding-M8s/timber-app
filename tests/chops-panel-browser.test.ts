import { describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath } from "./support/browser";
import { STORE, PANEL_SHOWN, PANEL_HIDDEN, BUTTON, FOCUS_IN_PANEL, ACTIVE, SET_VALUE, NAME_FIELD, TEXT_FIELD, SAVED_NAMES, openChopsPage } from "./support/chops-panel";

/**
 * The chops panel in a real browser, over the mock engine: the button, the
 * shortcut, where the keyboard goes, the "Use chops" switch, running a chop
 * from it with its filter and tabs, and making, editing, and deleting a chop
 * in it. Moving and starring chops is in chops-order-browser.test.ts. The
 * rest is tested without a window. Skipped where no browser is installed.
 */

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the chops panel in a real browser", () => {
	let page: BrowserPage;
	openChopsPage(opened => (page = opened));

	test("the button shows the panel and gives it the keyboard; Close only hides it and gives the keyboard back", async () => {
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(BUTTON)}).getAttribute("aria-pressed")`)).toBe("false");
		await page.click(BUTTON);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(BUTTON)}).getAttribute("aria-pressed")`)).toBe("true");
		// By keyboard: Tab reaches the switch to the files, New chop, then the Close button inside the panel, and Enter hides it.
		await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe("side-panel-view-chops");
		await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe("side-panel-view-files");
		await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe("New chop");
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
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Test", kind: "command", text: "bun test", description: "", agent: null, repository: null, sound: null }] })`);
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
	test("Run starts a personal chop in the selected worktree and keeps the keyboard in the panel; the filter and the tabs narrow the list", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Hello"]') !== null`, "the panel listed Hello");
		// The filter matches text as well as names, and says so when nothing matches.
		await page.click(`#chops-panel input[type="search"]`);
		await page.type("dev:web");
		await page.until(`document.querySelectorAll("#chops-panel .chops-panel-item").length === 1`, "the filter narrowed the list");
		expect(await page.evaluate<string>(`document.querySelector("#chops-panel .chop-item-name").textContent`)).toBe("Dev server");
		await page.type(" and more");
		await page.until(`document.querySelector("#chops-panel .chops-panel-none").textContent === 'No commands match "dev:web and more".'`, "the panel said nothing matches");
		// The tabs by keyboard: the arrow shows Prompts.
		await page.evaluate(`document.querySelector('#chops-panel [role="tab"][aria-selected="true"]').focus()`);
		await page.press("ArrowRight");
		await page.until(`document.querySelector('#chops-panel [role="tab"][aria-selected="true"]').textContent.startsWith("Prompts")`, "the Prompts tab showed");
		expect(await page.evaluate<boolean>(`document.activeElement.textContent.startsWith("Prompts")`)).toBe(true);
		await page.press("ArrowLeft");
		await page.until(`document.querySelector('#chops-panel [role="tab"][aria-selected="true"]').textContent.startsWith("Commands")`, "the Commands tab showed");
		await page.evaluate(`(() => { const field = document.querySelector('#chops-panel input[type="search"]'); const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set; set.call(field, ""); field.dispatchEvent(new Event("input", { bubbles: true })); })()`);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Hello"]') !== null`, "the filter was cleared");
		await page.click(`#chops-panel [aria-label="Run Hello"]`);
		await page.until(`${STORE}.getState().terminals.some(session => session.name === "Hello" && session.state.kind === "running")`, "Hello started");
		expect(await page.evaluate<boolean>(`${STORE}.getState().terminals.find(session => session.name === "Hello").worktree === ${STORE}.getState().repositories[0].worktrees[1].id`)).toBe(true);
		expect(await page.evaluate<boolean>(FOCUS_IN_PANEL)).toBe(true);
	}, 30_000);

	test("a chop from .timber/chops.json asks before its first run, from the panel too", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Dev server"]') !== null`, "the panel listed Dev server");
		await page.click(`#chops-panel [aria-label="Run Dev server"]`);
		await page.until(`${STORE}.getState().dialog?.kind === "approve-chop"`, "the approval was asked");
		expect(await page.evaluate<number>(`${STORE}.getState().terminals.length`)).toBe(0);
	}, 30_000);

	test("\"All chops\" in an empty session pane shows the panel, and never hides it: shown, the panel takes the keyboard; on the files, it switches to the chops", async () => {
		const ALL = `.empty-actions[aria-label="Chops"] button[title="Show the chops panel, with every chop of this repository"]`;
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.until(`document.querySelector(${JSON.stringify(ALL)}) !== null`, "the empty pane offered All chops");
		expect(await page.evaluate<number>(`document.querySelectorAll('.empty-actions[aria-label="Chops"] button').length`)).toBe(4);
		await page.click(ALL);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		// Clicked again with the panel shown, it stays and takes the keyboard back.
		await page.evaluate(`document.querySelector(${JSON.stringify(ALL)}).focus()`);
		await page.click(ALL);
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard again");
		expect(await page.evaluate<boolean>(PANEL_SHOWN)).toBe(true);
		// On the files, it switches the panel to the chops.
		await page.evaluate(`${STORE}.switchSidePanel("files")`);
		await page.until(`document.getElementById("chops-panel")?.dataset.view === "files"`, "the panel showed the files");
		await page.click(ALL);
		await page.until(`document.getElementById("chops-panel")?.dataset.view === "chops"`, "the panel switched to the chops");
		expect(await page.evaluate<boolean>(`${STORE}.getState().layout.chopsOpen`)).toBe(true);
		// Shown already and asked again from the pane, hiding it gives the keyboard back to "All chops".
		await page.evaluate(`document.querySelector(${JSON.stringify(ALL)}).focus()`);
		await page.click(ALL);
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		await page.press("K", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<boolean>(`document.activeElement === document.querySelector(${JSON.stringify(ALL)})`)).toBe(true);
	}, 30_000);

	test("a click on a blocked Run does nothing: no session and no dialog", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Hello"]') !== null`, "the panel listed Hello");
		// Removing the worktree blocks a run, as the palette's rule says.
		await page.evaluate(`(() => { const state = ${STORE}.getState(); const worktree = state.repositories[0].worktrees[1]; state.removals = [{ repository: state.repositories[0].path, worktree, toast: "", status: { kind: "running" } }]; ${STORE}.showTab("changes"); })()`);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Hello"]').getAttribute("aria-disabled") === "true"`, "Run was blocked");
		await page.click(`#chops-panel [aria-label="Run Hello"]`);
		await Bun.sleep(200);
		expect(await page.evaluate<number>(`${STORE}.getState().terminals.length`)).toBe(0);
		expect(await page.evaluate<boolean>(`${STORE}.getState().dialog === null`)).toBe(true);
		expect(await page.evaluate<string>(`${STORE}.getState().tab`)).toBe("changes");
	}, 30_000);


	async function openPanel() {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Dev server"]') !== null`, "the panel listed the repository's chops");
	}

	test("New chop makes one inline; a second Enter saves once; the keyboard goes to its Run", async () => {
		await openPanel();
		await page.click(`#chops-panel [aria-label="New chop"]`);
		await page.until(`document.activeElement?.matches(${JSON.stringify(NAME_FIELD)}) === true`, "the form's name took the keyboard");
		await page.type("Lint");
		await page.evaluate(SET_VALUE(TEXT_FIELD, "bun run lint"));
		await page.evaluate(`document.querySelector(${JSON.stringify(NAME_FIELD)}).focus()`);
		await page.evaluate(`window.chopSaves = 0; const save = ${STORE}.savePreferences; ${STORE}.savePreferences = change => { if (change.chops) window.chopSaves += 1; return save(change); }`);
		await page.press("Enter");
		await page.press("Enter");
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Lint"]') !== null`, "Lint was listed");
		await page.until(`document.activeElement?.getAttribute("aria-label") === "Run Lint"`, "the keyboard went to Lint's Run");
		expect(await page.evaluate<number>("window.chopSaves")).toBe(1);
		expect(await page.evaluate<unknown>(`${STORE}.getState().preferences.chops`)).toEqual([{ name: "Lint", kind: "command", text: "bun run lint", description: "", agent: null, repository: "/work/timber", sound: null }]);
		expect(await page.evaluate<string>(`document.querySelector('#chops-panel [aria-label="Run Lint"]').closest("li").querySelector(".chop-item-meta").textContent`)).toBe("this repository");
	}, 30_000);

	test("a form half typed survives hiding and showing the panel; Escape cancels it", async () => {
		await openPanel();
		await page.click(`#chops-panel [aria-label="New chop"]`);
		await page.until(`document.activeElement?.matches(${JSON.stringify(NAME_FIELD)}) === true`, "the form opened");
		await page.type("Half");
		await page.press("K", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		await page.press("K", "ctrlShift");
		await page.until(PANEL_SHOWN, "the panel showed");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(NAME_FIELD)}).value`)).toBe("Half");
		await page.evaluate(`document.querySelector(${JSON.stringify(NAME_FIELD)}).focus()`);
		await page.press("Escape");
		await page.until(`document.querySelector("#chops-panel .chop-editor") === null`, "Escape cancelled the form");
		expect(await page.evaluate<string[]>(SAVED_NAMES)).toEqual([]);
	}, 30_000);

	test("a double click edits your chop in place, and Settings shows the change", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await openPanel();
		const name = await page.evaluate<{ x: number; y: number }>(`(() => { const box = document.querySelector('#chops-panel [aria-label="Run Hello"]').closest("li").querySelector(".chop-item-name").getBoundingClientRect(); return { x: box.left + 4, y: box.top + box.height / 2 }; })()`);
		await page.evaluate(`document.querySelector('#chops-panel [aria-label="Run Hello"]').closest("li").querySelector(".chop-item-head").dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: ${name.x}, clientY: ${name.y} }))`);
		await page.until(`document.querySelector("#chops-panel li .chop-editor") !== null`, "the form opened in place of the row");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(NAME_FIELD)}).value`)).toBe("Hello");
		await page.evaluate(SET_VALUE(TEXT_FIELD, "pwd -P"));
		await page.click(`#chops-panel .chop-editor button[type="submit"]`);
		await page.until(`${STORE}.getState().preferences.chops[0]?.text === "pwd -P"`, "the change was saved");
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "chops" })`);
		await page.until(`[...document.querySelectorAll(".settings-dialog textarea")].some(field => field.value === "pwd -P")`, "Settings showed the change");
	}, 30_000);

	test("Shift+F10 opens a row's menu; Delete asks first, Cancel keeps it, Delete removes it", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await openPanel();
		await page.evaluate(`document.querySelector('#chops-panel [aria-label="Run Hello"]').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector('[role="menu"][aria-label="Actions for Hello"]') !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(item => item.textContent)`)).toEqual(["Edit", "Delete"]);
		await page.press("ArrowDown");
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel .chop-delete") !== null`, "the panel asked before deleting");
		await page.until(`document.activeElement?.textContent === "Cancel"`, "the keyboard went to Cancel");
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel .chop-delete") === null`, "Cancel put the question away");
		expect(await page.evaluate<string[]>(SAVED_NAMES)).toEqual(["Hello"]);
		await page.click(`#chops-panel [aria-label="Actions for Hello"]`);
		await page.until(`document.querySelector('[role="menu"]') !== null`, "the menu opened by its button");
		await page.press("ArrowDown");
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel .chop-delete") !== null`, "the panel asked again");
		await page.click(`#chops-panel .chop-delete .button.danger`);
		await page.until(`${STORE}.getState().preferences.chops.length === 0`, "Hello was deleted");
		await page.until(`document.querySelector('#chops-panel [aria-label="Run Hello"]') === null`, "Hello left the list");
	}, 30_000);

	test("a chop from .timber/chops.json is only shown: its menu has View, and the view has no field to change but its sound", async () => {
		await openPanel();
		await page.evaluate(`document.querySelector('#chops-panel [aria-label="Run Dev server"]').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector('[role="menu"][aria-label="Actions for Dev server"]') !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map(item => item.textContent)`)).toEqual(["View"]);
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel .chop-editor") !== null`, "the chop was shown");
		await page.until(`document.activeElement?.textContent === "Close"`, "the view opened with the keyboard on Close");
		// Nothing of the file can change: the one field is its sound, kept in the app's settings.
		expect(await page.evaluate<number>(`document.querySelectorAll("#chops-panel .chop-editor input, #chops-panel .chop-editor textarea").length`)).toBe(0);
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("#chops-panel .chop-editor select")].map(select => document.querySelector('label[for="' + select.id + '"]')?.textContent ?? "")`)).toEqual(["Sound"]);
		// Picking a sound saves it at once in the app's settings, and the list is read again with it.
		await page.evaluate(`(() => { const select = document.querySelector("#chops-panel .chop-editor select"); select.value = "bundled:ping"; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await page.until(`JSON.stringify(${STORE}.getState().preferences.fileChopSounds["/work/timber"]) === JSON.stringify([{ name: "Dev server", sound: { kind: "bundled", name: "ping" } }])`, "the sound was saved");
		await page.until(`${STORE}.getState().chops?.list?.chops?.find(chop => chop.name === "Dev server")?.sound?.name === "ping" && document.querySelector("#chops-panel .chop-editor select")?.disabled === false`, "the list has the sound, and the picker takes changes again");
		// None takes it away.
		await page.evaluate(`(() => { const select = document.querySelector("#chops-panel .chop-editor select"); select.value = "none"; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await page.until(`${STORE}.getState().preferences.fileChopSounds["/work/timber"] === undefined && ${STORE}.getState().chops?.list?.chops?.find(chop => chop.name === "Dev server")?.sound === null`, "None took the sound away");
		await page.evaluate(`(() => { const select = document.querySelector("#chops-panel .chop-editor select"); select.value = "bundled:knock"; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		await page.until(`${STORE}.getState().chops?.list?.chops?.find(chop => chop.name === "Dev server")?.sound?.name === "knock"`, "the sound was saved again");
		await page.evaluate(`[...document.querySelectorAll("#chops-panel .chop-editor button")].find(button => button.textContent === "Close").focus()`);
		await page.until(`document.activeElement?.textContent === "Close"`, "the keyboard is on Close");
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel .chop-editor") === null`, "Close put it away");
		await page.until(`document.querySelector('#chops-panel [data-chop-row="Dev server"] .chop-item-sound')?.textContent === "Knock"`, "the row shows the sound");
		await page.evaluate(`${STORE}.savePreferences({ fileChopSounds: {} })`);
	}, 30_000);

	test("Escape gives the keyboard back to the row's actions; a file chop's View leaves an open form as it is", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await openPanel();
		await page.click(`#chops-panel [aria-label="Actions for Hello"]`);
		await page.until(`document.querySelector('[role="menu"]') !== null`, "the menu opened");
		await page.press("Enter");
		await page.until(`document.activeElement?.matches(${JSON.stringify(NAME_FIELD)}) === true`, "the edit form took the keyboard");
		await page.type(" there");
		// Another chop asked for while a form is open: the form stays, with what was typed.
		await page.evaluate(`document.querySelector('#chops-panel [aria-label="Run Dev server"]').closest("li").querySelector(".chop-item-head").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
		await page.until(`document.activeElement?.matches(${JSON.stringify(NAME_FIELD)}) === true`, "the keyboard went back to the form");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(NAME_FIELD)}).value`)).toBe("Hello there");
		await page.press("Escape");
		await page.until(`document.activeElement?.getAttribute("aria-label") === "Actions for Hello"`, "the keyboard went back to the row");
		expect(await page.evaluate<string[]>(SAVED_NAMES)).toEqual(["Hello"]);
	}, 30_000);

	test("a failed save keeps the form and says why; Delete from the form asks, and Cancel goes back to the form", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await openPanel();
		await page.evaluate(`document.querySelector('#chops-panel [aria-label="Run Hello"]').closest("li").querySelector(".chop-item-head").dispatchEvent(new MouseEvent("dblclick", { bubbles: true }))`);
		await page.until(`document.activeElement?.matches(${JSON.stringify(NAME_FIELD)}) === true`, "the edit form opened");
		await page.evaluate(SET_VALUE(TEXT_FIELD, "pwd -L"));
		await page.evaluate(`window.timberTestEngine.failPreferenceSaves("The disk is full.")`);
		await page.click(`#chops-panel .chop-editor button[type="submit"]`);
		await page.until(`document.querySelector('#chops-panel .chop-editor [role="alert"]')?.textContent === "Not saved: The disk is full."`, "the failure was shown");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(TEXT_FIELD)}).value`)).toBe("pwd -L");
		await page.click(`#chops-panel .chop-editor-delete`);
		await page.until(`document.querySelector("#chops-panel .chop-delete") !== null`, "the panel asked before deleting");
		await page.click(`#chops-panel .chop-delete .button.quiet`);
		await page.until(`document.querySelector(${JSON.stringify(TEXT_FIELD)})?.value === "pwd -L"`, "Cancel went back to the form with its text");
		expect(await page.evaluate<string>(`${STORE}.getState().preferences.chops[0].text`)).toBe("pwd");
	}, 30_000);
});
