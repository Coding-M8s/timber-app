import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { THEME_STYLE_ID, themeStyleSheet } from "../src/shared/theme";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * A repository's header row as drawn (issue 293): its own background, apart
 * from the worktree rows, a change under the pointer, and Fetch now and More
 * in view without pointing at the header first. The styles themselves are
 * tested without a window in sidebar-look.test.ts. Skipped where no browser
 * is installed.
 */

const REPOSITORY = "timber";
const head = `document.querySelector('section.group[aria-label="${REPOSITORY}"] .group-head')`;
const header = `${head}.querySelector(".group-header")`;
const background = (element: string) => `getComputedStyle(${element}).backgroundColor`;
const opacity = (element: string) => `Number(getComputedStyle(${element}).opacity)`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("a repository's header row in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.until(`${head} !== null && document.querySelector(".row") !== null`, "the repository and its rows showed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	for (const theme of [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME]) {
		describe(`in ${theme.name}`, () => {
			beforeAll(async () => {
				// The test page has no saved settings, so the theme is put on it here, as the main process would.
				const sheet = themeStyleSheet({ mode: "fixed", theme: theme.id });
				await page.evaluate(`(() => {
					const style = document.getElementById(${JSON.stringify(THEME_STYLE_ID)}) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: ${JSON.stringify(THEME_STYLE_ID)} }));
					style.textContent = ${JSON.stringify(sheet)};
				})()`);
				await page.hover("main.workspace");
			});

			test("the header row's background differs from a worktree row's and from the sidebar's", async () => {
				const row = await page.evaluate<string>(background(`document.querySelector(".row:not(.selected)")`));
				const sidebar = await page.evaluate<string>(background(`document.querySelector(".sidebar")`));
				const own = await page.evaluate<string>(background(head));
				expect(own).not.toBe("rgba(0, 0, 0, 0)");
				expect(own).not.toBe(row);
				expect(own).not.toBe(sidebar);
			});

			test("Fetch now and More show without the header being pointed at or focused", async () => {
				expect(await page.evaluate<boolean>(`${head}.matches(":hover, :focus-within")`)).toBe(false);
				expect(await page.evaluate<number>(opacity(`${head}.querySelector(".group-fetch")`))).toBe(1);
				expect(await page.evaluate<number>(opacity(`${head}.querySelector(".group-more")`))).toBe(1);
			});

			test("pointing at the header changes how it looks", async () => {
				const before = await page.evaluate<string>(background(header));
				await page.hover(`section.group[aria-label="${REPOSITORY}"] .group-name`);
				await page.until(`${background(header)} !== ${JSON.stringify(before)}`, "the header changed under the pointer");
				await page.hover("main.workspace");
			});
		});
	}

	test("a group's More shows without its header being pointed at or focused", async () => {
		await page.click('[aria-label="New group"]');
		await page.until(`document.activeElement?.classList.contains("repository-group-name-input")`, "the name field took the keyboard");
		await page.type("Work");
		await page.press("Enter");
		await page.until(`document.querySelector(".repository-group-more") !== null`, "the group showed");
		await page.hover("main.workspace");
		await page.evaluate(`document.activeElement?.blur()`);
		expect(await page.evaluate<boolean>(`document.querySelector(".repository-group-head").matches(":hover, :focus-within")`)).toBe(false);
		expect(await page.evaluate<number>(opacity(`document.querySelector(".repository-group-more")`))).toBe(1);
	});
});
