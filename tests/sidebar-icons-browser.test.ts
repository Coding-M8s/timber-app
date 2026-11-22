import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * Repository and group icons in a real browser, over the mock engine: the
 * dialog from a menu, the icon drawn in the sidebar, and on the palette's
 * rows. Everything else about icons is tested without a window. Skipped
 * where no browser is installed.
 */

const DIALOG = `document.querySelector(".sidebar-icon-dialog")`;
const more = (name: string) => `[aria-label="More for ${name}"]`;
const headerIcon = (name: string) => `document.querySelector('section.group[aria-label="${name}"] .group-header .sidebar-icon')`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("icons in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page.reload();
		await page.until(`document.querySelector(${JSON.stringify(more("timber"))}) !== null`, "the sidebar showed");
	});

	test("Icon... in a repository's menu opens the dialog, and a choice shows in the sidebar at once", async () => {
		expect(await page.evaluate<boolean>(`${headerIcon("timber")} === null`)).toBe(true);
		await page.click(more("timber"));
		await page.until(`document.querySelector('[role="menu"]') !== null`, "the menu opened");
		const item = await page.evaluate<string>(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === "Icon...").id`);
		await page.click(`[id=${JSON.stringify(item)}]`);
		await page.until(`${DIALOG}?.open === true`, "the dialog opened");
		expect(await page.evaluate<string>(`${DIALOG}.querySelector(".dialog-title").textContent`)).toBe("Icon for timber");

		await page.click('.sidebar-icon-dialog [aria-label="Star"]');
		await page.until(`${headerIcon("timber")}?.classList.contains("bundled") === true`, "the star showed before the name");
		expect(await page.evaluate<string | null>(`document.querySelector('.sidebar-icon-dialog [aria-label="Star"]').getAttribute("aria-pressed")`)).toBe("true");

		await page.evaluate(`[...document.querySelectorAll(".sidebar-icon-dialog button")].find(button => button.textContent === "Use the GitHub avatar of acme").click()`);
		await page.until(`${headerIcon("timber")}?.querySelector("img")?.complete === true`, "the avatar showed before the name");
		expect(await page.evaluate<number>(`${headerIcon("timber")}.querySelector("img").naturalWidth`)).toBe(16);
		await page.until(`[...document.querySelectorAll(".sidebar-icon-dialog button")].some(button => button.textContent === "Refresh the GitHub avatar")`, "the button offers a refresh");

		await page.press("Escape");
		await page.until(`${DIALOG} === null`, "the dialog closed");
		expect(await page.evaluate<boolean>(`${headerIcon("timber")} !== null`)).toBe(true);
	}, 30_000);

	test("Icon... in a group's menu sets the group's icon, which shows before its name", async () => {
		await page.evaluate(`window.timberTestStore.createGroup("Work", "/work/timber")`);
		await page.until(`document.querySelector('[aria-label="More for group Work"]') !== null`, "the group showed");
		await page.click('[aria-label="More for group Work"]');
		await page.until(`document.querySelector('[role="menu"]') !== null`, "the menu opened");
		const item = await page.evaluate<string>(`[...document.querySelectorAll('[role="menuitem"]')].find(item => item.textContent === "Icon...").id`);
		await page.click(`[id=${JSON.stringify(item)}]`);
		await page.until(`${DIALOG}?.open === true`, "the dialog opened");
		expect(await page.evaluate<string>(`${DIALOG}.querySelector(".dialog-title").textContent`)).toBe("Icon for group Work");
		// A group has no remote to take an icon from.
		expect(await page.evaluate<boolean>(`[...document.querySelectorAll(".sidebar-icon-dialog button")].some(button => button.textContent.includes("GitHub"))`)).toBe(false);
		await page.click('.sidebar-icon-dialog [aria-label="Briefcase"]');
		await page.until(`document.querySelector('section[aria-label="Group Work"] .repository-group-header .sidebar-icon.bundled') !== null`, "the briefcase showed before the group's name");
		await page.evaluate(`[...document.querySelectorAll(".sidebar-icon-dialog button")].find(button => button.textContent === "Remove icon").click()`);
		await page.until(`document.querySelector('section[aria-label="Group Work"] .repository-group-header .sidebar-icon') === null`, "the icon went away");
	}, 30_000);

	test("a repository's icon shows beside its name on the palette's rows of another repository", async () => {
		await page.evaluate(`window.timberTestStore.setSidebarIcon({ kind: "repository", path: "/work/api-server" }, { kind: "bundled", name: "globe" })`);
		await page.evaluate(`window.timberTestStore.openDialog({ kind: "palette" })`);
		await page.until(`document.querySelector(".palette-input") === document.activeElement`, "the palette took the keyboard");
		await page.type("main");
		await page.until(`[...document.querySelectorAll(".palette-repository")].some(target => target.textContent === "api-server" && target.querySelector(".palette-repository-icon.bundled svg") !== null)`, "the globe showed beside api-server");
	}, 30_000);
});
