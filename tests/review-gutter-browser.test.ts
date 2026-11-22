import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The "+" in the diff's gutter in a real browser, over the mock engine:
 * hover, a click, a drag with its limits and its label, Escape during a drag,
 * and the keyboard, in both comparisons. The rest is tested without a
 * window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const PATH = "src/long.ts";

/**
 * One file with two hunks. The first: a line kept, 40 added (new lines 2 to
 * 41), and a line kept (42). The second: a line removed, one added, one kept,
 * and Git's note that the file has no newline at its end.
 */
const PATCH = [
	`diff --git a/${PATH} b/${PATH}`,
	"index 1111111..2222222 100644",
	`--- a/${PATH}`,
	`+++ b/${PATH}`,
	"@@ -1,2 +1,42 @@",
	" export const first = 0;",
	...Array.from({ length: 40 }, (_, index) => `+export const added${index + 2} = ${index + 2};`),
	" export const last = 1;",
	"@@ -60,2 +100,2 @@",
	"-export const old = 1;",
	"+export const now = 2;",
	" export const end = 3;",
	"\\ No newline at end of file",
	"",
].join("\n");

// A `.diff-line` at index i of its hunk is `:nth-of-type(i + 2)`: the hunk's header is the first `div`.
const ROWS = (hunk: number) => `[...document.querySelectorAll('[data-hunk="0-${hunk}"] > .diff-line')]`;
const NOTING = `document.querySelectorAll(".diff-line.noting").length`;
const LABEL = `document.querySelector(".diff-drag-label")?.textContent ?? null`;
const FIELD = `document.querySelector(".diff-body .note-field")?.getAttribute("aria-label") ?? null`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the + in the diff's gutter in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** Show the long file of the feature worktree's changes in its diff tab, in `comparison`. */
	async function showFile(comparison: "base" | "uncommitted") {
		// The main process writes the theme before the app's page is drawn; this page has none, so the colors drawn here are set by hand.
		await page.evaluate(`(() => {
			const root = document.documentElement.style;
			root.setProperty("--fill-hover", "rgba(255, 255, 255, 0.06)");
			root.setProperty("--focus", "rgb(229, 192, 123)");
		})()`);
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, [{ change: { area: "unstaged", kind: "modified", path: ${JSON.stringify(PATH)}, previousPath: null }, patch: ${JSON.stringify(PATCH)} }]);
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
		})()`);
		await page.until(`${STORE}.getState().changes?.compared != null`, "the changes were read");
		await page.evaluate(`${STORE}.compareChanges(${JSON.stringify(comparison)})`);
		await page.until(`${STORE}.getState().changes?.compared === ${JSON.stringify(comparison)}`, `the tab compared with ${comparison}`);
		await page.until(`[...document.querySelectorAll(".change-file")].some(button => button.title === ${JSON.stringify(PATH)})`, "the file was listed");
		await page.evaluate(`[...document.querySelectorAll(".change-file")].find(button => button.title === ${JSON.stringify(PATH)}).click()`);
		await page.until(`${ROWS(0)}.length === 42 && ${ROWS(1)}.length === 4`, "the diff showed");
		expect(await page.evaluate<string>(`${STORE}.getState().changes.compared`)).toBe(comparison);
	}

	/**
	 * The middle of the "+" of row `from` of the first hunk, and of the row
	 * `to` of hunk `toHunk` (or a point just above the hunk, for "above"),
	 * read together once row `from` is at the top of the diff.
	 */
	async function points(from: number, to: number | "above", toHunk = 0) {
		return page.evaluate<{ from: { x: number; y: number }; to: { x: number; y: number } }>(`(() => {
			const rows = ${ROWS(0)};
			rows[${from}].scrollIntoView({ block: "start" });
			const box = rows[${from}].querySelector(".diff-note-plus").getBoundingClientRect();
			const from = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
			let to;
			if (${JSON.stringify(to)} === "above") {
				const header = document.querySelector('[data-hunk="0-0"] > .diff-hunk-header').getBoundingClientRect();
				to = { x: from.x, y: header.top + header.height / 2 };
			} else {
				const row = ${ROWS(toHunk)}[${to === "above" ? 0 : to}].getBoundingClientRect();
				to = { x: from.x, y: row.top + row.height / 2 };
			}
			if (to.y < 0 || to.y > window.innerHeight) throw new Error("The target row is off the screen: " + to.y);
			return { from, to };
		})()`);
	}

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
	}, 30_000);

	test("hovering a line that takes notes lights it and shows its +; Git's note shows neither", async () => {
		await showFile("uncommitted");
		const plus = (row: string) => `getComputedStyle(${row}.querySelector(".diff-note-plus")).opacity`;
		expect(await page.evaluate<string>(plus(`${ROWS(0)}[3]`))).toBe("0");
		await page.hover('[data-hunk="0-0"] > .diff-line:nth-of-type(5)');
		await page.until(`${plus(`${ROWS(0)}[3]`)} === "1"`, "the + showed");
		expect(await page.evaluate<string>(`getComputedStyle(${ROWS(0)}[3]).boxShadow`)).not.toBe("none");
		// Git's note: no +, and nothing lights up.
		await page.hover('[data-hunk="0-1"] > .diff-line.note');
		expect(await page.evaluate<number>(`${ROWS(1)}[3].querySelectorAll(".diff-note-plus").length`)).toBe(0);
		expect(await page.evaluate<string>(`getComputedStyle(${ROWS(1)}[3]).boxShadow`)).toBe("none");
		expect(await page.evaluate<number>(`document.querySelectorAll(".diff-hunk-header .diff-note-plus").length`)).toBe(0);
	}, 30_000);

	for (const comparison of ["uncommitted", "base"] as const) {
		test(`in ${comparison === "base" ? "Base" : "Uncommitted"}, a click on + starts a note on that line`, async () => {
			await showFile(comparison);
			await page.click('[data-hunk="0-0"] > .diff-line:nth-of-type(5) .diff-note-plus');
			await page.until(`${FIELD} === "Note on line 4"`, "the note's field opened on line 4");
			expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("note-field") === true`)).toBe(true);
			expect(await page.evaluate<number>(NOTING)).toBe(1);
		}, 30_000);
	}

	test("a drag that comes back to its line starts a note on that line only, and no label shows until it reaches another line", async () => {
		await showFile("uncommitted");
		const { from, to } = await points(2, 4);
		await page.dragTo(from, from);
		expect(await page.evaluate<string | null>(LABEL)).toBeNull();
		await page.moveTo(to);
		await page.until(`${LABEL} === "Lines 3-5"`, "the drag reached two more lines");
		await page.moveTo(from);
		await page.until(`${LABEL} === "Line 3"`, "the drag came back");
		await page.release();
		await page.until(`${FIELD} === "Note on line 3"`, "the note started on the line pressed");
	}, 30_000);

	test("a drag upwards opens the field under the bottom line, and keeps what was typed in the note being written", async () => {
		await showFile("uncommitted");
		await page.click('[data-hunk="0-0"] > .diff-line:nth-of-type(12) .diff-note-plus');
		await page.until(`${FIELD} === "Note on line 11"`, "a note was started");
		await page.type("kept");
		const { from, to } = await points(6, 3);
		await page.dragTo(from, to);
		await page.until(`${LABEL} === "Lines 4-7"`, "the drag went up");
		await page.release();
		await page.until(`${FIELD} === "Note on 4 lines, ending at line 7"`, "the field opened under line 7");
		expect(await page.evaluate<string>(`document.querySelector(".diff-body .note-field").value`)).toBe("kept");
	}, 30_000);

	for (const comparison of ["uncommitted", "base"] as const) {
		test(`in ${comparison === "base" ? "Base" : "Uncommitted"}, dragging + over lines marks them, labels them, and letting go starts a note on them`, async () => {
			await showFile(comparison);
			const { from, to } = await points(2, 4);
			await page.dragTo(from, to);
			await page.until(`${LABEL} === "Lines 3-5"`, "the label named the lines");
			expect(await page.evaluate<number>(NOTING)).toBe(3);
			expect(await page.evaluate<string | null>(FIELD)).toBeNull();
			await page.release();
			await page.until(`${FIELD} === "Note on 3 lines, ending at line 5"`, "the note's field opened under the last line");
			expect(await page.evaluate<string | null>(LABEL)).toBeNull();
			expect(await page.evaluate<number>(NOTING)).toBe(3);
			expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("note-field") === true`)).toBe(true);
			// No text was selected on the way.
			expect(await page.evaluate<string>(`String(window.getSelection())`)).toBe("");
		}, 30_000);
	}

	test(`a drag stops at 30 lines and says so`, async () => {
		await showFile("uncommitted");
		const { from, to } = await points(1, 33);
		await page.dragTo(from, to);
		await page.until(`${LABEL} === "Lines 2-31 (30 lines at most)"`, "the label said the range is as long as it can be");
		expect(await page.evaluate<number>(NOTING)).toBe(30);
		await page.release();
		await page.until(`${FIELD} === "Note on 30 lines, ending at line 31"`, "the note's field opened on 30 lines");
	}, 30_000);

	test("a drag stops at the hunk's edge, down into the next hunk and up past its header", async () => {
		await showFile("uncommitted");
		const down = await points(39, 1, 1);
		await page.dragTo(down.from, down.to);
		await page.until(`${LABEL} === "Lines 40-42 (end of the hunk)"`, "the label said the hunk ended");
		await page.release();
		await page.until(`${FIELD} === "Note on 3 lines, ending at line 42"`, "the note stayed in its hunk");
		const up = await points(3, "above");
		await page.dragTo(up.from, up.to);
		await page.until(`${LABEL} === "Lines 1-4 (end of the hunk)"`, "the label said the hunk ended");
		await page.release();
		await page.until(`${FIELD} === "Note on 4 lines, ending at line 4"`, "the note stayed in its hunk");
	}, 30_000);

	test("Escape during a drag lets go of it, and the note being written stays as it was", async () => {
		await showFile("uncommitted");
		await page.click('[data-hunk="0-0"] > .diff-line:nth-of-type(12) .diff-note-plus');
		await page.until(`${FIELD} === "Note on line 11"`, "a note was started");
		await page.type("kept");
		const { from, to } = await points(2, 4);
		await page.dragTo(from, to);
		await page.until(`${LABEL} === "Lines 3-5"`, "the drag started");
		await page.press("Escape");
		await page.until(`${LABEL} === null`, "the drag ended");
		await page.release();
		expect(await page.evaluate<string | null>(FIELD)).toBe("Note on line 11");
		expect(await page.evaluate<string>(`document.querySelector(".diff-body .note-field").value`)).toBe("kept");
		expect(await page.evaluate<number>(NOTING)).toBe(1);
		// Escape and then letting go on the line pressed starts nothing either.
		await page.dragTo(from, to);
		await page.until(`${LABEL} === "Lines 3-5"`, "a drag started again");
		await page.press("Escape");
		await page.until(`${LABEL} === null`, "the drag ended again");
		await page.moveTo(from);
		await page.release();
		await Bun.sleep(100);
		expect(await page.evaluate<string | null>(FIELD)).toBe("Note on line 11");
		expect(await page.evaluate<string>(`document.querySelector(".diff-body .note-field").value`)).toBe("kept");
	}, 30_000);

	for (const comparison of ["uncommitted", "base"] as const) {
		test(`in ${comparison === "base" ? "Base" : "Uncommitted"}, the keyboard still starts notes: Enter on a line's numbers, Shift+Enter on another for a range, and the + shows on the focused one`, async () => {
			await showFile(comparison);
			await page.evaluate(`${ROWS(0)}[1].querySelector(".diff-note-target").focus()`);
			await page.press("ArrowDown");
			expect(await page.evaluate<string | null>(`document.activeElement.getAttribute("aria-label")`)).toBe("Add a note on line 3");
			expect(await page.evaluate<string>(`getComputedStyle(document.activeElement.querySelector(".diff-note-plus")).opacity`)).toBe("1");
			await page.press("Enter");
			await page.until(`${FIELD} === "Note on line 3"`, "Enter started a note");
			await page.evaluate(`${ROWS(0)}[5].querySelector(".diff-note-target").focus()`);
			await page.press("Enter", "shift");
			await page.until(`${FIELD} === "Note on 4 lines, ending at line 6"`, "Shift+Enter made it a range");
		}, 30_000);
	}
});
