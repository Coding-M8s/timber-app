import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Whether each agent is signed in (issue 347), in a real browser over the
 * mock engine: opening Settings, Agents, the New worktree dialog, and the
 * Start work dialog asks, and each shows the answer. The words and the rules
 * are tested without a window in ./agent-sign-in.test.tsx. Skipped where no
 * browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const ISSUE = { tracker: "jira", key: "TIM-91", url: "https://example.atlassian.net/browse/TIM-91", title: "Show the linked issue", status: { name: "To Do", category: "open" }, assignee: null, worktree: null, pullRequests: [], assignedToMe: false };
const OPTION = `[...document.querySelectorAll("dialog[open] select[name=agent] option")].some(option => option.textContent === "Codex (signed out)")`;
const PICKED = `document.querySelector("dialog[open] select[name=agent]").value`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("whether each agent is signed in, in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);
	afterAll(async () => {
		await page?.close();
	});
	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		await page.evaluate(`${ENGINE}.setSignIn("codex", { state: "signed-out" })`);
		expect(await page.evaluate<number>(`${ENGINE}.signInRequests()`)).toBe(0);
	}, 30_000);

	test("Settings, Agents asks as it opens and says each state, also in a narrow window", async () => {
		await page.resize(480, 820);
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "agents" })`);
		await page.until(`document.querySelectorAll(".agent-sign-in").length === 2`, "both rows say it");
		expect(await page.evaluate<string[]>(`[...document.querySelectorAll(".agent-sign-in")].map(line => line.textContent)`)).toEqual(["Sign-in Signed in, says claude auth status --json.", "Sign-in: Signed out, says codex login status."]);
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".agent-sign-in")].every(line => line.scrollWidth <= line.clientWidth)`)).toBe(true);
	});

	test("the New worktree dialog asks as it opens, marks the agent, and keeps its pick; one opened again at once does not ask again", async () => {
		const open = async () => {
			await page.evaluate(`${STORE}.openDialog({ kind: "new-worktree", repository: ${STORE}.getState().repositories[0].path })`);
			await page.until(OPTION, "Codex is marked");
		};
		await open();
		expect(await page.evaluate<string>(PICKED)).toBe("Claude Code");
		const asked = await page.evaluate<number>(`${ENGINE}.signInRequests()`);
		expect(asked).toBe(1);
		await page.evaluate(`${STORE}.closeDialog()`);
		await open();
		expect(await page.evaluate<number>(`${ENGINE}.signInRequests()`)).toBe(asked);
	});

	test("the Start work dialog asks as it opens and marks the agent", async () => {
		await page.evaluate(`${STORE}.openDialog({ kind: "start-work", repository: ${STORE}.getState().repositories[0].path, issue: ${JSON.stringify(ISSUE)} })`);
		await page.until(OPTION, "Codex is marked");
		expect(await page.evaluate<number>(`${ENGINE}.signInRequests()`)).toBe(1);
	});
});
