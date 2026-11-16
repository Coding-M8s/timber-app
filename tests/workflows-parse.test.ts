import { describe, expect, test } from "bun:test";
import { APP_CONFIG_READ_ARGUMENTS, APP_CONFIG_READ_COMMAND, type WorkflowList, readDiagnostic, readWorkflowList } from "../src/shared/workflows";
import { recordedAppConfig } from "./support/timber";

const { records, failures } = recordedAppConfig;

/** A version 1 repository record whose effective settings hold these workflows. */
const withWorkflows = (workflows: unknown) => JSON.stringify({
	schemaVersion: 1, scope: "repository", path: "/work/sample/.timber.toml", exists: true, tracked: false, revision: null,
	values: {}, effective: { workflows }, credentials: { jira: { configured: false, state: "none", environmentOverride: false }, linear: { state: "none", environmentOverride: false } },
});

const read = (stdout: string, exitCode: number | null = 0, stderr = "") => readWorkflowList(stdout, stderr, exitCode);
const message = (list: WorkflowList) => (list.ok ? null : list.message);

describe("the command", () => {
	test("is the repository scope of Timber's settings read", () => {
		expect([...APP_CONFIG_READ_ARGUMENTS]).toEqual(["__app-config", "read", "--scope", "repository"]);
		expect(APP_CONFIG_READ_COMMAND).toBe("timber __app-config read --scope repository");
	});
});

describe("reading recorded records", () => {
	test("workflows from both files are merged by name, in Timber's order", () => {
		expect(read(records.merged)).toEqual({
			ok: true,
			workflows: [
				{ name: "triage", description: "Look at a bug report", agent: { kind: "none" } },
				{ name: "explore", description: "Read the code, change nothing", agent: { kind: "not-set" } },
				{ name: "ship", description: "Get a change ready to merge", agent: { kind: "command", command: "codex", args: ["--full-auto"] } },
			],
		});
	});

	test("a repository's review = false hides the inherited workflow", () => {
		const names = (list: WorkflowList) => (list.ok ? list.workflows.map(workflow => workflow.name) : null);
		expect(names(read(records.inherited))).toContain("review");
		expect(names(read(records.merged))).not.toContain("review");
	});

	test("a workflow the repository defines again replaces the machine's as a whole", () => {
		const explore = (list: WorkflowList) => (list.ok ? list.workflows.find(workflow => workflow.name === "explore") : null);
		expect(explore(read(records.inherited))).toEqual({ name: "explore", description: null, agent: { kind: "not-set" } });
		expect(explore(read(records.merged))).toEqual({ name: "explore", description: "Read the code, change nothing", agent: { kind: "not-set" } });
	});

	test("each agent is a command, none, or not set", () => {
		const list = read(records.inherited);
		expect(list.ok && list.workflows.map(workflow => workflow.agent)).toEqual([
			{ kind: "command", command: "claude", args: ["--permission-mode", "plan"] },
			{ kind: "none" },
			{ kind: "not-set" },
		]);
	});

	test("workflows = false in the repository is an empty list", () => {
		expect(read(records.switchedOff)).toEqual({ ok: true, workflows: [] });
	});

	test("a repository with no workflows anywhere is an empty list", () => {
		expect(read(records.none)).toEqual({ ok: true, workflows: [] });
	});

	test("nothing but the workflows is kept: no path, revision, or credential flags", () => {
		const text = JSON.stringify(read(records.merged));
		for (const dropped of ["/work", "revision", "credentials", "jira", "linear", "post_create", "wait_for_setup", "tracked"]) {
			expect(text).not.toContain(dropped);
		}
	});
});

describe("a failure is never a list", () => {
	test("Timber's diagnostic is passed on when it exits with 1", () => {
		expect(read("", 1, failures.invalidToml)).toEqual({
			ok: false,
			message: "timber __app-config read --scope repository exited with code 1: Invalid TOML in /work/sample/.timber.toml",
		});
		expect(message(read("", 1, failures.invalidConfig))).toBe(
			"timber __app-config read --scope repository exited with code 1: Invalid config /work/sample/.timber.toml: workflows.review.agent is invalid",
		);
	});

	test("a Timber without the command says so, after any hint it printed first", () => {
		expect(message(read("", 1, failures.unknownCommand))).toBe("timber __app-config read --scope repository exited with code 1: unknown command '__app-config'");
	});

	test("a failing exit code without words still fails", () => {
		expect(message(read("", 2, "  \n"))).toBe("timber __app-config read --scope repository exited with code 2 without saying why.");
		expect(message(read("", null))).toBe("timber __app-config read --scope repository did not exit by itself without saying why.");
	});

	test("a good record with a failing exit code is not used", () => {
		expect(read(records.merged, 1).ok).toBe(false);
	});

	test("nothing, or text that is not JSON, is unreadable", () => {
		expect(message(read(""))).toBe("timber __app-config read --scope repository did not answer with a record this app can read: it printed nothing.");
		expect(message(read("Saved settings"))).toContain("the output is not valid JSON");
		expect(message(read("[]"))).toContain("the output is not a JSON object");
	});

	test("another schema version is refused", () => {
		const later = records.merged.replace('"schemaVersion":1', '"schemaVersion":2');
		expect(message(read(later))).toBe("timber __app-config read --scope repository answered with schema version 2, and this app reads version 1 only. Update Timber app, or install a Timber that matches it.");
		expect(message(read(JSON.stringify({ effective: {} })))).toContain("schema version none");
	});

	test("a record for the global scope is refused", () => {
		expect(message(read(records.merged.replace('"scope":"repository"', '"scope":"global"')))).toContain("it is not a record for the repository scope");
	});

	test("a record without effective settings is refused", () => {
		expect(message(read(JSON.stringify({ schemaVersion: 1, scope: "repository" })))).toContain("it has no effective settings");
	});

	test("workflows that are not a table are refused", () => {
		for (const workflows of [false, [], "review", null]) expect(message(read(withWorkflows(workflows)))).toContain("its workflows are not a table");
	});

	test.each([
		["a name Timber would not accept", { "-rm": {} }],
		["a name with capitals", { Review: {} }],
		["an entry that is switched off", { review: false }],
		["an entry that is not a table", { review: "yes" }],
		["a description that is not text", { review: { description: 3 } }],
		["an agent that is text", { review: { agent: "claude" } }],
		["an agent that is true", { review: { agent: true } }],
		["an agent without a command", { review: { agent: { args: [] } } }],
		["an agent with a blank command", { review: { agent: { command: "  ", args: [] } } }],
		["an agent without arguments", { review: { agent: { command: "claude" } } }],
		["an agent whose arguments are not all text", { review: { agent: { command: "claude", args: ["--x", 1] } } }],
	])("%s fails the whole list", (_, workflows) => {
		const list = read(withWorkflows({ fine: {}, ...workflows }));
		expect(message(list)).toBe("timber __app-config read --scope repository did not answer with a record this app can read: workflow 2 of 2 is not a workflow this app can read.");
	});
});

describe("what is lenient", () => {
	test("fields this app does not use are ignored at every level", () => {
		const record = JSON.parse(withWorkflows({ review: { description: "Review", later: 1, agent: { command: "claude", args: [], later: true } } }));
		record.later = { anything: true };
		record.effective.later = 1;
		expect(read(JSON.stringify(record))).toEqual({ ok: true, workflows: [{ name: "review", description: "Review", agent: { kind: "command", command: "claude", args: [] } }] });
	});

	test("a blank description is none, and a description is made safe to show", () => {
		const list = read(withWorkflows({ blank: { description: "   " }, odd: { description: "  two\nlines\u001b[31m  " } }));
		expect(list.ok && list.workflows.map(workflow => workflow.description)).toEqual([null, "two�lines�[31m"]);
	});

	test("arguments are kept exactly, for the command that starts the agent", () => {
		const args = ["--token", "secret value", "", "--x=\"y\""];
		const list = read(withWorkflows({ review: { agent: { command: "/opt/my agent/bin", args } } }));
		expect(list.ok && list.workflows[0]!.agent).toEqual({ kind: "command", command: "/opt/my agent/bin", args });
	});

	test("a workflow may be called constructor", () => {
		expect(read(withWorkflows({ constructor: {} }))).toEqual({ ok: true, workflows: [{ name: "constructor", description: null, agent: { kind: "not-set" } }] });
	});
});

describe("readDiagnostic", () => {
	test("takes the last line that says something, without Timber's error prefix", () => {
		expect(readDiagnostic("hint\n\nerror: last words\n\n")).toBe("last words");
		expect(readDiagnostic("")).toBeNull();
		expect(readDiagnostic("error:   \n")).toBeNull();
	});

	test("cuts a long diagnostic short", () => {
		expect(Array.from(readDiagnostic("x".repeat(1000))!).length).toBe(300);
	});
});
