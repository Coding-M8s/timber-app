import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { type BrowserPage, browserPath, openSidebarPage } from "./support/browser";
import { AGENT_PRESETS } from "../src/shared/agent";
import { AGENTS } from "../src/shared/agent-registry";

/**
 * Each agent of the registry's mark in a real browser, over the mock engine:
 * a session of each, started from its preset, shows its mark on its chip and
 * on its worktree's row, drawn and in view, in Timber Light and Timber
 * Dark. A one-color mark is the theme's text color; Gemini's spark is its
 * gradient. Skipped where no browser is installed.
 */

const STORE = "window.timberTestStore";
const REPOSITORY = "/work/storefront";
const WORKTREE = "/work/storefront-worktrees/fix-currency-rounding";
const ITEM = `[...document.querySelectorAll(".row-item")].find(item => item.querySelector(".row-name")?.textContent === "fix/currency-rounding")`;

/** How the agent's mark is drawn in a place: its size, and each shape's fill as the browser resolved it. */
const drawn = (place: string, id: string) => `(() => {
	const icon = ${place}?.querySelector(".agent-icon-${id}");
	if (!icon) return null;
	const box = icon.getBoundingClientRect();
	const paths = [...icon.querySelectorAll("path")];
	const gradient = icon.querySelector("radialGradient");
	return {
		width: box.width, height: box.height,
		fills: paths.map(path => getComputedStyle(path).fill),
		text: getComputedStyle(document.querySelector(".row-name")).color,
		gradientFound: gradient !== null && paths.every(path => path.getAttribute("fill") === "url(#" + gradient.id + ")") && document.getElementById(gradient.id) === gradient,
	};
})()`;

interface Drawn { width: number; height: number; fills: string[]; text: string; gradientFound: boolean }

// Not tried on Windows yet, so it does not run there.
describe.skipIf(browserPath === null || process.platform === "win32")("each agent's mark in a real browser", () => {
	let page: BrowserPage;

	beforeAll(async () => {
		page = await openSidebarPage("browser-sample-page.tsx");
		await page.evaluate(`${STORE}.savePreferences({ agents: ${JSON.stringify(AGENT_PRESETS)} })`);
		await page.until(ITEM, "the worktree's row showed");
		// The chips show for the worktree that is chosen.
		await page.evaluate(`${STORE}.select(${STORE}.getState().repositories.flatMap(repository => repository.worktrees).find(worktree => worktree.path === ${JSON.stringify(WORKTREE)}).id)`);
	}, 60_000);

	afterAll(async () => {
		await page?.close();
	});

	/** The fill of the one-color marks in each theme, which must differ between a light and a dark theme. */
	const oneColor = new Map<string, Set<string>>();

	for (const theme of ["timber-light", "timber-dark"]) {
		test(`a session of each agent shows its mark on its chip and its row, in ${theme}`, async () => {
			await page.evaluate(`${STORE}.savePreferences({ theme: { mode: "fixed", theme: "${theme}" } })`);
			for (const agent of AGENTS) {
				const preset = AGENT_PRESETS.find(preset => preset.command === agent.command)!;
				await page.evaluate(`${STORE}.openTerminal({ repository: ${JSON.stringify(REPOSITORY)}, worktree: ${JSON.stringify(WORKTREE)}, cols: 80, rows: 24, agent: ${JSON.stringify(preset.name)} })`);
				await page.until(`${ITEM}?.querySelector(".agent-icon-${agent.id}") && document.querySelector(".session-kind .agent-icon-${agent.id}")`, `${agent.name}'s mark showed`);
				const chip = await page.evaluate<Drawn | null>(drawn(`document.querySelector(".session-kind.branded:has(.agent-icon-${agent.id})")`, agent.id));
				const row = await page.evaluate<Drawn | null>(drawn(ITEM, agent.id));
				for (const [place, mark] of [["chip", chip], ["row", row]] as const) {
					expect(mark, `${agent.name} on its ${place}`).not.toBeNull();
					expect(mark!.width).toBeGreaterThan(0);
					expect(mark!.height).toBeGreaterThan(0);
					if (typeof agent.mark.fill !== "string") {
						expect(mark!.gradientFound, `${agent.name}'s gradient on its ${place}`).toBe(true);
					} else if (agent.mark.fill === "currentColor") {
						// The theme's text color, as a worktree's name is drawn.
						for (const fill of mark!.fills) expect(fill).toBe(mark!.text);
						for (const fill of mark!.fills) oneColor.set(theme, (oneColor.get(theme) ?? new Set()).add(fill));
					} else {
						for (const fill of mark!.fills) expect(fill).not.toBe("none");
					}
				}
				const id = await page.evaluate<string>(`${STORE}.getState().terminals.find(session => session.program === "${agent.id}")?.id ?? ""`);
				expect(id, `${agent.name}'s session carries its program`).not.toBe("");
				await page.evaluate(`${STORE}.closeTerminal(${JSON.stringify(id)})`);
				await page.until(`!${ITEM}?.querySelector(".agent-icon-${agent.id}")`, `${agent.name}'s session closed`);
			}
		}, 60_000);
	}

	test("a one-color mark is one color in each theme, and not the same in light and dark", () => {
		const light = [...oneColor.get("timber-light") ?? []];
		const dark = [...oneColor.get("timber-dark") ?? []];
		expect(light).toHaveLength(1);
		expect(dark).toHaveLength(1);
		expect(light[0]).not.toBe(dark[0]);
	});
});
