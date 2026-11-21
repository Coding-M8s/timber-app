import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The Arena mode of the New worktree dialog fits the dialog's width (issue
 * 248): no sideways scroll at 1280 px wide and wider, and at narrow widths
 * the group fields stack rather than being cut off. Layout needs a real
 * browser, so this is skipped where none is installed.
 */

const REPOSITORY = "/work/timber";
// A preset makes the widest choice in "Tool or preset".
const PRESET = "careful-review";

/** How many lines each group's fields take, by the distinct tops of its fields. */
const LINES = `[...document.querySelectorAll("dialog[open] .arena-group")].map(group => new Set([...group.querySelectorAll(".field")].map(field => Math.round(field.getBoundingClientRect().top))).size)`;

/**
 * What does not fit: the dialog's own sideways scroll, each field in the
 * form whose box passes the dialog's inner edges, and each field whose
 * text is cut short. Empty when everything fits.
 */
const MISFITS = `(() => {
	const dialog = document.querySelector("dialog[open]");
	const inner = dialog.getBoundingClientRect();
	const left = inner.left + dialog.clientLeft;
	const right = left + dialog.clientWidth;
	const misfits = [];
	if (dialog.scrollWidth > dialog.clientWidth) misfits.push("the dialog scrolls sideways by " + (dialog.scrollWidth - dialog.clientWidth) + "px");
	for (const element of dialog.querySelectorAll(".arena-group .field, .arena-group .text-button, .arena-groups > .text-button")) {
		const box = element.getBoundingClientRect();
		const name = element.querySelector(".field-label")?.textContent ?? element.textContent;
		if (box.left < left - 0.5 || box.right > right + 0.5) misfits.push(name + " passes the dialog's edge");
	}
	// A select or input narrower than the longest text it must show cuts that text off.
	const measure = document.createElement("span");
	measure.style.cssText = "position:absolute;visibility:hidden;white-space:pre";
	document.body.append(measure);
	for (const select of dialog.querySelectorAll(".arena-group select")) {
		measure.style.font = getComputedStyle(select).font;
		measure.textContent = select.selectedOptions[0].textContent;
		// The arrow and the padding take about 30px beside the text.
		if (measure.getBoundingClientRect().width + 30 > select.clientWidth) misfits.push("Tool or preset cuts off " + measure.textContent);
	}
	for (const input of dialog.querySelectorAll(".arena-group input:not([type=number])")) {
		measure.style.font = getComputedStyle(input).font;
		measure.textContent = input.value || input.placeholder;
		if (measure.getBoundingClientRect().width + 18 > input.clientWidth) misfits.push(input.closest(".field").querySelector(".field-label").textContent + " cuts off " + measure.textContent);
	}
	measure.remove();
	return misfits;
})()`;

describe.skipIf(browserPath === null || process.platform === "win32")("the arena form's width in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.evaluate(`(() => {
			window.timberTestEngine.setArenaPresets(${JSON.stringify(REPOSITORY)}, [{ name: ${JSON.stringify(PRESET)}, tool: "claude" }]);
			window.timberTestStore.openDialog({ kind: "new-worktree", repository: ${JSON.stringify(REPOSITORY)}, mode: "arena" });
		})()`);
		await page.until(`[...document.querySelectorAll("dialog[open] .arena-group select option")].some(option => option.textContent.includes(${JSON.stringify(PRESET)}))`, "the arena form showed with the preset");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	test("as it opens, with one group, nothing scrolls sideways or is cut off at 1280 px wide", async () => {
		await page.resize(1280, 900);
		expect(await page.evaluate<number>(`document.querySelectorAll("dialog[open] .arena-group").length`)).toBe(1);
		expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
	});

	describe("with three groups, the first on a preset and another with a model typed", () => {
		beforeAll(async () => {
			await page.click("dialog[open] .arena-groups > .text-button");
			await page.click("dialog[open] .arena-groups > .text-button");
			await page.until(`document.querySelectorAll("dialog[open] .arena-group").length === 3`, "three groups showed");
			await page.evaluate(`(() => {
				const set = (element, prototype, value) => {
					Object.getOwnPropertyDescriptor(prototype.prototype, "value").set.call(element, value);
					element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
				};
				const [first, second] = document.querySelectorAll("dialog[open] .arena-group");
				const select = first.querySelector("select");
				set(select, HTMLSelectElement, [...select.options].find(option => option.textContent.includes(${JSON.stringify(PRESET)})).value);
				set(second.querySelector("input"), HTMLInputElement, "claude-opus-5-5");
			})()`);
			await page.until(`document.querySelector("dialog[open] .arena-group select").selectedOptions[0].textContent.includes(${JSON.stringify(PRESET)}) && document.querySelectorAll("dialog[open] .arena-group")[1].querySelector("input").value === "claude-opus-5-5"`, "the groups took the preset and the model");
		});

		for (const width of [1280, 1600, 1920]) {
			test(`at ${width} px wide, nothing scrolls sideways or is cut off`, async () => {
				await page.resize(width, 900);
				expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
			});
		}

		for (const width of [720, 480, 360]) {
			test(`at ${width} px wide, the fields stack rather than being cut off`, async () => {
				await page.resize(width, 800);
				expect(await page.evaluate<string[]>(MISFITS)).toEqual([]);
				for (const lines of await page.evaluate<number[]>(LINES)) expect(lines).toBeGreaterThan(1);
			});
		}
	});
});
