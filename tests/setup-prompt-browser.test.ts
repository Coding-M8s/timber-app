import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The setup prompt stays compact (issue 341): at the default window size,
 * 1280 by 820, it takes one line with the chops panel closed and at most two
 * with it open, in Timber Light and Timber Dark. Narrower, the buttons wrap
 * below and the sentence is cut short, never a third line. Layout needs a
 * real browser, so this is skipped where none is installed.
 */

const STORE = "window.timberTestStore";

/**
 * How the prompt is laid out: its lines, counted by grouping the sentence and
 * the buttons that overlap from top to bottom, its height, the sentence's own
 * height against its line height, and whether the sentence is cut short.
 */
const LAYOUT = `(() => {
	const prompt = document.querySelector(".setup-prompt");
	const text = prompt.querySelector(".setup-prompt-text");
	const boxes = [text, ...prompt.querySelectorAll("button")].map(element => element.getBoundingClientRect()).sort((a, b) => a.top - b.top);
	let lines = 0;
	let bottom = -Infinity;
	for (const box of boxes) {
		if (box.top >= bottom - 0.5) lines += 1;
		bottom = Math.max(bottom, box.bottom);
	}
	return {
		lines,
		height: Math.round(prompt.getBoundingClientRect().height),
		textLines: Math.round(text.getBoundingClientRect().height / parseFloat(getComputedStyle(text).lineHeight)),
		cut: text.scrollWidth > text.clientWidth,
		color: getComputedStyle(text).color,
	};
})()`;

type Layout = { lines: number; height: number; textLines: number; cut: boolean; color: string };

/** Open or close the chops panel and wait until the window shows it so. */
async function chops(page: BrowserPage, open: boolean) {
	if ((await page.evaluate<boolean>(`${STORE}.getState().layout.chopsOpen`)) !== open) await page.evaluate(`${STORE}.toggleChopsPanel()`);
	await page.until(`(document.getElementById("chops-panel") !== null) === ${open}`, `the chops panel ${open ? "opened" : "closed"}`);
}

describe.skipIf(browserPath === null || process.platform === "win32")("the setup prompt's size in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		// The mock's picker adds docs-site, which was never set up for Timber.
		await page.evaluate(`${STORE}.addRepository()`);
		await page.until(`document.querySelector(".setup-prompt") !== null`, "the setup prompt showed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** The sentence's color in each theme, which must follow the theme. */
	const colors = new Map<string, string>();

	for (const theme of ["timber-light", "timber-dark"]) {
		describe(`in ${theme}`, () => {
			beforeAll(async () => {
				await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" } })`);
				await page.until(`${STORE}.getState().preferences.theme.theme === "${theme}"`, `${theme} was saved`);
				await page.resize(1280, 820);
			});

			test("at the default size with the chops panel closed, it takes one line", async () => {
				await chops(page, false);
				const layout = await page.evaluate<Layout>(LAYOUT);
				expect(layout).toMatchObject({ lines: 1, textLines: 1, cut: false });
				expect(layout.height).toBeLessThanOrEqual(44);
				colors.set(theme, layout.color);
			});

			test("at the default size with the chops panel open, it takes at most two lines", async () => {
				await chops(page, true);
				const layout = await page.evaluate<Layout>(LAYOUT);
				expect(layout.lines).toBeLessThanOrEqual(2);
				expect(layout.textLines).toBe(1);
				expect(layout.height).toBeLessThanOrEqual(layout.lines === 1 ? 44 : 70);
			});

			test("narrower, the buttons wrap below and the sentence is cut short, never a third line", async () => {
				await chops(page, true);
				await page.resize(860, 820);
				const layout = await page.evaluate<Layout>(LAYOUT);
				expect(layout).toMatchObject({ lines: 2, textLines: 1, cut: true });
				expect(layout.height).toBeLessThanOrEqual(70);
				await page.resize(1280, 820);
			});
		});
	}

	test("the sentence takes its color from the theme", () => {
		expect(colors.size).toBe(2);
		expect(colors.get("timber-light")).not.toBe(colors.get("timber-dark"));
	});
});
