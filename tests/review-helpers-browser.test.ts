import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { sampleSpreadEdit, samplePatch } from "../src/mainview/engine/mock-file-changes";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The review helpers in a real browser, over the mock engine: the unchanged
 * lines between hunks with a note on one, Alt+Up and Alt+Down, the Viewed
 * box, and the filter, from the keyboard, with what a screen reader is told.
 * The rest is tested without a window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const SPREAD = sampleSpreadEdit("src/spread.ts", 40, [6, 24]);
const OTHERS = ["src/other.ts", "docs/notes.md"].map(path => ({ change: { area: "unstaged", kind: "modified", path, previousPath: null, added: null, removed: null, version: "" }, patch: samplePatch(path) }));
const OPEN = `${STORE}.getState().diffs[${STORE}.getState().selection?.worktree]?.file.path ?? null`;
const FOCUSED = `(() => { const at = document.activeElement; return at ? (at.getAttribute("aria-label") ?? at.getAttribute("placeholder") ?? at.textContent) : null; })()`;
const STEPPED = `[...document.querySelectorAll('.visually-hidden[role="status"]')].map(status => status.textContent).join("|")`;

describe.skipIf(browserPath === null || process.platform === "win32")("the review helpers in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, ${JSON.stringify([SPREAD, ...OTHERS])});
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
			await ${STORE}.compareChanges("uncommitted");
		})()`);
		await page.until(`document.querySelectorAll(".change-file").length === 3`, "the files were listed");
	}, 30_000);

	test("a gap's row shows its unchanged lines, gives the keyboard to the first, and a note can be started there", async () => {
		await page.click('.change-file[title="src/spread.ts"]');
		await page.until(`[...document.querySelectorAll(".diff-gap")].some(row => row.textContent === "Show 11 unchanged lines")`, "the gaps showed");
		await page.evaluate(`[...document.querySelectorAll(".diff-gap")].find(row => row.textContent === "Show 11 unchanged lines").focus()`);
		await page.press("Enter");
		await page.until(`![...document.querySelectorAll(".diff-gap")].some(row => row.textContent === "Show 11 unchanged lines")`, "the gap opened");
		await page.until(`document.activeElement?.getAttribute("aria-label") === "Add a note on line 10"`, "the keyboard went to line 10");
		const texts = await page.evaluate<string[]>(`[...document.querySelectorAll('[data-hunk="0-2"] > .diff-line .diff-number')].map(cell => cell.textContent)`);
		expect(texts.slice(0, 4)).toEqual(["10", "10", "11", "11"]);
		await page.press("ArrowDown");
		expect(await page.evaluate<string>(FOCUSED)).toBe("Add a note on line 11");
		await page.press("Enter");
		await page.until(`document.querySelector(".diff-body .note-field")?.getAttribute("aria-label") === "Note on line 11"`, "the note's field opened");
	});

	test("Alt+Down and Alt+Up step through the files, saying where the keyboard went, and Viewed checks the file and opens the next", async () => {
		await page.click('.change-file[title="src/spread.ts"]');
		await page.until(`${OPEN} === "src/spread.ts"`, "the diff opened");
		await page.evaluate(`document.querySelector(".diff-body").focus()`);
		await page.press("ArrowDown", "alt");
		await page.until(`${OPEN} === "src/other.ts"`, "the next file opened");
		await page.until(`${STEPPED}.includes("src/other.ts, file 2 of 3")`, "the step was said");
		await page.press("ArrowUp", "alt");
		await page.until(`${OPEN} === "src/spread.ts"`, "the previous file opened");
		await page.click(".diff-viewed input");
		await page.until(`${OPEN} === "src/other.ts"`, "Viewed opened the next file");
		expect(await page.evaluate<string>(`document.querySelector('.change-file[title="src/spread.ts"]').getAttribute("aria-label")`)).toEndWith(", viewed");
		expect(await page.evaluate<boolean>(`document.querySelector('.change-file[title="src/spread.ts"]').classList.contains("viewed")`)).toBe(true);
	});

	test("the diff's title line wraps where the diff is narrow, so its buttons stay inside it", async () => {
		await page.click('.change-file[title="src/spread.ts"]');
		await page.until(`document.querySelector(".diff-close") !== null`, "the diff opened");
		try {
			// Short, so the diff is longer than the window and leans on the title line: it must keep the height of its lines.
			for (const width of [1400, 1100, 900]) {
				await page.resize(width, 420);
				const box = await page.evaluate<{ diff: number; close: number; previous: number; title: number; lowest: number; body: number; scrolls: boolean }>(`(() => {
					const edge = selector => document.querySelector(selector).getBoundingClientRect();
					const title = document.querySelector(".diff-title");
					const body = document.querySelector(".diff-body");
					return {
						diff: edge(".changes-diff").right, close: edge(".diff-close").right, previous: edge(".diff-steps").left,
						title: title.getBoundingClientRect().bottom,
						lowest: Math.max(...[...title.children].map(child => child.getBoundingClientRect().bottom)),
						body: body.getBoundingClientRect().top,
						scrolls: body.scrollHeight > body.clientHeight,
					};
				})()`);
				expect(box.scrolls).toBe(true);
				expect(box.close).toBeLessThanOrEqual(box.diff);
				expect(box.previous).toBeGreaterThan(0);
				expect(box.lowest).toBeLessThanOrEqual(box.title);
				expect(box.body).toBeGreaterThanOrEqual(box.title);
			}
		} finally {
			await page.resize(1280, 800);
		}
	});

	test("the filter narrows the list as it is typed, says how many match, and Down goes into the list", async () => {
		await page.click(".changes-filter-input");
		await page.type("SPREAD");
		await page.until(`document.querySelectorAll(".change-file").length === 1`, "the list was filtered");
		expect(await page.evaluate<string>(STEPPED)).toContain("1 of 3 files matches");
		await page.press("ArrowDown");
		expect(await page.evaluate<string>(`document.activeElement?.title ?? ""`)).toBe("src/spread.ts");
		await page.click(".changes-filter-input");
		await page.press("Escape");
		await page.until(`document.querySelectorAll(".change-file").length === 3`, "Escape emptied the filter");
	});
});
