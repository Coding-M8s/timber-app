import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { SPLIT_TOO_NARROW } from "../src/shared/diff-split";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The diff tab's Split layout in a real browser, over the mock engine: the
 * switch, the rows side by side, notes and ranges from each side and where
 * their references land, the keyboard staying on a side, and Unified when
 * the tab is too narrow. The pairing is tested without a window, in
 * ./diff-split.test.ts. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const PATH = "src/split.ts";

/**
 * One hunk. Old lines 1 to 4, new lines 1 to 5: "keep" kept, two lines
 * removed and three added in their place, and "end" kept. Its lines in the
 * hunk: 0 keep, 1 and 2 removed, 3 to 5 added, 6 end.
 */
const PATCH = [
	`diff --git a/${PATH} b/${PATH}`,
	"index 1111111..2222222 100644",
	`--- a/${PATH}`,
	`+++ b/${PATH}`,
	"@@ -1,4 +1,5 @@",
	" export const keep = 0;",
	"-export const retries = 3;",
	"-export const name = \"old\";",
	"+export const retries = 5;",
	"+export const name = \"new\";",
	"+export const extra = true;",
	" export const end = 1;",
	"",
].join("\n");

const ROWS = `[...document.querySelectorAll('[data-hunk="0-1"] > .diff-split-row')]`;
const CELL = (row: number, side: "old" | "new") => `${ROWS}[${row}].querySelector('[data-side="${side}"]')`;
const NOTING = (side: "old" | "new") => `document.querySelectorAll('.diff-line.noting[data-side="${side}"]').length`;
const LABEL = `(document.querySelector(".diff-drag-label")?.textContent ?? null)`;
const FIELD = `(document.querySelector(".diff-body .note-field")?.getAttribute("aria-label") ?? null)`;
const NOTE_LINES = `(${STORE}.getState().reviews[${STORE}.getState().selection.worktree]?.at(-1)?.lines.map(line => line.text.replace("export const ", "")) ?? null)`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the Split layout of the diff tab in a real browser", () => {
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

	/** Show the file in the feature worktree's diff tab, and choose Split with the switch. */
	async function showSplit(patch = PATCH) {
		// The main process writes the theme before the app's page is drawn; this page has none, so the colors drawn here are set by hand.
		await page.evaluate(`document.documentElement.style.setProperty("--fill-hover", "rgba(255, 255, 255, 0.06)")`);
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, [{ change: { area: "unstaged", kind: "modified", path: ${JSON.stringify(PATH)}, previousPath: null }, patch: ${JSON.stringify(patch)} }]);
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
		})()`);
		await page.until(`${STORE}.getState().changes?.compared != null`, "the changes were read");
		await page.evaluate(`${STORE}.compareChanges("uncommitted")`);
		await page.until(`[...document.querySelectorAll(".change-file")].some(button => button.title === ${JSON.stringify(PATH)})`, "the file was listed");
		await page.evaluate(`[...document.querySelectorAll(".change-file")].find(button => button.title === ${JSON.stringify(PATH)}).click()`);
		await page.until(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length >= 7`, "the diff showed in Unified");
		await page.evaluate(`[...document.querySelectorAll(".diff-layout .mode-option")].find(option => option.textContent === "Split").querySelector("input").click()`);
		// A narrow tab shows Unified with why, instead.
		await page.until(`${ROWS}.length >= 5 || document.querySelector(".diff-layout-note") !== null`, "the diff showed in Split");
	}

	/** The middle of the `+` of a cell, and the middle of another cell's row, read together once the first is on screen. */
	async function points(from: [number, "old" | "new"], to: [number, "old" | "new"]) {
		return page.evaluate<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`(() => {
			const box = ${CELL(...from)}.querySelector(".diff-note-plus").getBoundingClientRect();
			const row = ${CELL(...to)}.getBoundingClientRect();
			return { from: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, to: { x: box.left + box.width / 2, y: row.top + row.height / 2 } };
		})()`);
	}

	test("the switch shows old lines on the left and new on the right, each edited line beside what it became, and remembers the choice", async () => {
		await showSplit();
		const sides = await page.evaluate<string[][]>(`${ROWS}.map(row => [...row.children].map(cell => cell.classList.contains("diff-cell-empty") ? "" : cell.querySelector(".diff-number").textContent + " " + cell.querySelector(".diff-text").textContent.replace("export const ", "")))`);
		expect(sides).toEqual([
			["1 keep = 0;", "1 keep = 0;"],
			["2 retries = 3;", "2 retries = 5;"],
			["3 name = \"old\";", "3 name = \"new\";"],
			["", "4 extra = true;"],
			["4 end = 1;", "5 end = 1;"],
		]);
		// The changed words are marked on both sides of a pair.
		expect(await page.evaluate<string>(`${CELL(1, "old")}.querySelector(".diff-word").textContent`)).toBe("3");
		expect(await page.evaluate<string>(`${CELL(1, "new")}.querySelector(".diff-word").textContent`)).toBe("5");
		// The two columns are the same width, and the empty cell is drawn.
		const widths = await page.evaluate<number[]>(`[...${ROWS}[3].children].map(cell => Math.round(cell.getBoundingClientRect().width))`);
		expect(Math.abs(widths[0]! - widths[1]!)).toBeLessThanOrEqual(1);
		expect(await page.evaluate<string>(`getComputedStyle(${ROWS}[3].children[0]).backgroundImage`)).toContain("repeating-linear-gradient");
		// A row with an empty cell is one line tall, as any other.
		const heights = await page.evaluate<number[]>(`${ROWS}.map(row => Math.round(row.getBoundingClientRect().height))`);
		expect(new Set(heights).size).toBe(1);
		expect(await page.evaluate<string>(`${STORE}.getState().layout.diffLayout`)).toBe("split");
		await page.until(`${ENGINE}.loadLayout().then(layout => layout.diffLayout === "split")`, "the choice was saved");
	}, 30_000);

	test("a long line wraps in its cell, so its row stays paired and nothing scrolls sideways", async () => {
		const long = `export const message = "${"word ".repeat(80)}";`;
		const patch = PATCH.replace("+export const name = \"new\";", `+${long}`);
		await showSplit(patch);
		const sizes = await page.evaluate<{ row: number; line: number; scroll: number; client: number }>(`(() => {
			const body = document.querySelector(".diff-body");
			return { row: ${ROWS}[2].getBoundingClientRect().height, line: ${ROWS}[0].getBoundingClientRect().height, scroll: body.scrollWidth, client: body.clientWidth };
		})()`);
		expect(sizes.row).toBeGreaterThan(sizes.line * 2);
		expect(sizes.scroll).toBe(sizes.client);
	}, 30_000);

	test("a click on the + of a new line starts a note there, and its reference uses the new numbers", async () => {
		await showSplit();
		await page.click(`[data-hunk="0-1"] > .diff-split-row:nth-of-type(4) [data-side="new"] .diff-note-plus`);
		await page.until(`${FIELD} === "Note on line 3"`, "the note's field opened on new line 3");
		await page.type("Why new?");
		await page.evaluate(`[...document.querySelectorAll(".diff-body .note-form button, .diff-body .diff-note button")].find(button => button.textContent === "Save note").click()`);
		await page.until(`${NOTE_LINES} !== null`, "the note was kept");
		expect(await page.evaluate<string[]>(NOTE_LINES)).toEqual(["name = \"new\";"]);
		expect(await page.evaluate<string>(`document.querySelector(".review-ref-name")?.textContent ?? ""`)).toContain("split.ts:3");
	}, 30_000);

	test("dragging the + down the left takes the kept and removed lines only, and its note lands on them in Unified too", async () => {
		await showSplit();
		const { from, to } = await points([0, "old"], [4, "old"]);
		await page.dragTo(from, to);
		// Over the empty cell of row 3, the range stays on the left's lines.
		await page.until(`${LABEL} === "Lines 1-5"`, "the drag reached the last kept line");
		expect(await page.evaluate<number>(NOTING("old"))).toBe(4);
		expect(await page.evaluate<number>(NOTING("new"))).toBe(0);
		await page.release();
		await page.until(`${FIELD} === "Note on 4 lines, ending at line 5"`, "the note's field opened under the last row");
		await page.type("Left side");
		await page.evaluate(`[...document.querySelectorAll(".diff-body .note-form button, .diff-body .diff-note button")].find(button => button.textContent === "Save note").click()`);
		await page.until(`${NOTE_LINES} !== null`, "the note was kept");
		expect(await page.evaluate<string[]>(NOTE_LINES)).toEqual(["keep = 0;", "retries = 3;", "name = \"old\";", "end = 1;"]);
		// In Unified, the note shows under its last line, and choosing its reference marks its four lines.
		await page.evaluate(`${STORE}.chooseDiffLayout("unified")`);
		await page.until(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length === 7`, "the diff showed in Unified");
		await page.evaluate(`${STORE}.showReviewNote(${STORE}.getState().selection.worktree, ${STORE}.getState().reviews[${STORE}.getState().selection.worktree][0].id)`);
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 4`, "the note's lines were marked in Unified");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".diff-line.shown .diff-marker")].map(marker => marker.textContent)`)).toEqual(["", "-", "-", ""]);
	}, 30_000);

	test("a note made in Unified lands on its lines in Split, and a draft keeps its side and text across a switch", async () => {
		await showSplit();
		await page.evaluate(`${STORE}.chooseDiffLayout("unified")`);
		await page.until(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length === 7`, "the diff showed in Unified");
		// Unified rows 1 to 3: the two removed lines and the first added one.
		const { from, to } = await page.evaluate<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`(() => {
			const rows = [...document.querySelectorAll('[data-hunk="0-1"] > .diff-line')];
			const box = rows[1].querySelector(".diff-note-plus").getBoundingClientRect();
			const row = rows[3].getBoundingClientRect();
			return { from: { x: box.left + box.width / 2, y: box.top + box.height / 2 }, to: { x: box.left + box.width / 2, y: row.top + row.height / 2 } };
		})()`);
		await page.dragTo(from, to);
		await page.until(`${LABEL} === "Lines 2"`, "the drag took the removed lines and the first added one");
		await page.release();
		await page.until(`${FIELD} === "Note on 3 lines, ending at line 2"`, "the note's field opened");
		await page.type("Across");
		await page.evaluate(`[...document.querySelectorAll(".diff-body .note-form button, .diff-body .diff-note button")].find(button => button.textContent === "Save note").click()`);
		await page.until(`${NOTE_LINES} !== null`, "the note was kept");
		await page.evaluate(`${STORE}.chooseDiffLayout("split")`);
		await page.until(`${ROWS}.length === 5`, "the diff showed in Split");
		await page.evaluate(`${STORE}.showReviewNote(${STORE}.getState().selection.worktree, ${STORE}.getState().reviews[${STORE}.getState().selection.worktree][0].id)`);
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 3`, "the note's lines were marked in Split");
		expect(await page.evaluate<number>(`document.querySelectorAll('.diff-line.shown[data-side="old"]').length`)).toBe(2);
		expect(await page.evaluate<number>(`document.querySelectorAll('.diff-line.shown[data-side="new"]').length`)).toBe(1);
		expect(await page.evaluate<number>(`document.querySelectorAll(".diff-body [data-note-id]").length`)).toBe(1);

		// A draft on the right keeps its line and text through Unified and back.
		await page.click(`[data-hunk="0-1"] > .diff-split-row:nth-of-type(2) [data-side="new"] .diff-note-plus`);
		await page.until(`${FIELD} === "Note on line 1"`, "a note was started on the right");
		await page.type("kept");
		await page.evaluate(`${STORE}.chooseDiffLayout("unified")`);
		await page.until(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length === 7`, "the diff showed in Unified");
		expect(await page.evaluate<string | null>(FIELD)).toBe("Note on line 1");
		expect(await page.evaluate<number>(`document.querySelectorAll(".diff-line.noting").length`)).toBe(1);
		await page.evaluate(`${STORE}.chooseDiffLayout("split")`);
		await page.until(`${ROWS}.length === 5`, "the diff showed in Split again");
		expect(await page.evaluate<string | null>(FIELD)).toBe("Note on line 1");
		expect(await page.evaluate<string>(`document.querySelector(".diff-body .note-field").value`)).toBe("kept");
		expect(await page.evaluate<number>(NOTING("new"))).toBe(1);
		expect(await page.evaluate<number>(NOTING("old"))).toBe(0);
	}, 30_000);

	test("dragging up the right takes only the right's lines, and stops at the hunk's edge", async () => {
		await showSplit();
		const { from, to } = await points([3, "new"], [0, "new"]);
		await page.dragTo(from, { x: to.x, y: to.y - 40 });
		await page.until(`${LABEL} === "Lines 1-4 (end of the hunk)"`, "the drag stopped at the hunk's top");
		expect(await page.evaluate<number>(NOTING("new"))).toBe(4);
		expect(await page.evaluate<number>(NOTING("old"))).toBe(0);
		await page.release();
		await page.until(`${FIELD} === "Note on 4 lines, ending at line 4"`, "the note started on the right's lines");
	}, 30_000);

	test("the arrows stay on one side, and Shift+click on the other side starts a note there instead", async () => {
		await showSplit();
		await page.evaluate(`${CELL(0, "old")}.querySelector(".diff-note-target").focus()`);
		await page.press("ArrowDown");
		expect(await page.evaluate<string | null>(`document.activeElement.getAttribute("aria-label")`)).toBe("Add a note on removed line 2");
		await page.press("ArrowDown");
		await page.press("ArrowDown");
		expect(await page.evaluate<string | null>(`document.activeElement.getAttribute("aria-label")`)).toBe("Add a note on line 5");
		await page.press("Enter");
		await page.until(`${FIELD} === "Note on line 5"`, "Enter started a note on the left");
		await page.evaluate(`${CELL(3, "new")}.querySelector(".diff-note-target").focus()`);
		await page.press("Enter", "shift");
		await page.until(`${FIELD} === "Note on line 4"`, "Shift+Enter on the right started a note there");
		expect(await page.evaluate<number>(NOTING("new"))).toBe(1);
		expect(await page.evaluate<number>(NOTING("old"))).toBe(0);
	}, 30_000);

	test("in a narrow tab, Show Split anyway shows Split scrolling sideways, and Hide side panel makes room for it", async () => {
		await showSplit();
		await page.resize(1000, 900);
		await page.until(`document.querySelector(".diff-layout-note p")?.textContent === ${JSON.stringify(SPLIT_TOO_NARROW)}`, "the tab showed Unified");
		const button = (text: string) => `[...document.querySelectorAll(".diff-layout-note button")].find(button => button.textContent === ${JSON.stringify(text)})`;
		await page.evaluate(`${button("Show Split anyway")}.click()`);
		await page.until(`${ROWS}.length === 5 && document.querySelector(".diff-layout-note") === null`, "Split showed anyway");
		const scroll = await page.evaluate<{ scroll: number; client: number; column: number }>(`(() => {
			const body = document.querySelector(".diff-body");
			return { scroll: body.scrollWidth, client: body.clientWidth, column: ${ROWS}[0].children[0].getBoundingClientRect().width };
		})()`);
		expect(scroll.scroll).toBeGreaterThan(scroll.client);
		expect(scroll.column).toBeGreaterThanOrEqual(299);
		expect(await page.evaluate<string>(`document.querySelector('[data-hunk="0-1"]').style.minWidth`)).toBe("600px");
		expect(await page.evaluate<string>(`${STORE}.getState().layout.diffLayout`)).toBe("split");

		// A tab shown afresh is narrow again, and hiding the side panel gives it room.
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.resize(1000, 900);
		await showSplit();
		await page.until(`${button("Hide side panel")} !== undefined`, "the tab offered to hide the side panel");
		await page.evaluate(`${button("Hide side panel")}.click()`);
		await page.until(`${ROWS}.length === 5 && document.querySelector(".diff-layout-note") === null`, "Split showed once the side panel was hidden");
		// With room, the hunk takes the tab's width, with no least width of its own.
		expect(await page.evaluate<string>(`document.querySelector('[data-hunk="0-1"]').style.minWidth`)).toBe("");
	}, 40_000);

	test("in a narrow tab with a long diff, the title line wraps to its full height and nothing under it overlaps it", async () => {
		const long = PATCH.replace(" export const end = 1;", Array.from({ length: 300 }, (_, index) => ` export const kept${index} = ${index};`).join("\n"));
		await showSplit(long.replace("@@ -1,4 +1,5 @@", "@@ -1,303 +1,304 @@"));
		await page.resize(1000, 900);
		await page.until(`document.querySelector(".diff-layout-note") !== null`, "the tab showed Unified");
		const boxes = await page.evaluate<{ title: number; content: number; bottom: number; note: number }>(`(() => {
			const title = document.querySelector(".diff-title");
			return { title: title.clientHeight, content: title.scrollHeight, bottom: title.getBoundingClientRect().bottom, note: document.querySelector(".diff-layout-note").getBoundingClientRect().top };
		})()`);
		expect(boxes.content).toBeLessThanOrEqual(boxes.title);
		expect(boxes.note).toBeGreaterThanOrEqual(boxes.bottom - 1);
	}, 30_000);

	test("in Unified, a line wider than the tab scrolls sideways with every row's tint as wide as the widest line", async () => {
		const long = `export const message = "${"word ".repeat(60)}";`;
		await showSplit(PATCH.replace("+export const name = \"new\";", `+${long}`));
		await page.evaluate(`${STORE}.chooseDiffLayout("unified")`);
		await page.until(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length === 7`, "the diff showed in Unified");
		const widths = await page.evaluate<{ rows: number[]; scroll: number; client: number }>(`(() => {
			const body = document.querySelector(".diff-body");
			return { rows: [...document.querySelectorAll('[data-hunk="0-1"] > .diff-line, [data-hunk="0-1"] > .diff-hunk-header')].map(row => Math.round(row.getBoundingClientRect().width)), scroll: body.scrollWidth, client: body.clientWidth };
		})()`);
		expect(widths.scroll).toBeGreaterThan(widths.client);
		// Every row, short or long, and the hunk's header, reaches the end of the widest line.
		expect(new Set(widths.rows).size).toBe(1);
		expect(widths.rows[0]).toBeGreaterThanOrEqual(widths.scroll - 1);
	}, 30_000);

	test("a tab too narrow for two columns shows Unified and says why, and keeps Split chosen", async () => {
		await showSplit();
		await page.resize(1000, 900);
		await page.until(`document.querySelector(".diff-layout-note p")?.textContent === ${JSON.stringify(SPLIT_TOO_NARROW)}`, "the tab said why it shows Unified");
		expect(await page.evaluate<number>(`${ROWS}.length`)).toBe(0);
		expect(await page.evaluate<number>(`document.querySelectorAll('[data-hunk="0-1"] > .diff-line').length`)).toBe(7);
		expect(await page.evaluate<string>(`${STORE}.getState().layout.diffLayout`)).toBe("split");
		await page.resize(1500, 900);
		await page.until(`${ROWS}.length === 5 && document.querySelector(".diff-layout-note") === null`, "Split came back once the tab was wide again");
	}, 30_000);
});
