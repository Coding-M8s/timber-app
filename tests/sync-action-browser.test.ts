import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Pull and Push in a real browser, over the mock engine: the control beside
 * the row, the dialog's commands, the counts afterwards, where the keyboard
 * goes, and each from the row's menu by keyboard. The rest is tested without
 * a window. Skipped where no browser is installed.
 */

const CONTROL = ".sync.behind.row-sync-button";
/** The sample worktree that is ahead of its upstream and not behind. */
const AHEAD = "/work/timber-worktrees/feat-github-issue-lookup";
/** Its Push control. Another row, on a branch never published, has one too. */
const PUSH_CONTROL = `[data-worktree-path="${AHEAD}"] .sync.ahead.row-sync-button`;
/** The sample worktree on a branch never published, with one commit no remote has. */
const UNPUBLISHED = "/work/timber-worktrees/spike-new-idea";
const UNPUBLISHED_CONTROL = `[data-worktree-path="${UNPUBLISHED}"] .sync.ahead.row-sync-button`;
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
		// The sample primary checkout's base is its own upstream, so the way on is not Rebase, which it does not offer.
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).toContain("decide in a terminal");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).not.toContain("Rebase it onto its upstream");
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(CONTROL)}) !== null`)).toBe(true);
	}, 30_000);

	test("Pull is in the row's menu, by keyboard", async () => {
		await page.evaluate(`document.querySelector('[data-worktree-path="/work/timber"] .row').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector("[role=menu]") !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[role=menuitem]")].map(item => item.textContent.trim())`)).toEqual(["Pull", "Tag\u203a", "Done"]);
		// The keyboard starts on the first entry.
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("role") + " " + document.activeElement.textContent.trim()`)).toBe("menuitem Pull");
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Pull main");
	}, 30_000);
});

describe.skipIf(browserPath === null || process.platform === "win32")("Push in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(PUSH_CONTROL)}) !== null`, "a Push control showed");
	}, 30_000);

	test("the control replaces the ahead count, shows the timber publish command, and after a push the counts follow", async () => {
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(PUSH_CONTROL)}).closest("[data-worktree-path]").dataset.worktreePath`)).toBe(AHEAD);
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(PUSH_CONTROL)}).getAttribute("aria-label")`)).toBe("Push 2 commits from feat/github-issue-lookup to origin/feat/github-issue-lookup");
		await page.click(PUSH_CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		const commands = await page.evaluate<string[]>(`[...document.querySelectorAll("dialog[open] .dialog-command")].map(command => command.textContent)`);
		expect(commands).toEqual([`timber publish --result-file <temporary file> -- ${AHEAD}`]);
		await page.click("dialog[open] button[type=submit]");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(`document.querySelector(${JSON.stringify(PUSH_CONTROL)}) === null`, "the control went once the branch was pushed");
		await page.until(`[...document.querySelectorAll(".toast-text")].some(toast => toast.textContent === "Pushed feat/github-issue-lookup to origin/feat/github-issue-lookup.")`, "the toast said so");
		await page.until(`document.activeElement?.classList.contains("row") === true`, "the keyboard went to the row");
		expect(await page.evaluate<string>(`document.activeElement.closest("[data-worktree-path]").dataset.worktreePath`)).toBe(AHEAD);
	}, 30_000);

	test("the control stays where it is drawn when the pointer comes to it, so the row's other controls never take its click", async () => {
		const middle = `(() => { const box = document.querySelector(${JSON.stringify(PUSH_CONTROL)}).getBoundingClientRect(); return [box.x + box.width / 2, box.y + box.height / 2]; })()`;
		const [x, y] = await page.evaluate<[number, number]>(middle);
		// Not selected, so its other controls show only once the pointer is on the row.
		expect(await page.evaluate<boolean>(`document.querySelector('[data-worktree-path="${AHEAD}"]').classList.contains("selected")`)).toBe(false);
		await page.hover(PUSH_CONTROL);
		expect(await page.evaluate<[number, number]>(middle)).toEqual([x, y]);
		expect(await page.evaluate<boolean>(`document.elementFromPoint(${x}, ${y}).closest("button")?.matches(${JSON.stringify(PUSH_CONTROL)}) === true`)).toBe(true);
	}, 30_000);

	test("a refusal and an offline failure stay in the dialog with Timber's words, and the control stays", async () => {
		await page.evaluate(`window.timberTestEngine.endSyncActions("remote-moved")`);
		await page.click(PUSH_CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		await page.click("dialog[open] button[type=submit]");
		await page.until(`document.querySelector("dialog[open]")?.textContent.includes("has moved on") === true`, "Timber's words showed");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).toContain("Timber refused, so nothing was pushed and no branch changed.");
		await page.evaluate(`window.timberTestEngine.endSyncActions("offline")`);
		await page.click("dialog[open] button[type=submit]");
		await page.until(`document.querySelector("dialog[open]")?.textContent.includes("Git push to origin/feat/github-issue-lookup failed") === true`, "Timber's words for an offline push showed");
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(PUSH_CONTROL)}) !== null`)).toBe(true);
	}, 30_000);

	test("Push is in the row's menu, by keyboard", async () => {
		await page.evaluate(`document.querySelector('[data-worktree-path="${AHEAD}"] .row').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector("[role=menu]") !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[role=menuitem]")].map(item => item.textContent.trim())`)).toEqual(["Push", "Tag\u203a", "Done"]);
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("role") + " " + document.activeElement.textContent.trim()`)).toBe("menuitem Push");
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Push feat/github-issue-lookup");
	}, 30_000);

	test("a branch never published gets the control in place of local only, by keyboard from its menu too, and after publishing it tracks its new upstream", async () => {
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(UNPUBLISHED_CONTROL)}).getAttribute("aria-label")`)).toBe("Push 1 commit from spike/new-idea, publishing it");
		expect(await page.evaluate<boolean>(`document.querySelector('[data-worktree-path="${UNPUBLISHED}"]').textContent.includes("local only")`)).toBe(false);
		await page.evaluate(`document.querySelector('[data-worktree-path="${UNPUBLISHED}"] .row').focus()`);
		await page.press("F10", "shift");
		await page.until(`document.querySelector("[role=menu]") !== null`, "the menu opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("[role=menuitem]")].map(item => item.textContent.trim())`)).toEqual(["Push", "Tag\u203a", "Done"]);
		await page.press("Enter");
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll("dialog[open] .dialog-command")].map(command => command.textContent)`)).toEqual([`timber publish --result-file <temporary file> -- ${UNPUBLISHED}`]);
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).toContain("publishes spike/new-idea under its own name and sets its upstream");
		await page.click("dialog[open] button[type=submit]");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(`document.querySelector(${JSON.stringify(UNPUBLISHED_CONTROL)}) === null`, "the control went once the branch was published");
		await page.until(`[...document.querySelectorAll(".toast-text")].some(toast => toast.textContent === "Published spike/new-idea to origin/spike/new-idea and set its upstream.")`, "the toast named the new upstream");
		expect(await page.evaluate<boolean>(`document.querySelector('[data-worktree-path="${UNPUBLISHED}"]').textContent.includes("local only")`)).toBe(false);
	}, 30_000);
});

const SKIP_BOX = `[...document.querySelectorAll("dialog[open] label.check")].find(label => label.textContent.startsWith("Don't ask before pulling in "))?.querySelector("input")`;
const SKIPPED = `window.timberTestStore.getState().preferences.pull.skip`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("Skipping the Pull dialog in a real browser", () => {
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

	test("the dialog's box, ticked when Pull is submitted, turns on the repository's Skip pull confirmation", async () => {
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`(${SKIP_BOX}).closest("label").querySelector(".check-text").textContent`)).toStartWith("Don't ask before pulling in timberTurned on when you pull.");
		expect(await page.evaluate<boolean>(`(${SKIP_BOX}).checked`)).toBe(false);
		await page.evaluate(`(${SKIP_BOX}).click()`);
		await page.click("dialog[open] button[type=submit]");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		await page.until(`${SKIPPED}.includes("/work/timber")`, "the repository skips the dialog now");
		expect(await page.evaluate<string[]>(`window.timberTestEngine.loadPreferences().then(saved => saved.pull.skip)`)).toEqual(["/work/timber"]);
	}, 30_000);

	test("cancelling with the box ticked saves nothing", async () => {
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		await page.evaluate(`(${SKIP_BOX}).click()`);
		await page.click("dialog[open] .dialog-buttons button.quiet");
		await page.until(DIALOG_CLOSED, "the dialog closed");
		expect(await page.evaluate<string[]>(SKIPPED)).toEqual([]);
		expect(await page.evaluate<string[]>(`window.timberTestEngine.loadPreferences().then(saved => saved.pull.skip)`)).toEqual([]);
	}, 30_000);

	test("unticking the box and pulling again after a refusal turns the setting back off", async () => {
		await page.evaluate(`window.timberTestEngine.endSyncActions("diverged")`);
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened");
		await page.evaluate(`(${SKIP_BOX}).click()`);
		await page.click("dialog[open] button[type=submit]");
		await page.until(`document.querySelector("dialog[open]")?.textContent.includes("Not possible to fast-forward") === true`, "Git's words showed");
		await page.until(`${SKIPPED}.includes("/work/timber")`, "the tick was saved");
		await page.evaluate(`(${SKIP_BOX}).click()`);
		await page.click("dialog[open] button[type=submit]");
		await page.until(`${SKIPPED}.length === 0`, "the untick was saved");
	}, 30_000);

	test("with the dialog skipped, the control pulls at once, the toast says so, and the keyboard goes to the row", async () => {
		await page.evaluate(`window.timberTestStore.savePreferences({ pull: { ask: true, skip: ["/work/timber"] } })`);
		await page.until(`document.querySelector(${JSON.stringify(CONTROL)}).getAttribute("aria-haspopup") === null`, "the control no longer says it opens a dialog");
		await page.evaluate(`document.querySelector(${JSON.stringify(CONTROL)}).focus()`);
		await page.click(CONTROL);
		await page.until(`[...document.querySelectorAll(".toast-text")].some(toast => toast.textContent === "Pulled origin/main into main.")`, "the toast said so");
		expect(await page.evaluate<boolean>(DIALOG_CLOSED)).toBe(true);
		await page.until(`document.querySelector(${JSON.stringify(CONTROL)}) === null`, "the control went once the branch caught up");
		await page.until(`document.activeElement?.classList.contains("row") === true`, "the keyboard went to the row");
	}, 30_000);

	test("with the dialog skipped, a refusal opens it with Git's words and the commands that ran", async () => {
		await page.evaluate(`window.timberTestStore.savePreferences({ pull: { ask: false, skip: [] } })`);
		await page.evaluate(`window.timberTestEngine.endSyncActions("diverged")`);
		await page.until(`document.querySelector(${JSON.stringify(CONTROL)}).getAttribute("aria-haspopup") === null`, "the control no longer says it opens a dialog");
		await page.click(CONTROL);
		await page.until(DIALOG_OPEN, "the dialog opened on the refusal");
		await page.until(`document.querySelector("dialog[open]").textContent.includes("Not possible to fast-forward")`, "Git's words showed");
		const commands = await page.evaluate<string[]>(`[...document.querySelectorAll("dialog[open] .dialog-command")].map(command => command.textContent)`);
		expect(commands).toEqual(["git fetch origin", "git merge --ff-only --no-autostash refs/remotes/origin/main"]);
		// The sample primary checkout's base is its own upstream, so the way on is not Rebase, which it does not offer.
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).toContain("decide in a terminal");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open]").textContent`)).not.toContain("Rebase it onto its upstream");
		// It already skips, so the box is not offered.
		expect(await page.evaluate<boolean>(`(${SKIP_BOX}) === undefined`)).toBe(true);
	}, 30_000);
});
