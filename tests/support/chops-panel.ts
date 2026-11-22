import { afterAll, beforeAll, beforeEach } from "bun:test";
import { type BrowserPage, openSidebarPage } from "./browser";

/** What the chops panel's browser tests share: the store, the panel's selectors, and the page each file opens. */

export const STORE = "window.timberTestStore";
export const PANEL_SHOWN = `document.getElementById("chops-panel") !== null`;
export const PANEL_HIDDEN = `document.getElementById("chops-panel") === null`;
export const BUTTON = "#titlebar-chops";
export const FOCUS_IN_PANEL = `document.getElementById("chops-panel")?.contains(document.activeElement) === true`;
export const ACTIVE = `(() => {
	const active = document.activeElement;
	if (!active || active === document.body) return "nothing";
	return active.id || active.getAttribute("aria-label") || active.className;
})()`;
export const ROW_NAMES = `[...document.querySelectorAll("#chops-panel .chops-panel-item")].map(row => row.dataset.chopRow).join(",")`;

/** Set a form field's value as typing does, so React hears it. */
export const SET_VALUE = (selector: string, value: string) => `(() => {
	const field = document.querySelector(${JSON.stringify(selector)});
	const proto = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : field instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
	Object.getOwnPropertyDescriptor(proto, "value").set.call(field, ${JSON.stringify(value)});
	field.dispatchEvent(new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
})()`;
export const NAME_FIELD = "#chops-panel .chop-editor input[type='text']";
export const TEXT_FIELD = "#chops-panel .chop-editor textarea";
export const SAVED_NAMES = `${STORE}.getState().preferences.chops.map(chop => chop.name)`;

/**
 * Open the sample page once for the describe that calls this, hand it to
 * `use`, close it after, and load it afresh before each test. The page counts
 * as loaded once the repositories are listed, which can be before Timber is
 * ready; chops wait for both.
 */
export function openChopsPage(use: (page: BrowserPage) => void): void {
	let page: BrowserPage | undefined;

	beforeAll(async () => {
		page = await openSidebarPage();
		use(page);
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	beforeEach(async () => {
		await page!.reload();
		await page!.until(`document.querySelector(${JSON.stringify(BUTTON)}) !== null`, "chops were offered");
	}, 30_000);
}
