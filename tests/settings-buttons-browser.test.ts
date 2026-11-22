import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { SETTINGS_SECTIONS } from "../src/mainview/store/state";
import { DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME } from "../src/shared/builtin-themes";
import { THEME_STYLE_ID, themeStyleSheet } from "../src/shared/theme";
import { MIN_WINDOW_WIDTH } from "../src/shared/window-frame";
import { sampleRepositories } from "../src/mainview/engine/mock";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Every button in Settings keeps its label on one line inside its outline
 * (issue 310), in every section, from the app's narrowest window up: the
 * things beside a button give way, or the button goes to a line of its own.
 * "Test connection" stays beside its command wherever the row has room, and
 * a button whose label changes while it runs keeps its width. Layout needs a
 * real browser, so this is skipped where none is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
// The narrowest window, each side of the width where the sections go below their list, and each side of the width where a connection test stacks.
const WIDTHS = [MIN_WINDOW_WIDTH, 560, 561, 720, 721, 1040];
const PANEL = `document.querySelector(".settings-panel:not([hidden])")`;

/**
 * Each button in the shown section that breaks: its label on more than one
 * line, its text past its outline, or the button past the section's edges.
 * Empty when every button fits.
 */
const MISFITS = `(() => {
	const panel = ${PANEL};
	const inner = panel.getBoundingClientRect();
	const left = inner.left + panel.clientLeft;
	const right = left + panel.clientWidth;
	const misfits = [];
	if (panel.scrollWidth > panel.clientWidth) misfits.push("the section scrolls sideways by " + (panel.scrollWidth - panel.clientWidth) + "px");
	for (const button of panel.querySelectorAll("button")) {
		const box = button.getBoundingClientRect();
		if (box.width === 0 && box.height === 0) continue;
		const name = button.getAttribute("aria-label") ?? button.textContent;
		const range = document.createRange();
		range.selectNodeContents(button);
		const lines = new Set([...range.getClientRects()].filter(rect => rect.width > 0).map(rect => Math.round(rect.top)));
		if (lines.size > 1) misfits.push(name + " takes " + lines.size + " lines");
		const text = range.getBoundingClientRect();
		if (text.left < box.left - 0.5 || text.right > box.right + 0.5 || text.top < box.top - 0.5 || text.bottom > box.bottom + 0.5) misfits.push(name + " spills out of its outline");
		if (box.left < left - 0.5 || box.right > right + 0.5) misfits.push(name + " passes the section's edge");
	}
	return misfits;
})()`;

/** For each "Test connection" in the shown section, whether it sits on the same line as its command. */
const BESIDE = `[...${PANEL}.querySelectorAll(".connection-test-row")].map(row => {
	const command = row.querySelector(".dialog-command").getBoundingClientRect();
	const button = row.querySelector(".button").getBoundingClientRect();
	return button.left >= command.right && button.top < command.bottom && button.bottom > command.top;
})`;

async function show(page: BrowserPage, section: string): Promise<void> {
	// Opened afresh, so Settings reads what the test just changed.
	await page.evaluate(`${STORE}.closeDialog()`);
	await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: ${JSON.stringify(section)} })`);
	await page.until(`document.querySelector(".settings-nav-item.selected") !== null && ${PANEL} !== null && ${PANEL}.querySelector(".settings-section") !== null`, `Settings showed ${section}`);
	// The Timber sections read their settings before their buttons show.
	await page.until(`!${PANEL}.textContent.includes("Reading")`, `${section} finished reading`);
}

describe.skipIf(browserPath === null || process.platform === "win32")("Settings buttons in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	for (const theme of [DEFAULT_DARK_THEME, DEFAULT_LIGHT_THEME]) {
		describe(`in ${theme.name}`, () => {
			beforeAll(async () => {
				// The test page has no saved settings, so the theme is put on it here, as the main process would.
				const sheet = themeStyleSheet({ mode: "fixed", theme: theme.id });
				await page.evaluate(`(() => {
					const style = document.getElementById(${JSON.stringify(THEME_STYLE_ID)}) ?? document.head.appendChild(Object.assign(document.createElement("style"), { id: ${JSON.stringify(THEME_STYLE_ID)} }));
					style.textContent = ${JSON.stringify(sheet)};
				})()`);
			});

			for (const width of WIDTHS) {
				test(`at ${width} px wide, every section's buttons keep their labels on one line inside their outlines`, async () => {
					await page.resize(width, 800);
					const misfits: string[] = [];
					for (const section of SETTINGS_SECTIONS) {
						await show(page, section);
						for (const misfit of await page.evaluate<string[]>(MISFITS)) misfits.push(`${section}: ${misfit}`);
					}
					expect(misfits).toEqual([]);
				}, 60_000);
			}
		});
	}

	for (const section of ["repository", "machine"] as const) {
		for (const width of [561, 720, 1040, 1440]) {
			test(`in ${section === "machine" ? "Global" : "Repository"}, at ${width} px wide, each Test connection sits beside its command`, async () => {
				await page.resize(width, 800);
				await show(page, section);
				// GitHub, Jira, and Linear.
				expect(await page.evaluate<boolean[]>(BESIDE)).toEqual([true, true, true]);
			}, 30_000);
		}
	}

	/** Each button with a reserved label in the shown section whose width changes when its label says it is running, and the labels checked. */
	const JUMPS = `(() => {
		const running = { "Test connection": "Testing", "Save": "Saving", "Read again": "Reading", "Check for updates": "Looking", "Uninstall and quit": "Uninstalling" };
		const buttons = [...${PANEL}.querySelectorAll(".button[data-reserve]")];
		const jumps = [];
		for (const button of buttons) {
			const text = [...button.childNodes].find(node => node.nodeType === Node.TEXT_NODE && node.textContent.trim() !== "");
			const idle = text.textContent;
			const before = button.getBoundingClientRect().width;
			text.textContent = running[idle.trim()];
			const after = button.getBoundingClientRect().width;
			text.textContent = idle;
			if (Math.abs(before - after) >= 0.5) jumps.push(idle.trim() + " goes from " + before + "px to " + after + "px");
		}
		return { labels: [...new Set(buttons.map(button => button.textContent.trim()))].sort(), jumps };
	})()`;

	test("in Global, a button keeps its width while its label says it is running", async () => {
		await page.resize(1040, 800);
		await show(page, "machine");
		const result = await page.evaluate<{ labels: string[]; jumps: string[] }>(JUMPS);
		expect(result.labels).toEqual(["Read again", "Save", "Test connection"]);
		expect(result.jumps).toEqual([]);
	}, 30_000);

	test("in About, Check for updates and Uninstall and quit keep their widths while they run", async () => {
		await page.resize(1040, 800);
		await show(page, "about");
		const checking = await page.evaluate<{ labels: string[]; jumps: string[] }>(JUMPS);
		await page.evaluate(`[...${PANEL}.querySelectorAll("button")].find(button => button.textContent.trim() === "Uninstall Timber").click()`);
		await page.until(`[...${PANEL}.querySelectorAll("button")].some(button => button.textContent.trim() === "Uninstall and quit")`, "the uninstall question showed");
		const uninstalling = await page.evaluate<{ labels: string[]; jumps: string[] }>(JUMPS);
		await page.evaluate(`[...${PANEL}.querySelectorAll("button")].find(button => button.textContent.trim() === "Cancel").click()`);
		expect(checking).toEqual({ labels: ["Check for updates"], jumps: [] });
		expect(uninstalling.labels).toContain("Uninstall and quit");
		expect(uninstalling.jumps).toEqual([]);
	}, 30_000);

	/** Click the first button in the shown section whose text is this. */
	const clickText = (text: string) => page.evaluate(`[...${PANEL}.querySelectorAll("button")].find(button => button.textContent.trim() === ${JSON.stringify(text)}).click()`);
	const hasText = (text: string) => `[...${PANEL}.querySelectorAll("button")].some(button => button.textContent.trim() === ${JSON.stringify(text)})`;

	/** Every misfit at each width, for the section as it is now. */
	async function misfitsAtEveryWidth(what: string): Promise<string[]> {
		const misfits: string[] = [];
		for (const width of WIDTHS) {
			await page.resize(width, 800);
			for (const misfit of await page.evaluate<string[]>(MISFITS)) misfits.push(`${what} at ${width}px: ${misfit}`);
		}
		await page.resize(1040, 800);
		return misfits;
	}

	describe("in the states a section shows only after a step", () => {
		test("Theme, with a theme of the person's own and its delete question", async () => {
			await page.resize(1040, 800);
			await show(page, "theme");
			await clickText("New theme");
			await page.until(hasText("Cancel"), "the theme maker showed");
			const misfits = await misfitsAtEveryWidth("the theme maker");
			await page.evaluate(`${PANEL}.querySelector("button[type=submit]").click()`);
			await page.until(`${PANEL}.querySelector(".custom-theme") !== null`, "the new theme showed in the list");
			misfits.push(...await misfitsAtEveryWidth("a theme of the person's own"));
			await page.evaluate(`${PANEL}.querySelector(".custom-theme-actions .button:last-child").click()`);
			await page.until(hasText("Keep"), "the delete question showed");
			misfits.push(...await misfitsAtEveryWidth("the delete question"));
			await clickText("Keep");
			expect(misfits).toEqual([]);
		}, 60_000);

		test("Chops, with a shortcut changed so Reset shows", async () => {
			await show(page, "chops");
			await page.evaluate(`${PANEL}.querySelector(".chop-shortcut input").focus()`);
			await page.press("Y", "ctrlShift");
			await page.until(hasText("Reset"), "Reset showed");
			const misfits = await misfitsAtEveryWidth("a changed shortcut");
			await clickText("Reset");
			expect(misfits).toEqual([]);
		}, 60_000);

		test("About, asking before uninstalling", async () => {
			await show(page, "about");
			await clickText("Uninstall Timber");
			await page.until(hasText("Uninstall and quit"), "the uninstall question showed");
			const misfits = await misfitsAtEveryWidth("the uninstall question");
			await clickText("Cancel");
			expect(misfits).toEqual([]);
		}, 60_000);

		test("Global, with a setup script and a pre-done script", async () => {
			await page.evaluate(`${ENGINE}.setTimberConfig("machine", { default_tracker: "github", hooks: { post_create: ["bun install"], pre_delete: ["bun run clean"] } })`);
			await show(page, "machine");
			await page.until(`${PANEL}.querySelectorAll(".list-field-row").length === 2`, "the scripts showed with Remove");
			expect(await misfitsAtEveryWidth("scripts with Remove")).toEqual([]);
		}, 60_000);

		test("Global, when Timber cannot read the settings", async () => {
			await page.evaluate(`${ENGINE}.breakTimberConfig("machine", "expected a value at line 3, column 9")`);
			await show(page, "machine");
			await page.until(`${PANEL}.querySelector(".failure") !== null && ${hasText("Read again")}`, "the read failure showed");
			const misfits = await misfitsAtEveryWidth("a read failure");
			await page.evaluate(`${ENGINE}.breakTimberConfig("machine", null)`);
			expect(misfits).toEqual([]);
		}, 60_000);
	});

	// The shared button styles reach every dialog: their buttons fit too.
	const repository = sampleRepositories[0]!;
	const worktree = JSON.stringify(repository.worktrees[1]!.id);
	const DIALOGS: Record<string, string> = {
		"New worktree": `{ kind: "new-worktree", repository: ${JSON.stringify(repository.path)} }`,
		"Done": `{ kind: "done-worktree", repository: ${JSON.stringify(repository.path)}, worktree: ${worktree} }`,
		"Rebase": `{ kind: "rebase-worktree", repository: ${JSON.stringify(repository.path)}, worktree: ${worktree} }`,
		"Icon": `{ kind: "sidebar-icon", target: { kind: "repository", path: ${JSON.stringify(repository.path)} } }`,
		"Clean up merged": `{ kind: "clean-up-merged", repository: ${JSON.stringify(repository.path)} }`,
	};
	for (const [name, request] of Object.entries(DIALOGS)) {
		test(`the ${name} dialog's buttons fit at every width`, async () => {
			await page.evaluate(`${STORE}.closeDialog()`);
			await page.evaluate(`${STORE}.openDialog(${request})`);
			await page.until(`document.querySelector("dialog[open] .button") !== null`, `the ${name} dialog showed`);
			const misfits: string[] = [];
			for (const width of WIDTHS) {
				await page.resize(width, 800);
				for (const misfit of await page.evaluate<string[]>(MISFITS.replace(PANEL, `document.querySelector("dialog[open]")`))) misfits.push(`${width}px: ${misfit}`);
			}
			await page.evaluate(`${STORE}.closeDialog()`);
			expect(misfits).toEqual([]);
		}, 60_000);
	}
});
