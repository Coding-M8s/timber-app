import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MOCK_NOTES_FOLDER } from "../src/mainview/engine/mock-worktree-files";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * A complete path to a file outside the worktree, printed in a terminal and
 * clicked, in a real browser over the mock engine: it opens in the File tab,
 * read-only, from the mock's pretend folder outside every worktree.
 */

const STORE = "window.timberTestStore";
const PATH = `${MOCK_NOTES_FOLDER}/run.log`;

/** Open a session in the selected worktree and show it. */
const OPEN_SESSION = `(async () => {
	const store = ${STORE};
	const { repository, worktree } = store.getState().selection;
	const path = store.getState().repositories.find(candidate => candidate.path === repository).worktrees.find(candidate => candidate.id === worktree).path;
	const session = await store.openTerminal({ repository, worktree: path, cols: 80, rows: 24 });
	return session?.id ?? store.getState().terminals.at(-1).id;
})()`;

describe.skipIf(browserPath === null || process.platform === "win32")("a full path outside the worktree, clicked in a terminal", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	test("opens the file in the File tab, read-only, with its full path above it", async () => {
		await page.until(`${STORE}.getState().selection !== null`, "a worktree was selected");
		const session = await page.evaluate<string>(OPEN_SESSION);
		await page.until(`document.querySelector(".terminal-screen .xterm") !== null`, "the session's terminal showed");
		// The pretend shell clears the screen, then echoes the path after its prompt on the first row.
		await page.evaluate(`${STORE}.writeTerminal(${JSON.stringify(session)}, "clear\\r")`);
		await page.evaluate(`${STORE}.writeTerminal(${JSON.stringify(session)}, ${JSON.stringify(PATH)})`);

		// Sweep the first row until the pointer is over the link, as a person moving the mouse would, until the echo has drawn.
		const screen = await page.middle(".terminal-screen .xterm-screen");
		const left = await page.evaluate<number>(`document.querySelector(".terminal-screen .xterm-screen").getBoundingClientRect().left`);
		const y = screen.top + 6;
		let over: { x: number; y: number } | null = null;
		for (const deadline = Date.now() + 10_000; over === null && Date.now() < deadline;) {
			for (let x = left + 2; x < left + 900 && over === null; x += 6) {
				await page.pointAt({ x, y });
				if (await page.evaluate<boolean>(`document.querySelector(".terminal-screen .xterm-cursor-pointer") !== null`)) over = { x, y };
			}
		}
		expect(over).not.toBeNull();
		await page.clickAt(over!);

		await page.until(`${STORE}.getState().tab === "file"`, "the File tab showed");
		const view = await page.evaluate<{ path: string; outside: boolean; outcome: string }>(`(() => {
			const state = ${STORE}.getState();
			const view = state.files[state.selection.worktree];
			return { path: view.path, outside: view.outside, outcome: view.result?.outcome };
		})()`);
		expect(view).toEqual({ path: PATH, outside: true, outcome: "read" });
		await page.until(`document.querySelector(".file-edit-refusal") !== null`, "the read-only note showed");
		expect(await page.evaluate<string>(`document.querySelector(".file-viewer .diff-path").textContent`)).toBe(PATH);
		expect(await page.evaluate<string>(`document.querySelector(".file-edit-refusal").textContent`)).toBe("Read-only here. It is outside this worktree. Open it in your own editor to change it.");
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".file-viewer button")].some(button => button.textContent === "Save")`)).toBe(false);
		// Typing into it changes nothing and starts no draft.
		await page.click(".file-viewer .cm-content");
		await page.type("typed here");
		await Bun.sleep(100);
		expect(await page.evaluate<string>(`document.querySelector(".file-viewer .cm-content").textContent`)).not.toContain("typed here");
		expect(await page.evaluate<string | null>(`(() => { const state = ${STORE}.getState(); return state.files[state.selection.worktree].draft; })()`)).toBeNull();
	}, 60_000);
});
