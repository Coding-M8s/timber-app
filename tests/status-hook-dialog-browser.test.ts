import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The status hook of a Cursor CLI row in Settings, Agents (issue 350), in a
 * real browser over the mock engine: the row's status line, the Turn on
 * dialog stacked over Settings, Escape closing only that dialog, and Turn on
 * changing the line to On. In Timber Light and Timber Dark, at the default
 * window width and a narrow one, where the files and the script scroll inside
 * their own boxes rather than widening the dialog. Skipped where no browser
 * is installed.
 */

const STORE = "window.timberTestStore";
const LINE = `document.querySelector(".agent-rows > li:nth-child(3) .agent-status")`;
/** The section's Save bar stays at the bottom of Settings, so the line is brought to the middle first, as a person scrolls to it. */
const CENTER = `${LINE}.scrollIntoView({ block: "center" })`;

interface Look {
	settingsOpen: boolean;
	hookOpen: boolean;
	title: string | null;
	labels: string[];
	sideways: number;
	focused: string | null;
	scriptShown: boolean;
}

const LOOK = `(() => {
	const hook = document.querySelector("dialog.status-hook-dialog[open]");
	return {
		settingsOpen: document.querySelector("dialog.settings-dialog[open]") !== null,
		hookOpen: hook !== null,
		title: hook && hook.querySelector(".dialog-title").textContent,
		labels: hook ? [...hook.querySelectorAll(".dialog-command-label")].map(label => label.textContent) : [],
		sideways: hook ? hook.scrollWidth - hook.clientWidth : 0,
		focused: document.activeElement && document.activeElement.textContent,
		scriptShown: Boolean(hook && hook.textContent.includes('[ -n "$TIMBER_APP_STATUS" ] || exit 0')),
	};
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the status hook in Settings, Agents, in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	for (const theme of ["timber-light", "timber-dark"]) {
		for (const width of [1280, 480]) {
			test(`in ${theme} at ${width} pixels wide`, async () => {
				await page.reload();
				await page.until(`${STORE}.getState().repositories.length > 0`, "the repositories were listed");
				await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" }, agents: [{ name: "Claude Code", command: "claude" }, { name: "Codex", command: "codex" }, { name: "Cursor CLI", command: "cursor-agent" }] })`);
				await page.resize(width, 820);
				await page.evaluate(`${STORE}.openDialog({ kind: "settings", section: "agents" })`);
				await page.until(`${LINE} !== null && ${LINE}.textContent.includes("Off.")`, "the Cursor CLI row says its hook is off");
				expect(await page.evaluate<string>(`${LINE}.textContent`)).toBe("Status hook Off. Its sessions show only running or exited.Turn on…");
				expect(await page.evaluate<string>(`document.querySelector(".agent-rows > li:nth-child(1) .agent-status").textContent`)).toBe("Status Reports working, needs you, and done itself.");

				await page.evaluate(CENTER);
				await page.click(".agent-rows > li:nth-child(3) .agent-status button");
				await page.until(`document.querySelector("dialog.status-hook-dialog[open]") !== null`, "the Turn on dialog opened");
				const look = await page.evaluate<Look>(LOOK);
				expect(look).toMatchObject({ settingsOpen: true, hookOpen: true, title: "Turn on the Cursor CLI status hook?", sideways: 0, focused: "Cancel", scriptShown: true });
				expect(look.labels).toEqual(["~/.cursor/hooks.json", "The script they run, ~/.config/timber-app/status-hook"]);

				// Escape closes the hook dialog only; Settings stays.
				await page.press("Escape");
				await page.until(`document.querySelector("dialog.status-hook-dialog[open]") === null`, "the hook dialog closed");
				expect((await page.evaluate<Look>(LOOK)).settingsOpen).toBe(true);
				await page.until(`document.activeElement?.textContent === "Turn on…"`, "focus came back to Turn on");

				await page.evaluate(CENTER);
				await page.click(".agent-rows > li:nth-child(3) .agent-status button");
				await page.until(`document.querySelector("dialog.status-hook-dialog[open] .button.primary") !== null`, "the Turn on dialog opened again");
				await page.click("dialog.status-hook-dialog[open] .button.primary");
				await page.until(`${LINE}.textContent.startsWith("Status hook On, in ~/.cursor/hooks.json.")`, "the line says On");
				expect((await page.evaluate<Look>(LOOK)).hookOpen).toBe(false);
				await page.until(`document.activeElement?.textContent === "Remove…"`, "focus went to Remove");
				await page.evaluate(`${STORE}.closeDialog()`);
			}, 60_000);
		}
	}
});
