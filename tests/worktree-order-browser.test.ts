import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Moving worktree rows inside their repository in a real browser, over the
 * mock engine: pointer drags, the keys, and what is off while a filter is
 * typed. The saved order has its own tests without a window. Skipped where no
 * browser is installed.
 */

const ROWS = (repository: string) => `section.group[aria-label="${repository}"] li[data-row-path]`;
/** The worktree rows of a repository as drawn, top to bottom, by the last part of their path. */
const ORDER = (repository: string) => `[...document.querySelectorAll(${JSON.stringify(ROWS(repository))})].map(item => item.dataset.rowPath.split("/").pop()).join(",")`;
const row = (repository: string, name: string) => `section.group[aria-label="${repository}"] li[data-row-path$="/${name}"] .row`;
/** The last part of the path of the row that has the keyboard. */
const ACTIVE_ROW = `document.activeElement?.closest("li[data-row-path]")?.dataset.rowPath.split("/").pop() ?? "nothing"`;
const SELECTED = `document.querySelector(".row-item.selected")?.dataset.worktreePath.split("/").pop() ?? "nothing"`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("moving worktrees in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	// Each test starts from the app as it opens, with every repository but the first folded, so the rows fit the window.
	beforeEach(async () => {
		await page.reload();
		await page.evaluate(`(() => {
			const store = window.timberTestStore;
			const [first, ...rest] = store.getState().repositories;
			if (store.getState().layout.collapsed.includes(first.path)) store.toggleGroup(first.path);
			for (const repository of rest) {
				if (!store.getState().layout.collapsed.includes(repository.path)) store.toggleGroup(repository.path);
			}
		})()`);
		await page.until(`document.querySelectorAll(${JSON.stringify(ROWS("timber"))}).length >= 3`, "the rows of the first repository showed");
	}, 60_000);

	const order = () => page.evaluate<string>(ORDER("timber"));

	test("a row is dragged below the last one, with a drop mark while held, and the click that ends the drag does not select", async () => {
		const [main, ...rest] = (await order()).split(",");
		const last = rest[rest.length - 1]!;
		const selected = await page.evaluate<string>(SELECTED);
		const from = await page.middle(row("timber", main!));
		const below = await page.middle(row("timber", last));
		await page.dragTo(from, { x: below.x, y: below.bottom + 20 });
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(ROWS("timber"))}).classList.contains("dragging")`)).toBe(true);
		expect(await page.evaluate<number>(`document.querySelectorAll(".rows > li.drop-after").length`)).toBe(1);
		await page.release();
		await page.until(`${ORDER("timber")} === ${JSON.stringify([...rest, main].join(","))}`, "the first row moved to the end");
		expect(await page.evaluate<number>(`document.querySelectorAll(".rows > li.dragging, .rows > li.drop-after, .rows > li.drop-before").length`)).toBe(0);
		// The click that ended the drag selected nothing.
		expect(await page.evaluate<string>(SELECTED)).toBe(selected);
		// The Issues row is still first in its list.
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(`section.group[aria-label="timber"] ul.rows`)}).firstElementChild.hasAttribute("data-row-path")`)).toBe(false);
	}, 30_000);

	test("a click still selects a row, and a press that barely moves is not a drag", async () => {
		const before = await order();
		const names = before.split(",");
		const target = names[1]!;
		await page.click(row("timber", target));
		await page.until(`${SELECTED} === ${JSON.stringify(target)}`, "the click selected the row");
		const at = await page.middle(row("timber", names[2]!));
		await page.dragTo(at, { x: at.x, y: at.y + 1 });
		await page.release();
		expect(await order()).toBe(before);
	}, 30_000);

	test("a row dragged far above or over other repositories stays in its own, first in its list", async () => {
		const names = (await order()).split(",");
		const last = names[names.length - 1]!;
		const from = await page.middle(row("timber", last));
		const repositories = await page.evaluate<string[]>(`[...document.querySelectorAll("section.group")].map(section => section.getAttribute("aria-label"))`);
		const header = await page.middle(`section.group[aria-label="${repositories[repositories.length - 1]}"] .group-header`);
		const others = await page.evaluate<string>(ORDER(repositories[1]!));
		// Down onto another repository's header: it lands at the end of its own list, which it already is.
		await page.dragTo(from, { x: header.x, y: header.y });
		await page.release();
		await page.until(`document.querySelectorAll(".rows > li.dragging").length === 0`, "the drag ended");
		expect(await order()).toBe(names.join(","));
		expect(await page.evaluate<string>(ORDER(repositories[1]!))).toBe(others);
		// Up to the top of the page: before the first row, below the Issues row.
		const top = await page.middle(row("timber", names[0]!));
		await page.dragTo(await page.middle(row("timber", last)), { x: top.x, y: 2 });
		await page.release();
		await page.until(`${ORDER("timber")} === ${JSON.stringify([last, ...names.slice(0, -1)].join(","))}`, "the row went first");
		expect(await page.evaluate<boolean>(`document.querySelector(${JSON.stringify(`section.group[aria-label="timber"] ul.rows`)}).firstElementChild.hasAttribute("data-row-path")`)).toBe(false);
	}, 30_000);

	test("Alt+Down and Alt+Up move a focused row one place, and the keyboard stays on it", async () => {
		const names = (await order()).split(",");
		const first = names[0]!;
		await page.evaluate(`document.querySelector(${JSON.stringify(row("timber", first))}).focus()`);
		await page.press("ArrowDown", "alt");
		await page.until(`${ORDER("timber")} === ${JSON.stringify([names[1], first, ...names.slice(2)].join(","))}`, "the row moved down");
		await page.until(`${ACTIVE_ROW} === ${JSON.stringify(first)}`, "the keyboard stayed on the row");
		await page.press("ArrowUp", "alt");
		await page.until(`${ORDER("timber")} === ${JSON.stringify(names.join(","))}`, "the row moved up");
		await page.until(`${ACTIVE_ROW} === ${JSON.stringify(first)}`, "the keyboard stayed on the row again");
		// At the top it stays, and the keyboard with it.
		await page.press("ArrowUp", "alt");
		expect(await order()).toBe(names.join(","));
		expect(await page.evaluate<string>(ACTIVE_ROW)).toBe(first);
	}, 30_000);

	test("the row says it can be moved, in its tooltip and its shortcuts", async () => {
		const first = (await order()).split(",")[0]!;
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(row("timber", first))}).getAttribute("aria-keyshortcuts")`)).toContain("Alt+ArrowUp Alt+ArrowDown");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(row("timber", first))}).title`)).toEndWith("Drag to reorder, or press Alt+Up or Alt+Down.");
	}, 30_000);

	test("while a filter is typed, nothing moves and the row does not say it can", async () => {
		await page.click(".filter");
		await page.type("e");
		await page.until(`document.querySelectorAll(${JSON.stringify(ROWS("timber"))}).length >= 2`, "the filter kept some rows");
		const names = (await order()).split(",");
		const first = names[0]!;
		expect(await page.evaluate<string | null>(`document.querySelector(${JSON.stringify(row("timber", first))}).getAttribute("aria-keyshortcuts")`)).not.toContain("Alt+ArrowUp");
		expect(await page.evaluate<string>(`document.querySelector(${JSON.stringify(row("timber", first))}).title`)).not.toContain("Drag to reorder");
		await page.evaluate(`document.querySelector(${JSON.stringify(row("timber", first))}).focus()`);
		await page.press("ArrowDown", "alt");
		const from = await page.middle(row("timber", first));
		const below = await page.middle(row("timber", names[names.length - 1]!));
		await page.dragTo(from, { x: below.x, y: below.bottom + 20 });
		await page.release();
		expect(await order()).toBe(names.join(","));
	}, 30_000);
});
