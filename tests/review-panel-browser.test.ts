import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The side panel's Changes view and the diff tab in a real browser, over
 * the mock engine: the Review section at the foot of the panel, choosing a
 * reference, where the keyboard goes when notes go, Ctrl+Shift+G, and the
 * diff's Review button with the panel hidden. The rest is tested without a
 * window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	return active.getAttribute("aria-label") || active.id || active.className;
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the Changes view and the diff tab in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** Open a file of the feature worktree from the Changes view, and write a note on its first line. */
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
			${STORE}.showSidePanel("changes");
		})()`);
		await page.until(`document.querySelector(".change-file") !== null`, "the changed files were listed");
		await writeNote("README.md", "Why change the retries?");
		await writeNote("src/changed-1.ts", "Sort these imports.");
	}, 30_000);

	test("the notes are listed at the foot of the panel, below the files, and the diff fills its tab", async () => {
		expect(await page.evaluate<number>(`document.querySelectorAll(".review-item").length`)).toBe(2);
		const below = await page.evaluate<boolean>(`document.querySelector(".review-panel").getBoundingClientRect().top >= document.querySelector(".changes-files").getBoundingClientRect().bottom - 1`);
		expect(below).toBe(true);
		const inPanel = await page.evaluate<boolean>(`document.querySelector('[data-view="changes"]').contains(document.querySelector(".review-panel"))`);
		expect(inPanel).toBe(true);
		const fills = await page.evaluate<boolean>(`(() => {
			const diff = document.querySelector(".changes-diff").getBoundingClientRect();
			const panel = document.querySelector(".workspace-panel").getBoundingClientRect();
			return Math.abs(diff.width - panel.width) < 2 && Math.abs(diff.bottom - panel.bottom) < 2;
		})()`);
		expect(fills).toBe(true);
		expect(await page.evaluate<boolean>(`document.documentElement.scrollWidth <= document.documentElement.clientWidth`)).toBe(true);
		// The Changes view shows, so the diff has no Review button of its own.
		expect(await page.evaluate<boolean>(`document.querySelector(".review-toggle") === null`)).toBe(true);
		// Copy review puts the review on the clipboard, says so, and the notes stay.
		await page.evaluate(`[...document.querySelectorAll(".review-bar button")].find(button => button.textContent === "Copy review").click()`);
		await page.until(`[...document.querySelectorAll(".toast-text")].some(toast => toast.textContent.startsWith("Review copied."))`, "the review was copied");
		expect(await page.evaluate<number>(`document.querySelectorAll(".review-item").length`)).toBe(2);
	}, 30_000);

	test("choosing a reference opens its file's diff, marks its lines, and gives the diff the keyboard", async () => {
		await page.click('.review-ref[aria-label="Show README.md:1"]');
		await page.until(`document.querySelector(".changes-diff").getAttribute("aria-label") === "Diff of README.md"`, "README.md showed");
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 1`, "its line was marked");
		expect(await page.evaluate<string>(`document.activeElement.closest(".diff-body") === null ? "outside" : "diff"`)).toBe("diff");
		expect(await page.evaluate<string>(`document.querySelector('.review-ref[aria-current="true"]').getAttribute("aria-label")`)).toBe("Show README.md:1");
		expect(await page.evaluate<string>(`document.querySelector('[role="tab"][aria-selected="true"]').id`)).toBe("tab-diff");
		await page.until(`document.querySelectorAll(".diff-line.shown").length === 0`, "the mark went after a moment");
	}, 30_000);

	test("deleting a note gives the keyboard to the next one; the last going leaves the hint and gives it to the list", async () => {
		await page.click('.review-item button[aria-label="Delete the note on README.md:1"]');
		await page.until(`document.querySelectorAll(".review-item").length === 1`, "the note went");
		await page.until(`document.activeElement?.getAttribute("aria-label") === "Show src/changed-1.ts:1"`, "the keyboard went to the next reference");
		await page.click('.review-item button[aria-label="Delete the note on src/changed-1.ts:1"]');
		await page.until(`document.querySelector(".review-item") === null && document.querySelector(".review-hint") !== null`, "the hint showed in place of the notes");
		await page.until(`document.activeElement?.classList.contains("change-file") === true`, "the keyboard went to the list");
	}, 30_000);

	test("Ctrl+Shift+G hides the view and gives the keyboard to its button, and with it hidden the diff's Review button shows it again", async () => {
		await page.click(".change-file");
		await page.press("G", "ctrlShift");
		await page.until(`document.querySelector('[data-view="changes"]') === null`, "the view hid");
		expect(await page.evaluate<string>(ACTIVE)).toBe("titlebar-changes");
		await page.until(`document.querySelector(".review-toggle") !== null`, "the diff showed Review");
		expect(await page.evaluate<string>(`document.querySelector(".review-toggle").getAttribute("aria-label")`)).toBe("Review, 2 review notes. Show the Changes view");
		await page.click(".review-toggle");
		await page.until(`document.querySelector('[data-view="changes"]') !== null`, "the view showed again");
		await page.until(`document.querySelector('[data-view="changes"]').contains(document.activeElement)`, "the view took the keyboard");
		await page.until(`document.querySelector(".review-toggle") === null`, "the button went with the view on screen");
		// Pressed again from inside the view, the shortcut hides it. The Review button it came from went, so the keyboard goes to the title bar's Changes.
		await page.press("G", "ctrlShift");
		await page.until(`document.querySelector('[data-view="changes"]') === null`, "the view hid again");
		expect(await page.evaluate<string>(ACTIVE)).toBe("titlebar-changes");
	}, 30_000);
});
