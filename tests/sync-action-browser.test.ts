import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Pull in a real browser, over the mock engine: the control beside the row,
 * the dialog's commands, the counts afterwards, where the keyboard goes, and
 * Pull from the row's menu by keyboard. The rest is tested without a window.
 * Skipped where no browser is installed.
 */

const CONTROL = ".row-sync-button";
const DIALOG_OPEN = `document.querySelector("dialog[open]") !== null`;
const DIALOG_CLOSED = `document.querySelector("dialog[open]") === null`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("Pull in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(CONTROL)}) !== null`, "a Pull control showed");
	}, 30_000);

	test("the control sits beside the row's button, shows both commands, and after a pull the counts follow and the keyboard is on the row", async () => {
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(CONTROL)}).closest("button.row") === null`)).toBe(true);
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(CONTROL)}).getAttribute("aria-label")`)).toBe("Pull 2 commits into main from origin/main");
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		const commands = await page.evaluate<string[]>(`[...document.querySelectorAll("dialog[open] .dialog-command")].map(command => command.textContent)`);
		expect(commands).toEqual(["git fetch origin", "git merge --ff-only --no-autostash refs/remotes/origin/main"]);
		await page.click("dialog[open] button[type=submit]");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(`document.querySelector(${JSON.stringify(CONTROL)}) === null`, "the control went once the branch caught up");
		await page.until(`[...document.querySelectorAll(".toast-text")].some(toast => toast.textContent === "Pulled origin/main into main.")`, "the toast said so");
		await page.until(`document.activeElement?.classList.contains("row") === true`, "the keyboard went to the row");
		expect(await page.evaluate<string>(`document.activeElement.closest("[data-worktree-path]").dataset.worktreePath`)).toBe("/work/timber");
	}, 30_000);

	test("a pull whose fetch failed closes with a problem toast that has Git's words", async () => {
		await page.evaluate(`window.timberTestEngine.endSyncActions("fetch-failed")`);
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		await page.click("dialog[open] button[type=submit]");
		await page.until(`document.querySelector(".toast.problem") !== null`, "a problem toast showed");
		expect(await page.evaluate<string>(`document.querySelector(".toast.problem .toast-text").textContent`)).toContain("The fetch failed, so these are the commits fetched last. Git said:");
	}, 30_000);

	test("a refusal stays in the dialog with Git's words and the way on", async () => {
		await page.evaluate(`window.timberTestEngine.endSyncActions("diverged")`);
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		await page.click("dialog[open] button[type=submit]");
		await page.until(`document.querySelector("dialog[open]")?.textContent.includes("Not possible to fast-forward") === true`, "Git's words showed");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).toContain("Rebase it onto its upstream");
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(CONTROL)}) !== null`)).toBe(true);
	}, 30_000);

	test("Pull is in the row's menu, by keyboard", async () => {
		await page.evaluate(`document.querySelector('[data-worktree-path="/work/timber"] .row').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector("[role=menu]") !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[role=menuitem]")].map(item => item.textContent.trim())`)).toEqual(["Pull", "Done"]);
		// The keyboard starts on the first entry.
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("role") + " " + document.activeElement.textContent.trim()`)).toBe("menuitem Pull");
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Pull main");
	}, 30_000);
});
