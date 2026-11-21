import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The Review panel in a real browser, over the mock engine, in a window too
 * narrow for the diff and the panel side by side: the Review button, the
 * panel over the diff, Escape and Close, where the keyboard goes, choosing
 * a reference, and the last note going. The rest is tested without a
 * window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const PANEL_SHOWN = `getComputedStyle(document.querySelector(".review-panel")).display !== "none"`;
const PANEL_HIDDEN = `getComputedStyle(document.querySelector(".review-panel")).display === "none"`;
const TOGGLE = ".review-toggle";
const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	return active.getAttribute("aria-label") || active.className;
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the Review panel in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** Write a note on the first line of a file of the feature worktree's Changes tab. */
	async function writeNote(path: string, text: string) {
		await page.evaluate(`[...document.querySelectorAll(".change-file")].find(button => button.title === ${JSON.stringify(path)}).click()`);
		await page.until(`document.querySelector(".changes-diff")?.getAttribute("aria-label") === ${JSON.stringify(`Diff of ${path}`)} && document.querySelector(".diff-note-target") !== null`, `the diff of ${path} showed`);
		await page.click(".diff-note-target");
		await page.until(`document.querySelector(".diff-body .note-field") === document.activeElement`, "the note's field took the keyboard");
		await page.type(text);
		await page.evaluate(`[...document.querySelectorAll(".diff-body button")].find(button => button.textContent === "Save note").click()`);
		await page.until(`[...document.querySelectorAll(".diff-note-text")].some(note => note.textContent === ${JSON.stringify(text)})`, "the note was kept");
	}

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.evaluate(`(() => {
			const feature = ${STORE}.getState().repositories[0].worktrees[1];
			${STORE}.select(feature.id);
			${STORE}.showTab("changes");
		})()`);
		await page.until(`document.querySelector(".change-file") !== null`, "the changed files were listed");
		await writeNote("README.md", "Why change the retries?");
		await writeNote("src/changed-1.ts", "Sort these imports.");
	}, 30_000);

	test("in a narrow window the panel is hidden, and the Review button opens it over the diff with the keyboard on Close", async () => {
		expect(await page.evaluate<boolean>(PANEL_HIDDEN)).toBe(true);
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(TOGGLE)}).getAttribute("aria-label")`)).toBe("Review, 2 review notes");
		await page.click(TOGGLE);
		await page.until(PANEL_SHOWN, "the panel showed");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(TOGGLE)}).getAttribute("aria-expanded")`)).toBe("true");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Close the review");
		// Over the diff, below its title bar, and the page does not scroll sideways.
		expect(await page.evaluate<string>(`getComputedStyle(document.querySelector(".review-panel")).position`)).toBe("absolute");
		expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true);
	}, 30_000);

	test("Escape and Close each close it, and give the keyboard back to the Review button", async () => {
		await page.click(TOGGLE);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.press("Escape");
		await page.until(PANEL_HIDDEN, "Escape closed the panel");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Review, 2 review notes");
		await page.press("Enter");
		await page.until(PANEL_SHOWN, "Enter on the button opened it again");
		await page.press("Enter");
		await page.until(PANEL_HIDDEN, "Close closed the panel");
		expect(await page.evaluate<string>(ACTIVE)).toBe("Review, 2 review notes");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(TOGGLE)}).getAttribute("aria-expanded")`)).toBe("false");
	}, 30_000);

	test("choosing a reference closes the panel, shows its file, and marks its lines", async () => {
		await page.click(TOGGLE);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.click('.review-ref[aria-label="Show README.md:1"]');
		await page.until(PANEL_HIDDEN, "the panel closed");
		await page.until(`document.querySelector(".changes-diff").getAttribute("aria-label") === "Diff of README.md"`, "README.md showed");
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 1`, "its line was marked");
		expect(await page.evaluate<string>(`document.activeElement.closest(".diff-body") === null ? "outside" : "diff"`)).toBe("diff");
		expect(await page.evaluate<string>(`document.querySelector('.review-ref[aria-current="true"]').getAttribute("aria-label")`)).toBe("Show README.md:1");
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 0`, "the mark went after a moment");
	}, 30_000);

	test("deleting a note gives the keyboard to the next one; the last going closes the panel and gives it to the diff", async () => {
		await page.click(TOGGLE);
		await page.until(PANEL_SHOWN, "the panel showed");
		await page.click('.review-item button[aria-label="Delete the note on README.md:1"]');
		await page.until(`document.querySelectorAll(".review-item").length === 1`, "the note went");
		await page.until(`document.activeElement?.getAttribute("aria-label") === "Show src/changed-1.ts:1"`, "the keyboard went to the next reference");
		await page.click('.review-item button[aria-label="Delete the note on src/changed-1.ts:1"]');
		await page.until(`document.querySelector(".review-panel") === null && document.querySelector(${JSON.stringify(TOGGLE)}) === null`, "the panel and its button went");
		await page.until(`document.activeElement?.classList.contains("diff-body") === true`, "the keyboard went to the diff");
	}, 30_000);
});
