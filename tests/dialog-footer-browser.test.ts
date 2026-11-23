import { afterAll, afterEach, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The footer buttons of the setup wizard and the New worktree dialog stay in
 * place (issue 333): stepping through the wizard, switching the dialog's
 * modes, running, and a failure never move Cancel, Back, or the submit
 * button, and a failure or progress shows in view, at the default window
 * size, a shorter one, and the smallest the app keeps
 * (src/shared/window-frame.ts), in Timber Light and Timber Dark. Layout needs
 * a real browser, so this is skipped where none is installed.
 */

const STORE = "window.timberTestStore";
const ENGINE = "window.timberTestEngine";
const REPOSITORY = "/work/timber";
const FAILURE = { command: null, diagnostic: "Stopped for the test.", output: null };

interface Box { label: string; left: number; top: number; width: number; height: number }

/** Each footer button of the open dialog, where it is drawn and how large, unrounded. */
const BUTTONS = `[...document.querySelectorAll("dialog[open] .dialog-buttons .button")].map(button => {
	const box = button.getBoundingClientRect();
	return { label: button.textContent, left: box.left, top: box.top, width: box.width, height: box.height };
})`;

/**
 * Whether the first element in the open dialog that matches is in view:
 * drawn, inside the dialog, and above its footer, not scrolled away.
 */
const inView = (selector: string) => `(() => {
	const dialog = document.querySelector("dialog[open]");
	const element = dialog.querySelector(${JSON.stringify(selector)});
	if (!element) return false;
	const box = element.getBoundingClientRect();
	return box.height > 0 && box.top >= dialog.getBoundingClientRect().top && box.bottom <= dialog.querySelector(".dialog-foot").getBoundingClientRect().top + 0.5;
})()`;

/** Expects every look at the buttons to find them at the same place and size as the first, within a tenth of a pixel. */
function expectSteady(looks: { where: string; buttons: Box[] }[]) {
	const [first, ...rest] = looks;
	expect(first!.buttons.length).toBeGreaterThan(1);
	for (const look of rest) {
		expect({ where: look.where, count: look.buttons.length }).toEqual({ where: look.where, count: first!.buttons.length });
		look.buttons.forEach((button, index) => {
			const before = first!.buttons[index]!;
			for (const side of ["left", "top", "width", "height"] as const) {
				const moved = Math.abs(button[side] - before[side]);
				expect({ where: look.where, button: button.label, side, moved: moved < 0.1 ? 0 : moved }).toEqual({ where: look.where, button: button.label, side, moved: 0 });
			}
		});
	}
}

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("dialog footer buttons in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.until(`${STORE}.getState().repositories.some(repository => repository.path === ${JSON.stringify(REPOSITORY)})`, "the repositories were listed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	const look = async (where: string) => ({ where, buttons: await page.evaluate<Box[]>(BUTTONS) });
	// At the smallest window the footer covers most of the dialog, so a pointer could not reach every control there.
	const press = (selector: string) => page.evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);

	for (const theme of ["timber-light", "timber-dark"]) {
		for (const [width, height] of [[1280, 820], [1280, 600], [480, 320]] as const) {
			describe(`in ${theme} at ${width}x${height}`, () => {
				beforeAll(async () => {
					await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" } })`);
					await page.resize(width, height);
				});

				// A test that stopped part of the way leaves no dialog for the next.
				afterEach(async () => {
					await page.evaluate(`${STORE}.closeDialog()`);
				});

				// Under the sticky footer of the smallest window the fields, a failure, and progress can sit out of view, as before.
				const checksView = height > 540;

				test("stepping through the setup wizard, saving, and a failed save never move Cancel, Back, or Next", async () => {
					await page.evaluate(`${STORE}.openDialog({ kind: "set-up-timber", repository: ${JSON.stringify(REPOSITORY)} })`);
					await page.until(`document.querySelector("dialog[open] .wizard-step")?.textContent.startsWith("Step 1 of 7") && !document.querySelector("dialog[open] .dialog-body [role=status]")`, "the wizard read the settings");
					const looks = [await look("Step 1")];
					for (let step = 2; step <= 7; step++) {
						await press("dialog[open] button[type=submit]");
						await page.until(`document.querySelector("dialog[open] .wizard-step")?.textContent.startsWith("Step ${step} of 7")`, `step ${step} showed`);
						looks.push(await look(`Step ${step}`));
					}
					// The Issue tracking step was taller than the dialog, so it scrolled, and others did not: the body in a
					// window of usual height, and the whole dialog in one too short for that.
					const scroller = height > 540 ? ".dialog-body" : "";
					await press("dialog[open] .dialog-buttons .button:nth-child(2)");
					await page.until(`document.querySelector("dialog[open] .wizard-step")?.textContent.startsWith("Step 6 of 7")`, "Back went to step 6");
					expect(await page.evaluate<boolean>(`(() => { const box = document.querySelector("dialog[open] ${scroller}"); return box.scrollHeight > box.clientHeight; })()`)).toBe(true);
					await press("dialog[open] button[type=submit]");
					await page.until(`document.querySelector("dialog[open] .wizard-step")?.textContent.startsWith("Step 7 of 7")`, "Next went back to step 7");
					if (await page.evaluate<boolean>(`document.querySelector("dialog[open] .wizard-summary ~ * input[type=checkbox]") !== null`)) {
						await press("dialog[open] .wizard-summary ~ * input[type=checkbox]");
					}
					await page.evaluate(`(() => {
						${ENGINE}.saveTimberSettings = () => new Promise(resolve => { window.releaseSave = resolve; });
					})()`);
					// Save waits until the last step has shown for half a second.
					await Bun.sleep(600);
					await press("dialog[open] button[type=submit]");
					await page.until(`document.querySelector("dialog[open] button[type=submit]")?.textContent === "Saving"`, "the wizard was saving");
					looks.push(await look("Saving"));
					if (checksView) expect(await page.evaluate<boolean>(inView(".dialog-progress"))).toBe(true);
					await page.evaluate(`window.releaseSave(${JSON.stringify({ outcome: "failed", failure: FAILURE })})`);
					await page.until(`document.querySelector("dialog[open] button[type=submit]")?.textContent === "Save" && document.querySelector("dialog[open]").textContent.includes(${JSON.stringify(FAILURE.diagnostic)})`, "the failure showed");
					looks.push(await look("After a failed save"));
					expectSteady(looks);
				});

				test("switching the New worktree dialog's modes, running, and a failure never move its buttons", async () => {
					await page.evaluate(`${STORE}.openDialog({ kind: "new-worktree", repository: ${JSON.stringify(REPOSITORY)}, mode: "new" })`);
					await page.until(`document.querySelector("dialog[open] input[name=name]") === document.activeElement`, "the dialog opened on New branch");
					const looks = [await look("New branch")];
					const modes = await page.evaluate<number>(`document.querySelectorAll("dialog[open] .mode-option").length`);
					expect(modes).toBe(3);
					for (const index of [2, 3, 1]) {
						await press(`dialog[open] .mode-option:nth-child(${index}) .mode-radio`);
						await page.until(`document.querySelector("dialog[open] .mode-option:nth-child(${index}) .mode-radio").checked`, `mode ${index} showed`);
						looks.push(await look(`Mode ${index}`));
					}
					await page.evaluate(`document.querySelector("dialog[open] input[name=name]").focus()`);
					await page.type("steady-footer");
					await page.evaluate(`(() => {
						${ENGINE}.newWorktree = () => new Promise(resolve => { window.releaseCreate = resolve; });
					})()`);
					await press("dialog[open] button[type=submit]");
					await page.until(`document.querySelector("dialog[open] button[type=submit]")?.textContent === "Running"`, "the command was running");
					looks.push(await look("Running"));
					if (checksView) expect(await page.evaluate<boolean>(inView(".dialog-progress"))).toBe(true);
					await page.evaluate(`window.releaseCreate(${JSON.stringify({ outcome: "failed", failure: FAILURE, worktree: null, created: false, setupSkipped: false })})`);
					await page.until(`document.querySelector("dialog[open] button[type=submit]")?.textContent === "Create worktree" && document.querySelector("dialog[open]").textContent.includes(${JSON.stringify(FAILURE.diagnostic)})`, "the failure showed");
					looks.push(await look("After a failure"));
					// In a shorter window the rest of a failure scrolls under its start, but what failed and why are in view.
					if (checksView) expect(await page.evaluate<boolean>(inView(".failure-title"))).toBe(true);
					if (checksView) expect(await page.evaluate<boolean>(inView(".failure-diagnostic"))).toBe(true);
					expectSteady(looks);
				});
			});
		}
	}
});
