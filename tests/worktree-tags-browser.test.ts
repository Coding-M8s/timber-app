import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { contrastRatio } from "../src/shared/color";
import { THEME_STYLE_ID, themeStyleSheet } from "../src/shared/theme";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Worktree tags as drawn (issue 409): the wash of each tag over its row,
 * under the selection, hover, and the focus ring, a colored header, and the
 * Tag menu of a row reached by keyboard and by pointer. The styles and the
 * contrast are tested without a window in worktree-tags.test.ts and
 * theme.test.ts. Skipped where no browser is installed.
 */

const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";
const MAC = "/work/timber-worktrees/fix-macos-portability";
const SPIKE = "/work/timber-worktrees/spike-new-idea";
const item = (path: string) => `document.querySelector('[data-worktree-path="${path}"]')`;
/** The color a row is painted in, wash included, read from its pixels' parts: its own background and the wash over it. */
const painted = (path: string) => `(() => {
	const row = ${item(path)};
	const wash = getComputedStyle(row, "::before");
	return { fill: getComputedStyle(row).backgroundColor, wash: wash.backgroundColor, opacity: Number(wash.opacity), content: wash.content };
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("worktree tags in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage("tags-sample-page.tsx");
		await page.resize(1100, 1400);
		await page.until(`${item(LOOKUP)} !== null && document.querySelector(".repository-group-head.colored") !== null`, "the tagged rows and the colored group showed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	for (const theme of [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME]) {
		describe(`in ${theme.name}`, () => {
			beforeAll(async () => {
				const sheet = themeStyleSheet({ mode: "fixed", theme: theme.id });
				await page.evaluate(`(() => {
					const style = document.getElementById(${JSON.stringify(THEME_STYLE_ID)}) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: ${JSON.stringify(THEME_STYLE_ID)} }));
					style.textContent = ${JSON.stringify(sheet)};
				})()`);
				await page.hover("main.workspace");
			});

			test("each tag washes its row in its own color, under the words", async () => {
				const review = await page.evaluate<{ wash: string; opacity: number; content: string }>(painted(LOOKUP));
				const experiment = await page.evaluate<{ wash: string }>(painted(MAC));
				expect(review.content).toBe('""');
				expect(review.opacity).toBeCloseTo(0.07, 5);
				expect(review.wash).not.toBe(experiment.wash);
				expect(contrastRatio(review.wash, theme.ui.tag2)).toBeCloseTo(1, 1);
				// The words sit above the wash: the row's name is not covered by it.
				expect(await page.evaluate<number>(`Number(getComputedStyle(${item(LOOKUP)}, "::before").zIndex)`)).toBe(-1);
			});

			test("selection and hover still change a tagged row, and the focus ring goes around it", async () => {
				// Another row is selected, so this one starts plain.
				await page.click(`[data-worktree-path="${LOOKUP}"] .row`);
				await page.hover("main.workspace");
				const before = await page.evaluate<{ fill: string }>(painted(SPIKE));
				await page.hover(`[data-worktree-path="${SPIKE}"] .row`);
				const hovered = await page.evaluate<{ fill: string; wash: string }>(painted(SPIKE));
				expect(hovered.fill).not.toBe(before.fill);
				await page.hover("main.workspace");
				await page.click(`[data-worktree-path="${SPIKE}"] .row`);
				await page.hover("main.workspace");
				const selected = await page.evaluate<{ fill: string }>(painted(SPIKE));
				expect(selected.fill).not.toBe(before.fill);
				expect(selected.fill).not.toBe(hovered.fill);
				await page.press("Escape");
				await page.evaluate(`${item(MAC)}.querySelector(".row").focus()`);
				expect(await page.evaluate<string>(`getComputedStyle(${item(MAC)}).outlineStyle`)).toBe("solid");
			});

			test("a colored header takes the wash in place of its quiet surface", async () => {
				const head = `document.querySelector('section.group[aria-label="timber"] .group-head')`;
				expect(await page.evaluate<boolean>(`${head}.classList.contains("colored")`)).toBe(true);
				expect(await page.evaluate<string>(`getComputedStyle(${head}).backgroundColor`)).toBe("rgba(0, 0, 0, 0)");
				expect(await page.evaluate<string>(`getComputedStyle(${head}, "::before").backgroundColor`)).not.toBe("rgba(0, 0, 0, 0)");
				// Drawn as the contrast check reckons it: the tag color at the wash's opacity over the sidebar.
				expect(Number(await page.evaluate<string>(`getComputedStyle(${head}, "::before").opacity`))).toBeCloseTo(0.07, 5);
			});
		});
	}

	test("the keyboard opens a row's Tag menu, Right opens the tags, Left goes back, and a pick retags the row", async () => {
		await page.evaluate(`${item(MAC)}.querySelector(".row").focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector('.worktree-menu[role="menu"]') !== null`, "the row's menu opened");
		// Up from the first entry wraps to Done; one more up is Tag.
		await page.press("ArrowUp");
		await page.press("ArrowUp");
		expect(await page.evaluate<string>(`document.activeElement.textContent`)).toContain("Tag");
		await page.press("ArrowRight");
		await page.until(`document.querySelector(".worktree-submenu") !== null && document.activeElement?.closest(".worktree-submenu") !== null`, "the tags opened with the keyboard in them");
		// The keyboard starts on the current tag, Experiment.
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("aria-checked") + " " + document.activeElement.textContent`)).toBe("true Experiment✓");
		await page.press("ArrowLeft");
		await page.until(`document.querySelector(".worktree-submenu") === null && document.activeElement?.getAttribute("aria-haspopup") === "menu"`, "Left went back to Tag");
		await page.press("ArrowRight");
		await page.until(`document.activeElement?.closest(".worktree-submenu") !== null`, "the tags opened again");
		await page.press("Home");
		await page.press("ArrowDown");
		expect(await page.evaluate<string>(`document.activeElement.textContent`)).toBe("Review");
		await page.press("Enter");
		await page.until(`document.querySelector(".worktree-menu") === null && ${item(MAC)}.dataset.tag === "review"`, "the row took Review");
		// The keyboard is back on the row.
		expect(await page.evaluate<boolean>(`${item(MAC)}.contains(document.activeElement)`)).toBe(true);
	});

	test("a row's menu and a colored group's menu paint over the rows below them, so a click reaches every entry", async () => {
		const first = "/work/timber";
		const at = await page.middle(`[data-worktree-path="${first}"] .row`);
		await page.evaluate(`${item(first)}.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${at.x}, clientY: ${at.y} }))`);
		await page.until(`document.querySelector('.worktree-menu[role="menu"]') !== null`, "the row's menu opened");
		const covered = `[...document.querySelectorAll(".worktree-menu-item")].filter(entry => {
			const box = entry.getBoundingClientRect();
			return !document.elementFromPoint(box.left + box.width / 2, box.top + box.height / 2)?.closest(".worktree-menu");
		}).map(entry => entry.textContent)`;
		expect(await page.evaluate<string[]>(covered)).toEqual([]);
		await page.press("Escape");
		await page.until(`document.querySelector(".worktree-menu") === null`, "the menu closed");
		await page.click(".repository-group-head.colored .repository-group-more");
		await page.until(`document.querySelector('.worktree-menu[role="menu"]') !== null`, "the group's menu opened");
		expect(await page.evaluate<string[]>(covered)).toEqual([]);
		await page.press("Escape");
		await page.until(`document.querySelector(".worktree-menu") === null`, "the menu closed");
	});

	test("resting the pointer on Tag opens the tags beside the menu, inside the window", async () => {
		const at = await page.middle(`[data-worktree-path="${SPIKE}"] .row`);
		await page.evaluate(`${item(SPIKE)}.dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, clientX: ${at.x}, clientY: ${at.y} }))`);
		await page.until(`document.querySelector('.worktree-menu[role="menu"]') !== null`, "the menu opened");
		await page.hover('.worktree-menu-item[aria-haspopup="menu"]');
		await page.until(`document.querySelector(".worktree-submenu") !== null`, "the tags opened");
		const placed = await page.evaluate<{ menu: number; inner: number; right: number; width: number }>(`(() => {
			const menu = document.querySelector(".worktree-menu:not(.worktree-submenu)").getBoundingClientRect();
			const inner = document.querySelector(".worktree-submenu").getBoundingClientRect();
			return { menu: menu.right, inner: inner.left, right: inner.right, width: window.innerWidth };
		})()`);
		expect(placed.inner).toBeGreaterThanOrEqual(placed.menu - 4);
		expect(placed.right).toBeLessThanOrEqual(placed.width);
		await page.click('.worktree-submenu [role="menuitemradio"]');
		await page.until(`document.querySelector(".worktree-menu") === null && ${item(SPIKE)}.dataset.tag === "work"`, "the row took Work");
	});
});
