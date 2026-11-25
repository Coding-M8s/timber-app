import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { JIRA_TOKEN_PROBLEM } from "../src/mainview/timber-settings-format";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * A Jira login with the site address as its API token (issue 387), in
 * Settings and in the setup wizard, in a real browser: it is told at the
 * field, Test connection and Save send nothing, and correcting it sends the
 * login. An email the browser itself would refuse still reaches Timber.
 * Skipped where no browser is installed.
 */

const REPOSITORY = "/work/api-server";
const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const FORM = `[...document.querySelectorAll(".settings-panel:not([hidden]) form.timber-group")].find(form => form.querySelector("h4")?.textContent === "Issue tracking")`;
const WIZARD = `document.querySelector("dialog.setup-wizard[open]")`;
const SITE = "https://example.atlassian.net";
const EMAIL = "not an email";

const field = (root: string, label: string) => `[...${root}.querySelectorAll(".field")].find(field => field.querySelector("label")?.textContent === ${JSON.stringify(label)})`;
const input = (root: string, label: string) => `${field(root, label)}.querySelector("input")`;
const jiraTest = (root: string) => `${root}.querySelector('[aria-label="Jira check command"]').parentElement.querySelector("button")`;

describe.skipIf(browserPath === null || process.platform === "win32")("A Jira token that is the site address, in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		// Every request that could carry a login, kept to be counted, and answered as the mock engine answers it.
		await page.evaluate(`(() => {
			window.sent = [];
			for (const name of ["saveTimberSettings", "checkTimberConnection"]) {
				const answer = ${ENGINE}[name];
				${ENGINE}[name] = request => { window.sent.push([name, request.credentials ?? null]); return answer.call(${ENGINE}, request); };
			}
		})()`);
	}, 60_000);

	afterEach(async () => {
		await page.evaluate(`(() => { ${STORE}.closeDialog(); window.sent.length = 0; })()`);
	});

	afterAll(async () => {
		await page?.close();
	});

	const sent = () => page.evaluate<[string, unknown][]>("window.sent");

	/** Type over what a field holds, as a person would, and wait until it holds it. */
	async function fill(root: string, label: string, text: string): Promise<void> {
		await page.evaluate(`(() => { const field = ${input(root, label)}; field.focus(); field.select(); })()`);
		if (text === "") await page.press("Delete");
		else await page.type(text);
		await page.until(`${input(root, label)}.value === ${JSON.stringify(text)}`, `${label} was typed`);
	}

	/** Choose "This site" and type the site and a login. */
	async function typeLogin(root: string, token: string): Promise<void> {
		await page.evaluate(`[...${root}.querySelectorAll(".check")].find(label => label.textContent.trim() === "This site").querySelector("input").click()`);
		await page.until(`${field(root, "Site address")} !== undefined`, "the site field showed");
		await fill(root, "Site address", SITE);
		await fill(root, "Jira email", EMAIL);
		await fill(root, "Jira API token", token);
	}

	async function expectRefused(root: string): Promise<void> {
		expect(await page.evaluate<string>(`${input(root, "Jira email")}.type`)).toBe("email");
		expect(await page.evaluate<string>(`${input(root, "Jira API token")}.type`)).toBe("password");
		expect(await page.evaluate<string>(`${field(root, "Jira API token")}.querySelector(".field-error").textContent`)).toBe(JIRA_TOKEN_PROBLEM);
		expect(await page.evaluate<string>(`${input(root, "Jira API token")}.getAttribute("aria-invalid")`)).toBe("true");
		expect(await page.evaluate<boolean>(`${jiraTest(root)}.disabled`)).toBe(true);
		await page.evaluate(`${jiraTest(root)}.click()`);
	}

	const TOKEN = "ATATT3xFfGF0";
	const LOGIN = { jira: { email: EMAIL, token: TOKEN } };

	test("in Settings, nothing is sent until the token is corrected", async () => {
		await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "repository", repository: ${JSON.stringify(REPOSITORY)} })`);
		await page.until(`${FORM} !== undefined`, "Issue tracking showed");
		for (const token of ["example.atlassian.net", SITE]) {
			await typeLogin(FORM, token);
			await expectRefused(FORM);
			expect(await page.evaluate<string>(`${FORM}.querySelector("button[type=submit]").getAttribute("aria-disabled")`)).toBe("true");
			expect(await page.evaluate<string>(`${FORM}.textContent`)).toContain("Correct the Jira API token above to save.");
			await page.evaluate(`${FORM}.querySelector("button[type=submit]").click()`);
			// Enter in the field submits the form too.
			await page.evaluate(`${input(FORM, "Jira API token")}.focus()`);
			await page.press("Enter");
			expect(await sent()).toEqual([]);
			expect(await page.evaluate<string>(`${FORM}.querySelector(".settings-section-status").textContent`)).toBe("");
		}

		// Settings waits for nothing: the message goes as the token is typed over.
		await fill(FORM, "Jira API token", TOKEN);
		await page.until(`${field(FORM, "Jira API token")}.querySelector(".field-error") === null`, "the message went");
		await page.evaluate(`${jiraTest(FORM)}.click()`);
		await page.until(`${FORM}.querySelector(".connection-result") !== null`, "Jira was checked");
		expect(await sent()).toEqual([["checkTimberConnection", LOGIN]]);
		await page.evaluate(`${FORM}.querySelector("button[type=submit]").click()`);
		await page.until(`${FORM}.querySelector(".settings-section-status").textContent === "Saved"`, "the login was saved");
		expect((await sent()).at(-1)).toEqual(["saveTimberSettings", LOGIN]);
		expect(await page.evaluate<string>(`${input(FORM, "Jira API token")}.value`)).toBe("");
	}, 30_000);

	test("in the setup wizard, nothing is sent until the token is corrected", async () => {
		const step = async (button: string, title: string) => {
			await page.evaluate(`[...${WIZARD}.querySelectorAll(".dialog-buttons button")].find(candidate => candidate.textContent.trim().startsWith(${JSON.stringify(button)})).click()`);
			await page.until(`${WIZARD}.querySelector(".wizard-step").textContent.endsWith(${JSON.stringify(`: ${title}`)})`, `the wizard showed ${title}`);
		};
		await page.evaluate(`${STORE}.openDialog({ kind: "set-up-timber", repository: ${JSON.stringify(REPOSITORY)} })`);
		await page.until(`${WIZARD}?.querySelector("button[type=submit]").disabled === false`, "the wizard read the settings");
		for (const title of ["Editor", "Coding assistant", "Branch, remote, and folder", "Scripts", "Issue tracking"]) await step("Next", title);
		await typeLogin(WIZARD, SITE);
		await expectRefused(WIZARD);
		await step("Next", "Save");
		// Save waits until the last step has shown for half a second.
		await Bun.sleep(600);
		expect(await page.evaluate<boolean>(`${WIZARD}.querySelector("button[type=submit]").disabled`)).toBe(true);
		expect(await page.evaluate<string>(`${WIZARD}.querySelector(".dialog-foot").textContent`)).toContain("The Jira API token looks like the site address. Go back to Issue tracking to correct it.");
		// Past the disabled button, as a submit sent by anything else would go.
		await page.evaluate(`${WIZARD}.querySelector("form").dispatchEvent(new SubmitEvent("submit", { bubbles: true, cancelable: true }))`);
		expect(await page.evaluate<boolean>(`${WIZARD} !== null && ${WIZARD}.querySelector("form").getAttribute("aria-busy") === "false"`)).toBe(true);
		expect(await sent()).toEqual([]);

		await step("Back", "Issue tracking");
		expect(await page.evaluate<string>(`${field(WIZARD, "Jira API token")}.querySelector(".field-error").textContent`)).toBe(JIRA_TOKEN_PROBLEM);
		await fill(WIZARD, "Jira API token", TOKEN);
		await step("Next", "Save");
		await Bun.sleep(600);
		await page.evaluate(`${WIZARD}.querySelector("button[type=submit]").click()`);
		await page.until(`${WIZARD} === null`, "the wizard saved and closed");
		expect(await sent()).toEqual([["saveTimberSettings", LOGIN]]);
	}, 30_000);
});
