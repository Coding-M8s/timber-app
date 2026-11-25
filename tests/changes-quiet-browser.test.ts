import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The Changes list in a real browser while the file watch reports changes
 * again and again, as it does while an agent writes: the list is never dimmed
 * and no spinner shows, a file the agent adds still shows, and the keyboard
 * stays where it was. The person's own Refresh still dims and shows the
 * spinner. The words and the store are tested without a window in
 * ./changes-tab.test.tsx. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";

const FILES = ["a", "b", "c"].map(name => ({
	change: { area: "unstaged", kind: "modified", path: `src/${name}.ts`, previousPath: null, added: null, removed: null, version: "" },
	patch: `diff --git a/src/${name}.ts b/src/${name}.ts\n--- a/src/${name}.ts\n+++ b/src/${name}.ts\n@@ -1 +1 @@\n-a\n+b\n`,
}));

/** Sees, from now on, whether a dimmed list or a spinner ever drew, and the lowest opacity the list had. */
const WATCH = `(() => {
	const seen = { dimmed: false, spinner: false, lowest: 1 };
	window.__seen = seen;
	const look = () => {
		if (document.querySelector(".change-groups.refreshing, .changes-clean.refreshing")) seen.dimmed = true;
		if (document.querySelector(".changes-spinner")) seen.spinner = true;
		const list = document.querySelector(".change-groups, .changes-clean");
		if (list) seen.lowest = Math.min(seen.lowest, Number(getComputedStyle(list).opacity));
	};
	new MutationObserver(look).observe(document.body, { subtree: true, childList: true, attributes: true });
	const frame = () => { look(); requestAnimationFrame(frame); };
	frame();
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the Changes list while the file watch reports changes", () => {
	let page: BrowserPage;
	let repositoryPath = "";

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.evaluate(`${ENGINE}.announceChangesEvery("x", null)`).catch(() => {});
		await page?.close();
	});

	beforeEach(async () => {
		await page.resize(1400, 900);
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
		repositoryPath = await page.evaluate<string>(`(async () => {
			const repository = ${STORE}.getState().repositories[0];
			const feature = repository.worktrees[1];
			${ENGINE}.setFileChanges(feature.path, ${JSON.stringify(FILES)});
			${STORE}.select(feature.id);
			${STORE}.showSidePanel("changes");
			await ${STORE}.readChanges(repository.path, feature.id);
			await ${STORE}.compareChanges("uncommitted");
			return repository.path;
		})()`);
		await page.until(`document.querySelectorAll(".change-file").length === 3`, "the files showed");
		// The reads of getting here are the person's, and show their spinner: let them end before watching.
		await page.until(`${STORE}.getState().operations.length === 0 && !document.querySelector(".changes-spinner")`, "the first reads ended");
	}, 30_000);

	test("an agent adding a file every 300 ms never dims the list or shows the spinner, and the new files show", async () => {
		await page.evaluate(`${WATCH}`);
		await page.evaluate(`document.querySelector(".change-file").focus()`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, 300, true)`);
		await page.until(`document.querySelectorAll(".change-file").length >= 8`, "the files the agent added showed");
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, null)`);
		const seen = await page.evaluate<{ dimmed: boolean; spinner: boolean; lowest: number }>(`window.__seen`);
		expect(seen).toEqual({ dimmed: false, spinner: false, lowest: 1 });
		expect(await page.evaluate<boolean>(`getComputedStyle(document.querySelector(".change-groups")).opacity === "1"`)).toBe(true);
		// The keyboard stays on the file it was on, and Refresh stays ready.
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("aria-label")`)).toStartWith("src/a.ts");
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".changes-bar .text-button")].find(button => button.textContent === "Refresh").disabled`)).toBe(false);
	}, 30_000);

	test("changes reported with the same result keep an open dialog and the list", async () => {
		await page.evaluate(`${WATCH}`);
		await page.evaluate(`document.querySelectorAll(".change-file")[1].focus()`);
		await page.evaluate(`${STORE}.openDialog({ kind: "set-base", repository: ${STORE}.getState().selection.repository, worktree: ${STORE}.getState().selection.worktree })`);
		await page.until(`document.querySelector("dialog[open]") !== null`, "the dialog opened");
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, 200)`);
		await page.evaluate(`new Promise(done => setTimeout(done, 1500))`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, null)`);
		expect(await page.evaluate<boolean>(`document.querySelector("dialog[open]") !== null`)).toBe(true);
		expect(await page.evaluate<{ dimmed: boolean; spinner: boolean }>(`window.__seen`)).toMatchObject({ dimmed: false, spinner: false });
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-file").length`)).toBe(3);
	}, 30_000);

	test("the person's own Refresh still dims the list and shows the spinner", async () => {
		await page.evaluate(`${WATCH}`);
		await page.evaluate(`[...document.querySelectorAll(".changes-bar .text-button")].find(button => button.textContent === "Refresh").click()`);
		await page.until(`window.__seen.dimmed && window.__seen.spinner`, "the list dimmed and the spinner showed");
	}, 30_000);

	test("a long list keeps its scroll position and the focused file through reported changes", async () => {
		const many = Array.from({ length: 80 }, (_, index) => ({
			change: { area: "unstaged", kind: "modified", path: `src/file-${String(index).padStart(2, "0")}.ts`, previousPath: null, added: null, removed: null, version: "" },
			patch: "diff --git a/x b/x\n--- a/x\n+++ b/x\n@@ -1 +1 @@\n-a\n+b\n",
		}));
		await page.evaluate(`(async () => {
			const selection = ${STORE}.getState().selection;
			const feature = ${STORE}.getState().repositories[0].worktrees.find(candidate => candidate.id === selection.worktree);
			${ENGINE}.setFileChanges(feature.path, ${JSON.stringify(many)});
			await ${STORE}.readChanges(selection.repository, selection.worktree);
		})()`);
		await page.until(`document.querySelectorAll(".change-file").length === 80`, "the long list showed");
		await page.until(`${STORE}.getState().operations.length === 0 && !document.querySelector(".changes-spinner")`, "the reads ended");
		const scroller = `(() => { for (let node = document.querySelector(".change-file"); node; node = node.parentElement) if (node.scrollHeight > node.clientHeight + 50 && getComputedStyle(node).overflowY !== "visible") return node; return null; })()`;
		expect(await page.evaluate<boolean>(`${scroller} !== null`)).toBe(true);
		await page.evaluate(`document.querySelectorAll(".change-file")[40].focus()`);
		const before = await page.evaluate<number>(`(() => { const node = ${scroller}; node.scrollTop = 400; return node.scrollTop; })()`);
		expect(before).toBeGreaterThan(0);
		await page.evaluate(`${WATCH}`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, 200)`);
		await page.evaluate(`new Promise(done => setTimeout(done, 1500))`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, null)`);
		expect(await page.evaluate<number>(`${scroller}.scrollTop`)).toBe(before);
		expect(await page.evaluate<string>(`document.activeElement.getAttribute("aria-label")`)).toStartWith("src/file-40.ts");
		expect(await page.evaluate<{ dimmed: boolean; spinner: boolean }>(`window.__seen`)).toMatchObject({ dimmed: false, spinner: false });
	}, 30_000);

	test("for 30 seconds of an agent writing a file every second, the list never dims and no spinner shows", async () => {
		await page.evaluate(`${WATCH}`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, 1000, true)`);
		await page.evaluate(`new Promise(done => setTimeout(done, 30_000))`);
		await page.evaluate(`${ENGINE}.announceChangesEvery(${JSON.stringify(repositoryPath)}, null)`);
		expect(await page.evaluate<{ dimmed: boolean; spinner: boolean; lowest: number }>(`window.__seen`)).toEqual({ dimmed: false, spinner: false, lowest: 1 });
		// A file the agent added shows within a few seconds: about thirty were added.
		expect(await page.evaluate<number>(`document.querySelectorAll(".change-file").length`)).toBeGreaterThanOrEqual(30);
	}, 60_000);
});
