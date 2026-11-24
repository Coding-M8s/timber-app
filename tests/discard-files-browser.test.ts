import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Discard in the Changes view in a real browser, over the mock engine: the
 * dialog lists the files and the command with the keyboard on Cancel,
 * Escape and Cancel change nothing, Delete on a file asks as its Discard
 * does, and after a discard the keyboard is on the file that took its
 * place. The words and the store are tested in ./discard-files-view.test.tsx,
 * and Git itself in ./discard-files.test.ts. Skipped where no browser is
 * installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";

const patch = (path: string) => `diff --git a/${path} b/${path}\n--- a/${path}\n+++ b/${path}\n@@ -1 +1 @@\n-a\n+b\n`;
const FILES = [
	{ change: { area: "conflicted", kind: "conflicted", path: "src/rates.ts", previousPath: null }, patch: "" },
	{ change: { area: "staged", kind: "modified", path: "src/rules.ts", previousPath: null }, patch: patch("src/rules.ts") },
	{ change: { area: "unstaged", kind: "modified", path: "src/total.ts", previousPath: null }, patch: patch("src/total.ts") },
	{ change: { area: "unstaged", kind: "modified", path: "src/lines.ts", previousPath: null }, patch: patch("src/lines.ts") },
	{ change: { area: "untracked", kind: "untracked", path: "notes/todo.md", previousPath: null }, patch: "diff --git a/notes/todo.md b/notes/todo.md\nnew file mode 100644\n--- /dev/null\n+++ b/notes/todo.md\n@@ -0,0 +1 @@\n+todo\n" },
];

/** The file row the keyboard is on, as `area path`, from the list's own label. */
const FOCUSED = `(() => {
	const row = document.activeElement?.closest(".change-row");
	const button = row?.querySelector(".change-file");
	if (!button) return null;
	return button.closest(".change-group").getAttribute("aria-label") + " " + button.title;
})()`;
const ROW = (path: string) => `[...document.querySelectorAll(".change-row")].find(row => row.querySelector(".change-file").title === ${JSON.stringify(path)})`;
const DIALOG_OPEN = `document.querySelector("dialog[open]") !== null`;
const COUNT = `document.querySelectorAll(".change-file").length`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("discarding in a real browser", () => {
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
		await page.until(`${COUNT} === 5`, "the files were listed");
	}, 30_000);

	test("a row's Discard opens the dialog with the file and command, the keyboard on Cancel, and Escape changes nothing", async () => {
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file").focus()`);
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file-action.discard").click()`);
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Discard changes to src/total.ts?");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .discard-files").textContent`)).toBe("src/total.ts");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-command").textContent`)).toBe("git restore --worktree -- src/total.ts");
		await page.until(`document.activeElement?.textContent === "Cancel"`, "the keyboard is on Cancel");
		// Enter on Cancel would close it too; Escape is the other way out.
		await page.press("Escape");
		await page.until(`!(${DIALOG_OPEN})`, "Escape closed the dialog");
		expect(await page.evaluate<number>(COUNT)).toBe(5);
		expect(await page.evaluate<unknown[]>(`${ENGINE}.indexWrites()`)).toEqual([]);
	}, 30_000);

	test("Delete on a file asks, Discard deletes it, and the keyboard goes to the file that took its place", async () => {
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file").focus()`);
		await page.press("Delete");
		await page.until(DIALOG_OPEN, "Delete opened the dialog");
		await page.evaluate(`[...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Discard").click()`);
		await page.until(`!(${DIALOG_OPEN}) && ${COUNT} === 4`, "the file was discarded and the dialog closed");
		await page.until(`${FOCUSED} === "Unstaged src/lines.ts"`, "the keyboard went to the next file");
		expect(await page.evaluate<{ command: string }[]>(`${ENGINE}.indexWrites()`)).toEqual([expect.objectContaining({ command: "git restore --worktree -- src/total.ts" })]);
	}, 30_000);

	test("an untracked file says Delete, and a failure stays in the dialog with Git's message", async () => {
		await page.evaluate(`${ENGINE}.failIndexWrites("fatal: Unable to create '/work/.git/index.lock': File exists.")`);
		await page.evaluate(`${ROW("notes/todo.md")}.querySelector(".change-file-action.discard").click()`);
		await page.until(DIALOG_OPEN, "the dialog opened");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] .dialog-title").textContent`)).toBe("Delete notes/todo.md?");
		await page.evaluate(`[...document.querySelectorAll("dialog[open] button")].find(button => button.textContent === "Delete").click()`);
		await page.until(`document.querySelector("dialog[open] [role=alert]")?.textContent.includes("index.lock': File exists.") === true`, "the failure showed in the dialog");
		expect(await page.evaluate<string>(`document.querySelector("dialog[open] [role=alert]").textContent`)).toContain("Could not delete");
		expect(await page.evaluate<number>(COUNT)).toBe(5);
		await page.press("Escape");
		await page.until(`!(${DIALOG_OPEN})`, "Escape closed the dialog");
	}, 30_000);

	test("a conflicted file has no Discard, and the row's two buttons fit inside it", async () => {
		expect(await page.evaluate<boolean>(`${ROW("src/rates.ts")}.querySelector(".change-file-action.discard") === null`)).toBe(true);
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file").focus()`);
		const fits = await page.evaluate<boolean>(`(() => {
			const row = ${ROW("src/total.ts")}.getBoundingClientRect();
			return [...${ROW("src/total.ts")}.querySelectorAll(".change-file-action")].every(button => {
				const box = button.getBoundingClientRect();
				return getComputedStyle(button).visibility === "visible" && box.left >= row.left && box.right <= row.right && box.top >= row.top - 1 && box.bottom <= row.bottom + 1;
			});
		})()`);
		expect(fits).toBe(true);
	}, 30_000);
});
