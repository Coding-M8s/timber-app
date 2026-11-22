import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AgentIcon } from "../src/mainview/components/AgentIcon";
import { AGENTS } from "../src/shared/agent-registry";

describe("an agent's mark", () => {
	test("every agent of the registry draws its own mark, hidden from assistive technology", () => {
		for (const agent of AGENTS) {
			const markup = renderToStaticMarkup(<AgentIcon brand={agent.id} />);
			expect(markup).toContain(`<svg class="agent-icon agent-icon-${agent.id}" aria-hidden="true" width="12" height="12" viewBox="${agent.mark.viewBox}">`);
			expect(markup.match(/<path /g)).toHaveLength(agent.mark.paths.length);
			for (const path of agent.mark.paths) expect(markup).toContain(`d="${path.d}"`);
		}
	});

	test("one-color marks take the theme's text color, so they read in light and dark themes", () => {
		for (const id of ["codex", "cursor", "grok", "opencode", "copilot"] as const) {
			const markup = renderToStaticMarkup(<AgentIcon brand={id} />);
			expect(markup).toContain('fill="currentColor"');
			expect(markup).not.toContain("<radialGradient");
		}
		expect(renderToStaticMarkup(<AgentIcon brand="claude" />)).toContain('fill="#D97757"');
	});

	test("Copilot's holes stay open, and OpenCode's inner square is faint", () => {
		const copilot = renderToStaticMarkup(<AgentIcon brand="copilot" />);
		expect(copilot.match(/fill-rule="evenodd"/g)).toHaveLength(3);
		const opencode = renderToStaticMarkup(<AgentIcon brand="opencode" />);
		expect(opencode.match(/fill-opacity="0.2"/g)).toHaveLength(1);
	});

	test("Gemini's spark is filled with its gradient, under an id of each drawing's own", () => {
		const markup = renderToStaticMarkup(<><AgentIcon brand="gemini" /><AgentIcon brand="gemini" /></>);
		const ids = [...markup.matchAll(/<radialGradient id="([^"]+)"/g)].map(match => match[1]!);
		expect(ids).toHaveLength(2);
		expect(new Set(ids).size).toBe(2);
		for (const id of ids) expect(markup).toContain(`fill="url(#${id})"`);
		expect(markup).toContain('stop-color="#9168C0"');
		expect(markup).toContain('gradientUnits="userSpaceOnUse"');
	});
});
