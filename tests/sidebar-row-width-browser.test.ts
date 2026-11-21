import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { MIN_SIDEBAR_WIDTH } from "../src/shared/layout";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * A sidebar row stays inside the sidebar at its narrowest width (issue 240),
 * with six agents, an upstream that is gone, a merged pull request, and a
 * removal Timber refused, whose Details shows without pointing at the row.
 * Layout needs a real browser, so this is skipped where none is installed.
 */

const REPOSITORY = "/work/storefront";
// Its pull request merged, its upstream is gone, and Timber refuses to remove it (see the mock's sampleRemovalRefusals).
const WORKTREE = "/work/storefront-worktrees/fix-currency-rounding";
const AGENTS = 6;

const STORE = "window.timberTestStore";
const ITEM = `[...document.querySelectorAll(".row-item")].find(item => item.querySelector(".row-name")?.textContent === "fix/currency-rounding")`;

/**
 * What spills: each element in the row's item whose right edge passes the
 * sidebar's inner right edge, and how far, plus the sidebar's own sideways
 * overflow. Empty when everything fits.
 */
const SPILLS = `(() => {
	const sidebar = document.querySelector(".sidebar");
	const edge = sidebar.getBoundingClientRect().left + sidebar.clientWidth;
	const spills = [...${ITEM}.querySelectorAll("*")]
		.filter(element => element.getBoundingClientRect().width > 0 && element.getBoundingClientRect().right > edge + 0.5)
		.map(element => (element.className.baseVal ?? element.className) + " by " + Math.round(element.getBoundingClientRect().right - edge) + "px");
	if (sidebar.scrollWidth > sidebar.clientWidth) spills.push("sidebar scrolls sideways by " + (sidebar.scrollWidth - sidebar.clientWidth) + "px");
	return spills;
})()`;

/** Every row's name with what of it spills past the sidebar's edge, and with any flag whose words are cut short. Empty when all fit. */
const EVERY_ROW = `(() => {
	const sidebar = document.querySelector(".sidebar");
	const edge = sidebar.getBoundingClientRect().left + sidebar.clientWidth;
	return [...document.querySelectorAll(".rows > li")].flatMap(item => {
		const name = item.querySelector(".row-name")?.textContent ?? item.textContent.slice(0, 20);
		const spills = [...item.querySelectorAll("*")].filter(element => element.getBoundingClientRect().right > edge + 0.5).map(element => name + ": spills " + (element.className.baseVal ?? element.className));
		const cut = [...item.querySelectorAll(".row-flag, .sync-note")].filter(element => element.scrollWidth > element.clientWidth).map(element => name + ": cut " + element.textContent);
		return [...spills, ...cut];
	});
})()`;

/** Whether Details shows, and what in the row it covers. */
const DETAILS = `(() => {
	const item = ${ITEM};
	const details = item.querySelector(".row-removal-details");
	if (!details) return { shown: false, covers: ["no Details button"] };
	const box = details.getBoundingClientRect();
	const covers = [...item.querySelectorAll(".row *")]
		.filter(element => element.children.length === 0 || element.matches(".row-agent, .row-flag, .sync-note"))
		.filter(element => {
			const other = element.getBoundingClientRect();
			return other.width > 0 && other.left < box.right && other.right > box.left && other.top < box.bottom && other.bottom > box.top;
		})
		.map(element => element.className.baseVal ?? element.className);
	return { shown: getComputedStyle(item.querySelector(".row-actions")).opacity === "1", covers };
})()`;

describe.skipIf(browserPath === null || process.platform === "win32")("a crowded sidebar row in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage("browser-sample-page.tsx");
		await page.evaluate(`(async () => {
			const store = ${STORE};
			for (let index = 0; index < ${AGENTS}; index += 1) {
				await store.openTerminal({ repository: ${JSON.stringify(REPOSITORY)}, worktree: ${JSON.stringify(WORKTREE)}, cols: 80, rows: 24, agent: "Codex" });
			}
			// A plain shell too, shown as a count beside the agents.
			await store.openTerminal({ repository: ${JSON.stringify(REPOSITORY)}, worktree: ${JSON.stringify(WORKTREE)}, cols: 80, rows: 24 });
			store.resizeSidebar(${MIN_SIDEBAR_WIDTH});
		})()`);
		await page.until(`${ITEM}?.querySelector(".row-agents-more") && document.querySelector(".sidebar").getBoundingClientRect().width === ${MIN_SIDEBAR_WIDTH}`, "the crowded row showed at the narrowest width");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** Select the crowded row, or another one, and check that nothing spills either way. */
	async function fitsSelectedOrNot() {
		await page.evaluate(`${ITEM}.querySelector(".row").click()`);
		await page.until(`${ITEM}.classList.contains("selected")`, "the row was selected");
		expect(await page.evaluate<string[]>(SPILLS)).toEqual([]);
		await page.evaluate(`document.querySelector(".row-item:not(.selected) .row").click(); document.activeElement.blur()`);
		await page.until(`!${ITEM}.classList.contains("selected")`, "another row was selected");
		expect(await page.evaluate<string[]>(SPILLS)).toEqual([]);
	}

	test("with six agents, a shell, a merged pull request, and its upstream gone, nothing passes the sidebar's edge", async () => {
		const shown = await page.evaluate<string>(`${ITEM}.querySelector(".row").textContent`);
		expect(shown).toContain("#64 merged");
		expect(shown).toContain("upstream gone");
		expect(shown).toContain("+4");
		await fitsSelectedOrNot();
	});

	test("after Timber refused to remove it, the row says so, and still nothing passes the edge", async () => {
		await page.evaluate(`(async () => {
			const store = ${STORE};
			const worktree = store.getState().repositories.find(repository => repository.path === ${JSON.stringify(REPOSITORY)})
				.worktrees.find(worktree => worktree.path === ${JSON.stringify(WORKTREE)});
			const preview = await store.previewDone({ repository: ${JSON.stringify(REPOSITORY)}, path: worktree.path, options: { keepBranch: false, keepIgnored: false, base: null } });
			await store.removeWorktree({ repository: ${JSON.stringify(REPOSITORY)}, worktree, preview: preview.id, toast: "Removed", announce: false });
		})()`);
		await page.until(`${ITEM}?.classList.contains("removal-failed")`, "the removal failed");
		expect(await page.evaluate<string>(`${ITEM}.querySelector(".row").textContent`)).toContain("removal failed");
		await fitsSelectedOrNot();
	});

	test("every sample row fits, and no flag is cut short while a line of its own holds it", async () => {
		expect(await page.evaluate<string[]>(EVERY_ROW)).toEqual([]);
	});

	test("Details shows without pointing at the row, and covers nothing in it", async () => {
		// Another row selected, and the pointer and keyboard elsewhere.
		await page.evaluate(`document.querySelector(".row-item:not(.selected) .row").click(); document.activeElement.blur()`);
		await page.until(`!${ITEM}.classList.contains("selected")`, "another row was selected");
		expect(await page.evaluate<{ shown: boolean; covers: string[] }>(DETAILS)).toEqual({ shown: true, covers: [] });
		expect(await page.evaluate<string[]>(SPILLS)).toEqual([]);
	});
});
