import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createTimberConfigReader, readTimberConfigFile } from "../src/bun/timber-config";
import { describeIntegration, rowSourceNote, timberSettingRows } from "../src/mainview/timber-settings-format";
import { type TimberConfigFile, displayText, machineConfigPath, readTimberConfig, timberSetupArguments } from "../src/shared/timber-config";
import { describeTimberCommand } from "../src/shared/timber-result";

const parse = (text: string) => Bun.TOML.parse(text);
const read = (source: string | null) => readTimberConfig("/repo/.timber.toml", source, parse);
const SECRET = "ghp_SuperSecretToken123";

/** A file like the one `timber setup` writes, with a secret where a careless person might put one. */
const FULL = `
# Timber settings.
default_tracker = "jira"
base_branch = "main"
remote = "origin"
worktree_dir = "../worktrees"

[editor]
command = "code"
args = ["--new-window"]
enabled = true

[agent]
command = "claude"
args = ["--api-key", "${SECRET}"]
enabled = false
wait_for_setup = true

[hooks]
post_create = ["bun install", "export TOKEN=${SECRET}"]
pre_delete = ["echo bye"]

[workflows.review]
description = "Review a pull request"
post_create = ["gh pr checkout"]

[workflows.legacy]

[jira]
site_url = "https://example.atlassian.net"
cloud_id = "00000000-0000-4000-8000-000000000000"

[arena.agents.fast]
tool = "codex"
command = "codex"
args = ["--token", "${SECRET}"]
`;

describe("reading one of Timber's files", () => {
	test("shows every value Timber's setup screen shows, commands without their arguments and scripts as counts", () => {
		const file = read(FULL);
		expect(file).toEqual({
			state: "read",
			path: "/repo/.timber.toml",
			unknown: [],
			values: {
				defaultTracker: "jira",
				baseBranch: "main",
				remote: "origin",
				worktreeDir: "../worktrees",
				editor: { command: "code", argumentCount: 1, enabled: true, integration: null },
				agent: { command: "claude", argumentCount: 2, enabled: false, waitForSetup: true },
				hooks: { setupScripts: 2, preDoneScripts: 1 },
				workflows: [
					{ name: "review", off: false, description: "Review a pull request", setupScripts: 1 },
					{ name: "legacy", off: false, description: null, setupScripts: 0 },
				],
				jira: { siteUrl: "https://example.atlassian.net", cloudId: true },
				arena: [{ name: "fast", off: false }],
			},
		});
	});

	test("never carries a secret from arguments, scripts, or keys it does not know", () => {
		const file = read(`${FULL}\n[mystery]\ntoken = "${SECRET}"\n`);
		expect(file.state).toBe("read");
		expect(JSON.stringify(file)).not.toContain(SECRET);
		expect(file).toMatchObject({ unknown: ["mystery"] });
		const rows = timberSettingRows((file as Extract<TimberConfigFile, { state: "read" }>).values, "repository", null);
		expect(JSON.stringify(rows)).not.toContain(SECRET);
	});

	test("keeps features turned off apart from features not set", () => {
		const file = read(`editor = false\nagent = false\nhooks = false\nworkflows = false\njira = false\narena = false\n`);
		expect(file).toMatchObject({
			state: "read",
			values: { editor: false, agent: false, hooks: false, workflows: false, jira: false, arena: false },
		});
		expect(read("")).toEqual({ state: "read", path: "/repo/.timber.toml", values: {}, unknown: [] });
	});

	test("a file that is not there is missing, never empty defaults", () => {
		expect(read(null)).toEqual({ state: "missing", path: "/repo/.timber.toml" });
	});

	test("a file that is not TOML is an error, never with the parser's words or the file's text", () => {
		const file = read(`base_branch = "main\ntoken = "${SECRET}"\n`);
		expect(file).toMatchObject({ state: "error", message: expect.stringMatching(/^It is not valid TOML\./), problems: [] });
		expect(JSON.stringify(file)).not.toContain(SECRET);
		const quoting = readTimberConfig("/x", "a", () => {
			throw new Error(`bad near ${SECRET}`);
		});
		expect(JSON.stringify(quoting)).not.toContain(SECRET);
	});

	test("a value Timber cannot use makes the whole file an error that names each key, as it does for Timber", () => {
		const file = read(`default_tracker = "trello"\nbase_branch = " "\neditor = true\n[agent]\nargs = ["x"]\n[hooks]\npost_create = "make"\n[jira]\ncloud_id = "x"\n`);
		expect(file).toEqual({
			state: "error",
			path: "/repo/.timber.toml",
			message: "Timber cannot use these settings.",
			problems: ["default_tracker is invalid", "base_branch is invalid", "editor is invalid", "agent.command is invalid", "hooks.post_create is invalid", "jira.site_url is invalid"],
		});
	});

	test("text from the file is made safe to show", () => {
		expect(displayText("main\u001b[31m\nred")).toBe("main\uFFFD[31m\uFFFDred");
		expect(displayText("x".repeat(300))).toHaveLength(200);
		expect(read(`base_branch = "a\\u0007b"`)).toMatchObject({ values: { baseBranch: "a\uFFFDb" } });
	});
});

describe("where Timber's machine settings are", () => {
	test("as Timber finds them: an absolute XDG_CONFIG_HOME, else .config in the home folder", () => {
		expect(machineConfigPath({ XDG_CONFIG_HOME: "/xdg", HOME: "/home/sam" }, "linux", "/fallback")).toBe("/xdg/timber/config.toml");
		expect(machineConfigPath({ XDG_CONFIG_HOME: "relative", HOME: "/home/sam" }, "linux", "/fallback")).toBe("/home/sam/.config/timber/config.toml");
		expect(machineConfigPath({}, "darwin", "/Users/sam")).toBe("/Users/sam/.config/timber/config.toml");
		expect(machineConfigPath({ USERPROFILE: "C:\\Users\\sam" }, "win32", null)).toBe("C:\\Users\\sam\\.config\\timber\\config.toml");
		expect(machineConfigPath({}, "linux", null)).toBeNull();
	});

	test("setup is run as timber setup, with --global for the machine", () => {
		expect(describeTimberCommand(timberSetupArguments("repository"))).toBe("timber setup");
		expect(describeTimberCommand(timberSetupArguments("machine"))).toBe("timber setup --global");
	});
});

describe("the words for Timber's settings", () => {
	test("a repository's value it does not set falls back to the machine's, then to Timber's default", () => {
		const rows = timberSettingRows({ baseBranch: "develop", hooks: { setupScripts: 1, preDoneScripts: null } }, "repository", {
			agent: { command: "claude", argumentCount: 0, enabled: true, waitForSetup: null },
			remote: "upstream",
			editor: false,
		});
		const byKey = Object.fromEntries(rows.map(row => [row.key, row]));
		expect(byKey.base_branch).toMatchObject({ value: "develop", source: "file", mono: true });
		expect(byKey.hooks).toMatchObject({ value: "1 script", source: "file" });
		expect(byKey.pre_delete).toMatchObject({ value: "None", source: "default" });
		expect(byKey.agent).toMatchObject({ value: "claude (starts by itself)", source: "machine" });
		expect(byKey.remote).toMatchObject({ value: "upstream", source: "machine" });
		expect(byKey.editor).toMatchObject({ value: "Off", source: "machine", mono: false });
		expect(byKey.worktree_dir).toMatchObject({ value: "A folder beside the repository", source: "default" });
		expect(rowSourceNote(byKey.agent!)).toBe("From the machine defaults");
		expect(rowSourceNote(byKey.base_branch!)).toBeNull();
	});

	test("the machine's file never falls back to itself", () => {
		const rows = timberSettingRows({}, "machine", { remote: "upstream" });
		expect(rows.every(row => row.source === "default")).toBe(true);
	});

	test("say how each integration is configured, never with a value", () => {
		expect(describeIntegration("github", { state: "configured", source: "github-cli" }).text).toBe("Configured: signed in with the GitHub CLI");
		expect(describeIntegration("jira", { state: "configured", source: "environment" }).text).toContain("JIRA_EMAIL and JIRA_API_TOKEN are set");
		expect(describeIntegration("linear", { state: "configured", source: "saved" }).text).toBe("Configured: credentials saved by timber setup");
		expect(describeIntegration("linear", { state: "not-configured" })).toEqual({ configured: false, text: "Not configured" });
	});
});

describe("reading Timber's files from disk", () => {
	let root: string;
	let xdg: string;
	let repository: string;
	let empty: string;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-config-")));
		xdg = join(root, "xdg");
		repository = join(root, "my repo");
		empty = join(root, "empty repo");
		mkdirSync(join(xdg, "timber", "credentials"), { recursive: true });
		mkdirSync(repository);
		mkdirSync(empty);
		writeFileSync(join(xdg, "timber", "config.toml"), `editor = false\n[agent]\ncommand = "claude"\nenabled = true\n`);
		writeFileSync(join(repository, ".timber.toml"), FULL);
	});

	afterAll(() => {
		rmSync(root, { recursive: true, force: true });
	});

	const listed = (path: string) => path === repository || path === empty;
	const reader = (environment: Record<string, string | undefined> = {}, githubStatus?: () => Promise<number>) => createTimberConfigReader({
		isListed: async path => listed(path),
		environment: { XDG_CONFIG_HOME: xdg, HOME: root, PATH: "", ...environment },
		platform: "linux",
		home: root,
		...(githubStatus ? { githubStatus } : {}),
	});

	/** Every file under the folder with its bytes and modification time, to show reading changed nothing. */
	function snapshot(folder: string): Record<string, string> {
		const all: Record<string, string> = {};
		for (const entry of readdirSync(folder, { recursive: true, withFileTypes: true })) {
			const path = join(entry.parentPath, entry.name);
			const info = statSync(path);
			all[path] = entry.isFile() ? `${info.mtimeMs}:${readFileSync(path, "base64")}` : `${info.mtimeMs}`;
		}
		return all;
	}

	test("values match the files on disk, and reading changes nothing", async () => {
		const before = snapshot(root);
		const settings = await reader().read(repository);
		expect(settings.machine).toEqual({
			state: "read",
			path: join(xdg, "timber", "config.toml"),
			values: { editor: false, agent: { command: "claude", argumentCount: 0, enabled: true, waitForSetup: null } },
			unknown: [],
		});
		expect(settings.repository).toMatchObject({ state: "read", path: join(repository, ".timber.toml"), values: { baseBranch: "main", remote: "origin" } });
		expect(JSON.stringify(settings)).not.toContain(SECRET);
		expect(snapshot(root)).toEqual(before);
	});

	test("a repository with no .timber.toml is not configured", async () => {
		expect((await reader().read(empty)).repository).toEqual({ state: "missing", path: join(empty, ".timber.toml") });
	});

	test("without a repository only the machine's file is read", async () => {
		expect((await reader().read(null)).repository).toBeNull();
	});

	test("a folder that is not a repository in the app's list is refused and not read", async () => {
		const outside = join(root, "outside");
		mkdirSync(outside, { recursive: true });
		writeFileSync(join(outside, ".timber.toml"), `base_branch = "main"\n`);
		expect((await reader().read(outside)).repository).toMatchObject({ state: "error", message: `${outside} is not a repository in this app's list.` });
	});

	test("a machine without the file is not configured, never empty defaults", async () => {
		const settings = await reader({ XDG_CONFIG_HOME: join(root, "nowhere") }).read(null);
		expect(settings.machine).toEqual({ state: "missing", path: join(root, "nowhere", "timber", "config.toml") });
	});

	test("a malformed, a too large, a folder, and a binary file each give an error", async () => {
		const bad = join(root, "bad.toml");
		writeFileSync(bad, `editor = [\n`);
		expect(await readTimberConfigFile(bad)).toMatchObject({ state: "error", message: expect.stringContaining("not valid TOML") });
		writeFileSync(bad, `# ${"x".repeat(300 * 1024)}\n`);
		expect(await readTimberConfigFile(bad)).toMatchObject({ state: "error", message: expect.stringContaining("too large") });
		writeFileSync(bad, new Uint8Array([0xff, 0xfe, 0x00]));
		expect(await readTimberConfigFile(bad)).toMatchObject({ state: "error", message: "It is not UTF-8 text." });
		expect(await readTimberConfigFile(root)).toMatchObject({ state: "error", message: "It is a folder, not a file." });
	});

	test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("a file the app may not read gives an error", async () => {
		const locked = join(root, "locked.toml");
		writeFileSync(locked, `base_branch = "main"\n`);
		chmodSync(locked, 0o000);
		try {
			expect(await readTimberConfigFile(locked)).toMatchObject({ state: "error", message: "The app is not allowed to read it." });
		} finally {
			chmodSync(locked, 0o600);
		}
	});

	describe("integrations", () => {
		test("say whether each one is configured without reading a credential file", async () => {
			const jira = join(xdg, "timber", "credentials", "jira.json");
			writeFileSync(jira, `{"token":"${SECRET}"}`);
			// Not even the app may read it: the answer can only come from its being there.
			if (process.platform !== "win32") chmodSync(jira, 0o000);
			try {
				const statuses = await reader().integrations();
				expect(statuses).toEqual({
					github: { state: "unknown", reason: "The GitHub CLI (gh) is not on the PATH the app was started with." },
					jira: { state: "configured", source: "saved" },
					linear: { state: "not-configured" },
				});
				expect(JSON.stringify(statuses)).not.toContain(SECRET);
			} finally {
				chmodSync(jira, 0o600);
				rmSync(jira);
			}
		});

		test("environment variables count when they are set, and their values are never kept", async () => {
			const statuses = await reader({ GH_TOKEN: SECRET, JIRA_EMAIL: "sam@example.invalid", JIRA_API_TOKEN: SECRET, LINEAR_API_KEY: SECRET }).integrations();
			expect(statuses).toEqual({
				github: { state: "configured", source: "environment" },
				jira: { state: "configured", source: "environment" },
				linear: { state: "configured", source: "environment" },
			});
			// Jira needs both, as Timber does.
			expect((await reader({ JIRA_API_TOKEN: SECRET }).integrations()).jira).toEqual({ state: "not-configured" });
		});

		test.skipIf(process.platform === "win32")("GitHub is configured when gh auth status exits with 0", async () => {
			const bin = join(root, "bin");
			mkdirSync(bin, { recursive: true });
			writeFileSync(join(bin, "gh"), "#!/bin/sh\nexit 1\n");
			chmodSync(join(bin, "gh"), 0o755);
			const asked: number[] = [];
			const signedIn = await reader({ PATH: bin }, async () => {
				asked.push(1);
				return 0;
			}).integrations();
			expect(signedIn.github).toEqual({ state: "configured", source: "github-cli" });
			// The real gh stand-in exits with 1: not signed in.
			expect((await reader({ PATH: bin }).integrations()).github).toEqual({ state: "not-configured" });
			expect(asked).toHaveLength(1);
		});
	});
});
