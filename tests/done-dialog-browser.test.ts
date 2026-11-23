import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { DONE_COMMAND_LABEL, DONE_LEAD, DONE_PREVIEW_COMMAND_LABEL } from "../src/mainview/done-format";
import { sampleRepositories } from "../src/mainview/engine/mock";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";

/**
 * The Done dialog leads with a plain sentence and shows its exact Timber
 * commands in full, smaller and dimmed under a label (issue 329). Its title,
 * which can name a long branch and its upstream, wraps inside the dialog
 * rather than pushing it sideways. Checked for the sample worktree whose
 * branch has commits to push, at the default window width and a narrow one,
 * in Timber Light and Timber Dark. Layout needs a real browser, so this is
 * skipped where none is installed.
 */

const STORE = "window.timberTestStore";
const repository = sampleRepositories[0]!;
const worktree = repository.worktrees.find(candidate => candidate.branch === "fix/macos-portability")!;
const REQUEST = `{ kind: "done-worktree", repository: ${JSON.stringify(repository.path)}, worktree: ${JSON.stringify(worktree.id)} }`;

interface Look {
	title: string;
	titleLines: number;
	sideways: number;
	lead: string | null;
	leadBeforePath: boolean;
	labels: string[];
	/**
	 * For each labelled command: its label sits right above it, the command
	 * is smaller than a command other dialogs show without a label, and it is
	 * drawn in the theme's quietest text color, which the theme contrast check
	 * covers on the dialog's surface.
	 */
	commands: { label: string; above: boolean; smaller: boolean; dimmer: boolean; full: boolean }[];
}

const LOOK = `(() => {
	const dialog = document.querySelector("dialog[open]");
	const title = dialog.querySelector(".dialog-title");
	const lineHeight = parseFloat(getComputedStyle(title).lineHeight) || parseFloat(getComputedStyle(title).fontSize) * 1.2;
	const lead = dialog.querySelector(".done-lead");
	const path = dialog.querySelector(".done-target .path");
	// A command as other dialogs show it, and the quietest text color, measured in the dialog.
	const plain = document.createElement("pre");
	plain.className = "dialog-command";
	const quiet = document.createElement("span");
	quiet.style.color = "var(--text-3)";
	dialog.append(plain, quiet);
	const plainSize = parseFloat(getComputedStyle(plain).fontSize);
	const quietColor = getComputedStyle(quiet).color;
	plain.remove();
	quiet.remove();
	const commands = [...dialog.querySelectorAll(".dialog-command-label")].map(label => {
		const command = label.nextElementSibling;
		const style = getComputedStyle(command);
		const gap = command.getBoundingClientRect().top - label.getBoundingClientRect().bottom;
		return {
			label: label.textContent,
			above: command.localName === "pre" && gap >= -1 && gap < 8,
			smaller: parseFloat(style.fontSize) < plainSize,
			dimmer: style.color === quietColor,
			full: command.scrollWidth <= command.clientWidth && command.textContent.includes(${JSON.stringify(worktree.path)}),
		};
	});
	return {
		title: title.textContent,
		titleLines: Math.round(title.getBoundingClientRect().height / lineHeight),
		sideways: dialog.scrollWidth - dialog.clientWidth,
		lead: lead && lead.textContent,
		leadBeforePath: Boolean(lead && path && lead.getBoundingClientRect().bottom <= path.getBoundingClientRect().top),
		labels: commands.map(command => command.label),
		commands,
	};
})()`;

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("the Done dialog in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage();
		await page.until(`${STORE}.getState().repositories.some(repository => repository.path === ${JSON.stringify(repository.path)})`, "the repositories were listed");
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	for (const theme of ["timber-light", "timber-dark"]) {
		for (const width of [1280, 480]) {
			test(`in ${theme} at ${width} pixels wide`, async () => {
				await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" } })`);
				await page.resize(width, 820);
				await page.evaluate(`${STORE}.closeDialog()`);
				await page.evaluate(`${STORE}.openDialog(${REQUEST})`);
				await page.until(`document.querySelector("dialog[open] .done-preview .done-line") !== null`, "the preview showed");
				const look = await page.evaluate<Look>(LOOK);
				await page.evaluate(`${STORE}.closeDialog()`);

				expect(look.title).toBe("fix/macos-portability has 3 commits not on origin/fix/macos-portability");
				// At the narrow width the title wraps instead of widening the dialog.
				if (width === 480) expect(look.titleLines).toBeGreaterThan(1);
				expect(look.sideways).toBe(0);
				expect(look.lead).toBe(DONE_LEAD);
				expect(look.leadBeforePath).toBe(true);
				expect(look.labels).toEqual([DONE_PREVIEW_COMMAND_LABEL, DONE_COMMAND_LABEL]);
				for (const command of look.commands) expect(command).toEqual({ label: command.label, above: true, smaller: true, dimmer: true, full: true });
			}, 60_000);
		}
	}
});
