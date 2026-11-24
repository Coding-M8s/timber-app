import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Having an agent write, in a real browser over the mock engine: Generate
 * fills the commit box, Stop, the one-click dialog's focus, its editable text
 * and command, Cancel, a refusal that stays, and Publish. The words and the
 * store are tested without a window in ./generate-store.test.tsx, and the
 * agent's run in ./generate-text.test.ts. Skipped where no browser is
 * installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const FILES = [{ change: { area: "staged", kind: "modified", path: "src/rules.ts", previousPath: null }, patch: "diff --git a/src/rules.ts b/src/rules.ts\n--- a/src/rules.ts\n+++ b/src/rules.ts\n@@ -1 +1 @@\n-a\n+b\n" }];
const BOX = `document.querySelector(".commit-message")`;
const DIALOG = `document.querySelector("dialog[open]")`;
const SPIKE = "/work/timber-worktrees/spike-new-idea";
const form = `Object.values(${STORE}.getState().pullRequestForms).find(candidate => candidate.worktree === ${JSON.stringify(SPIKE)})`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("an agent that writes, in a real browser", () => {
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
			const spike = repository.worktrees.find(candidate => candidate.path === ${JSON.stringify(SPIKE)});
			${ENGINE}.setGenerateDelay(50);
			${ENGINE}.setFileChanges(spike.path, ${JSON.stringify(FILES)});
			${STORE}.select(spike.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, spike.id);
			await ${STORE}.compareChanges("uncommitted");
			await ${STORE}.locateAgents();
		})()`);
		await page.until(`document.querySelector('.commit-box .generate-in-box[aria-disabled="false"]') !== null`, "Generate may be pressed");
	}, 30_000);

	test("Generate sits inside the box and fills it; Stop takes its place and leaves the box", async () => {
		const inside = await page.evaluate<boolean>(`(() => {
			const box = ${BOX}.getBoundingClientRect();
			const button = document.querySelector(".commit-box .generate-in-box").getBoundingClientRect();
			return button.left > box.left && button.right <= box.right && button.top > box.top && button.bottom <= box.bottom;
		})()`);
		expect(inside).toBe(true);
		// The button at the top is above the box and inside the panel.
		expect(await page.evaluate<boolean>(`document.querySelector(".commit-create-pull").getBoundingClientRect().bottom <= ${BOX}.getBoundingClientRect().top`)).toBe(true);
		await page.click(".commit-box .generate-in-box");
		await page.until(`${BOX}.value.startsWith("Round totals after tax")`, "the text was filled in");
		expect(await page.evaluate<number>(`${ENGINE}.commits().length`)).toBe(0);
		await page.evaluate(`(${ENGINE}.setGenerateDelay(60000), ${STORE}.setCommitMessage(${STORE}.getState().changes.worktree, ""))`);
		await page.click(".commit-box .generate-in-box");
		await page.until(`document.querySelector(".commit-box .generate-in-box").textContent === "Stop"`, "Stop showed");
		await page.click(".commit-box .generate-in-box");
		await page.until(`document.querySelector(".commit-box .generate-in-box").textContent === "Generate"`, "it stopped");
		expect(await page.evaluate<string>(`${BOX}.value`)).toBe("");
	}, 30_000);

	test("one click writes, shows the text and its command, and Cancel changes nothing", async () => {
		await page.evaluate(`${ENGINE}.setGeneratedText("pull-request", "Round totals\\n\\nSee https://example.com/x, thanks @octocat")`);
		await page.click(".commit-create-pull");
		await page.until(`${DIALOG}?.querySelector("[name=title]")?.value.endsWith("Round totals") === true`, "the text showed");
		const text = await page.evaluate<string>(`${DIALOG}.textContent`);
		expect(text).toContain("Nothing has been published.");
		expect(text).toContain("1 uncommitted file is not in this pull request.");
		expect(text).toContain("It has a link: https://example.com/x");
		expect(text).toContain("It mentions @octocat");
		expect(await page.evaluate<string>(`${DIALOG}.querySelector(".dialog-command").textContent`)).toContain("timber pr --title 'Round totals'");
		await page.evaluate(`(() => { const body = ${DIALOG}.querySelector("[name=body]"); body.focus(); body.select(); })()`);
		await page.type("Mine");
		await page.until(`${DIALOG}.querySelector(".dialog-command").textContent.includes("--body Mine")`, "the command followed");
		const before = await page.evaluate<string>(`${form}.body`);
		await page.press("Escape");
		await page.until(`${DIALOG} === null`, "the dialog closed");
		expect(await page.evaluate<string>(`${form}.body`)).toBe(before);
	}, 30_000);

	test("Cancel while it writes stops the agent", async () => {
		await page.evaluate(`${ENGINE}.setGenerateDelay(60000)`);
		await page.click(".commit-create-pull");
		await page.until(`${ENGINE}.generateRequests().length === 1`, "the agent started");
		const id = await page.evaluate<string>(`${ENGINE}.generateRequests()[0].id`);
		await page.press("Escape");
		await page.until(`${DIALOG} === null`, "the dialog closed");
		expect(await page.evaluate<boolean>(`${ENGINE}.stopGenerating(${JSON.stringify(id)})`)).toBe(false);
	}, 30_000);

	test("a failure of the agent stays in the dialog and nothing can be published", async () => {
		await page.evaluate(`${ENGINE}.failGenerate("Not logged in")`);
		await page.click(".commit-create-pull");
		await page.until(`${DIALOG}?.textContent.includes("Not logged in") === true`, "the failure showed");
		expect(await page.evaluate<boolean>(`${DIALOG}.querySelector(".button.primary").disabled`)).toBe(true);
	}, 30_000);

	test("a refusal by Timber stays in the dialog with the text", async () => {
		await page.evaluate(`${ENGINE}.endPullRequestResults("refused")`);
		await page.evaluate(`${STORE}.showTab("pull-request")`);
		await page.until(`${form} !== undefined`, "the form started");
		await page.evaluate(`${STORE}.editPullRequestForm(${STORE}.getState().changes.worktree, { title: "Typed", body: "Typed body" })`);
		await page.click(".commit-create-pull");
		await page.until(`${DIALOG}?.querySelector("[name=title]") != null`, "the text showed");
		await page.evaluate(`${DIALOG}.querySelector(".button.primary").click()`);
		await page.until(`${DIALOG}?.textContent.includes("Timber did not open the pull request") === true`, "the refusal showed");
		expect(await page.evaluate<boolean>(`${DIALOG}.querySelector("[name=title]").value.includes("Round totals")`)).toBe(true);
		// Cancel then leaves what was typed in the form.
		await page.press("Escape");
		await page.until(`${DIALOG} === null`, "the dialog closed");
		expect(await page.evaluate<string[]>(`[${form}.title, ${form}.body]`)).toEqual(["Typed", "Typed body"]);
	}, 30_000);

	test("Publish and open runs timber pr once with the text as shown, then closes", async () => {
		await page.click(".commit-create-pull");
		await page.until(`${DIALOG}?.querySelector("[name=title]") != null`, "the text showed");
		await page.evaluate(`(() => { const title = ${DIALOG}.querySelector("[name=title]"); title.focus(); title.select(); })()`);
		await page.type("My title");
		await page.evaluate(`${DIALOG}.querySelector(".button.primary").click()`);
		await page.until(`${DIALOG} === null`, "the dialog closed");
		expect(await page.evaluate<string>(`${STORE}.getState().tab`)).toBe("pull-request");
		expect(await page.evaluate<string>(`${STORE}.getState().toasts.map(toast => toast.text).join()`)).toMatch(/Pull request #\d+ opened/);
	}, 30_000);

	test("Settings saves the picked agent, follows a rename, and clears it with its row", async () => {
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "agents" })`);
		const choose = `document.querySelector(".agent-generate select")`;
		await page.until(`${choose} !== null`, "the choice showed");
		const pick = (index: number) => page.evaluate(`(() => { const select = ${choose}; select.selectedIndex = ${index}; select.dispatchEvent(new Event("change", { bubbles: true })); })()`);
		const save = () => page.evaluate(`document.querySelector(".agent-generate").closest(".settings-section").querySelector(".settings-section-foot button[type=submit], .settings-section-foot .button.primary").click()`);
		await pick(2);
		await save();
		await page.until(`${STORE}.getState().preferences.generateWith === "Codex"`, "the pick was saved");
		await page.evaluate(`(() => { const name = document.querySelectorAll(".agent-name input")[1]; name.focus(); name.select(); })()`);
		await page.type("My Codex");
		await save();
		await page.until(`${STORE}.getState().preferences.generateWith === "My Codex"`, "the pick followed the rename");
		await page.evaluate(`document.querySelectorAll(".agent-remove")[1].click()`);
		await save();
		await page.until(`${STORE}.getState().preferences.generateWith === ""`, "the pick was cleared");
	}, 30_000);
});
