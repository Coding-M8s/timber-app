import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The workspace header's action bar in a real browser, over the mock engine:
 * Open in editor then More by Tab, the More menu by keyboard, its disabled
 * entry with the reason, a dialog from it that shows the command and gives
 * the keyboard back to More, and the pull request link. The entries' rules
 * are tested without a window in ./workspace-actions.test.ts. Skipped where
 * no browser is installed.
 */

const MORE = ".workspace-actions .workspace-more";
const EDITOR = ".workspace-actions .workspace-editor";
const MENU_OPEN = `document.querySelector(".worktree-menu") !== null`;
const MENU_CLOSED = `document.querySelector(".worktree-menu") === null`;
const DIALOG_OPEN = `document.querySelector("dialog[open]") !== null`;
const DIALOG_CLOSED = `document.querySelector("dialog[open]") === null`;
const ON_MORE = `document.activeElement === document.querySelector(${JSON.stringify(MORE)})`;
const FOCUSED_TEXT = `(document.activeElement?.textContent ?? "")`;
/** The sample worktree with an open pull request, #42. */
const LOOKUP = "/work/timber-worktrees/feat-github-issue-lookup";

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the workspace header's actions in a real browser", () => {
	let page: BrowserPage;

	const selectWorktree = async (path: string) => {
		await page.evaluate(`(() => {
			const store = window.timberTestStore;
			const worktree = store.getState().repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === ${JSON.stringify(path)});
			store.select(worktree.id);
		})()`);
		await page.until(`document.querySelector(".workspace-title")?.closest("main") !== null && document.querySelector(".workspace .path")?.textContent === ${JSON.stringify(path)}`, "the worktree showed");
	};

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(MORE)}) !== null`, "More showed");
	}, 30_000);

	test("the primary checkout has its quiet label, and Tab goes from Open in editor to More", async () => {
		expect(await page.evaluate<string>(`document.querySelector(".workspace-title-line .workspace-kind").textContent`)).toBe("Primary checkout");
		await page.evaluate(`document.querySelector(${JSON.stringify(EDITOR)}).focus()`);
		await page.press("Tab");
		await page.until(ON_MORE, "Tab reached More");
	}, 30_000);

	test("on the primary checkout, whose base is its upstream, Enter opens the menu on Pull; Done is off with the reason and stays put when pressed; Escape gives the keyboard back to More", async () => {
		await page.evaluate(`document.querySelector(${JSON.stringify(MORE)}).focus()`);
		await page.press("Enter");
		await page.until(MENU_OPEN, "the menu opened");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(MORE)}).getAttribute("aria-expanded")`)).toBe("true");
		await page.until(`${FOCUSED_TEXT} === "Pull…"`, "Pull had the keyboard");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[role=menuitem]")].map(item => item.textContent.trim())`)).toEqual(["Pull…", "Done…"]);
		await page.press("ArrowDown");
		await page.until(`${FOCUSED_TEXT} === "Done…"`, "Done had the keyboard");
		expect(await page.evaluate<string | null>(`document.activeElement.getAttribute("aria-disabled")`)).toBe("true");
		expect(await page.evaluate<string>(`document.getElementById(document.activeElement.getAttribute("aria-describedby")).textContent`)).toBe("The primary checkout is never removed.");
		await page.press("Enter");
		expect(await page.evaluate<boolean>(MENU_OPEN)).toBe(true);
		expect(await page.evaluate<boolean>(DIALOG_CLOSED)).toBe(true);
		await page.press("Escape");
		await page.until(MENU_CLOSED, "the menu closed");
		await page.until(ON_MORE, "the keyboard went back to More");
	}, 30_000);

	test("Up opens the menu on its last entry, and Space opens it on its first", async () => {
		await page.evaluate(`document.querySelector(${JSON.stringify(MORE)}).focus()`);
		await page.press("ArrowUp");
		await page.until(`${FOCUSED_TEXT} === "Done…"`, "Up opened on Done");
		await page.press("Escape");
		await page.until(ON_MORE, "the keyboard went back to More");
		await page.press(" ");
		await page.until(`${FOCUSED_TEXT} === "Pull…"`, "Space opened on Pull");
	}, 30_000);

	test("Pull from the primary checkout's menu opens the row's Pull dialog with the Git commands", async () => {
		await page.evaluate(`document.querySelector(${JSON.stringify(MORE)}).focus()`);
		await page.press("Enter");
		await page.until(`${FOCUSED_TEXT} === "Pull…"`, "Pull had the keyboard");
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the Pull dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Pull main");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("dialog[open] .dialog-command")].map(command => command.textContent)`))
			.toEqual(["git fetch origin", "git merge --ff-only --no-autostash refs/remotes/origin/main"]);
		await page.press("Escape");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(ON_MORE, "the keyboard went back to More");
	}, 30_000);

	test("Rebase from a linked worktree's menu opens its dialog with the command, and closing it gives the keyboard back to More", async () => {
		await selectWorktree(LOOKUP);
		await page.evaluate(`document.querySelector(${JSON.stringify(MORE)}).focus()`);
		await page.press("Enter");
		await page.until(`${FOCUSED_TEXT} === "Rebase…"`, "Rebase had the keyboard");
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the Rebase dialog opened");
		await page.until(MENU_CLOSED, "the menu went");
		await page.until(`[...document.querySelectorAll("dialog[open] .dialog-command")].some(command => command.textContent.startsWith("timber rebase"))`, "the dialog showed the Timber command");
		await page.press("Escape");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(ON_MORE, "the keyboard went back to More");
	}, 30_000);

	test("the pull request in the details is a link that opens it, and there is no separate Open pull request button", async () => {
		await selectWorktree(LOOKUP);
		await page.evaluate(`(() => {
			window.openedLinks = [];
			window.timberTestEngine.openLink = async url => { window.openedLinks.push(url); return true; };
		})()`);
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".workspace-header button")].some(button => button.textContent === "Open pull request")`)).toBe(false);
		await page.click(".workspace-meta .pull-link");
		await page.until(`window.openedLinks.length === 1`, "the link was opened");
		expect(await page.evaluate<string[]>(`window.openedLinks`)).toEqual(["https://github.com/example/timber/pull/42"]);
	}, 30_000);
});
