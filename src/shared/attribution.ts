/**
 * Lines that credit an AI assistant as an author, such as a coauthor trailer
 * or "Generated with Claude Code". The commit hook and CI refuse them
 * (scripts/check-commit-attribution.ts), and text an agent wrote loses them
 * (./generate-text.ts). Pure.
 */
const assistantRoots = new Set([
	"claude", "codex", "chatgpt", "gpt", "openai", "anthropic", "cursor", "composer",
	"copilot", "gemini", "grok", "windsurf", "codeium", "devin", "aider", "ai",
]);
const assistantSuffixes = new Set([
	"code", "codex", "ai", "assistant", "agent", "bot", "swe", "opus", "sonnet",
	"haiku", "luna", "sol", "astra", "composer",
]);
const assistantEmail = /(?:^(?:[^@]*\+)?(?:claude|codex|chatgpt|copilot|cursor|gemini|grok|devin|ai)(?:\[bot\])?@users\.noreply\.github\.com$|^noreply@(?:anthropic\.com|openai\.com|cursor\.com|cursor\.sh)$)/iu;

/** Whether a name and email are an assistant's. Tokenizes identities without overlapping nested regex repetitions. */
export function assistantIdentity(name: string, email: string): boolean {
	if (assistantEmail.test(email)) return true;
	let normalized = name.trim().toLowerCase();
	if (normalized.startsWith("🤖")) normalized = normalized.slice("🤖".length).trimStart();
	if (normalized.endsWith("[bot]")) normalized = normalized.slice(0, -"[bot]".length).trimEnd();
	const words = normalized.split(/[\s._-]+/u).filter(Boolean);
	const root = words.shift();
	if (root === "github" || root === "amazon") {
		if (words.shift() !== (root === "github" ? "copilot" : "q")) return false;
	} else if (!root || !assistantRoots.has(root)) return false;
	return words.every(word => assistantSuffixes.has(word) || /^\d\w*$/u.test(word));
}

/** Whether one line credits an AI assistant as an author. Normal AI feature descriptions and human credits are not such lines. */
export function isAIAttributionLine(line: string): boolean {
	const trailer = /^\s*(?:co[- ]?authored[- ]by|generated[- ]by|assisted[- ]by|signed[- ]off[- ]by):\s*(.+)$/iu.exec(line);
	if (trailer) {
		const identity = trailer[1]!;
		const email = /<([^<>]+)>/u.exec(identity)?.[1] ?? "";
		const angle = identity.indexOf("<");
		return assistantIdentity((angle === -1 ? identity : identity.slice(0, angle)).trim(), email);
	}
	const generated = /^\s*(?:🤖\s*)?generated (?:with|by)\s+(.+)$/iu.exec(line);
	const name = generated?.[1]?.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").trim();
	return name !== undefined && assistantIdentity(name, "");
}

/** Whether any line of a message is one. */
export function hasAIAttribution(message: string): boolean {
	return message.split(/\r?\n/u).some(isAIAttributionLine);
}
