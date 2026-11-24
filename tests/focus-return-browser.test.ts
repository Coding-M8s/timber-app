import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Where the keyboard goes after a switch from the command palette, and when
 * the window gets the focus back (issue 392), in a real browser over the
 * mock engine. A headless browser cannot lose the window's focus to another
 * app, so the window's own blur and focus events are fired in the page; the
 * desktop webview's real events are checked by hand (docs/verification.md).
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";

/** Open a session in the worktree at `index` of the first repository, and answer its id once its terminal shows. */
const openSession = (index: number) => `(async () => {
	const store = ${STORE};
	const worktree = store.getState().repositories[0].worktrees[${index}];
	store.select(worktree.id);
	store.showTab("workspace");
	const session = await store.openTerminal({ repository: store.getState().repositories[0].path, worktree: worktree.path, cols: 80, rows: 24 });
	return session?.id ?? store.getState().terminals.at(-1).id;
})()`;

/** The id of the session whose terminal has the keyboard, or null. */
const IN_TERMINAL = `document.activeElement?.closest(".terminal-screen")?.getAttribute("data-drop-session") ?? null`;
const shown = (id: string) => `document.querySelector('.terminal-screen[data-drop-session="${id}"] .xterm') !== null`;
/** The window loses the focus to another app, and the webview leaves the keyboard on the page, then the window gets it back. */
const LEAVE = `window.dispatchEvent(new Event("blur"))`;
const COME_BACK = `window.dispatchEvent(new Event("focus"))`;

describe.skipIf(browserPath === null || process.platform === "win32")("the keyboard after a switch or a return to the window, in a real browser", () => {
	let page: BrowserPage;
	let first = "";
	let second = "";

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`${STORE}.getState().repositories.length > 0 && ${STORE}.getState().selection !== null`, "a worktree was selected");
		second = await page.evaluate<string>(openSession(1));
		await page.until(shown(second), "the second session showed");
		first = await page.evaluate<string>(openSession(0));
		await page.until(shown(first), "the first session showed");
	}, 30_000);

	const branchOf = (index: number) => page.evaluate<string>(`${STORE}.getState().repositories[0].worktrees[${index}].branch`);
	const choose = async (index: number) => {
		await page.press("P", "ctrlShift");
		await page.until(`document.activeElement?.classList.contains("palette-input") === true`, "the palette opened");
		await page.type(await branchOf(index));
		await page.press("Enter");
		await page.until(`document.querySelector("dialog[open]") === null`, "the palette closed");
	};

	test("choosing another worktree in the palette puts the keyboard in its shown terminal", async () => {
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		await choose(1);
		await page.until(`${IN_TERMINAL} === ${JSON.stringify(second)}`, "the chosen worktree's terminal took the keyboard");
	}, 30_000);

	test("choosing the worktree already shown also puts the keyboard in its terminal", async () => {
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		await choose(0);
		await page.until(`${IN_TERMINAL} === ${JSON.stringify(first)}`, "the shown terminal took the keyboard");
	}, 30_000);

	test("arrows in the sidebar keep the keyboard there", async () => {
		await page.evaluate(`document.querySelector(".row:not(.issues-row)").focus()`);
		await page.press("ArrowDown");
		await Bun.sleep(100);
		expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("row") === true`)).toBe(true);
	}, 30_000);

	test("arrows on the session chips keep the keyboard on the chips", async () => {
		const third = await page.evaluate<string>(openSession(0));
		await page.until(shown(third), "the new session showed");
		await page.evaluate(`document.querySelector('.session-chip-tab[aria-selected="true"]').focus()`);
		await page.press("ArrowLeft");
		await Bun.sleep(100);
		expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("session-chip-tab") === true`)).toBe(true);
		expect(await page.evaluate<string | null>(IN_TERMINAL)).toBeNull();
	}, 30_000);

	test("back in the window, the keyboard returns to the shown terminal it was in", async () => {
		await page.evaluate(`document.querySelector('.terminal-screen[data-drop-session="${first}"] textarea').focus()`);
		await page.until(`${IN_TERMINAL} === ${JSON.stringify(first)}`, "the terminal had the keyboard");
		await page.evaluate(`${LEAVE}; document.activeElement.blur(); ${COME_BACK}`);
		await page.until(`${IN_TERMINAL} === ${JSON.stringify(first)}`, "the terminal took the keyboard back");
	}, 30_000);

	test("back in the window after the keyboard's spot went, the shown session's terminal takes it", async () => {
		await page.evaluate(`document.querySelector('.terminal-screen[data-drop-session="${first}"] textarea').focus()`);
		await page.evaluate(LEAVE);
		// While the window was away, another worktree came to show, and with it its session.
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees[1].id)`);
		await page.until(shown(second), "the second session showed");
		await page.evaluate(`document.activeElement?.blur(); ${COME_BACK}`);
		await page.until(`${IN_TERMINAL} === ${JSON.stringify(second)}`, "the shown terminal took the keyboard");
	}, 30_000);

	test("a sidebar row that still shows keeps the keyboard", async () => {
		await page.evaluate(`document.querySelector(".row:not(.issues-row)").focus()`);
		await page.evaluate(`${LEAVE}; ${COME_BACK}`);
		await Bun.sleep(100);
		expect(await page.evaluate<boolean>(`document.activeElement?.classList.contains("row") === true`)).toBe(true);
	}, 30_000);

	test("an open dialog keeps the keyboard", async () => {
		await page.press("P", "ctrlShift");
		await page.until(`document.activeElement?.classList.contains("palette-input") === true`, "the palette opened");
		await page.evaluate(`${LEAVE}; ${COME_BACK}`);
		await Bun.sleep(100);
		expect(await page.evaluate<boolean>(`document.activeElement?.closest("dialog[open]") !== null`)).toBe(true);
		await page.press("Escape");
	}, 30_000);

	test("with a file in the editor on the shown tab, the editor takes it, not a terminal", async () => {
		await page.evaluate(`(() => {
			const worktree = ${STORE}.getState().repositories[0].worktrees[0];
			${ENGINE}.setWorktreeFile(worktree.path, "notes.txt", "hello\\n");
			${STORE}.openFile(worktree.id, "notes.txt");
		})()`);
		await page.until(`document.querySelector(".cm-content") === document.activeElement`, "the editor took the keyboard");
		// The keyboard was on the page when the window left, so the editor gets it by the rule, not as the spot it was in.
		await page.evaluate(`document.activeElement.blur(); ${LEAVE}; ${COME_BACK}`);
		await page.until(`document.querySelector(".cm-content") === document.activeElement`, "the editor took the keyboard back");
		expect(await page.evaluate<string | null>(IN_TERMINAL)).toBeNull();
	}, 30_000);

	test("with no session showing, the keyboard stays where the page left it", async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees.at(-1).id)`);
		expect(await page.evaluate<number>(`${STORE}.getState().terminals.filter(session => session.worktree === ${STORE}.getState().selection.worktree).length`)).toBe(0);
		await page.evaluate(`${LEAVE}; document.activeElement?.blur(); ${COME_BACK}`);
		await Bun.sleep(100);
		expect(await page.evaluate<boolean>(`document.activeElement === document.body`)).toBe(true);
	}, 30_000);
});
