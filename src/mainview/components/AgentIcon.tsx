import { agentById } from "../../shared/agent-registry";
import type { AgentBrand } from "../../shared/session-status";

/**
 * An agent's official mark, from the agent registry (`mark` in
 * src/shared/agent-registry.ts, which says where each was taken from):
 * Claude's spark for Claude Code, and OpenAI's mark for Codex. They are the
 * makers' trademarks, shown only to say which agent a session runs. Hidden
 * from assistive technology: the agent's name is always in words beside it or
 * in a description.
 */
export function AgentIcon({ brand }: { brand: AgentBrand }) {
	const mark = agentById(brand).mark;
	return (
		<svg className={`agent-icon agent-icon-${brand}`} aria-hidden="true" width="12" height="12" viewBox={mark.viewBox}>
			<path d={mark.path} fill={mark.fill} />
		</svg>
	);
}
