import { describe, expect, test } from "bun:test";
import { WIZARD_STEPS, describeChoices, firstStepOf, stepOfField, wizardSaveRequest } from "../src/mainview/setup-wizard-format";
import { EDITOR_PRESETS, draftsOf, valuesWithAll, withPreset } from "../src/mainview/timber-settings-format";
import type { TimberValues } from "../src/shared/timber-config";

const READ: TimberValues = {
	base_branch: "main",
	editor: { command: "code", args: ["--new-window"], enabled: false },
	workflows: { review: { description: "Review a pull request", post_create: ["gh pr checkout"] } },
	future_key: { kept: true },
};

describe("the setup wizard as data", () => {
	test("asks what timber setup asks, in its order, between where to save and the one save", () => {
		expect([...WIZARD_STEPS]).toEqual(["scope", "editor", "agent", "git", "scripts", "tracking", "review"]);
	});

	test("Timber's message about a field sends the person to the step that draws it", () => {
		expect(stepOfField("editor.command is invalid")).toBe("editor");
		expect(stepOfField("hooks.post_create.1 is invalid")).toBe("scripts");
		expect(stepOfField("credentials.jira needs a configured Jira site")).toBe("tracking");
		expect(stepOfField("<root> is invalid")).toBeNull();
		for (const field of ["jira.board", "jira.sprint_jql", "jira.project", "github.project", "github.milestone", "linear.team"]) expect(stepOfField(`${field} is invalid`)).toBe("tracking");
		expect(firstStepOf(["linear.team is invalid"])).toBe("tracking");
		expect(firstStepOf(["jira.site_url is invalid", "agent.command is invalid"])).toBe("agent");
		expect(firstStepOf(["<root> is invalid"])).toBe("review");
	});

	test("every group saves at once, on top of what was read, keeping what the app does not edit", () => {
		const drafts = draftsOf(READ);
		expect(valuesWithAll(drafts, READ)).toEqual(READ);
		drafts.editor = withPreset(drafts.editor, EDITOR_PRESETS.find(preset => preset.label === "Zed")!);
		drafts.agent = { ...drafts.agent, mode: "set", command: "claude", enabled: true };
		drafts.git = { ...drafts.git, base_branch: "", remote: "upstream" };
		drafts.scripts = { ...drafts.scripts, mode: "set", setup: ["bun install"] };
		drafts.tracking = { ...drafts.tracking, tracker: "linear" };
		const values = valuesWithAll(drafts, READ);
		expect(values).toEqual({
			editor: { command: "zed", args: ["--new"], enabled: false },
			agent: { command: "claude", args: [], enabled: true },
			remote: "upstream",
			hooks: { post_create: ["bun install"] },
			default_tracker: "linear",
			workflows: READ.workflows,
			future_key: { kept: true },
		});
	});

	test("the one save keeps keys set by hand inside the tables the wizard draws", () => {
		const read = {
			...READ,
			agent: { command: "claude", args: [], enabled: true, resolve_handoff: "ask" },
			jira: { site_url: "https://example.atlassian.net", sprint_jql: "sprint in openSprints()", project: "TIM", later_key: "kept" },
		} as TimberValues;
		const drafts = draftsOf(read);
		expect(valuesWithAll(drafts, read)).toEqual(read);
		drafts.agent = { ...drafts.agent, command: "codex" };
		drafts.tracking = { ...drafts.tracking, tracker: "jira", cloudId: "abc" };
		const values = valuesWithAll(drafts, read);
		expect<unknown>(values.agent).toEqual({ command: "codex", args: [], enabled: true, resolve_handoff: "ask" });
		expect<unknown>(values.jira).toEqual({ site_url: "https://example.atlassian.net", cloud_id: "abc", sprint_jql: "sprint in openSprints()", project: "TIM", later_key: "kept" });
	});

	test("the save request carries the revision as read, the scope, the logins typed, and the tracked say-so only for a tracked file", () => {
		const drafts = draftsOf({});
		drafts.tracking = { ...drafts.tracking, linearKey: "lin_key" };
		const settings = { revision: null, values: {}, tracked: false };
		expect(wizardSaveRequest("repository", "/work/docs-site", settings, drafts, true)).toEqual({
			scope: "repository", repository: "/work/docs-site", revision: null, values: {}, credentials: { linear: { token: "lin_key" } }, editTracked: false,
		});
		const machine = wizardSaveRequest("machine", "/work/docs-site", { ...settings, revision: "abc" }, draftsOf({}), false);
		expect(machine).toEqual({ scope: "machine", repository: null, revision: "abc", values: {}, editTracked: false });
		expect(wizardSaveRequest("repository", "/work/timber", { ...settings, tracked: true }, draftsOf({}), true).editTracked).toBe(true);
	});

	test("the last step says each choice in words, and never a login", () => {
		const drafts = draftsOf({});
		drafts.agent = { ...drafts.agent, mode: "set", command: "codex", enabled: true };
		drafts.editor = { ...drafts.editor, mode: "off" };
		drafts.tracking = { ...drafts.tracking, linearKey: "lin_secret" };
		const words = describeChoices(drafts, "repository");
		expect(words).toEqual([
			{ group: "editor", text: "Off" },
			{ group: "agent", text: "codex, starts by itself" },
			{ group: "git", text: "Machine default" },
			{ group: "scripts", text: "Machine default" },
			{ group: "tracking", text: "logins change" },
		]);
		expect(JSON.stringify(words)).not.toContain("lin_secret");
		expect(describeChoices(draftsOf({}), "machine")[0]).toEqual({ group: "editor", text: "Timber's default" });
	});

	test("the last step lists the sprint source, the Jira project, GitHub's project and milestone, and Linear's team", () => {
		const drafts = draftsOf({});
		drafts.tracking = {
			...drafts.tracking, jiraMode: "set", siteUrl: "https://example.atlassian.net", sprintSource: "board", board: "12", sprintJql: "ignored", jiraProject: "TIM",
			githubProject: "octo/2", githubMilestone: "v0.3", linearTeam: "ENG",
		};
		const tracking = describeChoices(drafts, "repository").find(choice => choice.group === "tracking");
		expect(tracking?.text).toBe("Jira at https://example.atlassian.net, board 12, project TIM, GitHub project octo/2, milestone v0.3, Linear team ENG");
		drafts.tracking = { ...drafts.tracking, sprintSource: "jql", sprintJql: "sprint in openSprints()", jiraProject: "", githubProject: "", githubMilestone: "", linearTeam: "" };
		expect(describeChoices(drafts, "repository").at(-1)?.text).toBe("Jira at https://example.atlassian.net, sprint from JQL");
		// Off or inherited, the sprint fields are not listed.
		drafts.tracking = { ...drafts.tracking, jiraMode: "off" };
		expect(describeChoices(drafts, "repository").at(-1)?.text).toBe("Jira off");
	});
});
