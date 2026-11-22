import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * No tooltip covers an open menu, in a real browser over the mock engine:
 * whatever opened a menu drops its `title` while the menu is open and gets it
 * back once the menu closes, keeping its name, and no menu entry has a
 * `title`. What an entry does is still said, as its description. A real
 * tooltip is drawn by the browser outside the page, so these look at the
 * attribute. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const MENU_OPEN = `document.querySelector("[role=menu]") !== null`;
const MENU_CLOSED = `document.querySelector("[role=menu]") === null`;
const HELLO = { name: "Hello", kind: "command", text: "pwd", description: "", agent: null, repository: null, sound: null };
const titleOf = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.getAttribute("title") ?? null`;
const labelOf = (selector: string) => `document.querySelector(${JSON.stringify(selector)})?.getAttribute("aria-label") ?? null`;
const ENTRY_TITLES = `[...document.querySelectorAll("[role=menu] [role=menuitem]")].filter(entry => entry.hasAttribute("title")).length`;
const ENTRIES = `document.querySelectorAll("[role=menu] [role=menuitem]").length`;
/** Each entry's description, as assistive technology reads it from `aria-describedby`. */
const DESCRIPTIONS = `[...document.querySelectorAll("[role=menu] [role=menuitem]")].map(entry => (entry.getAttribute("aria-describedby") ?? "").split(" ").filter(Boolean).map(id => document.getElementById(id)?.textContent ?? "").join(" "))`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("menus and tooltips in a real browser", () => {
	let page: BrowserPage;

	/** The first repository's first linked worktree, chosen, so the workspace shows it. */
	const selectLinked = async () => {
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories[0].worktrees.find(worktree => !worktree.primary).id)`);
		await page.until(`document.querySelector(".workspace-more") !== null`, "the workspace showed");
	};

	/**
	 * Opens a menu with `open`, then checks that `opener` has no title while it
	 * is open, keeps its name, that no entry has a title, and that Escape
	 * gives the title back.
	 */
	const checkOpener = async (opener: string, open: () => Promise<void>) => {
		const title = await page.evaluate<string | null>(titleOf(opener));
		const label = await page.evaluate<string | null>(labelOf(opener));
		expect(title).not.toBeNull();
		await open();
		await page.until(MENU_OPEN, "the menu opened");
		expect(await page.evaluate<string | null>(titleOf(opener))).toBeNull();
		expect(await page.evaluate<string | null>(labelOf(opener))).toBe(label);
		expect(await page.evaluate<number>(ENTRIES)).toBeGreaterThan(0);
		expect(await page.evaluate<number>(ENTRY_TITLES)).toBe(0);
		const descriptions = await page.evaluate<string[]>(DESCRIPTIONS);
		// The menu takes the keyboard a moment after it shows; Escape is its key.
		await page.until(`document.querySelector("[role=menu]")?.contains(document.activeElement) === true`, "the menu had the keyboard");
		await page.press("Escape");
		await page.until(MENU_CLOSED, "the menu closed");
		expect(await page.evaluate<string | null>(titleOf(opener))).toBe(title);
		return descriptions;
	};

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(".group-header") !== null`, "the sidebar showed");
	}, 30_000);

	test("the workspace header's More, clicked, has no tooltip while its menu is open, and its entries say what they do", async () => {
		await selectLinked();
		const descriptions = await checkOpener(".workspace-actions .workspace-more", () => page.click(".workspace-actions .workspace-more"));
		expect(descriptions.every(text => text !== "")).toBe(true);
	}, 30_000);

	test("the terminal \"+\", clicked, has no tooltip while its menu is open; a chop's entry says what it runs", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [${JSON.stringify(HELLO)}] })`);
		await selectLinked();
		await page.evaluate(`(() => {
			const repository = ${STORE}.getState().repositories[0];
			const worktree = repository.worktrees.find(worktree => !worktree.primary);
			return ${STORE}.openTerminal({ repository: repository.path, worktree: worktree.path, cols: 80, rows: 24 });
		})()`);
		await page.until(`document.querySelector(".session-add[aria-haspopup=menu]") !== null`, "the \"+\" showed");
		await page.until(`${STORE}.getState().chops?.list?.outcome === "listed"`, "the chops were read");
		const descriptions = await checkOpener(".session-add", () => page.click(".session-add"));
		// The shell and agent entries' words are all in sight; the chop's description is its first line.
		expect(descriptions).toContain("pwd");
	}, 30_000);

	test("a session chip has no tooltip while its menu, opened with Shift+F10, is open", async () => {
		await selectLinked();
		await page.evaluate(`(() => {
			const repository = ${STORE}.getState().repositories[0];
			const worktree = repository.worktrees.find(worktree => !worktree.primary);
			return ${STORE}.openTerminal({ repository: repository.path, worktree: worktree.path, cols: 80, rows: 24 });
		})()`);
		await page.until(`document.querySelector(".session-chip-tab") !== null`, "the chip showed");
		await page.evaluate(`document.querySelector(".session-chip-tab").focus()`);
		await checkOpener(".session-chip-tab", () => page.press("F10", "shift"));
	}, 30_000);

	test("a repository's More, clicked, and its header, by Shift+F10, have no tooltip while the menu is open", async () => {
		await checkOpener(".group-more", () => page.click(".group-more"));
		await page.evaluate(`document.querySelector(".group-header").focus()`);
		const descriptions = await checkOpener(".group-header", () => page.press("F10", "shift"));
		// Remove from the list says what it does; an entry its label says all of has no description.
		expect(descriptions.at(-1)).toContain("Nothing on disk is changed.");
		expect(descriptions).toContain("");
	}, 30_000);

	test("a worktree row and a repository header, right-clicked, have no tooltip while the menu is open", async () => {
		const rightClick = (selector: string) => async () => {
			const at = await page.middle(selector);
			await page.evaluate(`document.querySelector(${JSON.stringify(selector)}).dispatchEvent(new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2, clientX: ${at.x}, clientY: ${at.y} }))`);
		};
		await checkOpener(".row-item .row", rightClick(".row-item .row"));
		await checkOpener(".group-header", rightClick(".group-header"));
	}, 30_000);

	test("a chop's actions button, clicked, has no tooltip while its menu is open", async () => {
		await page.evaluate(`${STORE}.savePreferences({ chops: [${JSON.stringify(HELLO)}] })`);
		await selectLinked();
		await page.click("#titlebar-chops");
		await page.until(`document.querySelector('[data-chop-actions="Hello"]') !== null`, "Hello was listed");
		const descriptions = await checkOpener('[data-chop-actions="Hello"]', () => page.click('[data-chop-actions="Hello"]'));
		expect(descriptions).toEqual(["Change it here. Settings shows the same chops.", "Asks first."]);
	}, 30_000);

	test("a worktree row, by Shift+F10, has no tooltip on either line while its menu is open", async () => {
		const row = ".row-item .row";
		const meta = ".row-item .row-meta";
		const metaTitle = await page.evaluate<string | null>(titleOf(meta));
		expect(metaTitle).not.toBeNull();
		await page.evaluate(`document.querySelector(${JSON.stringify(row)}).focus()`);
		await checkOpener(row, async () => {
			await page.press("F10", "shift");
			await page.until(MENU_OPEN, "the menu opened");
			expect(await page.evaluate<string | null>(titleOf(meta))).toBeNull();
		});
		expect(await page.evaluate<string | null>(titleOf(meta))).toBe(metaTitle);
	}, 30_000);
});
