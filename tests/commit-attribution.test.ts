import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { hasAIAttribution } from "../scripts/check-commit-attribution";
import { windows } from "./support/runtime";
import { git } from "./support/timber";

const root = fileURLToPath(new URL("..", import.meta.url));
const checker = join(root, "scripts/check-commit-attribution.ts");

function run(command: string[], cwd: string, env: Record<string, string | undefined> = process.env) {
	const result = Bun.spawnSync(command, { cwd, stdout: "pipe", stderr: "pipe", env });
	return { exitCode: result.exitCode, stderr: result.stderr.toString() };
}

test("AI attribution rejects assistant identities while keeping human credits and feature descriptions", () => {
	for (const credit of [
		"Co-authored-by: Claude <noreply@anthropic.com>",
		"co-authored-by: Codex <noreply@openai.com>",
		"Co-Authored-By: GitHub Copilot <copilot@github.com>",
		"Co-authored-by: Cursor <cursoragent@cursor.com>",
		"Co-authored-by: Gemini [bot] <bot@example.invalid>",
		"Assisted-by: AI assistant <bot@example.invalid>",
		"Generated-by: Claude Code",
		"🤖 Generated with [Claude Code](https://example.invalid)",
		"Generated with Amazon Q",
	]) expect(hasAIAttribution("Implement feature\r\n\r\n" + credit)).toBe(true);
	for (const message of [
		"Add Claude Code and Codex to the agent list",
		"Explain why AI coauthors are prohibited",
		"Fix bug\n\nCo-authored-by: Claude Smith <claude.smith@example.invalid>",
		"Fix bug\n\nCo-authored-by: Jane Doe <jane@openai.com>",
		"Signed-off-by: Jane Doe <jane@example.invalid>",
	]) expect(hasAIAttribution(message)).toBe(false);
});

describe.skipIf(windows)("the commit-msg hook and the history check against a real repository", () => {
	let folder: string;
	let primary: string;

	beforeEach(() => {
		folder = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-attribution-")));
		primary = join(folder, "sample");
		git(folder, "init", "--initial-branch=main", primary);
		writeFileSync(join(primary, "a.txt"), "one\n");
		git(primary, "add", "a.txt");
		git(primary, "commit", "-m", "First");
	});

	afterEach(() => rmSync(folder, { recursive: true, force: true }));

	test("the hook rejects an AI credit without moving HEAD or rewriting the message, and accepts a human credit", () => {
		const before = git(primary, "rev-parse", "HEAD");
		const badMessage = "Fix bug\n\nCo-authored-by: Codex <noreply@openai.com>";
		const commit = (message: string) => run(
			["git", "-c", `core.hooksPath=${join(root, ".githooks")}`, "-c", "user.name=Timber Test", "-c", "user.email=test@example.invalid", "-c", "commit.gpgsign=false", "commit", "--allow-empty", "-m", message],
			primary,
			{ ...process.env, GIT_CONFIG_GLOBAL: "", GIT_CONFIG_NOSYSTEM: "1" },
		);
		const rejected = commit(badMessage);
		expect(rejected.exitCode).toBe(1);
		expect(rejected.stderr).toContain("prohibited");
		expect(git(primary, "rev-parse", "HEAD")).toBe(before);
		expect(readFileSync(join(primary, ".git/COMMIT_EDITMSG"), "utf8")).toContain(badMessage);

		expect(commit("Fix bug\n\nCo-authored-by: Jane Doe <jane@example.invalid>").exitCode).toBe(0);
		expect(git(primary, "log", "-1", "--format=%B")).toContain("Jane Doe");
	});

	test("the history check names the offending commit without printing its message", () => {
		git(primary, "commit", "--allow-empty", "-m", "PRIVATE_SENTINEL\n\nCo-authored-by: Claude <noreply@anthropic.com>");
		const bad = git(primary, "rev-parse", "HEAD").trim();
		git(primary, "commit", "--allow-empty", "-m", "Add Claude Code to the agent list");

		expect(run([process.execPath, "--no-env-file", checker], primary).exitCode).toBe(0);
		const audit = run([process.execPath, "--no-env-file", checker, "--all-history"], primary);
		expect(audit.exitCode).toBe(1);
		expect(audit.stderr).toContain(bad.slice(0, 12));
		expect(audit.stderr).not.toContain("PRIVATE_SENTINEL");
	});
});
