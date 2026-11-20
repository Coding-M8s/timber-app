import { readFile } from "node:fs/promises";

const assistantRoots = new Set([
	"claude", "codex", "chatgpt", "gpt", "openai", "anthropic", "cursor", "composer",
	"copilot", "gemini", "grok", "windsurf", "codeium", "devin", "aider", "ai",
]);
const assistantSuffixes = new Set([
	"code", "codex", "ai", "assistant", "agent", "bot", "swe", "opus", "sonnet",
	"haiku", "luna", "sol", "astra", "composer",
]);
const assistantEmail = /(?:^(?:[^@]*\+)?(?:claude|codex|chatgpt|copilot|cursor|gemini|grok|devin|ai)(?:\[bot\])?@users\.noreply\.github\.com$|^noreply@(?:anthropic\.com|openai\.com|cursor\.com|cursor\.sh)$)/iu;

/** Tokenize identities without overlapping nested regex repetitions. */
function assistantIdentity(name: string, email: string): boolean {
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

/** Inspect attribution lines only; normal AI feature descriptions and human credits remain valid. */
export function hasAIAttribution(message: string): boolean {
	return message.split(/\r?\n/u).some(line => {
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
	});
}

function git(args: readonly string[]): string {
	const result = Bun.spawnSync(["git", ...args], { stdin: "ignore", stdout: "pipe", stderr: "pipe" });
	if (result.exitCode !== 0) throw new Error("Cannot read commit range; ensure its history is available.");
	return result.stdout.toString();
}
function gitOk(args: readonly string[]): boolean {
	return Bun.spawnSync(["git", ...args], { stdin: "ignore", stdout: "ignore", stderr: "ignore" }).exitCode === 0;
}
function object(value: unknown): Record<string, unknown> | undefined {
	return value !== null && typeof value === "object" && !Array.isArray(value)
		? value as Record<string, unknown> : undefined;
}

/** Event commit arrays can be incomplete. Derive coverage from Git, or refuse the check. */
function branchRange(event: Record<string, unknown>, head: string, newBranch: boolean): string {
	const defaultBranch = object(event.repository)?.default_branch;
	if (typeof defaultBranch !== "string" || !defaultBranch
		|| !gitOk(["check-ref-format", `refs/remotes/origin/${defaultBranch}`])
		|| typeof event.ref !== "string" || !event.ref.startsWith("refs/heads/")
		|| !gitOk(["check-ref-format", event.ref]))
		throw new Error("Cannot determine branch base from CI event.");
	if (event.ref === `refs/heads/${defaultBranch}`) {
		if (newBranch) return head;
		throw new Error("Cannot check rewritten default branch without its previous commit history.");
	}
	const base = git(["merge-base", `refs/remotes/origin/${defaultBranch}`, head]).trim();
	return `${base}..${head}`;
}

async function check(args: readonly string[]): Promise<void> {
	if (args[0] === "--message-file" && args.length === 2) {
		if (hasAIAttribution(await readFile(args[1]!, "utf8")))
			throw new Error("AI coauthor/attribution signatures are prohibited. Remove the AI credit; human coauthors are allowed.");
		return;
	}
	let range = "HEAD";
	let tipOnly = true;
	if (args[0] === "--event" && args.length === 2) {
		const event = object(JSON.parse(await readFile(args[1]!, "utf8")) as unknown);
		if (!event) throw new Error("Cannot determine commits to check from CI event.");
		const pr = object(event.pull_request);
		const isPullRequest = event.pull_request !== undefined;
		if (typeof pr?.body === "string" && hasAIAttribution(pr.body))
			throw new Error("AI attribution signatures are prohibited in PR descriptions.");
		const base = isPullRequest ? object(pr?.base)?.sha : event.before;
		const head = isPullRequest ? object(pr?.head)?.sha : event.after;
		const oid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u;
		if (typeof base !== "string" || typeof head !== "string" || !oid.test(base) || !oid.test(head))
			throw new Error("Cannot determine commits to check from CI event.");
		if (/^0+$/u.test(head)) return;
		tipOnly = false;
		if (/^0+$/u.test(base)) range = branchRange(event, head, true);
		else if (!isPullRequest && !gitOk(["cat-file", "-e", `${base}^{commit}`]))
			range = branchRange(event, head, false);
		else range = `${base}..${head}`;
	} else if (args.length === 1 && args[0] === "--all-history") {
		tipOnly = false;
	} else if (args.length) {
		throw new Error("Usage: check-commit-attribution.ts [--message-file <path> | --event <path> | --all-history]");
	}
	// Fixed-width NUL fields keep names and messages separate without printing either.
	const fields = git(["log", "--format=%H%x00%an%x00%ae%x00%cn%x00%ce%x00%B%x00", ...(tipOnly ? ["-1"] : []), "--end-of-options", range]).split("\0");
	const rejected: string[] = [];
	for (let i = 0; i + 5 < fields.length; i += 6) {
		if (assistantIdentity(fields[i + 1]!, fields[i + 2]!)
			|| assistantIdentity(fields[i + 3]!, fields[i + 4]!)
			|| hasAIAttribution(fields[i + 5]!)) rejected.push(fields[i]!.trim().slice(0, 12));
	}
	if (rejected.length) throw new Error(`AI attribution found in commits: ${rejected.join(", ")}. Commit messages were not changed.`);
}

if (import.meta.main) {
	try { await check(process.argv.slice(2)); }
	catch (error) {
		console.error(error instanceof Error ? error.message : "Cannot check commit attribution.");
		process.exitCode = 1;
	}
}
