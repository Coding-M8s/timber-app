import { afterAll, afterEach, beforeAll, describe, expect, setDefaultTimeout, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { createTimberSettings } from "../src/bun/timber-settings";
import {
	type TimberSettingsSaveRequest, checkConnectionRequest, checkSaveRequest, invalidFieldPath, invalidFieldsAt, readConnectionCheck, readSettingsOutput,
	readTimberValues, settingsInput, shownApplyArguments, shownCheckArguments,
} from "../src/shared/timber-config";
import { describeTimberCommand, readTimberResult } from "../src/shared/timber-result";
import { REAL_TIMBER_TIMEOUT_MS, fingerprint, git, privateFolder, readyAt, realTimber, recordedConfig, standInResultTimber, standInTimber } from "./support/timber";

setDefaultTimeout(REAL_TIMBER_TIMEOUT_MS);

const SECRET = "lin_api_SuperSecretKey123";
const JIRA_SECRET = "atl_SuperSecretToken456";
const REVISION = "a".repeat(64);

describe("what Timber's settings commands print", () => {
	test("a read gives the scope's values, what applies after inheritance, the file, and only whether logins are saved", () => {
		const machine = readSettingsOutput(recordedConfig.reads.machine, "machine");
		expect(machine).toEqual({
			ok: true,
			value: {
				scope: "machine",
				path: "/work/xdg/timber/config.toml",
				exists: true,
				tracked: false,
				revision: "222f601cc704ea0c5d41d925ec0fc5d049ca1f1f58e2f54bbc3cbd1602573218",
				values: { agent: { command: "claude", args: [], enabled: true } },
				effective: { agent: { command: "claude", args: [], enabled: true } },
				credentials: { jira: { configured: false, state: "none", environmentOverride: false }, linear: { state: "none", environmentOverride: false } },
			},
		});
		const repository = readSettingsOutput(recordedConfig.reads.repository, "repository");
		if (!repository.ok) throw new Error(repository.message);
		// A script that spans lines is kept whole, and a named workflow is kept to send back unchanged.
		expect(repository.value.values.hooks).toEqual({ post_create: ["bun install", "echo 'one\ntwo'"] });
		expect(repository.value.values.workflows).toEqual({ review: { description: "Review a pull request", post_create: ["gh pr checkout"] } });
		expect(repository.value.effective.agent).toEqual({ command: "claude", args: [], enabled: true });
	});

	test("a read for another scope, of another version, or with a shape this app does not know is not used", () => {
		expect(readSettingsOutput(recordedConfig.reads.machine, "repository")).toMatchObject({ ok: false, message: expect.stringContaining("another scope") });
		expect(readSettingsOutput(recordedConfig.reads.machine.replace('"schemaVersion":1', '"schemaVersion":2'), "machine")).toMatchObject({ ok: false });
		expect(readSettingsOutput("not json", "machine")).toMatchObject({ ok: false });
		expect(readSettingsOutput(recordedConfig.reads.machine.replace('"args":[]', '"args":"--flag"'), "machine")).toMatchObject({ ok: false });
		// Keys the app does not edit may be anything: they go back as they came.
		expect(readTimberValues({ arena: { agents: { fast: false } }, future_key: [1, 2] })).toEqual({ arena: { agents: { fast: false } }, future_key: [1, 2] });
	});

	test("each result of a save is read from Timber's record", () => {
		const saved = readTimberResult("config", recordedConfig.results.saved, 0);
		expect(saved).toMatchObject({ outcome: "succeeded", record: { fields: { config: { result: "saved", revision: expect.stringMatching(/^[a-f0-9]{64}$/) } } } });
		const invalid = readTimberResult("config", recordedConfig.results.invalid, 1);
		expect(invalid).toMatchObject({ outcome: "failed", record: { fields: { config: { result: "invalid", invalidFields: ["base_branch is invalid", "hooks.post_create.1 is invalid", "editor.command is invalid", "jira.site_url is invalid"] } } } });
		expect(readTimberResult("config", recordedConfig.results.conflict, 1)).toMatchObject({ outcome: "failed", record: { fields: { config: { result: "conflict" } } } });
		expect(readTimberResult("config", recordedConfig.results.refused, 1)).toMatchObject({ outcome: "failed", record: { fields: { config: { result: "refused" } } } });
	});

	test("a check says whether the login was accepted, and is used only for the integration asked about", () => {
		expect(readConnectionCheck(recordedConfig.checks.github, "github")).toEqual({ ok: true, value: { integration: "github", ok: true, source: "github-cli", account: "sample-user", diagnostic: null } });
		expect(readConnectionCheck(recordedConfig.checks.linearRejected, "linear")).toMatchObject({ ok: true, value: { ok: false, source: "draft", diagnostic: expect.stringContaining("Linear authentication failed") } });
		expect(readConnectionCheck(recordedConfig.checks.jiraNoSite, "jira")).toMatchObject({ ok: true, value: { ok: false, source: null } });
		expect(readConnectionCheck(recordedConfig.checks.github, "jira")).toMatchObject({ ok: false });
	});

	test("the commands are shown exactly, with stand-ins for the private files and no login in them", () => {
		expect(describeTimberCommand(shownApplyArguments("repository", false))).toBe("timber __app-config apply --scope repository --input-file <settings draft> --result-file <temporary file>");
		expect(describeTimberCommand(shownApplyArguments("repository", true))).toBe("timber __app-config apply --scope repository --edit-tracked --input-file <settings draft> --result-file <temporary file>");
		expect(describeTimberCommand(shownApplyArguments("machine", false))).toBe("timber __app-config apply --scope global --input-file <settings draft> --result-file <temporary file>");
		expect(describeTimberCommand(shownCheckArguments("jira", "machine"))).toBe("timber __app-config check jira --scope global --input-file <settings draft>");
	});

	test("the input file holds the draft and the logins, and leaves out what is not given", () => {
		expect(JSON.parse(settingsInput(REVISION, { remote: "origin" }, undefined))).toEqual({ schemaVersion: 1, revision: REVISION, values: { remote: "origin" } });
		expect(JSON.parse(settingsInput(null, {}, { linear: null }))).toEqual({ schemaVersion: 1, revision: null, values: {}, credentials: { linear: null } });
		expect(JSON.parse(settingsInput(undefined, {}, {}))).toEqual({ schemaVersion: 1, values: {} });
		expect(JSON.parse(settingsInput(null, { remote: "origin", workflows: { review: false }, arena: false, future_key: 1 }, undefined)).values).toEqual({ remote: "origin", future_key: 1 });
	});

	test("a request from the window that does not fit is refused without quoting it", () => {
		const good: TimberSettingsSaveRequest = { scope: "repository", repository: "/work/sample", revision: REVISION, values: {}, editTracked: false };
		expect(checkSaveRequest(good)).toBeNull();
		expect(checkSaveRequest({ ...good, scope: "everything" })).not.toBeNull();
		expect(checkSaveRequest({ ...good, repository: null })).not.toBeNull();
		expect(checkSaveRequest({ ...good, scope: "machine" })).not.toBeNull();
		expect(checkSaveRequest({ ...good, revision: "../../etc/passwd" })).not.toBeNull();
		expect(checkSaveRequest({ ...good, credentials: { github: { token: SECRET } } })).not.toBeNull();
		const extra = checkSaveRequest({ ...good, credentials: { linear: { token: SECRET, extra: SECRET } } });
		expect(extra).not.toBeNull();
		expect(extra).not.toContain(SECRET);
		expect(checkConnectionRequest({ scope: "machine", repository: null, integration: "gitlab", values: {} })).not.toBeNull();
		expect(checkConnectionRequest({ scope: "machine", repository: null, integration: "linear", values: {}, credentials: { linear: { token: SECRET } } })).toBeNull();
	});

	test("Timber's messages are put at the field they name", () => {
		expect(invalidFieldPath("hooks.post_create.1 is invalid")).toBe("hooks.post_create.1");
		expect(invalidFieldPath("credentials.jira needs a configured Jira site")).toBe("credentials.jira");
		expect(invalidFieldPath("<root> is invalid")).toBeNull();
		const messages = ["hooks.post_create.1 is invalid", "editor.command is invalid", "hooks is invalid", "base_branch is invalid"];
		expect(invalidFieldsAt(messages, "hooks")).toEqual(["hooks.post_create.1 is invalid", "hooks is invalid"]);
		expect(invalidFieldsAt(messages, "hooks.post_create.1")).toEqual(["hooks.post_create.1 is invalid"]);
		expect(invalidFieldsAt(messages, "base")).toEqual([]);
	});
});

describe("running Timber's settings commands", () => {
	let root: string;
	let repository: string;
	let temporary: string;
	let home: string;
	let count = 0;
	const ready = readyAt("0.1.2");

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-settings-")));
		repository = join(root, "my repo zażółć");
		mkdirSync(repository);
		writeFileSync(join(repository, "tracked.txt"), "one\n");
		temporary = join(root, "temporary");
		mkdirSync(temporary);
		home = join(root, "home");
		mkdirSync(home);
	});
	afterEach(() => {
		// Whatever happened, no input file, no result file, and no folder for them is left behind, and nothing was put in the repository.
		expect(readdirSync(temporary)).toEqual([]);
		expect(readdirSync(repository)).toEqual(["tracked.txt"]);
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const service = (path: string, listed = true) => createTimberSettings({
		timber: async () => ready(path),
		isListed: async candidate => listed && candidate === repository,
		temporaryRoot: temporary,
		machineFolder: home,
	});

	test("read: answers what Timber printed, run in the repository, with the exact command", async () => {
		const timber = standInTimber(root, `read-${++count}`, recordedConfig.reads.repository, 0);
		const result = await service(timber.path).read({ scope: "repository", repository });
		expect(result).toMatchObject({ outcome: "read", command: "timber __app-config read --scope repository", settings: { scope: "repository", path: "/work/sample/.timber.toml" } });
		expect(readFileSync(join(timber.folder, "arguments"), "utf8").trim()).toBe("__app-config read --scope repository");
		expect(realpathSync(readFileSync(join(timber.folder, "cwd"), "utf8").trim())).toBe(repository);
	});

	test("read: the machine scope runs outside any repository", async () => {
		const timber = standInTimber(root, `read-${++count}`, recordedConfig.reads.machine, 0);
		const result = await service(timber.path).read({ scope: "machine", repository: null });
		expect(result).toMatchObject({ outcome: "read", command: "timber __app-config read --scope global" });
		expect(realpathSync(readFileSync(join(timber.folder, "cwd"), "utf8").trim())).toBe(home);
	});

	test("read: Timber's one line on standard error is the reason it could not read", async () => {
		const timber = standInResultTimber(root, `read-${++count}`, { result: null, stderr: "error: Invalid TOML in /work/sample/.timber.toml\n", exitCode: 1 });
		const result = await service(timber.path).read({ scope: "repository", repository });
		expect(result).toEqual({ outcome: "failed", failure: { command: "timber __app-config read --scope repository", diagnostic: "Invalid TOML in /work/sample/.timber.toml", output: null } });
	});

	test("nothing runs for a repository the app does not list, a request that does not fit, or without a usable Timber", async () => {
		const timber = standInResultTimber(root, `never-${++count}`, { result: recordedConfig.results.saved });
		const unlisted = await service(timber.path, false).save({ scope: "repository", repository, revision: null, values: {}, editTracked: false });
		expect(unlisted).toMatchObject({ outcome: "failed", failure: { command: null, diagnostic: expect.stringContaining("not a repository in this app's list") } });
		const odd = await service(timber.path).save({ scope: "repository", repository, revision: "nope", values: {}, editTracked: false });
		expect(odd).toMatchObject({ outcome: "failed", failure: { command: null } });
		const missing = createTimberSettings({ timber: async () => ({ state: "not-found", override: null }), isListed: async () => true, temporaryRoot: temporary });
		expect(await missing.read({ scope: "machine", repository: null })).toMatchObject({ outcome: "failed", failure: { command: null } });
		expect(() => timber.notes()).toThrow();
	});

	test("save: the draft and the login go in a private input file, never in the arguments, and the file is gone afterwards", async () => {
		const timber = standInResultTimber(root, `save-${++count}`, { result: recordedConfig.results.saved });
		const values = { base_branch: "develop", workflows: { review: { post_create: ["gh pr checkout"] } } };
		const result = await service(timber.path).save({
			scope: "repository", repository, revision: REVISION, values, editTracked: false,
			credentials: { linear: { token: SECRET }, jira: { email: "sam@example.invalid", token: JIRA_SECRET } },
		});
		expect(result).toEqual({
			outcome: "saved",
			command: "timber __app-config apply --scope repository --input-file <settings draft> --result-file <temporary file>",
			revision: "52441784169784f4e58405d1d51e5979b4cc3552f4e87ef5c4aa8dc5af13e679",
			credentials: { jira: "unchanged", linear: "unchanged" },
		});
		const notes = timber.notes();
		expect(notes.arguments).toEqual(["__app-config", "apply", "--scope", "repository", "--input-file", notes.inputFile!, "--result-file", notes.resultFile!]);
		expect(notes.arguments.join(" ")).not.toContain(SECRET);
		expect(notes.arguments.join(" ")).not.toContain(JIRA_SECRET);
		// Named workflows are left for Timber to carry over from the file as it is.
		expect(JSON.parse(notes.input!)).toEqual({ schemaVersion: 1, revision: REVISION, values: { base_branch: "develop" }, credentials: { linear: { token: SECRET }, jira: { email: "sam@example.invalid", token: JIRA_SECRET } } });
		if (process.platform !== "win32") {
			expect(notes.inputMode).toBe(0o600);
			expect(notes.folderMode).toBe(0o700);
		}
		expect(dirname(dirname(notes.inputFile!))).toBe(temporary);
		expect(JSON.stringify(result)).not.toContain(SECRET);
	});

	test("save: the tracked file is changed only when the person said so", async () => {
		const timber = standInResultTimber(root, `save-${++count}`, { result: recordedConfig.results.saved });
		const result = await service(timber.path).save({ scope: "repository", repository, revision: REVISION, values: {}, editTracked: true });
		expect(result).toMatchObject({ outcome: "saved", command: expect.stringContaining("--edit-tracked") });
		expect(timber.notes().arguments).toContain("--edit-tracked");
	});

	test("save: invalid fields, a conflict, and a refusal each come back as themselves, with Timber's diagnostic", async () => {
		const run = async (result: string) => {
			const timber = standInResultTimber(root, `save-${++count}`, { result, exitCode: 1, stderr: "error: something\n" });
			return service(timber.path).save({ scope: "repository", repository, revision: REVISION, values: {}, editTracked: false });
		};
		expect(await run(recordedConfig.results.invalid)).toMatchObject({
			outcome: "invalid",
			invalidFields: ["base_branch is invalid", "hooks.post_create.1 is invalid", "editor.command is invalid", "jira.site_url is invalid"],
			failure: { diagnostic: expect.stringContaining("Nothing was saved") },
		});
		expect(await run(recordedConfig.results.conflict)).toMatchObject({ outcome: "conflict", failure: { diagnostic: expect.stringContaining("changed since they were read") } });
		expect(await run(recordedConfig.results.refused)).toMatchObject({ outcome: "refused", failure: { diagnostic: expect.stringContaining("is tracked by Git") } });
	});

	test("save: a missing or mismatched result is a failure that says the outcome is unknown", async () => {
		const none = standInResultTimber(root, `save-${++count}`, { result: null, exitCode: 1 });
		expect(await service(none.path).save({ scope: "repository", repository, revision: null, values: {}, editTracked: false })).toMatchObject({ outcome: "failed", failure: { diagnostic: expect.stringContaining("unknown") } });
		const otherScope = standInResultTimber(root, `save-${++count}`, { result: recordedConfig.results.saved });
		expect(await service(otherScope.path).save({ scope: "machine", repository: null, revision: null, values: {}, editTracked: false })).toMatchObject({ outcome: "failed", failure: { diagnostic: expect.stringContaining("unknown") } });
	});

	test("check: the draft goes in a private input file, and a rejected login is an answer, not a failure", async () => {
		const timber = standInResultTimber(root, `check-${++count}`, { result: null, stdout: recordedConfig.checks.linearRejected, exitCode: 1 });
		const result = await service(timber.path).check({ scope: "machine", repository: null, integration: "linear", values: {}, credentials: { linear: { token: SECRET } } });
		expect(result).toEqual({
			outcome: "checked",
			command: "timber __app-config check linear --scope global --input-file <settings draft>",
			check: { integration: "linear", ok: false, source: "draft", account: null, diagnostic: "Linear authentication failed; check LINEAR_API_KEY or run timber setup." },
		});
		const notes = timber.notes();
		expect(notes.arguments).toEqual(["__app-config", "check", "linear", "--scope", "global", "--input-file", notes.inputFile!]);
		expect(JSON.parse(notes.input!)).toEqual({ schemaVersion: 1, values: {}, credentials: { linear: { token: SECRET } } });
		if (process.platform !== "win32") expect(notes.inputMode).toBe(0o600);
	});

	test("check: an answer for another integration, or none, is a failure", async () => {
		const other = standInResultTimber(root, `check-${++count}`, { result: null, stdout: recordedConfig.checks.github, exitCode: 0 });
		expect(await service(other.path).check({ scope: "machine", repository: null, integration: "jira", values: {} })).toMatchObject({ outcome: "failed" });
		const silent = standInResultTimber(root, `check-${++count}`, { result: null, stderr: "error: Check one of: github, linear, jira.\n", exitCode: 1 });
		expect(await service(silent.path).check({ scope: "machine", repository: null, integration: "jira", values: {} })).toMatchObject({ outcome: "failed", failure: { diagnostic: "Check one of: github, linear, jira." } });
	});
});

describe.skipIf(realTimber === null)("with the real Timber", () => {
	let root: string;
	let repository: string;
	let xdg: string;
	let environment: Record<string, string | undefined>;
	let temporary: string;

	beforeAll(() => {
		root = realpathSync(mkdtempSync(join(tmpdir(), "timber-app-real-settings-")));
		xdg = join(root, "config");
		// Timber refuses a credential store in a folder others can write to, so the folders are private whatever the umask.
		mkdirSync(xdg, { recursive: true, mode: 0o700 });
		privateFolder(join(xdg, "timber"));
		writeFileSync(join(xdg, "timber", "config.toml"), "[agent]\ncommand = \"claude\"\nenabled = true\n");
		temporary = join(root, "temporary");
		mkdirSync(temporary);
		mkdirSync(join(root, "home"));
		repository = join(root, "sample");
		mkdirSync(repository);
		git(repository, "init", "-q", "-b", "main");
		writeFileSync(join(repository, "README.md"), "sample\n");
		git(repository, "add", "README.md");
		git(repository, "commit", "-q", "-m", "init");
		writeFileSync(join(repository, ".timber.toml"), [
			'base_branch = "main"',
			"[hooks]",
			'post_create = ["bun install", "echo \'one\\ntwo\'"]',
			"[workflows.review]",
			'description = "Review a pull request"',
			'post_create = ["gh pr checkout"]',
			"",
		].join("\n"));
		const { JIRA_EMAIL: _email, JIRA_API_TOKEN: _token, LINEAR_API_KEY: _key, ...rest } = process.env;
		environment = { ...rest, XDG_CONFIG_HOME: xdg, CI: "1" };
	});
	afterAll(() => rmSync(root, { recursive: true, force: true }));

	const service = () => createTimberSettings({
		timber: async () => ({ state: "ready", path: realTimber!, version: "0.1.2" }),
		isListed: async candidate => candidate === repository,
		environment,
		temporaryRoot: temporary,
		machineFolder: join(root, "home"),
	});
	const readRepository = async () => {
		const result = await service().read({ scope: "repository", repository });
		if (result.outcome !== "read") throw new Error(result.failure.diagnostic);
		return result.settings;
	};

	test("reading leaves every file, ref, and the index as they were", async () => {
		const before = fingerprint(repository);
		const settings = await readRepository();
		expect(settings.values.base_branch).toBe("main");
		expect(settings.effective.agent).toEqual({ command: "claude", args: [], enabled: true });
		expect(fingerprint(repository)).toBe(before);
	});

	test("saving one group writes what Timber's setup writes and keeps named workflows and the other settings", async () => {
		const settings = await readRepository();
		const result = await service().save({ scope: "repository", repository, revision: settings.revision, values: { ...settings.values, remote: "upstream" }, editTracked: false });
		expect(result).toMatchObject({ outcome: "saved" });
		const file = readFileSync(join(repository, ".timber.toml"), "utf8");
		// Setup's renderer writes this header, so the file is the one setup would write.
		expect(file).toStartWith("# Timber settings. Keep credentials in the private user store or environment, never this file.\n");
		const after = await readRepository();
		expect(after.values).toEqual({ ...settings.values, remote: "upstream" });
		expect(after.values.workflows).toEqual({ review: { description: "Review a pull request", post_create: ["gh pr checkout"] } });
		expect(after.revision).toBe(result.outcome === "saved" ? result.revision : "");
		// Timber hid the file from Git status with its local exclusion, as setup does.
		expect(git(repository, "status", "--porcelain")).toBe("");
	});

	test("an invalid value is refused at the field it names, and nothing is written", async () => {
		const settings = await readRepository();
		const before = readFileSync(join(repository, ".timber.toml"), "utf8");
		const result = await service().save({ scope: "repository", repository, revision: settings.revision, values: { ...settings.values, editor: { command: " ", args: [], enabled: false } }, editTracked: false });
		expect(result).toMatchObject({ outcome: "invalid", invalidFields: ["editor.command is invalid"] });
		expect(readFileSync(join(repository, ".timber.toml"), "utf8")).toBe(before);
	});

	test("a change made outside the app between read and save is refused, and the outside change stays", async () => {
		const settings = await readRepository();
		// At the top, so the key is not inside a table.
		const outside = `worktree_dir = "../elsewhere"\n${readFileSync(join(repository, ".timber.toml"), "utf8")}`;
		writeFileSync(join(repository, ".timber.toml"), outside);
		const result = await service().save({ scope: "repository", repository, revision: settings.revision, values: { ...settings.values, remote: "origin" }, editTracked: false });
		expect(result).toMatchObject({ outcome: "conflict" });
		expect(readFileSync(join(repository, ".timber.toml"), "utf8")).toBe(outside);
	});

	test("a change to named workflows made outside the app is a conflict, not a refused field", async () => {
		const settings = await readRepository();
		const path = join(repository, ".timber.toml");
		const outside = readFileSync(path, "utf8").replace("Review a pull request", "Review a change");
		writeFileSync(path, outside);
		const result = await service().save({ scope: "repository", repository, revision: settings.revision, values: { ...settings.values, remote: "elsewhere" }, editTracked: false });
		expect(result).toMatchObject({ outcome: "conflict" });
		expect(readFileSync(path, "utf8")).toBe(outside);
	});

	test("a login is saved only in Timber's private store, and never comes back in a result, a read, or the settings file", async () => {
		const read = await service().read({ scope: "machine", repository: null });
		if (read.outcome !== "read") throw new Error(read.failure.diagnostic);
		const result = await service().save({ scope: "machine", repository: null, revision: read.settings.revision, values: read.settings.values, credentials: { linear: { token: SECRET } }, editTracked: false });
		expect(result).toMatchObject({ outcome: "saved", credentials: { linear: "saved", jira: "unchanged" } });
		expect(JSON.stringify(result)).not.toContain(SECRET);
		const again = await service().read({ scope: "machine", repository: null });
		expect(again).toMatchObject({ outcome: "read", settings: { credentials: { linear: { state: "saved" } } } });
		expect(JSON.stringify(again)).not.toContain(SECRET);
		expect(readFileSync(join(xdg, "timber", "config.toml"), "utf8")).not.toContain(SECRET);
	});

	test("a check reports a safe failure and saves nothing", async () => {
		const before = fingerprint(xdg);
		const result = await service().check({ scope: "machine", repository: null, integration: "jira", values: {} });
		expect(result).toMatchObject({ outcome: "checked", check: { integration: "jira", ok: false, diagnostic: expect.any(String) } });
		expect(fingerprint(xdg)).toBe(before);
	});
});
