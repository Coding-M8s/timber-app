import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Stage and Unstage in the Changes view in a real browser, over the mock
 * engine: the buttons show on hover and keyboard focus, Space on a file does
 * the same, and the keyboard stays on the file in its new group. The words
 * and the store are tested without a window in ./stage-files.test.tsx, and
 * Git itself in ./index-writes.test.ts. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";

const FILES = [
	{ change: { area: "conflicted", kind: "conflicted", path: "src/rates.ts", previousPath: null }, patch: "" },
	{ change: { area: "staged", kind: "modified", path: "src/rules.ts", previousPath: null }, patch: "diff --git a/src/rules.ts b/src/rules.ts\n--- a/src/rules.ts\n+++ b/src/rules.ts\n@@ -1 +1 @@\n-a\n+b\n" },
	{ change: { area: "unstaged", kind: "modified", path: "src/total.ts", previousPath: null }, patch: "diff --git a/src/total.ts b/src/total.ts\n--- a/src/total.ts\n+++ b/src/total.ts\n@@ -1 +1 @@\n-a\n+b\n" },
	{ change: { area: "unstaged", kind: "modified", path: "src/lines.ts", previousPath: null }, patch: "diff --git a/src/lines.ts b/src/lines.ts\n--- a/src/lines.ts\n+++ b/src/lines.ts\n@@ -1 +1 @@\n-a\n+b\n" },
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
const ACTION_SHOWN = (path: string) => `getComputedStyle(${ROW(path)}.querySelector(".change-file-action")).visibility === "visible"`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("staging and unstaging in a real browser", () => {
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
		await page.until(`document.querySelectorAll(".change-file").length === 5`, "the files were listed");
	}, 30_000);

	test("a file's button shows on hover and keyboard focus only, and its tooltip is the command", async () => {
		expect(await page.evaluate<boolean>(ACTION_SHOWN("src/total.ts"))).toBe(false);
		await page.hover(`.change-row:nth-of-type(1) .change-file`);
		await page.until(`[...document.querySelectorAll(".change-file-action")].filter(button => getComputedStyle(button).visibility === "visible").length === 1`, "one button showed on hover");
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file").focus()`);
		await page.until(ACTION_SHOWN("src/total.ts"), "the focused file's button showed");
		expect(await page.evaluate<string>(`${ROW("src/total.ts")}.querySelector(".change-file-action").title`)).toBe("Runs git add -- src/total.ts");
		expect(await page.evaluate<string>(`${ROW("src/rates.ts")}.querySelector(".change-file-action").textContent`)).toBe("Mark resolved");
		// The button stays inside its row, and the row does not scroll sideways.
		const fits = await page.evaluate<boolean>(`(() => {
			const row = ${ROW("src/total.ts")}.getBoundingClientRect();
			const button = ${ROW("src/total.ts")}.querySelector(".change-file-action").getBoundingClientRect();
			return button.left >= row.left && button.right <= row.right && button.top >= row.top - 1 && button.bottom <= row.bottom + 1;
		})()`);
		expect(fits).toBe(true);
	}, 30_000);

	test("Space stages the focused file and Space again unstages it, the keyboard staying on it in its new group", async () => {
		await page.evaluate(`${ROW("src/total.ts")}.querySelector(".change-file").focus()`);
		await page.press(" ");
		await page.until(`${FOCUSED} === "Staged src/total.ts"`, "the keyboard followed the file into Staged");
		// Space did not open the diff, as Enter does.
		expect(await page.evaluate<string>(`${STORE}.getState().tab`)).not.toBe("diff");
		await page.press(" ");
		await page.until(`${FOCUSED} === "Unstaged src/total.ts"`, "the keyboard followed the file back into Unstaged");
		// The arrows go on from where it is now.
		await page.press("ArrowUp");
		expect(await page.evaluate<string | null>(FOCUSED)).toBe("Unstaged src/lines.ts");
	}, 30_000);

	test("Mark resolved by Tab and Enter moves the file out of Merge conflicts, with the keyboard on it", async () => {
		await page.evaluate(`${ROW("src/rates.ts")}.querySelector(".change-file").focus()`);
		await page.press("Tab");
		expect(await page.evaluate<string>(`document.activeElement.textContent`)).toBe("Mark resolved");
		await page.press("Enter");
		await page.until(`${FOCUSED} === "Staged src/rates.ts"`, "the keyboard followed the file into Staged");
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".change-group")].some(group => group.getAttribute("aria-label") === "Merge conflicts")`)).toBe(false);
	}, 30_000);

	test("a group's Stage all stages what it shows, and a failure shows Git's message and moves nothing", async () => {
		await page.evaluate(`${ENGINE}.failIndexWrites("fatal: Unable to create '/work/.git/index.lock': File exists.")`);
		await page.evaluate(`[...document.querySelectorAll(".change-group-action")].find(button => button.getAttribute("aria-label").startsWith("Stage all: 2 files in Unstaged")).click()`);
		await page.until(`document.querySelector(".changes-files [role=alert]")?.textContent.includes("index.lock': File exists.") === true`, "the failure showed");
		expect(await page.evaluate<string>(`document.querySelector(".changes-files [role=alert]").textContent`)).toContain("Could not stage");
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-group[aria-label=Unstaged] .change-file").length`)).toBe(2);
		await page.evaluate(`${ENGINE}.failIndexWrites(null)`);
		await page.evaluate(`[...document.querySelectorAll(".change-group-action")].find(button => button.getAttribute("aria-label").startsWith("Stage all: 2 files in Unstaged")).click()`);
		await page.until(`document.querySelectorAll(".change-group[aria-label=Staged] .change-file").length === 3`, "both files were staged");
		expect(await page.evaluate<boolean>(`document.querySelector(".changes-files [role=alert]") === null`)).toBe(true);
	}, 30_000);

	test("Base shows no write buttons", async () => {
		await page.evaluate(`${STORE}.compareChanges("base")`);
		await page.until(`${STORE}.getState().changes?.compared === "base" && document.querySelectorAll(".change-file").length > 0`, "Base was listed");
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-file-action, .change-group-action").length`)).toBe(0);
	}, 30_000);
});
