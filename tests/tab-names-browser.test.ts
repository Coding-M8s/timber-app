import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { MAX_SIDEBAR_WIDTH } from "../src/shared/layout";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The workspace's tab row with long and short file names in the diff and
 * File tabs (issue 421), in a real browser over the mock engine: nothing in
 * it passes the workspace's edges, long names end in an ellipsis, and what
 * closes a tab or sets the diff's layout stays in reach. Layout needs a real
 * browser, so this is skipped where none is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const LONG = "docs/plans/What-to-ask-in-the-questionnaire-abu-949-sales-leads-query-and-every-follow-up-question.md";
const LONG_FILE = "docs/plans/the-second-long-named-plan-that-is-open-in-the-file-tab-beside-the-diff.md";
const SHORT = "src/split.ts";

/**
 * Window and sidebar widths. The narrowest workspace is beside a sidebar at
 * half the window and a side panel at a third, just above the window width
 * at which the three stack.
 */
const SIZES: readonly { window: number; sidebar: number }[] = [
	{ window: 1500, sidebar: 272 },
	{ window: 1280, sidebar: 272 },
	{ window: 1000, sidebar: 272 },
	{ window: 800, sidebar: 272 },
	{ window: 641, sidebar: MAX_SIDEBAR_WIDTH },
	{ window: 480, sidebar: 272 },
];
const NARROWEST = SIZES[4]!;

/** What the tab row draws: each tab, close button, marker, name, and the Diff layout switch with its two choices. */
const DRAWN = `.tabs, .tabs .tab, .tabs .tab-close, .tabs .tab-kind, .tabs .tab-label, .diff-layout, .diff-layout .mode-option`;

/** What passes the workspace's left or right edge, or lies over something else the row draws. Empty when all fits. */
const MISFITS = `(() => {
	const workspace = document.querySelector(".workspace").getBoundingClientRect();
	const row = document.querySelector(".tabs-row").getBoundingClientRect();
	const name = element => element.id || element.getAttribute("aria-label") || element.className;
	const misfits = [];
	for (const element of document.querySelectorAll(${JSON.stringify(DRAWN)})) {
		const box = element.getBoundingClientRect();
		if (box.width <= 0 || box.height <= 0) misfits.push(name(element) + " is not drawn");
		if (box.left < workspace.left - 0.5 || box.right > workspace.right + 0.5) misfits.push(name(element) + " passes the workspace's edge: " + box.left + " to " + box.right);
		if (box.top < row.top - 0.5 || box.bottom > row.bottom + 0.5) misfits.push(name(element) + " passes the row's edge");
	}
	if (Math.abs(row.right - workspace.right) > 0.5) misfits.push("the row does not end at the workspace's edge");
	if (document.documentElement.scrollWidth > document.documentElement.clientWidth) misfits.push("the page scrolls sideways");
	// Each thing to click, and the diff's marker, is what the pointer reaches at its middle.
	for (const element of document.querySelectorAll(".tabs .tab, .tabs .tab-kind, .tabs .tab-close, .diff-layout .mode-option")) {
		const box = element.getBoundingClientRect();
		const reached = document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2);
		if (!reached || !element.contains(reached)) misfits.push(name(element) + " is under " + (reached ? name(reached) : "nothing"));
	}
	return misfits;
})()`;

/** Whether the name of a tab is cut short, with room for a letter and the whole ellipsis. */
const SHORTENED = (tab: string) => `(() => {
	const name = document.querySelector("#tab-${tab} .tab-label");
	const style = getComputedStyle(name);
	const pen = document.createElement("canvas").getContext("2d");
	pen.font = style.font;
	const room = name.getBoundingClientRect().width - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight);
	return name.scrollWidth > name.clientWidth && style.textOverflow === "ellipsis" && style.overflowX === "hidden" && room >= pen.measureText(name.textContent[0] + "\u2026").width;
})()`;

const WIDTH = (selector: string) => `document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect().width`;
const ACTIVE = `document.activeElement?.id ?? null`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the tab row with long file names in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.resize(1500, 900);
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
	}, 30_000);

	/** Open one path in the diff tab and one in the File tab, with the side panel showing, and show the diff tab. */
	async function open(diff: string, file: string) {
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			const patch = path => ["diff --git a/" + path + " b/" + path, "index 1111111..2222222 100644", "--- a/" + path, "+++ b/" + path, "@@ -1 +1 @@", "-old", "+new", ""].join("\\n");
			${ENGINE}.setFileChanges(feature.path, ${JSON.stringify([...new Set([diff, file])])}.map(path => ({ change: { area: "unstaged", kind: "modified", path, previousPath: null }, patch: patch(path) })));
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
		})()`);
		await page.until(`${STORE}.getState().changes?.compared != null`, "the changes were read");
		await page.evaluate(`${STORE}.compareChanges("uncommitted")`);
		await page.until(`[...document.querySelectorAll(".change-file")].some(button => button.title === ${JSON.stringify(diff)})`, "the file was listed");
		await page.evaluate(`${STORE}.openFile(${STORE}.getState().selection.worktree, ${JSON.stringify(file)})`);
		await page.until(`document.querySelector("#tab-file") !== null`, "the File tab showed");
		await page.evaluate(`[...document.querySelectorAll(".change-file")].find(button => button.title === ${JSON.stringify(diff)}).click()`);
		await page.until(`document.querySelector("#tab-diff.selected") !== null && document.querySelector(".diff-layout") !== null`, "the diff tab showed");
	}

	async function layOut(size: { window: number; sidebar: number }) {
		await page.resize(size.window, 900);
		await page.evaluate(`${STORE}.resizeSidebar(${size.sidebar})`);
		await page.until(`document.querySelector(".body").style.getPropertyValue("--sidebar-width") === "${size.sidebar}px"`, "the sidebar took its width");
		// The side panel shows, so the workspace has the least room this window leaves it.
		expect(await page.evaluate<boolean>(`document.querySelector(".chops-panel") !== null`)).toBe(true);
	}

	test("nothing in the row passes the workspace's edges at any width, and long names end in an ellipsis", async () => {
		await open(LONG, LONG_FILE);
		for (const path of [LONG, LONG_FILE]) expect(path.slice(path.lastIndexOf("/") + 1).length).toBeGreaterThanOrEqual(60);
		const whole = { workspace: await page.evaluate<number>(WIDTH("#tab-workspace")), pullRequest: await page.evaluate<number>(WIDTH("#tab-pull-request")) };
		const workspaces: number[] = [];
		for (const size of SIZES) {
			await layOut(size);
			workspaces.push(await page.evaluate<number>(WIDTH(".workspace")));
			for (const tab of ["diff", "file"]) {
				await page.evaluate(`${STORE}.showTab("${tab}")`);
				await page.until(`document.querySelector("#tab-${tab}.selected") !== null`, `the ${tab} tab was selected`);
				expect({ size, tab, misfits: await page.evaluate<string[]>(MISFITS) }).toEqual({ size, tab, misfits: [] });
				expect({ size, diff: await page.evaluate<boolean>(SHORTENED("diff")), file: await page.evaluate<boolean>(SHORTENED("file")) }).toEqual({ size, diff: true, file: true });
				// The other two are never shortened.
				expect(await page.evaluate<number>(WIDTH("#tab-workspace"))).toBe(whole.workspace);
				expect(await page.evaluate<number>(WIDTH("#tab-pull-request"))).toBe(whole.pullRequest);
			}
		}
		// One long name alone fits as well, whichever tab it is in.
		for (const alone of ["file", "diff"] as const) {
			await page.evaluate(`${STORE}.${alone === "file" ? "closeDiff" : "closeFile"}(${STORE}.getState().selection.worktree)`);
			await page.until(`document.querySelector("#tab-${alone === "file" ? "diff" : "file"}") === null`, `the ${alone} tab was alone`);
			for (const size of SIZES) {
				await layOut(size);
				await page.evaluate(`${STORE}.showTab("${alone}")`);
				expect({ size, alone, misfits: await page.evaluate<string[]>(MISFITS) }).toEqual({ size, alone, misfits: [] });
				expect({ size, alone, shortened: await page.evaluate<boolean>(SHORTENED(alone)) }).toEqual({ size, alone, shortened: true });
			}
			if (alone === "file") await open(LONG, LONG_FILE);
		}
		// The sizes reach the narrowest workspace the layout allows: half the window to the sidebar, a third to the side panel.
		expect(Math.min(...workspaces)).toBe(workspaces[SIZES.indexOf(NARROWEST)]!);
		expect(Math.min(...workspaces)).toBeLessThan(641 * 0.17);
	}, 60_000);

	test("a long name does not take the whole row where there is room, and hovering gives the full path", async () => {
		await open(LONG, LONG_FILE);
		await page.resize(2400, 900);
		expect(await page.evaluate<boolean>(`document.querySelector(".diff-layout").getBoundingClientRect().top < document.querySelector(".tabs").getBoundingClientRect().bottom`)).toBe(true);
		for (const tab of ["diff", "file"]) {
			expect(await page.evaluate<number>(WIDTH(`#tab-${tab}`))).toBeLessThanOrEqual(260);
			expect(await page.evaluate<boolean>(SHORTENED(tab))).toBe(true);
		}
		for (const size of [{ window: 2400, sidebar: 272 }, NARROWEST]) {
			await layOut(size);
			for (const [tab, title] of [["diff", `Diff of ${LONG}`], ["file", LONG_FILE]] as const) {
				await page.hover(`#tab-${tab} .tab-label`);
				// The tooltip is the title of what the pointer is over, or of what holds it.
				expect(await page.evaluate<string | null>(`[...document.querySelectorAll(":hover")].at(-1).closest("[title]")?.title ?? null`)).toBe(title);
			}
			// The marker before the diff's name is whole, and the name starts after it.
			expect(await page.evaluate<boolean>(`(() => {
				const kind = document.querySelector("#tab-diff .tab-kind");
				return kind.scrollWidth <= kind.clientWidth && kind.getBoundingClientRect().right <= document.querySelector("#tab-diff .tab-label").getBoundingClientRect().left;
			})()`)).toBe(true);
		}
	}, 30_000);

	test("the Diff layout switch and both close buttons answer to a real click at the narrowest width", async () => {
		await open(LONG, LONG_FILE);
		await layOut(NARROWEST);
		await page.click(".diff-layout .mode-option:last-child");
		await page.until(`${STORE}.getState().layout.diffLayout === "split"`, "Split was chosen");
		await page.click(".diff-layout .mode-option:first-child");
		await page.until(`${STORE}.getState().layout.diffLayout === "unified"`, "Unified was chosen");
		await page.click("#tab-file + .tab-close");
		await page.until(`document.querySelector("#tab-file") === null`, "the File tab closed");
		expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
		await page.click("#tab-diff + .tab-close");
		await page.until(`document.querySelector("#tab-diff") === null`, "the diff tab closed");
	}, 30_000);

	test("short names are whole, and each tab is as wide as its name and where the last one left off", async () => {
		await open(SHORT, "README.md");
		for (const size of [SIZES[0]!, SIZES[1]!]) {
			await layOut(size);
			const row = await page.evaluate<{ id: string; left: number; width: number; top: number; height: number }[]>(`(() => {
				const tabs = document.querySelector(".tabs").getBoundingClientRect();
				return [...document.querySelectorAll(".tabs .tab, .tabs .tab-close")].map(element => {
					const box = element.getBoundingClientRect();
					return { id: element.id || "close", left: box.left - tabs.left, width: box.width, top: box.top - tabs.top, height: box.height };
				});
			})()`);
			expect(row.map(item => item.id)).toEqual(["tab-workspace", "tab-pull-request", "tab-diff", "close", "tab-file", "close"]);
			// As before the names could be shortened: 2px between tabs, and each close 4px into its tab's padding.
			let left = 8;
			for (const item of row) {
				const close = item.id === "close";
				if (close) left -= 6;
				expect(Math.abs(item.left - left)).toBeLessThan(0.1);
				expect({ id: item.id, top: item.top, height: item.height }).toEqual({ id: item.id, top: close ? 6 : 0, height: close ? 22 : 34 });
				left = item.left + item.width + 2;
			}
			for (const tab of ["diff", "file"]) {
				expect(await page.evaluate<boolean>(`(() => {
					const name = document.querySelector("#tab-${tab} .tab-label");
					return name.scrollWidth === name.clientWidth;
				})()`)).toBe(true);
			}
			expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
		}
		// With one file open, a narrower row puts the switch under the tabs before it shortens a short name.
		await page.evaluate(`${STORE}.closeFile(${STORE}.getState().selection.worktree)`);
		await page.until(`document.querySelector("#tab-file") === null`, "the File tab closed");
		await layOut({ window: 1000, sidebar: 272 });
		expect(await page.evaluate<boolean>(`document.querySelector(".diff-layout").getBoundingClientRect().top >= document.querySelector(".tabs").getBoundingClientRect().bottom`)).toBe(true);
		expect(await page.evaluate<boolean>(SHORTENED("diff"))).toBe(false);
		expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
	}, 30_000);

	test("with less room the switch goes under the tabs first, then the names shrink, and last a file's tab goes on the next line with its close button", async () => {
		await open(LONG, LONG_FILE);
		const at = async (window: number) => {
			await layOut({ window, sidebar: 272 });
			return page.evaluate<{ switchBeside: boolean; lines: number; diff: number; closeBeside: boolean }>(`(() => {
				const tops = [...document.querySelectorAll(".tabs .tab")].map(tab => tab.getBoundingClientRect().top);
				const tabs = document.querySelector(".tabs").getBoundingClientRect();
				return {
					switchBeside: document.querySelector(".diff-layout").getBoundingClientRect().top < tabs.bottom,
					lines: new Set(tops).size,
					diff: Math.round(document.querySelector("#tab-diff").getBoundingClientRect().width),
					closeBeside: [...document.querySelectorAll(".tab-close")].every(close => Math.abs(close.getBoundingClientRect().left + 4 - close.previousElementSibling.getBoundingClientRect().right) < 0.1 && close.getBoundingClientRect().top - close.previousElementSibling.getBoundingClientRect().top === 6),
				};
			})()`);
		};
		expect(await at(1500)).toEqual({ switchBeside: true, lines: 1, diff: 260, closeBeside: true });
		const middle = await at(1280);
		expect(middle).toEqual({ switchBeside: false, lines: 1, diff: middle.diff, closeBeside: true });
		expect(middle.diff).toBeLessThan(260);
		expect(await at(1000)).toMatchObject({ switchBeside: false, lines: 2, closeBeside: true });
	}, 30_000);

	test("the unsaved mark is whole after a name at any width, says so, and goes with a save, which the sidebar's row shows at once", async () => {
		const MARK = `document.querySelector("#tab-file .tab-unsaved")`;
		const ROW = `[...document.querySelectorAll(".row-item.selected *")]`;
		const change = `${STORE}.editFile(${STORE}.getState().selection.worktree); ${STORE}.changeDraft(${STORE}.getState().selection.worktree, "edited\\n")`;
		const name = LONG_FILE.slice(LONG_FILE.lastIndexOf("/") + 1);
		await open(LONG, LONG_FILE);
		expect(await page.evaluate<boolean>(`${MARK} === null`)).toBe(true);
		await page.evaluate(change);
		await page.until(`${MARK} !== null`, "the mark showed while the diff tab does");
		for (const size of SIZES) {
			await layOut(size);
			for (const tab of ["diff", "file"]) {
				await page.evaluate(`${STORE}.showTab("${tab}")`);
				await page.until(`document.querySelector("#tab-${tab}.selected") !== null`, `the ${tab} tab was selected`);
				expect({ size, tab, misfits: await page.evaluate<string[]>(MISFITS) }).toEqual({ size, tab, misfits: [] });
				expect({ size, tab, shortened: await page.evaluate<boolean>(SHORTENED("file")) }).toEqual({ size, tab, shortened: true });
				const mark = await page.evaluate<{ drawn: boolean; afterName: boolean; inTab: boolean; reached: boolean }>(`(() => {
					const mark = ${MARK};
					const box = mark.getBoundingClientRect();
					const tab = document.querySelector("#tab-file").getBoundingClientRect();
					return {
						drawn: box.width > 3 && box.height > 3,
						afterName: box.left >= document.querySelector("#tab-file .tab-label").getBoundingClientRect().right,
						inTab: box.right <= tab.right && box.top >= tab.top && box.bottom <= tab.bottom,
						reached: mark.contains(document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)),
					};
				})()`);
				expect({ size, tab, ...mark }).toEqual({ size, tab, drawn: true, afterName: true, inTab: true, reached: true });
			}
		}
		expect(await page.accessibleName("#tab-file")).toBe(`${name} (unsaved)`);
		await page.hover("#tab-file .tab-unsaved");
		expect(await page.evaluate<string | null>(`[...document.querySelectorAll(":hover")].at(-1).closest("[title]")?.title ?? null`)).toBe(`${LONG_FILE} (unsaved)`);
		expect(await page.accessibleName("#tab-file + .tab-close")).toBe(`Close ${name}`);

		await page.resize(1500, 900);
		expect(await page.evaluate<boolean>(`${ROW}.some(element => element.textContent === "3M")`)).toBe(true);
		// The other file is no longer changed, which only reading the Changes list again shows.
		const patch = [`diff --git a/${LONG_FILE} b/${LONG_FILE}`, "index 1111111..2222222 100644", `--- a/${LONG_FILE}`, `+++ b/${LONG_FILE}`, "@@ -1 +1 @@", "-old", "+new", ""].join("\n");
		await page.evaluate(`${ENGINE}.setFileChanges(${STORE}.getState().repositories[0].worktrees[1].path, ${JSON.stringify([{ change: { area: "unstaged", kind: "modified", path: LONG_FILE, previousPath: null }, patch }])})`);
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-file").length`)).toBe(2);
		await page.evaluate(`${STORE}.saveFile(${STORE}.getState().selection.worktree)`);
		await page.until(`${ROW}.some(element => element.textContent === "4M")`, "the row counted the saved file");
		await page.until(`[...document.querySelectorAll(".change-file")].map(button => button.title).join() === ${JSON.stringify(LONG_FILE)}`, "the Changes list was read again");
		expect(await page.evaluate<boolean>(`${MARK} === null`)).toBe(true);
		expect(await page.accessibleName("#tab-file")).toBe(name);
	}, 60_000);

	test("the arrows, Home, and End move between the tabs, and each focused one draws its ring inside the workspace", async () => {
		// The main process writes the theme before the app's page is drawn; this page has none, so the ring's color is set by hand.
		await page.evaluate(`document.documentElement.style.setProperty("--focus", "rgb(80, 140, 255)")`);
		await open(LONG, LONG_FILE);
		for (const size of [SIZES[1]!, NARROWEST]) {
			await layOut(size);
			await page.evaluate(`document.querySelector("#tab-diff").focus()`);
			for (const [key, tab] of [["Home", "workspace"], ["ArrowRight", "pull-request"], ["ArrowRight", "diff"], ["ArrowRight", "file"], ["ArrowLeft", "diff"], ["End", "file"]] as const) {
				await page.press(key);
				await page.until(`${ACTIVE} === "tab-${tab}"`, `${key} reached the ${tab} tab`);
				expect(await page.evaluate<string>(`${STORE}.getState().tab`)).toBe(tab);
				const ring = await page.evaluate<{ style: string; width: string; offset: string; inside: boolean }>(`(() => {
					const tab = document.activeElement;
					const style = getComputedStyle(tab);
					const box = tab.getBoundingClientRect();
					const tabs = document.querySelector(".tabs").getBoundingClientRect();
					return { style: style.outlineStyle, width: style.outlineWidth, offset: style.outlineOffset, inside: box.left >= tabs.left - 0.5 && box.right <= tabs.right + 0.5 && box.top >= tabs.top - 0.5 && box.bottom <= tabs.bottom + 0.5 };
				})()`);
				expect(ring).toEqual({ style: "solid", width: "2px", offset: "-2px", inside: true });
				// Reaching a tab scrolls nothing in the row.
				expect(await page.evaluate<number>(`document.querySelector(".tabs").scrollLeft`)).toBe(0);
			}
		}
	}, 30_000);
});
