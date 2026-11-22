import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";
import { BUILT_IN_THEMES, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { parseColor } from "../src/shared/color";

/**
 * A diff's colors in a real browser, over the mock engine: code colored as
 * the editor colors it, the words that changed marked, a theme change
 * recoloring both, and a diff of nearly 5,000 lines that scrolls smoothly.
 * The rest is tested without a window. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const PATH = "src/big.ts";
const PAIRS = 2_480;

/** One hunk of edited lines: each removed line, then the added line it became, so every pair marks a word. */
const PATCH = [
	`diff --git a/${PATH} b/${PATH}`,
	"index 1111111..2222222 100644",
	`--- a/${PATH}`,
	`+++ b/${PATH}`,
	`@@ -1,${PAIRS + 1} +1,${PAIRS + 1} @@`,
	" export function compute(value: number): number {",
	...Array.from({ length: PAIRS }, (_, index) => [`-\tconst value${index} = compute(${index}, "a line of the big diff");`, `+\tconst value${index} = compute(${index + 1}, "a line of the big diff");`]).flat(),
	"",
].join("\n");

const rgb = (color: string) => {
	const { r, g, b } = parseColor(color)!;
	return `rgb(${r}, ${g}, ${b})`;
};

/** The color the first "const" of the diff is drawn in. */
const KEYWORD_COLOR = `(() => {
	const word = [...document.querySelectorAll(".diff-text span")].find(span => span.textContent === "const");
	return word ? getComputedStyle(word).color : "none";
})()`;
/** The background of the first changed word on an added line. */
const WORD_BACKGROUND = `(() => {
	const word = document.querySelector(".diff-line.added .diff-word");
	return word ? getComputedStyle(word).backgroundColor : "none";
})()`;

/** The color of the first changed word on an added line. */
const WORD_COLOR = `getComputedStyle(document.querySelector(".diff-line.added .diff-word")).color`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("a diff's colors in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		// The test page starts with no theme on it; saving one other than the default puts it on.
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "timber-light" } })`);
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, [{ change: { area: "unstaged", kind: "modified", path: ${JSON.stringify(PATH)}, previousPath: null }, patch: ${JSON.stringify(PATCH)} }]);
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
		})()`);
		await page.until(`[...document.querySelectorAll(".change-file")].some(button => button.title === ${JSON.stringify(PATH)})`, "the file was listed");
		await page.evaluate(`[...document.querySelectorAll(".change-file")].find(button => button.title === ${JSON.stringify(PATH)}).click()`);
		await page.until(`document.querySelectorAll(".diff-line").length === ${PAIRS * 2 + 1}`, "the diff showed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	test("colors code as the editor does, and marks the changed words, in the theme's colors", async () => {
		await page.until(`${KEYWORD_COLOR} === ${JSON.stringify(rgb(DEFAULT_LIGHT_THEME.terminal.magenta))}`, "keywords were drawn in the theme's magenta");
		expect(await page.evaluate<number>(`document.querySelectorAll(".diff-word").length`)).toBe(PAIRS * 2);
		// The changed number, and only it, is marked.
		expect(await page.evaluate<string>(`document.querySelector(".diff-line.added .diff-word").textContent`)).toBe("1");
		expect(await page.evaluate<string>(WORD_BACKGROUND)).toBe(DEFAULT_LIGHT_THEME.ui.diffAddedWord);
		// A changed word is drawn in the text color, which the contrast check measures on its tint.
		expect(await page.evaluate<string>(WORD_COLOR)).toBe(rgb(DEFAULT_LIGHT_THEME.ui.text));

		const nord = BUILT_IN_THEMES.find(theme => theme.id === "nord")!;
		await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "nord" } })`);
		await page.until(`${KEYWORD_COLOR} === ${JSON.stringify(rgb(nord.terminal.magenta))}`, "keywords took Nord's magenta");
		expect(await page.evaluate<string>(WORD_BACKGROUND)).toBe(nord.ui.diffAddedWord);
		expect(await page.evaluate<string>(WORD_COLOR)).toBe(rgb(nord.ui.text));
	});

	test("a diff of nearly 5,000 colored lines scrolls smoothly", async () => {
		const frames = await page.evaluate<{ times: number[]; moved: number }>(`(async () => {
			const body = document.querySelector(".diff-body");
			body.scrollTop = 0;
			const times = [];
			let last = await new Promise(requestAnimationFrame);
			for (let step = 0; step < 120; step++) {
				body.scrollTop += 400;
				const now = await new Promise(requestAnimationFrame);
				times.push(now - last);
				last = now;
			}
			return { times, moved: body.scrollTop };
		})()`).then(({ times, moved }) => {
			// The diff itself scrolled, far down.
			expect(moved).toBeGreaterThan(40_000);
			return times;
		});
		const sorted = [...frames].sort((one, other) => one - other);
		const median = sorted[Math.floor(sorted.length / 2)]!;
		const slow = sorted[Math.floor(sorted.length * 0.95)]!;
		console.log(`Scrolling ${PAIRS * 2 + 1} diff lines: median frame ${median.toFixed(1)} ms, 95th percentile ${slow.toFixed(1)} ms`);
		// 60 frames a second is 16.7 ms each, as measured alone; the whole suite running beside it doubles that.
		expect(median).toBeLessThan(50);
	});
});
