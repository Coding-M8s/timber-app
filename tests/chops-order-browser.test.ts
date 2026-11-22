import { describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath } from "./support/browser";
import { STORE, BUTTON, ACTIVE, ROW_NAMES, SET_VALUE, NAME_FIELD, openChopsPage } from "./support/chops-panel";

/**
 * Moving and starring chops in the chops panel in a real browser, over the
 * mock engine: Alt+Up and Alt+Down, the star and Favorites, dragging, and
 * what a screen reader hears. The rest of the panel is in
 * chops-panel-browser.test.ts. Skipped where no browser is installed.
 */

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("moving and starring chops in a real browser", () => {
	let page: BrowserPage;
	openChopsPage(opened => (page = opened));

	const SAID = `document.querySelector('#chops-panel p[aria-live="polite"]').textContent.trim()`;

	test("Alt+Up and Alt+Down move a chop, keep the keyboard on it, and say where it is now", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Hello,Test,Dev server"`, "the panel listed the commands in merge order");
		await page.evaluate(`document.querySelector('#chops-panel [data-chop-handle="Dev server"]').focus()`);
		await page.press("ArrowUp", "alt");
		await page.until(`${ROW_NAMES} === "Hello,Dev server,Test"`, "Dev server moved up");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Move Dev server");
		expect(await page.evaluate<string>(SAID)).toBe("Dev server, 2 of 3 in Other chops.");
		// From the Run button too, and the keyboard stays on that button.
		await page.evaluate(`document.querySelector('#chops-panel [data-chop-run="Hello"]').focus()`);
		await page.press("ArrowDown", "alt");
		await page.until(`${ROW_NAMES} === "Dev server,Hello,Test"`, "Hello moved down");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Run Hello");
		await page.until(`${STORE}.getState().preferences.chopOrder["/work/timber"]?.rest.join(",") === "Dev server,Hello,Test,Review the diff"`, "the order was saved");
		// At the top already: nothing moves, and the live region says so.
		await page.evaluate(`document.querySelector('#chops-panel [data-chop-handle="Dev server"]').focus()`);
		await page.press("ArrowUp", "alt");
		await page.until(`${SAID} === "Dev server is already first in Other chops."`, "the panel said it is first");
	}, 30_000);

	test("the star pins a chop from .timber/chops.json to Favorites at the top, and keeps the keyboard on the star", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		await page.click(`#chops-panel [data-chop-star="Dev server"]`);
		await page.until(`${ROW_NAMES} === "Dev server,Test"`, "Dev server went to the top");
		expect(await page.evaluate<string | null>(`document.querySelector('#chops-panel [data-chop-star="Dev server"]').getAttribute("aria-pressed")`)).toBe("true");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Favorite Dev server");
		expect(await page.evaluate<string>(SAID)).toBe("Dev server, 1 of 1 in Favorites.");
		await page.until(`${STORE}.getState().preferences.chopOrder["/work/timber"]?.favorites.join(",") === "Dev server"`, "the favorite was saved");
	}, 30_000);

	test("a press let go beside the handle before a drag began leaves nothing behind for a later hover", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		const handle = await page.middle(`#chops-panel [data-chop-handle="Dev server"]`);
		// Sideways, under the threshold: no drag began, so the handle never hears the release.
		await page.dragTo(handle, { x: handle.x + 120, y: handle.y + 1 });
		await page.release();
		await page.hover(`#chops-panel [data-chop-handle="Test"]`);
		await page.hover(`#chops-panel [data-chop-handle="Dev server"]`);
		expect(await page.evaluate<number>(`document.querySelectorAll("#chops-panel .dragging, #chops-panel .drop-before, #chops-panel .drop-after, #chops-panel .chops-panel-drop").length`)).toBe(0);
	}, 30_000);

	test("a rename whose save fails leaves the rows where they were", async () => {
		// Deploy was starred and deleted, so its name is kept in Favorites.
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Ship", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }], chopOrder: { "/work/timber": { favorites: ["Deploy"], rest: ["Ship", "Test", "Dev server"] } } })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Ship,Test,Dev server"`, "the panel listed Ship first");
		await page.evaluate(`window.timberTestEngine.failPreferenceSaves("The disk is full.")`);
		await page.click(`#chops-panel [data-chop-actions="Ship"]`);
		await page.until(`[...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.includes("Edit"))`, "the menu opened");
		await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes("Edit")).click()`);
		await page.until(`document.querySelector(${JSON.stringify(NAME_FIELD)}) !== null`, "the form opened");
		await page.evaluate(SET_VALUE(NAME_FIELD, "Deploy"));
		await page.press("Enter");
		await page.until(`document.querySelector("#chops-panel").textContent.includes("The disk is full.")`, "the failure showed");
		await page.until(`${STORE}.getState().chopRenaming === null`, "the rename was let go");
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll("#chops-panel h3")].some(heading => heading.textContent === "Favorites")`)).toBe(false);
		expect(await page.evaluate<string>(ROW_NAMES)).toBe("Ship,Test,Dev server");
	}, 30_000);

	test("a press let go beside the handle does not turn a later press elsewhere into a drag", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		const handle = await page.middle(`#chops-panel [data-chop-handle="Dev server"]`);
		await page.dragTo(handle, { x: handle.x + 120, y: handle.y + 1 });
		await page.release();
		// Pressed elsewhere, then over a handle with the button held.
		const other = await page.middle(`#chops-panel [data-chop-handle="Test"]`);
		await page.dragTo({ x: other.x + 120, y: other.y - 20 }, other);
		expect(await page.evaluate<number>(`document.querySelectorAll("#chops-panel .dragging").length`)).toBe(0);
		await page.release();
		expect(await page.evaluate<string>(ROW_NAMES)).toBe("Test,Dev server");
	}, 30_000);

	test("Escape puts a drag away, and nothing moves", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		const handle = await page.middle(`#chops-panel [data-chop-handle="Dev server"]`);
		const test = await page.middle(`#chops-panel [data-chop-row="Test"]`);
		await page.dragTo(handle, { x: handle.x, y: test.top + 2 });
		await page.until(`document.querySelector("#chops-panel .chops-panel-item.dragging") !== null`, "the drag began");
		await page.press("Escape");
		await page.until(`document.querySelector("#chops-panel .chops-panel-item.dragging") === null`, "the drag was put away");
		await page.release();
		expect(await page.evaluate<string>(ROW_NAMES)).toBe("Test,Dev server");
		expect(await page.evaluate<boolean>(`${STORE}.getState().preferences.chopOrder["/work/timber"] === undefined`)).toBe(true);
	}, 30_000);

	test("the same words said twice change the live region, so a screen reader hears them again", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		await page.evaluate(`document.querySelector('#chops-panel [data-chop-handle="Test"]').focus()`);
		const RAW = `document.querySelector('#chops-panel p[aria-live="polite"]').textContent`;
		await page.press("ArrowUp", "alt");
		await page.until(`${SAID} === "Test is already first in Other chops."`, "the panel said it is first");
		const first = await page.evaluate<string>(RAW);
		await page.press("ArrowUp", "alt");
		await page.until(`${RAW} !== ${JSON.stringify(first)}`, "the live region changed");
		expect(await page.evaluate<string>(SAID)).toBe("Test is already first in Other chops.");
	}, 30_000);

	test("dragging reorders within a part and out of Favorites", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chopOrder: { "/work/timber": { favorites: ["Test", "Dev server"], rest: [] } } })`);
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server,Hello"`, "the panel listed the favorites first");
		// Dev server above Test, within Favorites.
		let handle = await page.middle(`#chops-panel [data-chop-handle="Dev server"]`);
		let target = await page.middle(`#chops-panel [data-chop-row="Test"]`);
		await page.dragTo(handle, { x: handle.x, y: target.top + 2 });
		await page.release();
		await page.until(`${ROW_NAMES} === "Dev server,Test,Hello"`, "Dev server moved up in Favorites");
		await page.until(`${STORE}.getState().chopOrderAim === null`, "the order was saved");
		// Test below Hello, out of Favorites.
		handle = await page.middle(`#chops-panel [data-chop-handle="Test"]`);
		target = await page.middle(`#chops-panel [data-chop-row="Hello"]`);
		await page.dragTo(handle, { x: handle.x, y: target.bottom + 4 });
		await page.release();
		await page.until(`${ROW_NAMES} === "Dev server,Hello,Test"`, "Test left Favorites for the end of the rest");
		await page.until(`${STORE}.getState().preferences.chopOrder["/work/timber"]?.favorites.join(",") === "Dev server"`, "Test was unpinned");
	}, 30_000);

	test("a starred chop renamed in the panel's form keeps its star and place, also while the list is read again", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Hello,Test,Dev server"`, "the panel listed Hello");
		await page.click(`#chops-panel [data-chop-star="Dev server"]`);
		await page.click(`#chops-panel [data-chop-star="Hello"]`);
		await page.until(`${ROW_NAMES} === "Dev server,Hello,Test"`, "both were pinned");
		await page.until(`${STORE}.getState().chopOrderAim === null`, "the order was saved");
		await page.evaluate(`window.chopRowsSeen = new Set(); new MutationObserver(() => window.chopRowsSeen.add(${ROW_NAMES})).observe(document.getElementById("chops-panel"), { subtree: true, childList: true, attributes: true })`);
		await page.click(`#chops-panel [data-chop-actions="Hello"]`);
		await page.until(`[...document.querySelectorAll('[role="menuitem"]')].some(item => item.textContent.includes("Edit"))`, "the menu opened");
		await page.evaluate(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent.includes("Edit")).click()`);
		await page.until(`document.querySelector(${JSON.stringify(NAME_FIELD)}) !== null`, "the form opened");
		await page.evaluate(SET_VALUE(NAME_FIELD, "Howdy"));
		await page.press("Enter");
		await page.until(`${ROW_NAMES} === "Dev server,Howdy,Test"`, "Howdy kept Hello's place and star");
		expect(await page.evaluate<string>(`[...window.chopRowsSeen].filter(rows => rows.endsWith(",Hello") || rows.endsWith(",Howdy")).join(" | ")`)).toBe("");
		expect(await page.evaluate<string | null>(`document.querySelector('#chops-panel [data-chop-star="Howdy"]').getAttribute("aria-pressed")`)).toBe("true");
	}, 30_000);

	test("a chop dragged to the top of a long list scrolls it and lands first", async () => {
		const many = Array.from({ length: 30 }, (_, index) => ({ name: `Chop ${index + 1}`, kind: "command", text: `echo ${index + 1}`, description: "", agent: null, repository: null, sound: null }));
		await page.evaluate(`${STORE}.savePreferences({ chops: ${JSON.stringify(many)} })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`document.querySelectorAll("#chops-panel .chops-panel-item").length === 32`, "the panel listed every chop");
		const BODY = `document.querySelector("#chops-panel .chops-panel-body")`;
		expect(await page.evaluate<boolean>(`${BODY}.scrollHeight > ${BODY}.clientHeight * 2`)).toBe(true);
		await page.evaluate(`${BODY}.scrollTop = ${BODY}.scrollHeight`);
		const handle = await page.middle(`#chops-panel [data-chop-handle="Chop 30"]`);
		const top = await page.evaluate<number>(`${BODY}.getBoundingClientRect().top`);
		await page.dragTo(handle, { x: handle.x, y: top + 2 });
		await page.until(`${BODY}.scrollTop === 0`, "the list scrolled to its top");
		await page.release();
		await page.until(`${ROW_NAMES}.startsWith("Chop 30,Chop 1,")`, "Chop 30 landed first");
	}, 30_000);

	test("a chop renamed in Settings, Chops keeps its star and place in the panel", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [{ name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null }] })`);
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Hello,Test,Dev server"`, "the panel listed Hello");
		await page.click(`#chops-panel [data-chop-star="Test"]`);
		await page.until(`${ROW_NAMES} === "Test,Hello,Dev server"`, "Test was pinned");
		await page.click(`#chops-panel [data-chop-handle="Hello"]`);
		await page.press("ArrowDown", "alt");
		await page.until(`${ROW_NAMES} === "Test,Dev server,Hello"`, "Hello moved down");
		await page.until(`${STORE}.getState().chopOrderAim === null`, "the order was saved");
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "chops" })`);
		await page.until(`document.querySelector('.settings-dialog .chop-name input') !== null`, "Settings showed Hello");
		await page.evaluate(SET_VALUE(".settings-dialog .chop-name input", "Howdy"));
		await page.click(`.settings-dialog button[type="submit"][aria-disabled="false"]`);
		await page.until(`${STORE}.getState().preferences.chops[0]?.name === "Howdy"`, "the rename was saved");
		await page.evaluate(`${STORE}.closeDialog()`);
		await page.until(`${ROW_NAMES} === "Test,Dev server,Howdy"`, "Howdy kept Hello's place");
	}, 30_000);

	test("dragging a chop's handle reorders it, and dropping it above the rest pins it", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.click(BUTTON);
		await page.until(`${ROW_NAMES} === "Test,Dev server"`, "the panel listed the file's commands");
		const handle = await page.middle(`#chops-panel [data-chop-handle="Dev server"]`);
		const test = await page.middle(`#chops-panel [data-chop-row="Test"]`);
		// Where the first row was: once the drag starts, the Favorites drop zone shows there and pushes the rows down.
		await page.dragTo(handle, { x: handle.x, y: test.top + 2 });
		await page.until(`document.querySelector("#chops-panel .chops-panel-drop.active") !== null`, "the Favorites drop zone showed, ready to pin");
		await page.release();
		await page.until(`${ROW_NAMES} === "Dev server,Test"`, "Dev server was pinned at the top");
		await page.until(`${STORE}.getState().preferences.chopOrder["/work/timber"]?.favorites.join(",") === "Dev server"`, "the favorite was saved");
	}, 30_000);
});
