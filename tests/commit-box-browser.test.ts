import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The commit box in a real browser, over the mock engine: typing and
 * Ctrl+Enter commits, Enter alone is a new line, Base's Commit… switches to
 * Uncommitted with the box focused, and Push after a commit opens the row's
 * Push dialog. The words and the store are tested without a window in
 * ./commit-box.test.tsx, and Git itself in ./commit-staged.test.ts. Skipped
 * where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";

const FILES = [
	{ change: { area: "staged", kind: "modified", path: "src/rules.ts", previousPath: null }, patch: "diff --git a/src/rules.ts b/src/rules.ts\n--- a/src/rules.ts\n+++ b/src/rules.ts\n@@ -1 +1 @@\n-a\n+b\n" },
	{ change: { area: "unstaged", kind: "modified", path: "src/total.ts", previousPath: null }, patch: "diff --git a/src/total.ts b/src/total.ts\n--- a/src/total.ts\n+++ b/src/total.ts\n@@ -1 +1 @@\n-a\n+b\n" },
];

const BOX = `document.querySelector(".commit-message")`;
const BUTTON = `document.querySelector(".commit-button")`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("committing in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.resize(1400, 900);
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.evaluate(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, ${JSON.stringify(FILES)});
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
			await ${STORE}.compareChanges("uncommitted");
		})()`);
		await page.until(`document.querySelectorAll(".change-file").length === 2 && ${BOX} !== null`, "the files and the box showed");
	}, 30_000);

	test("typing a message enables Commit, Enter is a new line, and Ctrl+Enter commits", async () => {
		expect(await page.evaluate<boolean>(`${BUTTON}.disabled`)).toBe(true);
		await page.evaluate(`${BOX}.focus()`);
		await page.type("Add the rules");
		await page.press("Enter");
		await page.type("Second line");
		expect(await page.evaluate<string>(`${BOX}.value`)).toBe("Add the rules\nSecond line");
		expect(await page.evaluate<boolean>(`${BUTTON}.disabled`)).toBe(false);
		await page.press("Enter", "ctrl");
		await page.until(`document.querySelector(".commit-done")?.textContent.startsWith("Committed ") === true`, "the commit showed");
		expect(await page.evaluate<{ message: string }[]>(`${ENGINE}.commits()`)).toMatchObject([{ message: "Add the rules\nSecond line" }]);
		expect(await page.evaluate<string>(`${BOX}.value`)).toBe("");
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-group[aria-label=Staged] .change-file").length`)).toBe(0);
		// Push opens the row's Push dialog, which shows timber publish before anything runs.
		await page.click(".commit-done .text-button");
		await page.until(`document.querySelector("dialog[open]")?.textContent.includes("timber publish") === true`, "the Push dialog showed its command");
		expect(await page.evaluate<number>(`${ENGINE}.commits().length`)).toBe(1);
	}, 30_000);

	test("a failing hook's output shows, and the message stays to try again", async () => {
		await page.evaluate(`${ENGINE}.failCommits("pre-commit: lint failed\\nsrc/rules.ts:1 unused variable")`);
		await page.evaluate(`${BOX}.focus()`);
		await page.type("Add the rules");
		await page.click(".commit-button");
		await page.until(`document.querySelector(".commit-box [role=alert]")?.textContent.includes("unused variable") === true`, "the hook's output showed");
		expect(await page.evaluate<string>(`${BOX}.value`)).toBe("Add the rules");
		expect(await page.evaluate<string>(`document.querySelector(".commit-output").textContent`)).toBe("pre-commit: lint failed\nsrc/rules.ts:1 unused variable");
		expect(await page.evaluate<number>(`${ENGINE}.commits().length`)).toBe(0);
	}, 30_000);

	test("Base's Commit… switches to Uncommitted with the box focused", async () => {
		await page.evaluate(`${STORE}.compareChanges("base")`);
		await page.until(`${STORE}.getState().changes?.compared === "base" && document.querySelector(".commit-from-base button") !== null`, "Base showed Commit…");
		expect(await page.evaluate<boolean>(`${BOX} === null`)).toBe(true);
		await page.click(".commit-from-base button");
		await page.until(`document.activeElement === ${BOX}`, "the message box took the keyboard");
		expect(await page.evaluate<string>(`${STORE}.getState().changes.compared`)).toBe("uncommitted");
	}, 30_000);
});
