import { useId } from "react";
import { agentById } from "../../shared/agent-registry";
import type { AgentBrand } from "../../shared/session-status";

/**
 * An agent's official mark, from the agent registry (`mark` in
 * src/shared/agent-registry.ts, which says where each was taken from):
 * Claude's spark for Claude Code, OpenAI's mark for Codex, Cursor's cube,
 * Gemini's spark, Grok's mark, OpenCode's mark, GitHub's Copilot mark, Qwen Code's mark,
 * Amp's wordmark, and Pi's mark.
 * They are the makers' trademarks, shown only to say which agent a session
 * runs. Hidden from assistive technology: the agent's name is always in
 * words beside it or in a description.
 */
export function AgentIcon({ brand }: { brand: AgentBrand }) {
	const mark = agentById(brand).mark;
	// Each drawing of a gradient mark needs its own id: several are on the page at once.
	const gradientId = `agent-icon-gradient-${useId()}`;
	const fill = typeof mark.fill === "string" ? mark.fill : `url(#${gradientId})`;
	return (
		<svg className={`agent-icon agent-icon-${brand}`} aria-hidden="true" width="12" height="12" viewBox={mark.viewBox}>
			{typeof mark.fill !== "string" && (
				<defs>
					<radialGradient id={gradientId} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform={mark.fill.transform}>
						{mark.fill.stops.map(stop => <stop key={stop.offset} offset={stop.offset} stopColor={stop.color} />)}
					</radialGradient>
				</defs>
			)}
			{mark.paths.map((path, index) => (
				<path key={index} d={path.d} fill={fill} {...(path.fillRule ? { fillRule: path.fillRule, clipRule: path.fillRule } : {})} {...(path.opacity !== undefined ? { fillOpacity: path.opacity } : {})} />
			))}
		</svg>
	);
}
