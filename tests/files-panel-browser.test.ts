import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MIN_CHOPS_WIDTH } from "../src/shared/layout";
import { COLLAPSE_FOLDERS_LABEL } from "../src/mainview/files-panel-format";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The file explorer in a real browser, over the mock engine: the Files
 * button and shortcut, the switch to the chops, and the tree by keyboard
 * and pointer, opening a file in the File tab. The rest is tested without a
 * window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const FILES_SHOWN = `document.querySelector('[data-view="files"]') !== null`;
const PANEL_HIDDEN = `document.getElementById("chops-panel") === null`;
const BUTTON = "#titlebar-files";
const FOCUS_IN_PANEL = `document.getElementById("chops-panel")?.contains(document.activeElement) === true`;
const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	return active.dataset.row || active.id || active.getAttribute("aria-label") || active.className;
})()`;
const ROW = (path: string) => `[data-row=${JSON.stringify(path)}]`;
const OPEN_FILE = `(() => { const state = ${STORE}.getState(); const id = state.selection?.worktree; return state.tab === "file" && id ? state.files[id]?.path ?? null : null; })()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the file explorer in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(BUTTON)}) !== null`, "the Files button showed");
	}, 30_000);

	test("the button shows the files and gives them the keyboard; pressed again it hides them and gives it back", async () => {
		await page.click(BUTTON);
		await page.until(FILES_SHOWN, "the files showed");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(BUTTON)}).getAttribute("aria-pressed")`)).toBe("true");
		await page.click(BUTTON);
		await page.until(PANEL_HIDDEN, "the panel hid");
	}, 30_000);

	test("the tree works by keyboard: the arrows move, open, and close, and Enter opens a file in the File tab", async () => {
		await page.press("E", "ctrlShift");
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs"))}) !== null`, "the tree was read");
		// Tab goes through the switch, Ignored, Close, and Collapse all folders, then reaches the tree's one tab stop: its first row.
		for (const expected of ["side-panel-view-chops", "side-panel-view-files", "side-panel-view-changes", "files-panel-ignored", "Hide the files panel", COLLAPSE_FOLDERS_LABEL, "docs"]) {
			await page.press("Tab");
			expect(await page.evaluate<string>(ACTIVE)).toBe(expected);
		}
		await page.press("ArrowRight");
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs/plan.md"))}) !== null`, "docs opened");
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(ROW("docs"))}).getAttribute("aria-expanded")`)).toBe("true");
		await page.press("ArrowRight");
		expect(await page.evaluate<string>(ACTIVE)).toBe("docs/plan.md");
		await page.press("Enter");
		await page.until(`${OPEN_FILE} === "docs/plan.md"`, "the file opened in the File tab");
		// The keyboard stays in the tree, to open the next one.
		expect(await page.evaluate<string>(ACTIVE)).toBe("docs/plan.md");
		await page.press("ArrowLeft");
		expect(await page.evaluate<string>(ACTIVE)).toBe("docs");
		await page.press("ArrowLeft");
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs/plan.md"))}) === null`, "docs closed");
		await page.press("End");
		const last = await page.evaluate<string>(ACTIVE);
		await page.press("Home");
		expect(await page.evaluate<string>(ACTIVE)).toBe("docs");
		await page.press("ArrowDown");
		expect(await page.evaluate<string>(ACTIVE)).not.toBe("docs");
		expect(last).not.toBe("docs");
	}, 30_000);

	test("a click on a file opens it, and a click on a folder opens it", async () => {
		await page.click(BUTTON);
		await page.until(`document.querySelector(${JSON.stringify(ROW("README.md"))}) !== null`, "the tree was read");
		await page.click(ROW("README.md"));
		await page.until(`${OPEN_FILE} === "README.md"`, "README.md opened");
		await page.until(`document.querySelector('${ROW("README.md")}[aria-current="true"]') !== null`, "the open file is marked");
		await page.click(ROW("docs"));
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs/plan.md"))}) !== null`, "docs opened");
	}, 30_000);

	test("Ignored shows what Git ignores, and the switch goes to the chops and back with the keyboard on it", async () => {
		await page.click(BUTTON);
		await page.until(`document.querySelector(${JSON.stringify(ROW("README.md"))}) !== null`, "the tree was read");
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(ROW("node_modules"))}) === null`)).toBe(true);
		await page.click(".files-panel-ignored");
		await page.until(`document.querySelector(${JSON.stringify(ROW("node_modules"))}) !== null`, "ignored entries showed");
		await page.click("#side-panel-view-chops");
		await page.until(`document.querySelector('[data-view="chops"]') !== null`, "the chops showed");
		await page.until(`document.activeElement?.id === "side-panel-view-chops"`, "the keyboard stayed on the switch");
		await page.press("Tab");
		await page.press("Enter");
		await page.until(FILES_SHOWN, "the files showed again");
		await page.until(`document.activeElement?.id === "side-panel-view-files"`, "the keyboard stayed on the switch");
		// The tree is as it was: what was read is kept while the chops show.
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(ROW("node_modules"))}) !== null`)).toBe(true);
	}, 30_000);

	test("each row's icon is drawn from the app's own files, only the ones that show load, and a light theme takes its light drawings", async () => {
		const ICON = (path: string) => `document.querySelector(${JSON.stringify(`${ROW(path)} .files-tree-icon`)})`;
		const LOADED = `[...document.querySelectorAll(".files-tree-icon")].every(icon => icon.complete && icon.naturalWidth > 0)`;
		// The page's own resource list is full of the dev server's modules by now, so the icons are counted as they load.
		await page.evaluate(`(() => {
			window.iconRequests = [];
			new PerformanceObserver(list => {
				for (const entry of list.getEntries()) if (entry.name.includes("/material-icons/")) window.iconRequests.push(entry.name);
			}).observe({ type: "resource" });
		})()`);
		await page.evaluate(`window.timberTestEngine.setWorktreeFile(${STORE}.getState().repositories[0].worktrees[0].path, "bun.lock", "{}\\n")`);
		await page.click(BUTTON);
		await page.until(`${ICON("bun.lock")} !== null`, "the tree was read");
		await page.until(LOADED, "every icon that shows was drawn");
		expect(await page.evaluate<string>(`${ICON("docs")}.getAttribute("src")`)).toBe("/assets/material-icons/folder-docs.svg");
		await page.click(ROW("docs"));
		await page.until(`${ICON("docs")}.getAttribute("src") === "/assets/material-icons/folder-docs-open.svg"`, "the folder's icon opened with it");
		await page.until(LOADED, "the opened folder's icons were drawn");
		await page.until(`window.iconRequests.length > 3`, "the icons that show were counted");
		const requests = await page.evaluate<string[]>("window.iconRequests");
		// Same origin as the page, never the network, and a handful of the theme's more than a thousand icons.
		const origin = await page.evaluate<string>("location.origin");
		for (const request of requests) expect(request.startsWith(`${origin}/assets/material-icons/`)).toBe(true);
		expect(requests.length).toBeGreaterThan(3);
		expect(requests.length).toBeLessThan(20);
		expect(await page.evaluate<string>(`${ICON("bun.lock")}.getAttribute("src")`)).toBe("/assets/material-icons/bun.svg");
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-light" } })`);
		await page.until(`${ICON("bun.lock")}.getAttribute("src") === "/assets/material-icons/bun_light.svg"`, "the light theme took the light drawing");
		await page.until(LOADED, "the light drawing was drawn");
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-dark" } })`);
		await page.until(`${ICON("bun.lock")}.getAttribute("src") === "/assets/material-icons/bun.svg"`, "the dark theme took the dark drawing back");
	}, 30_000);

	const COLLAPSE = ".files-panel-collapse";
	const NESTED_ROWS = `[...document.querySelectorAll("[data-row]")].filter(row => row.getAttribute("aria-level") !== "1").length`;
	const COLLAPSE_OFF = `document.querySelector("${COLLAPSE}").getAttribute("aria-disabled") === "true"`;
	const TAB_STOPS = `[...document.querySelectorAll('[role="treeitem"][tabindex="0"]')].map(row => row.dataset.row)`;
	/** Show the files with node_modules and its left-pad open, and docs, and the row of `node_modules/left-pad/index.js` with the keyboard. */
	async function openNested() {
		await page.click(BUTTON);
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs"))}) !== null`, "the tree was read");
		expect(await page.evaluate<boolean>(COLLAPSE_OFF)).toBe(true);
		await page.click(".files-panel-ignored");
		for (const path of ["node_modules", "node_modules/left-pad", "docs"]) {
			await page.until(`document.querySelector(${JSON.stringify(ROW(path))}) !== null`, `${path} showed`);
			await page.click(ROW(path));
		}
		await page.until(`document.querySelector(${JSON.stringify(ROW("docs/plan.md"))}) !== null`, "docs opened");
		await page.evaluate(`document.querySelector(${JSON.stringify(ROW("node_modules/left-pad/index.js"))}).focus()`);
		expect(await page.evaluate<string>(ACTIVE)).toBe("node_modules/left-pad/index.js");
	}

	test("a click on Collapse all folders closes every folder, and the tree's tab stop is the top-level folder of the row that had it", async () => {
		await openNested();
		await page.click(COLLAPSE);
		await page.until(`${NESTED_ROWS} === 0`, "every folder closed");
		expect(await page.evaluate<boolean>(COLLAPSE_OFF)).toBe(true);
		expect(await page.evaluate<string[]>(TAB_STOPS)).toEqual(["node_modules"]);
		await page.press("Tab");
		expect(await page.evaluate<string>(ACTIVE)).toBe("node_modules");
		await page.press("ArrowRight");
		await page.until(`document.querySelector(${JSON.stringify(ROW("node_modules/left-pad"))}) !== null`, "the folder opened again");
		expect(await page.evaluate<boolean>(COLLAPSE_OFF)).toBe(false);
	}, 30_000);

	test("pressed by keyboard, Collapse all folders keeps the keyboard, and pressed again while off it does nothing", async () => {
		await openNested();
		await page.evaluate(`document.querySelector("${COLLAPSE}").focus()`);
		await page.press("Enter");
		await page.until(`${NESTED_ROWS} === 0`, "every folder closed");
		expect(await page.evaluate<string>(ACTIVE)).toBe(COLLAPSE_FOLDERS_LABEL);
		await page.press("Enter");
		expect(await page.evaluate<string>(ACTIVE)).toBe(COLLAPSE_FOLDERS_LABEL);
		expect(await page.evaluate<string[]>(TAB_STOPS)).toEqual(["node_modules"]);
	}, 30_000);

	test("a press that leaves the keyboard on the hidden row, or on the panel, puts it on the top-level folder; one from elsewhere leaves it", async () => {
		// As a screen reader's press, which moves no focus.
		const press = `document.querySelector("${COLLAPSE}").click()`;
		await openNested();
		await page.evaluate(press);
		await page.until(`document.activeElement?.dataset?.row === "node_modules"`, "the keyboard went from the row to the top-level folder");
		await page.press("ArrowRight");
		await page.until(`${NESTED_ROWS} > 0`, "the folder opened again");
		// As a webview that gives a click on a button to the panel around it.
		await page.evaluate(`document.querySelector("#chops-panel").focus()`);
		await page.evaluate(press);
		await page.until(`document.activeElement?.dataset?.row === "node_modules"`, "the keyboard went from the panel to the top-level folder");
		await page.press("ArrowRight");
		await page.until(`${NESTED_ROWS} > 0`, "the folder opened once more");
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const before = await page.evaluate<string>(ACTIVE);
		await page.evaluate(press);
		await page.until(`${NESTED_ROWS} === 0`, "every folder closed");
		await Bun.sleep(50);
		expect(await page.evaluate<string>(ACTIVE)).toBe(before);
	}, 30_000);

	test("chosen in the command palette from a nested row, the keyboard lands on that row's top-level folder", async () => {
		await openNested();
		await page.press("P", "ctrlShift");
		await page.until(`document.querySelector("dialog.palette[open]") !== null`, "the palette opened");
		await page.type("collapse all");
		await page.press("Enter");
		await page.until(`${NESTED_ROWS} === 0`, "every folder closed");
		await page.until(`document.activeElement?.dataset?.row === "node_modules"`, "the keyboard went to the top-level folder");
	}, 30_000);

	test("at the narrowest panel, the header, the row, and the tree do not overlap, in Timber Light and Timber Dark", async () => {
		await openNested();
		await page.evaluate(`${STORE}.resizeChopsPanel(${MIN_CHOPS_WIDTH})`);
		for (const theme of ["timber-light", "timber-dark"]) {
			await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: ${JSON.stringify(theme)} } })`);
			const drawn = await page.evaluate<Record<"panel" | "head" | "tools" | "button" | "close" | "body", { left: number; right: number; top: number; bottom: number }> & { reached: boolean }>(`(() => {
				const box = selector => { const { left, right, top, bottom } = document.querySelector(selector).getBoundingClientRect(); return { left, right, top, bottom }; };
				const button = box("${COLLAPSE}");
				const reached = document.elementFromPoint((button.left + button.right) / 2, (button.top + button.bottom) / 2);
				return {
					panel: box("#chops-panel"), head: box(".files-panel .chops-panel-head"), tools: box(".files-panel-tools"), button,
					close: box(".files-panel .chops-panel-close"), body: box(".files-panel-body"), reached: document.querySelector("${COLLAPSE}").contains(reached),
				};
			})()`);
			expect(drawn.panel.right - drawn.panel.left).toBe(MIN_CHOPS_WIDTH);
			expect(drawn.head.bottom).toBeLessThanOrEqual(drawn.tools.top);
			expect(drawn.tools.bottom).toBeLessThanOrEqual(drawn.body.top);
			expect(drawn.close.bottom).toBeLessThanOrEqual(drawn.button.top);
			expect(drawn.button.top).toBeGreaterThanOrEqual(drawn.tools.top);
			expect(drawn.button.bottom).toBeLessThanOrEqual(drawn.tools.bottom);
			expect(drawn.button.left).toBeGreaterThanOrEqual(drawn.panel.left);
			// At the row's right edge, inside the panel.
			expect(drawn.panel.right - drawn.button.right).toBe(8);
			expect(drawn.reached).toBe(true);
		}
	}, 30_000);

	test("the shortcut hides the files and gives the keyboard back where it was", async () => {
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const before = await page.evaluate<string>(ACTIVE);
		await page.press("E", "ctrlShift");
		await page.until(FOCUS_IN_PANEL, "the panel took the keyboard");
		await page.press("E", "ctrlShift");
		await page.until(PANEL_HIDDEN, "the panel hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe(before);
	}, 30_000);
});
