import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * From the Issues board to the setting that sets its sprint up, in a real
 * browser (issue 276): a Linear board with no team links to Issue tracking,
 * the link opens Settings at the board's repository with that group focused,
 * and a team saved there brings the board's Current sprint back. Focus needs
 * a real browser, so this is skipped where none is installed.
 */

const REPOSITORY = "/work/api-server";
const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const TRACKING_FORM = `[...document.querySelectorAll(".settings-panel:not([hidden]) form.timber-group")].find(form => form.querySelector("h4")?.textContent === "Issue tracking")`;
const TEAM_INPUT = `[...${TRACKING_FORM}.querySelectorAll(".field")].find(field => field.querySelector("label")?.textContent === "Team").querySelector("input")`;
const SPRINT_TOGGLE = `[...document.querySelectorAll(".board-toggle")].find(button => button.textContent === "Current sprint")`;

describe.skipIf(browserPath === null || process.platform === "win32")("Issue tracking from the Issues board in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.evaluate(`(async () => {
			${ENGINE}.setTimberConfig(${JSON.stringify(REPOSITORY)}, { default_tracker: "linear" });
			${STORE}.openBoard(${JSON.stringify(REPOSITORY)});
		})()`);
		await page.until(`${SPRINT_TOGGLE}?.disabled === true && document.querySelector(".board-settings")`, "the board showed its sprint as not set up, with the link");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	test("the link opens the board's repository at Issue tracking, and a team saved there sets the sprint up", async () => {
		await page.click(".board-settings");
		await page.until(`document.activeElement?.textContent === "Issue tracking"`, "Issue tracking took the focus");
		expect(await page.evaluate<string>(`document.querySelector(".settings-nav-item.selected").textContent`)).toBe("Repository");
		expect(await page.evaluate<string>(`[...document.querySelectorAll(".settings-panel:not([hidden]) select")][0].value`)).toBe(REPOSITORY);

		await page.evaluate(`${TEAM_INPUT}.focus()`);
		await page.type("eng");
		await page.until(`${TEAM_INPUT}.value === "eng"`, "the team was typed");
		await page.evaluate(`${TRACKING_FORM}.querySelector("button[type=submit]").click()`);
		await page.until(`${TRACKING_FORM}.querySelector(".settings-section-status").textContent === "Saved"`, "Timber saved the team");
		expect(await page.evaluate<string>(`${TEAM_INPUT}.value`)).toBe("ENG");

		await page.evaluate(`${STORE}.closeDialog()`);
		await page.until(`${SPRINT_TOGGLE}?.disabled === false`, "Current sprint came back on the board");
		expect(await page.evaluate<boolean>(`document.querySelector(".board-settings") === null`)).toBe(true);
	}, 30_000);
});
